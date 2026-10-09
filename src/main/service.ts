import { EventEmitter } from 'events'
import {
  type BatteryConfig,
  type Connection,
  type DeviceInfo,
  type DeviceState,
  type Dialect,
  type Handshake,
  type HandshakeAttempt,
  type LogLine,
  type SendResult,
  type WriteMode
} from '@shared/types'
import { HidChannel, TimeoutError } from './hid-channel'
import { decodeReply, encodeCommand, toPrintable } from './protocol/framing'
import { Deriver } from './protocol/derived'
import {
  parseFirmware,
  parseProtocolId,
  parseQMOD,
  parseQPIGS,
  parseQPIRI,
  parseQPIWS,
  parseString
} from './protocol/parsers'

const POLL_MS = 1000
const PROBE_TIMEOUT_MS = 900
const QUERY_TIMEOUT_MS = 800
/** QPIGS is the slow one (~500 ms live). Give it headroom over a plain query. */
const POLL_TIMEOUT_MS = 1500
const WARMUP_TIMEOUT_MS = 1400
const FAILURES_BEFORE_GIVEUP = 5
const MAX_LOGS = 600
const MAX_DURATIONS = 60

function blankState(): DeviceState {
  return {
    connection: 'absent',
    info: null,
    handshake: null,
    mode: null,
    telemetry: null,
    settings: null,
    warnings: null,
    derived: null,
    stats: {
      ok: 0,
      failed: 0,
      consecutiveFailures: 0,
      lastOkAt: null,
      lastFailure: null,
      meanPollMs: 0
    }
  }
}

/**
 * Owns the connection lifecycle: hotplug -> open -> dialect handshake -> poll.
 *
 * Everything runs through a single mutex so there is never more than one
 * command in flight on the half-duplex HID link.
 */
export class InverterService extends EventEmitter {
  private readonly channel = new HidChannel()
  private readonly deriver = new Deriver()
  private state: DeviceState = blankState()
  private connecting = false
  private pollTimer: NodeJS.Timeout | null = null
  private cycle = 0
  private mutex: Promise<unknown> = Promise.resolve()
  private durations: number[] = []
  private logs: LogLine[] = []

  constructor() {
    super()
    this.channel.on('appeared', (info: DeviceInfo) => void this.connect(info))
    this.channel.on('close', (reason: string) => this.onClose(reason))
    this.channel.on('log', (line: LogLine) => this.log(line.kind, line.text, line.debug))
  }

  start(): void {
    this.channel.start()
  }

  stop(): void {
    this.stopPolling()
    this.channel.dispose()
  }

  snapshot(): DeviceState {
    return this.state
  }

  logSnapshot(): LogLine[] {
    return [...this.logs]
  }

  async sendCommand(command: string): Promise<SendResult> {
    const cmd = command.trim().replace(/\s+$/, '')
    if (!cmd) return { ok: false, tx: '', rx: null, error: 'empty command', crcValid: null }
    if (this.state.connection !== 'ready') {
      return { ok: false, tx: cmd, rx: null, error: 'not connected', crcValid: null }
    }

    try {
      const buf = await this.query(cmd, WARMUP_TIMEOUT_MS)
      const d = decodeReply(buf)
      return {
        ok: d.kind !== 'nak',
        tx: cmd,
        rx: toPrintable(buf, 512),
        error: d.kind === 'nak' ? 'NAK from inverter' : null,
        crcValid: d.crcValid
      }
    } catch (err) {
      this.log('err', `${cmd} failed: ${(err as Error).message}`)
      return { ok: false, tx: cmd, rx: null, error: (err as Error).message, crcValid: null }
    }
  }

  private async connect(info: DeviceInfo): Promise<void> {
    if (this.connecting || this.channel.isOpen) return
    this.connecting = true
    this.stopPolling()
    this.state = { ...blankState(), connection: 'connecting', info }
    this.deriver.reset()
    this.pushState()

    try {
      await this.channel.open(info.path)
    } catch (err) {
      this.fail(`open failed: ${(err as Error).message}`)
      this.connecting = false
      return
    }

    this.setConnection('handshaking')
    try {
      const handshake = await this.handshake()
      this.state.handshake = handshake
      await this.warmup()
      this.setConnection('ready')
      this.startPolling()
    } catch (err) {
      this.fail((err as Error).message)
    } finally {
      this.connecting = false
    }
  }

  private fail(message: string): void {
    this.log('err', message)
    this.state.connection = 'error'
    this.pushState()
    this.channel.close(message)
  }

  private onClose(reason: string): void {
    this.stopPolling()
    this.state.info = null
    this.state.mode = null
    if (this.state.connection !== 'error') this.state.connection = 'absent'
    this.pushState()
    this.log('sys', `link down: ${reason}`)
  }

  private setConnection(connection: Connection): void {
    this.state.connection = connection
    this.pushState()
    this.log('sys', `connection -> ${connection}`)
  }

  // ---------------------------------------------------------------- handshake

  private async handshake(): Promise<Handshake> {
    const attempts: HandshakeAttempt[] = []
    const modes: WriteMode[] = ['report', 'feature']
    const crcOptions = [true, false]
    let featureBroken = false

    for (const writeMode of modes) {
      // Once SetFeature reports "Incorrect function" this bridge will never
      // accept a feature report - stop asking, it just spams the log.
      if (writeMode === 'feature' && featureBroken) continue
      this.channel.writeMode = writeMode
      for (const useCrc of crcOptions) {
        for (const cmd of ['QPI', 'QPIGS', 'QMOD']) {
          const step = `${cmd} · ${writeMode} · ${useCrc ? 'crc' : 'plain'}`

          // The first query after the link comes up is reliably dropped, so a
          // single timeout here must not send us tumbling into the wrong
          // dialect. Give every probe two tries before moving on.
          for (let tryNo = 1; tryNo <= 2; tryNo++) {
            try {
              const buf = await this.rawExchange(cmd, useCrc, PROBE_TIMEOUT_MS)
              const d = decodeReply(buf)
              attempts.push({ step, ok: d.body.length > 0, detail: toPrintable(buf) })
              if (!d.body || d.kind === 'nak') break

              const id = parseProtocolId(d.body)
              if (id) return this.lockHandshake(attempts, 'pi30', writeMode, useCrc, { protocolId: id })
              if (parseQPIGS(d.body)) {
                return this.lockHandshake(attempts, 'pi30', writeMode, useCrc, { protocolId: null })
              }
              break // answered, but not PI30-shaped - don't retry
            } catch (err) {
              const msg = (err as Error).message
              attempts.push({ step, ok: false, detail: msg })
              if (writeMode === 'feature' && /Incorrect function/i.test(msg)) {
                featureBroken = true
                this.log('sys', 'feature reports unsupported on this bridge, skipping them')
                break
              }
              if (tryNo === 2) break
              await sleep(120)
            }
          }
          if (featureBroken) break
        }
        if (featureBroken) break
      }
    }

    for (const writeMode of modes) {
      this.channel.writeMode = writeMode
      for (const useCrc of crcOptions) {
        for (const cmd of ['QS', 'QGS', 'Q']) {
          const step = `${cmd} · ${writeMode} · ${useCrc ? 'crc' : 'plain'}`
          try {
            const buf = await this.rawExchange(cmd, useCrc, PROBE_TIMEOUT_MS)
            const d = decodeReply(buf)
            attempts.push({ step, ok: d.body.length > 0, detail: toPrintable(buf) })
            if (d.body) return this.lockHandshake(attempts, 'voltronic-qs', writeMode, useCrc, { protocolId: null })
          } catch (err) {
            attempts.push({ step, ok: false, detail: (err as Error).message })
          }
        }
      }
    }

    this.log('err', 'handshake: no dialect answered')
    this.state.handshake = {
      protocolId: null,
      dialect: 'unknown',
      writeMode: null,
      crcEnabled: null,
      firmware: null,
      serial: null,
      model: null,
      attempts
    }
    throw new Error('handshake failed: no dialect answered (see attempt log)')
  }

  private lockHandshake(
    attempts: HandshakeAttempt[],
    dialect: Dialect,
    writeMode: WriteMode,
    crcEnabled: boolean,
    ids: { protocolId: string | null }
  ): Handshake {
    this.channel.writeMode = writeMode
    this.log('sys', `handshake ok: dialect=${dialect} write=${writeMode} crc=${crcEnabled} ${ids.protocolId ?? ''}`)
    return {
      protocolId: ids.protocolId,
      dialect,
      writeMode,
      crcEnabled,
      firmware: null,
      serial: null,
      model: null,
      attempts
    }
  }

  /** The first query after link-up is reliably lost on this bridge - swallow it. */
  private async warmup(): Promise<void> {
    try {
      await this.query('QPIGS', WARMUP_TIMEOUT_MS)
    } catch (err) {
      this.log('sys', `warmup 1: ${(err as Error).message}`)
      try {
        await this.query('QPIGS', WARMUP_TIMEOUT_MS)
      } catch (err2) {
        this.log('err', `warmup 2: ${(err2 as Error).message}`)
      }
    }
    await this.identify()
  }

  private async identify(): Promise<void> {
    const hs = this.state.handshake
    if (!hs) return

    const probes: Array<[string, (body: string) => string | null]> = [
      ['QVFW', parseFirmware],
      ['QID', parseString],
      ['QMN', parseString]
    ]

    for (const [cmd, parse] of probes) {
      try {
        const buf = await this.query(cmd, QUERY_TIMEOUT_MS)
        const d = decodeReply(buf)
        // A NAK is the device saying "busy/unknown", not an identity string -
        // treating it as one is how a NAK ends up stored as the serial.
        if (d.kind === 'nak' || !d.body) {
          this.log('sys', `${cmd}: ${d.kind === 'nak' ? 'NAK' : 'empty reply'}`)
          continue
        }
        const value = parse(d.body)
        if (!value) continue
        if (cmd === 'QVFW') hs.firmware = value
        else if (cmd === 'QID') hs.serial = value
        else hs.model = value
        this.log('sys', `${cmd} -> ${value}`)
      } catch (err) {
        this.log('sys', `${cmd}: ${(err as Error).message}`)
      }
    }
    this.pushState()
  }

  // ------------------------------------------------------------------- polling

  private startPolling(): void {
    this.stopPolling()
    this.cycle = 0
    const tick = (): void => {
      if (!this.channel.isOpen || this.state.connection !== 'ready') return
      // Schedule the next tick only once this one has finished, so a slow or
      // failing poll can never stack on top of itself. Back off while the link
      // is unhealthy instead of hammering a device that is already struggling.
      void this.pollOnce().finally(() => {
        if (!this.channel.isOpen || this.state.connection !== 'ready') return
        const failed = this.state.stats.consecutiveFailures
        const delay = failed > 0 ? Math.min(POLL_MS * (1 + failed), 8000) : POLL_MS
        this.pollTimer = setTimeout(tick, delay)
      })
    }
    this.pollTimer = setTimeout(tick, POLL_MS)
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
  }

  private async pollOnce(): Promise<void> {
    const started = Date.now()
    try {
      const buf = await this.query('QPIGS', POLL_TIMEOUT_MS)
      const decoded = decodeReply(buf)

      // NAK means "busy / not now" on this bridge, not a dead link. Skip the
      // cycle without counting it as a failure - the next tick will retry.
      if (decoded.kind === 'nak' || !decoded.body) {
        this.log('sys', 'QPIGS busy (NAK), skipping cycle')
        return
      }

      const parsed = parseQPIGS(decoded.body, started)
      if (!parsed) throw new Error(`unparsable QPIGS: ${toPrintable(buf)}`)

      this.state.telemetry = parsed
      this.state.stats.ok++
      this.state.stats.consecutiveFailures = 0
      this.state.stats.lastOkAt = started

      // Analytics: battery health, energy totals, peaks, runtime, alarms.
      try {
        this.state.derived = this.deriver.ingest(parsed, this.state.warnings, started)
      } catch (err) {
        this.log('err', `derive failed: ${(err as Error).message}`)
      }

      this.cycle++
      await this.pollSecondary()
    } catch (err) {
      this.noteFailure((err as Error).message)
    } finally {
      this.recordDuration(Date.now() - started)
      this.pushState()
    }
  }

  private async pollSecondary(): Promise<void> {
    if (this.cycle % 5 === 0) {
      try {
        const buf = await this.query('QMOD')
        const d = decodeReply(buf)
        if (d.kind !== 'nak' && d.body) this.state.mode = parseQMOD(d.body)
      } catch (err) {
        this.log('sys', `QMOD: ${(err as Error).message}`)
      }
    }

    if (this.cycle % 10 === 0) {
      try {
        const buf = await this.query('QPIWS')
        const d = decodeReply(buf)
        if (d.kind !== 'nak' && d.body) this.state.warnings = parseQPIWS(d.body)
      } catch (err) {
        this.log('sys', `QPIWS: ${(err as Error).message}`)
      }
    }

    if (this.cycle % 60 === 0) {
      try {
        const buf = await this.query('QPIRI', WARMUP_TIMEOUT_MS)
        const d = decodeReply(buf)
        if (d.kind !== 'nak' && d.body) this.state.settings = parseQPIRI(d.body)
      } catch (err) {
        this.log('sys', `QPIRI: ${(err as Error).message}`)
      }
    }
  }

  private noteFailure(message: string): void {
    const s = this.state.stats
    s.failed++
    s.consecutiveFailures++
    s.lastFailure = message

    // A dead link fires once a second. Log the first few, then go quiet, then
    // speak up again right before we give up - otherwise the console is unreadable.
    const n = s.consecutiveFailures
    if (n <= 2 || n === FAILURES_BEFORE_GIVEUP || n % 10 === 0) {
      this.log('err', `poll failed (${n}/${FAILURES_BEFORE_GIVEUP}): ${message}`)
    }

    if (n >= FAILURES_BEFORE_GIVEUP && this.state.connection === 'ready') {
      this.fail(`link lost after ${n} consecutive failures`)
    }
  }

  private recordDuration(ms: number): void {
    this.durations.push(ms)
    if (this.durations.length > MAX_DURATIONS) this.durations.shift()
    this.state.stats.meanPollMs = Math.round(
      this.durations.reduce((a, b) => a + b, 0) / this.durations.length
    )
  }

  // ------------------------------------------------------------------- transport

  private query(cmd: string, timeoutMs = QUERY_TIMEOUT_MS): Promise<Buffer> {
    const useCrc = this.state.handshake?.crcEnabled ?? true
    return this.withLock(() => this.rawExchange(cmd, useCrc, timeoutMs))
  }

  private async rawExchange(cmd: string, useCrc: boolean, timeoutMs: number): Promise<Buffer> {
    return this.channel.request(encodeCommand(cmd, useCrc), { timeoutMs })
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutex.then(fn, fn)
    this.mutex = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  // ---------------------------------------------------------------------- misc

  private log(kind: LogLine['kind'], text: string, debug = false): void {
    const line: LogLine = { at: Date.now(), kind, text, debug }
    this.logs.push(line)
    if (this.logs.length > MAX_LOGS) this.logs.shift()
    this.emit('log', line)
  }

  private pushState(): void {
    this.emit('state', this.state)
  }

  /** Update the battery-bank model used for SoC, health and runtime estimates. */
  configureBattery(cfg: Partial<BatteryConfig>): void {
    this.deriver.configure(cfg)
    this.log(
      'sys',
      `battery model: ${this.deriver.config.chemistry} ${this.deriver.config.nominalVoltage}V ${this.deriver.config.capacityAh}Ah`
    )
    // Re-derive from the sample we already have so the UI updates immediately.
    if (this.state.telemetry) {
      try {
        this.state.derived = this.deriver.ingest(this.state.telemetry, this.state.warnings)
        this.pushState()
      } catch {
        /* next poll will refresh it */
      }
    }
  }

  get batteryConfig(): BatteryConfig {
    return this.deriver.config
  }

  /** Zero the energy counters, peaks and alarm history. */
  resetAnalytics(): void {
    this.deriver.reset()
    this.log('sys', 'analytics reset (energy, peaks, alarms, history)')
    if (this.state.telemetry) {
      try {
        this.state.derived = this.deriver.ingest(this.state.telemetry, this.state.warnings)
      } catch {
        /* next poll will refresh it */
      }
    }
    this.pushState()
  }
}

export { TimeoutError }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
