import { EventEmitter } from 'events'
import { HID, devices } from 'node-hid'
import { PRODUCT_ID, VENDOR_ID, type DeviceInfo, type LogLine, type WriteMode } from '@shared/types'
import { CR, toHex, toPrintable, toReport } from './protocol/framing'

export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`no reply within ${timeoutMs}ms`)
    this.name = 'TimeoutError'
  }
}

interface Pending {
  promise: Promise<Buffer>
  resolve: (frame: Buffer) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export interface RequestOptions {
  timeoutMs?: number
  quietMs?: number
}

const MONITOR_INTERVAL_MS = 1000
const MAX_RX = 16 * 1024

/**
 * Owns the HID handle and the half-duplex request/reply cycle.
 *
 * The bridge is one shared buffer with no OUT endpoint: exactly one command
 * may be in flight, and stale bytes are a known failure mode on this VID/PID
 * (NUT reports it replaying old responses). So every request waits for the
 * line to go quiet, flushes whatever is buffered, then writes, then collects
 * up to the next CR.
 */
export class HidChannel extends EventEmitter {
  private dev: HID | null = null
  private info: DeviceInfo | null = null
  private rx: Buffer = Buffer.alloc(0)
  private lastRxAt = 0
  private pending: Pending | null = null
  private monitor: NodeJS.Timeout | null = null
  private opening = false
  private disposed = false

  writeMode: WriteMode = 'report'

  get isOpen(): boolean {
    return this.dev !== null
  }

  get deviceInfo(): DeviceInfo | null {
    return this.info
  }

  static find(): ReturnType<typeof devices> {
    return devices(VENDOR_ID, PRODUCT_ID)
  }

  start(): void {
    if (this.monitor || this.disposed) return
    this.scan()
    this.monitor = setInterval(() => this.scan(), MONITOR_INTERVAL_MS)
    this.monitor.unref?.()
  }

  stop(): void {
    if (this.monitor) {
      clearInterval(this.monitor)
      this.monitor = null
    }
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    this.close('shutdown')
  }

  private scan(): void {
    if (this.opening || this.disposed) return
    let list: ReturnType<typeof devices>
    try {
      list = HidChannel.find()
    } catch {
      return
    }

    if (list.length === 0) {
      if (this.dev) this.close('unplugged')
      return
    }

    if (this.dev) return

    const match = pickDevice(list)
    if (match) this.emit('appeared', describe(match))
  }

  async open(path: string): Promise<void> {
    if (this.dev) return
    this.opening = true
    try {
      const dev = new HID(path)
      this.dev = dev
      this.info = describe({ ...HidChannel.find().find((d) => d.path === path), path })
      this.rx = Buffer.alloc(0)
      dev.on('data', (chunk) => this.onData(chunk as Uint8Array | number[]))
      dev.on('error', (err: Error) => this.onDeviceError(err))
      this.log('sys', `opened ${path}`)
      this.emit('open', this.info)
    } finally {
      this.opening = false
    }
  }

  close(reason: string): void {
    const dev = this.dev
    if (!dev) return
    this.dev = null
    const info = this.info
    this.info = null
    this.rx = Buffer.alloc(0)
    this.failPending(new Error(`device closed: ${reason}`))
    try {
      dev.removeAllListeners()
      dev.close()
    } catch {
      /* already gone */
    }
    this.log('sys', `closed (${reason})`)
    this.emit('close', reason, info)
  }

  private onDeviceError(err: Error): void {
    this.log('err', `hid error: ${err.message}`)
    this.close(err.message)
  }

  private onData(chunk: Uint8Array | number[]): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    if (buf.length === 0) return

    this.lastRxAt = Date.now()
    this.rx = this.rx.length + buf.length > MAX_RX ? buf : Buffer.concat([this.rx, buf])
    this.emit('bytes', buf)
    this.tryResolve()
  }

  private tryResolve(): void {
    if (!this.pending) return
    const idx = this.rx.indexOf(CR)
    if (idx < 0) return

    const frame = this.rx.subarray(0, idx + 1)
    this.rx = this.rx.subarray(idx + 1)
    const p = this.pending
    this.pending = null
    clearTimeout(p.timer)
    p.resolve(Buffer.from(frame))
  }

  private failPending(err: Error): void {
    if (!this.pending) return
    const p = this.pending
    this.pending = null
    clearTimeout(p.timer)
    p.reject(err)
  }

  /** Resolves once the line has been silent for `ms`. */
  async quiet(ms: number): Promise<void> {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const seen = this.lastRxAt
      await sleep(ms)
      if (this.lastRxAt === seen) return
    }
  }

  collect(timeoutMs: number): Promise<Buffer> {
    if (this.pending) return this.pending.promise

    let resolve!: (frame: Buffer) => void
    let reject!: (err: Error) => void
    const promise = new Promise<Buffer>((res, rej) => {
      resolve = res
      reject = rej
    })

    const timer = setTimeout(() => {
      if (this.pending?.timer === timer) this.pending = null
      reject(new TimeoutError(timeoutMs))
    }, timeoutMs)

    this.pending = { promise, resolve, reject, timer }
    this.tryResolve()
    return promise
  }

  write(bytes: Uint8Array): number {
    const dev = this.dev
    if (!dev) throw new Error('device not open')
    const report = toReport(Buffer.from(bytes))
    const written = this.writeMode === 'feature' ? dev.sendFeatureReport(report) : dev.write(report)
    this.log('tx', `${this.writeMode} ${toPrintable(bytes)}  ${toHex(report)}`)
    return written
  }

  /**
   * One half-duplex exchange: quiet the line, flush stale bytes, arm the
   * collector, then write.
   */
  async request(frame: Buffer, opts: RequestOptions = {}): Promise<Buffer> {
    const { timeoutMs = 800, quietMs = 80 } = opts
    if (!this.dev) throw new Error('device not open')

    await this.quiet(quietMs)
    this.rx = Buffer.alloc(0)

    const reply = this.collect(timeoutMs)
    try {
      this.write(frame)
    } catch (err) {
      this.failPending(err as Error)
      this.log('err', `write failed: ${(err as Error).message}`)
    }

    const buf = await reply
    this.log('rx', `${toPrintable(buf)}  ${toHex(buf)}`)
    return buf
  }

  log(kind: LogLine['kind'], text: string): void {
    const line: LogLine = { at: Date.now(), kind, text }
    this.emit('log', line)
  }
}

function pickDevice(list: ReturnType<typeof devices>) {
  const exact = list.filter((d) => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID)
  return exact.find((d) => d.usagePage === 0xff00 && d.usage === 0x01) ?? exact[0]
}

function describe(d: Partial<ReturnType<typeof devices>[number]> & { path?: string }): DeviceInfo {
  return {
    path: d.path ?? '',
    vendorId: d.vendorId ?? 0,
    productId: d.productId ?? 0,
    manufacturer: d.manufacturer,
    product: d.product,
    serialNumber: d.serialNumber,
    release: d.release
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
