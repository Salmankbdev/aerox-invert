import './style.css'
import type { DeviceState, LogLine, Settings, Status2Flags, StatusFlags, Telemetry } from '@shared/types'
import { MODE_LABEL } from '@shared/types'

const app = document.getElementById('app')

if (!app) throw new Error('#app missing')

app.innerHTML = `
<header class="top">
  <div class="brand">
    <span class="brand__mark">AEROX</span>
    <span class="brand__model">1.2KW · INVEREX</span>
  </div>
  <div class="pills">
    <span class="pill" id="pill-connection">disconnected</span>
    <span class="pill pill--muted" id="pill-dialect">dialect —</span>
    <span class="pill pill--muted" id="pill-link">link —</span>
    <span class="pill pill--muted" id="pill-protocol">—</span>
  </div>
  <div class="meta" id="meta">waiting for device</div>
</header>

<main>
  <section class="hero">
    <article class="hero__card" data-tone="pv">
      <h2>PV power</h2>
      <p class="value"><span data-f="pv-power">—</span><small>W</small></p>
      <p class="sub"><span data-f="pv-voltage">—</span> V · <span data-f="pv-current">—</span> A</p>
      <div class="bar"><i data-b="pv"></i></div>
    </article>
    <article class="hero__card" data-tone="batt">
      <h2>Battery</h2>
      <p class="value"><span data-f="batt-voltage">—</span><small>V</small></p>
      <p class="sub"><span data-f="batt-current">—</span> A in · <span data-f="batt-discharge">—</span> A out</p>
      <div class="bar"><i data-b="batt"></i></div>
    </article>
    <article class="hero__card" data-tone="load">
      <h2>Load</h2>
      <p class="value"><span data-f="load-power">—</span><small>W</small></p>
      <p class="sub"><span data-f="load-percent">—</span> % · <span data-f="load-va">—</span> VA</p>
      <div class="bar"><i data-b="load"></i></div>
    </article>
    <article class="hero__card" data-tone="ac">
      <h2>AC output</h2>
      <p class="value"><span data-f="ac-voltage">—</span><small>V</small></p>
      <p class="sub"><span data-f="ac-frequency">—</span> Hz · <span data-f="ac-mode">—</span></p>
      <div class="bar"><i data-b="ac"></i></div>
    </article>
  </section>

  <section class="row row--split">
    <div class="panel">
      <h3>Telemetry <span class="panel__hint" id="stale">—</span></h3>
      <dl class="grid" id="tiles"></dl>
    </div>
    <div class="panel">
      <h3>State</h3>
      <div class="mode" id="mode">—</div>
      <ul class="chips" id="flags"></ul>
      <h3 class="panel__sub">Warnings</h3>
      <ul class="chips chips--warn" id="warnings"><li class="chip chip--ok">none</li></ul>
    </div>
  </section>

  <section class="row row--split">
    <div class="panel">
      <h3>Settings</h3>
      <dl class="grid" id="settings"></dl>
    </div>
    <div class="panel panel--console">
      <h3>Console</h3>
      <div class="log" id="log"></div>
      <form class="cmd" id="cmd-form">
        <input id="cmd" placeholder="type a command, e.g. QPIGS" autocomplete="off" spellcheck="false" />
        <button type="submit">send</button>
      </form>
    </div>
  </section>
</main>
`

const $ = (selector: string): HTMLElement => {
  const el = app!.querySelector(selector)
  if (!el) throw new Error(`missing ${selector}`)
  return el as HTMLElement
}

const setText = (selector: string, value: string): void => {
  const el = app!.querySelector(selector)
  if (el) el.textContent = value
}

const num = (v: number | null | undefined, digits = 1): string =>
  v !== null && v !== undefined && Number.isFinite(v) ? v.toFixed(digits) : '—'

const int = (v: number | null | undefined): string =>
  v !== null && v !== undefined && Number.isFinite(v) ? String(Math.round(v)) : '—'

const when = (timestamp: number | null): string => {
  if (!timestamp) return '—'
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds.toFixed(0)}s ago`
  return `${Math.floor(seconds / 60)}m ago`
}

interface Tile {
  label: string
  unit: string
  read: (t: Telemetry) => number | null
  digits: number
}

const TILES: Tile[] = [
  { label: 'AC input', unit: 'V', digits: 1, read: (t) => t.acInputVoltage },
  { label: 'Grid', unit: 'Hz', digits: 1, read: (t) => t.acInputFrequency },
  { label: 'Output', unit: 'Hz', digits: 1, read: (t) => t.acOutputFrequency },
  { label: 'DC bus', unit: 'V', digits: 0, read: (t) => t.busVoltage },
  { label: 'PV voltage', unit: 'V', digits: 1, read: (t) => t.pvVoltage },
  { label: 'PV current', unit: 'A', digits: 2, read: (t) => t.pvCurrent },
  { label: 'SCC voltage', unit: 'V', digits: 2, read: (t) => t.batteryVoltageFromScc },
  { label: 'Capacity', unit: '%', digits: 0, read: (t) => t.batteryCapacity },
  { label: 'Heat sink', unit: '°C', digits: 0, read: (t) => t.heatSinkTemperature },
  { label: 'Discharge', unit: 'A', digits: 0, read: (t) => t.batteryDischargeCurrent }
]

const tiles = $('#tiles')
tiles.innerHTML = TILES.map(
  (t) => `<div class="tile"><dt>${t.label}</dt><dd><span data-tile="${t.label}">—</span><small>${t.unit}</small></dd></div>`
).join('')

interface SettingRow {
  label: string
  read: (s: Settings) => string | number | null
}

const SETTINGS: SettingRow[] = [
  { label: 'Output V / Hz', read: (s) => `${num(s.acOutputVoltage)} / ${num(s.acOutputFrequency)}` },
  { label: 'Rated VA / W', read: (s) => `${int(s.acOutputApparentPower)} / ${int(s.acOutputActivePower)}` },
  { label: 'Battery type', read: (s) => s.batteryType },
  { label: 'Bulk / float', read: (s) => `${num(s.batteryBulkChargeVoltage)} / ${num(s.batteryFloatChargeVoltage)}` },
  { label: 'Recharge / cut-off', read: (s) => `${num(s.batteryRechargeVoltage)} / ${num(s.batteryUnderVoltage)}` },
  { label: 'Max AC charge', read: (s) => (s.maxAcChargingCurrent === null ? null : `${int(s.maxAcChargingCurrent)} A`) },
  { label: 'Max charge', read: (s) => (s.maxChargingCurrent === null ? null : `${int(s.maxChargingCurrent)} A`) },
  { label: 'Output priority', read: (s) => s.outputSourcePriority },
  { label: 'Charger priority', read: (s) => s.chargerSourcePriority },
  { label: 'Input range', read: (s) => s.inputVoltageRange },
  { label: 'Machine type', read: (s) => s.machineType },
  { label: 'Parallel units', read: (s) => s.maxParallelUnits }
]

const settingsEl = $('#settings')
settingsEl.innerHTML = SETTINGS.map(
  (s) => `<div class="tile"><dt>${s.label}</dt><dd><span data-set="${s.label}">—</span></dd></div>`
).join('')

const FLAG_LABELS: Array<[keyof StatusFlags | keyof Status2Flags, string]> = [
  ['loadOn', 'Load on'],
  ['chargingOn', 'Charging'],
  ['sccChargingOn', 'SCC charging'],
  ['acChargingOn', 'AC charging'],
  ['chargingToFloat', 'Float stage'],
  ['batteryVoltageSteadyWhileCharging', 'Batt steady'],
  ['sbuPriorityVersionAdded', 'SBU version'],
  ['configurationChanged', 'Config changed'],
  ['sccFirmwareUpdated', 'SCC fw updated'],
  ['switchedOn', 'Switched on']
]

let currentMode: string | null = null

function renderTelemetry(t: Telemetry): void {
  const pvPower = Number.isFinite(t.pvInputPower) ? t.pvInputPower : t.pvVoltage * t.pvCurrent

  setText('[data-f="pv-power"]', int(pvPower))
  setText('[data-f="pv-voltage"]', num(t.pvVoltage))
  setText('[data-f="pv-current"]', num(t.pvCurrent, 2))
  setText('[data-f="batt-voltage"]', num(t.batteryVoltage, 2))
  setText('[data-f="batt-current"]', int(t.batteryChargingCurrent))
  setText('[data-f="batt-discharge"]', int(t.batteryDischargeCurrent))
  setText('[data-f="load-power"]', int(t.acOutputActivePower))
  setText('[data-f="load-percent"]', int(t.acOutputLoad))
  setText('[data-f="load-va"]', int(t.acOutputApparentPower))
  setText('[data-f="ac-voltage"]', num(t.acOutputVoltage))
  setText('[data-f="ac-frequency"]', num(t.acOutputFrequency))

  for (const tile of TILES) {
    setText(`[data-tile="${tile.label}"]`, num(tile.read(t), tile.digits))
  }

  const bars: Array<[string, number]> = [
    ['pv', clamp(pvPower / 700)],
    ['batt', clamp(t.batteryCapacity / 100)],
    ['load', clamp(t.acOutputLoad / 100)],
    ['ac', clamp(t.acOutputVoltage / 250)]
  ]
  for (const [key, ratio] of bars) {
    const el = app!.querySelector(`[data-b="${key}"]`)
    if (el) (el as HTMLElement).style.transform = `scaleX(${ratio.toFixed(3)})`
  }

  const flagHost = $('#flags')
  flagHost.innerHTML = FLAG_LABELS.map(([key, label]) => {
    const active =
      key in t.status ? t.status[key as keyof StatusFlags] : t.status2[key as keyof Status2Flags]
    return `<li class="chip${active ? ' chip--on' : ''}">${label}</li>`
  }).join('')

  setText('#ac-mode', currentMode ? (MODE_LABEL[currentMode] ?? currentMode) : '—')
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function renderSettings(s: Settings): void {
  for (const row of SETTINGS) {
    const value = row.read(s)
    setText(`[data-set="${row.label}"]`, value === null || value === undefined ? '—' : String(value))
  }
}

const CONNECTION_LABEL: Record<string, string> = {
  absent: 'disconnected',
  connecting: 'connecting',
  handshaking: 'handshaking',
  ready: 'connected',
  error: 'error'
}

function renderState(state: DeviceState): void {
  currentMode = state.mode

  const pill = $('#pill-connection')
  pill.textContent = CONNECTION_LABEL[state.connection] ?? state.connection
  pill.dataset.tone = state.connection

  const hs = state.handshake
  setText('#pill-dialect', hs ? `dialect ${hs.dialect}` : 'dialect —')
  setText('#pill-link', hs?.writeMode ? `${hs.writeMode} · ${hs.crcEnabled ? 'crc' : 'plain'}` : 'link —')
  setText('#pill-protocol', hs?.protocolId ?? '—')

  const meta: string[] = []
  if (hs?.model) meta.push(hs.model)
  if (hs?.serial) meta.push(`SN ${hs.serial}`)
  if (hs?.firmware) meta.push(`fw ${hs.firmware}`)
  meta.push(`${state.stats.ok} ok / ${state.stats.failed} failed`, `${state.stats.meanPollMs} ms`)
  if (state.stats.lastFailure) meta.push(`last error: ${state.stats.lastFailure}`)
  setText('#meta', meta.join(' · '))

  if (state.telemetry) {
    renderTelemetry(state.telemetry)
    setText('#stale', `updated ${when(state.telemetry.at)}`)
  }

  if (state.settings) renderSettings(state.settings)

  setText('#mode', state.mode ? (MODE_LABEL[state.mode] ?? state.mode) : '—')

  const warnings = $('#warnings')
  if (!state.warnings || state.warnings.active.length === 0) {
    warnings.innerHTML = '<li class="chip chip--ok">none</li>'
  } else {
    warnings.innerHTML = state.warnings.active
      .map((w) => `<li class="chip chip--fault">${escapeHtml(w)}</li>`)
      .join('')
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

const logHost = $('#log')
const MAX_LOG_NODES = 400

function appendLog(line: LogLine): void {
  const at = new Date(line.at).toLocaleTimeString('en-GB', { hour12: false })
  const row = document.createElement('div')
  row.className = `log__line log__line--${line.kind}`
  row.innerHTML = `<span class="log__time">${at}</span><span class="log__kind">${line.kind}</span><span class="log__text">${escapeHtml(line.text)}</span>`
  logHost.appendChild(row)

  while (logHost.childElementCount > MAX_LOG_NODES) logHost.removeChild(logHost.firstElementChild!)

  const nearBottom = logHost.scrollHeight - logHost.scrollTop - logHost.clientHeight < 48
  if (nearBottom) logHost.scrollTop = logHost.scrollHeight
}

$('#cmd-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const input = $('#cmd') as HTMLInputElement
  const command = input.value.trim()
  if (!command) return
  input.value = ''
  void window.aerox
    .send({ command })
    .then((result) => {
      appendLog({
        at: Date.now(),
        kind: result.ok ? 'tx' : 'err',
        text: `${result.tx} → ${result.rx ?? result.error ?? 'no reply'}${result.crcValid === false ? ' [crc mismatch]' : ''}`
      })
    })
    .catch((err: unknown) => appendLog({ at: Date.now(), kind: 'err', text: String(err) }))
})

async function boot(): Promise<void> {
  window.aerox.onLog(appendLog)
  window.aerox.onState(renderState)

  try {
    const { state, logs } = await window.aerox.getState()
    logs.forEach(appendLog)
    renderState(state)
  } catch (err) {
    appendLog({ at: Date.now(), kind: 'err', text: `boot: ${String(err)}` })
  }
}

void boot()
