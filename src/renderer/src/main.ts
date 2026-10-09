import './style.css'
import type {
  AlarmEvent,
  DerivedState,
  DeviceState,
  HistoryPoint,
  LogLine,
  SettingKey,
  Settings,
  Status2Flags,
  StatusFlags,
  Telemetry
} from '@shared/types'
import { MODE_LABEL } from '@shared/types'
import { SETTING_SPECS, type SettingSpec } from '@shared/settings-spec'

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

<div class="notice" id="notice" hidden></div>

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

  <section class="row row--analytics">
    <div class="panel panel--health">
      <h3>Battery health <span class="panel__hint" id="health-verdict">—</span></h3>
      <div class="health">
        <div class="health__score">
          <span class="health__number" id="health-score">—</span>
          <span class="health__unit">/100</span>
          <div class="bar bar--tall"><i id="health-bar" style="background:var(--ok)"></i></div>
        </div>
        <dl class="health__stats">
          <div><dt>SoC (voltage)</dt><dd id="soc-voltage">—</dd></div>
          <div><dt>SoC (reported)</dt><dd id="soc-reported">—</dd></div>
          <div><dt>SoC delta</dt><dd id="soc-delta">—</dd></div>
          <div><dt>Internal R</dt><dd id="internal-r">—</dd></div>
          <div><dt>Voltage sag</dt><dd id="voltage-sag">—</dd></div>
          <div><dt>Min voltage</dt><dd id="min-voltage">—</dd></div>
          <div><dt>Max discharge</dt><dd id="max-discharge">—</dd></div>
        </dl>
      </div>
      <ul class="chips" id="health-notes"></ul>
    </div>

    <div class="panel">
      <h3>Runtime &amp; state</h3>
      <div class="runtime">
        <div class="runtime__main">
          <span class="runtime__value" id="runtime-value">—</span>
          <span class="runtime__label" id="runtime-label">estimate</span>
        </div>
        <dl class="health__stats">
          <div><dt>Remaining</dt><dd id="remaining-wh">—</dd></div>
          <div><dt>Bank size</dt><dd id="bank-wh">—</dd></div>
          <div><dt>Load now</dt><dd id="load-now">—</dd></div>
          <div><dt>On battery</dt><dd id="on-battery">—</dd></div>
          <div><dt>Time on batt</dt><dd id="time-on-batt">—</dd></div>
          <div><dt>Since grid fail</dt><dd id="since-grid">—</dd></div>
          <div><dt>PV efficiency</dt><dd id="pv-eff">—</dd></div>
          <div><dt>Charge / discharge</dt><dd id="charge-discharge">—</dd></div>
        </dl>
      </div>
    </div>

    <div class="panel">
      <h3>Energy <span class="panel__hint">since start · today</span></h3>
      <dl class="grid grid--energy" id="energy"></dl>
      <h3 class="panel__sub">Peaks</h3>
      <dl class="grid grid--energy" id="peaks"></dl>
      <div class="actions">
        <button type="button" id="btn-reset" class="btn">reset counters</button>
      </div>
    </div>
  </section>

  <section class="row row--charts">
    <div class="panel">
      <h3>Power history <span class="panel__hint">last 10 min</span></h3>
      <canvas id="chart-power" width="600" height="120"></canvas>
      <ul class="legend">
        <li><i style="background:var(--pv)"></i>PV</li>
        <li><i style="background:var(--load)"></i>Load</li>
      </ul>
    </div>
    <div class="panel">
      <h3>Battery voltage <span class="panel__hint">last 10 min</span></h3>
      <canvas id="chart-voltage" width="600" height="120"></canvas>
      <ul class="legend">
        <li><i style="background:var(--batt)"></i>Battery V</li>
      </ul>
    </div>
  </section>

  <section class="row row--alarms">
    <div class="panel">
      <h3>Alarm history <span class="panel__hint" id="alarm-count">0</span></h3>
      <ul class="alarms" id="alarms"><li class="alarms__empty">no alarms recorded</li></ul>
    </div>
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
      <h3>Settings <span class="panel__hint" id="settings-hint">—</span></h3>
      <dl class="grid" id="settings"></dl>
    </div>
    <div class="panel panel--console">
      <h3>Console</h3>
      <div class="log" id="log"></div>
      <form class="cmd" id="cmd-form">
        <input
          id="cmd"
          placeholder="type a command, e.g. QPIGS"
          autocomplete="off"
          spellcheck="false"
          maxlength="64"
        />
        <button type="submit">send</button>
      </form>
    </div>
  </section>

  <section class="row">
    <div class="panel">
      <h3>Configuration <span class="panel__hint" id="config-hint">waiting for device</span></h3>
      <div class="config" id="config"></div>
      <p class="config__note">
        A write goes to the inverter immediately. Some units only keep it across a power cycle
        once it has been saved to EEPROM.
      </p>
      <div class="actions">
        <button type="button" id="btn-eeprom" class="btn">save to EEPROM</button>
      </div>
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

// ------------------------------------------------------------- configuration

interface ConfigRow {
  spec: SettingSpec
  readout: HTMLElement
  input: HTMLSelectElement | HTMLInputElement
  command: HTMLElement
  result: HTMLElement
  apply: HTMLButtonElement
}

const configHost = $('#config')
const eepromButton = $('#btn-eeprom') as HTMLButtonElement
const configRows = new Map<SettingKey, ConfigRow>()
/** Edited but not yet written - a poll must not clobber a half-made change. */
const dirtySettings = new Set<SettingKey>()

/** Where each writable parameter's current value lives in a QPIRI snapshot. */
const CURRENT_VALUE: Record<SettingKey, (s: Settings) => { value: number | null; label: string }> = {
  outputSourcePriority: (s) => ({
    value: s.outputSourcePriorityIndex,
    label: s.outputSourcePriority ?? '—'
  }),
  chargerSourcePriority: (s) => ({
    value: s.chargerSourcePriorityIndex,
    label: s.chargerSourcePriority ?? '—'
  }),
  inputVoltageRange: (s) => ({ value: s.inputVoltageRangeIndex, label: s.inputVoltageRange ?? '—' }),
  batteryType: (s) => ({ value: s.batteryTypeIndex, label: s.batteryType ?? '—' }),
  batteryBulkChargeVoltage: (s) => ({
    value: s.batteryBulkChargeVoltage,
    label: `${num(s.batteryBulkChargeVoltage)} V`
  }),
  batteryFloatChargeVoltage: (s) => ({
    value: s.batteryFloatChargeVoltage,
    label: `${num(s.batteryFloatChargeVoltage)} V`
  }),
  batteryRechargeVoltage: (s) => ({
    value: s.batteryRechargeVoltage,
    label: `${num(s.batteryRechargeVoltage)} V`
  }),
  batteryUnderVoltage: (s) => ({ value: s.batteryUnderVoltage, label: `${num(s.batteryUnderVoltage)} V` }),
  batteryRedischargeVoltage: (s) => ({
    value: s.batteryRedischargeVoltage,
    label: `${num(s.batteryRedischargeVoltage)} V`
  }),
  maxChargingCurrent: (s) => ({ value: s.maxChargingCurrent, label: `${int(s.maxChargingCurrent)} A` }),
  maxAcChargingCurrent: (s) => ({
    value: s.maxAcChargingCurrent,
    label: `${int(s.maxAcChargingCurrent)} A`
  }),
  outputFrequency: (s) => ({
    value: s.acOutputFrequency === null ? null : Math.round(s.acOutputFrequency / 10) * 10,
    label: `${num(s.acOutputFrequency)} Hz`
  })
}

function buildConfigRows(): void {
  for (const spec of SETTING_SPECS) {
    const row = document.createElement('div')
    row.className = 'config__row'

    const meta = document.createElement('div')
    meta.className = 'config__meta'
    const label = document.createElement('dt')
    label.textContent = spec.label
    const readout = document.createElement('dd')
    readout.textContent = '—'
    meta.append(label, readout)

    const field = document.createElement('div')
    field.className = 'config__field'

    let input: HTMLSelectElement | HTMLInputElement
    if (spec.kind === 'select' && spec.options) {
      const select = document.createElement('select')
      for (const option of spec.options) {
        const el = document.createElement('option')
        el.value = String(option.value)
        el.textContent = option.label
        select.appendChild(el)
      }
      input = select
    } else {
      const number = document.createElement('input')
      number.type = 'number'
      number.min = String(spec.min)
      number.max = String(spec.max)
      number.step = String(spec.step)
      input = number
    }
    input.disabled = true
    input.addEventListener('input', () => {
      dirtySettings.add(spec.key)
      updateCommandPreview(spec.key)
    })

    const command = document.createElement('code')
    command.className = 'config__cmd'

    const apply = document.createElement('button')
    apply.type = 'button'
    apply.className = 'btn btn--apply'
    apply.textContent = 'apply'
    apply.disabled = true
    apply.addEventListener('click', () => void applySetting(spec))

    const result = document.createElement('span')
    result.className = 'config__result'

    field.append(input, apply, command, result)

    const help = document.createElement('p')
    help.className = 'config__help'
    help.textContent = spec.help

    row.append(meta, field, help)
    configHost.appendChild(row)
    configRows.set(spec.key, { spec, readout, input, command, result, apply })
  }
}

function updateCommandPreview(key: SettingKey): void {
  const row = configRows.get(key)
  if (!row) return
  const raw = row.input.value
  const value = Number(raw)
  row.command.textContent =
    raw === '' || !Number.isFinite(value) ? '—' : `${row.spec.command}${row.spec.encode(value)}`
}

async function applySetting(spec: SettingSpec): Promise<void> {
  const row = configRows.get(spec.key)
  if (!row) return

  const raw = row.input.value
  const value = Number(raw)
  if (raw === '' || !Number.isFinite(value)) {
    row.result.textContent = 'enter a value'
    row.result.dataset.tone = 'err'
    return
  }

  row.apply.disabled = true
  row.result.dataset.tone = ''
  row.result.textContent = 'sending…'

  try {
    const result = await window.aerox.setSetting({ key: spec.key, value })
    row.result.textContent = result.ok ? `✓ ${result.command}` : `✗ ${result.error ?? 'rejected'}`
    row.result.dataset.tone = result.ok ? 'ok' : 'err'
    if (result.ok) dirtySettings.delete(spec.key)
    appendLog({
      at: Date.now(),
      kind: result.ok ? 'tx' : 'err',
      text: `${result.command || spec.key} → ${result.rx ?? result.error ?? 'no reply'}`
    })
  } catch (err) {
    row.result.textContent = `✗ ${String(err)}`
    row.result.dataset.tone = 'err'
  } finally {
    row.apply.disabled = lastConnection !== 'ready'
  }
}

function renderConfiguration(state: DeviceState): void {
  const ready = state.connection === 'ready'
  const settings = state.settings
  setText('#config-hint', ready ? (settings ? 'read from device' : 'reading…') : 'waiting for device')
  eepromButton.disabled = !ready

  for (const [key, row] of configRows) {
    row.input.disabled = !ready
    row.apply.disabled = !ready

    const current = settings ? CURRENT_VALUE[key](settings) : { value: null, label: '—' }
    row.readout.textContent = current.label
    if (current.value !== null && !dirtySettings.has(key)) row.input.value = String(current.value)
    updateCommandPreview(key)
  }
}

buildConfigRows()

// ------------------------------------------------------------- derived panels

const VERDICT_TONE: Record<string, string> = {
  good: 'var(--ok)',
  fair: 'var(--load)',
  poor: 'var(--ac)',
  critical: 'var(--fault)',
  unknown: 'var(--muted)'
}

function formatDuration(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) return '—'
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`
  return `${Math.floor(h / 24)} d ${h % 24} h`
}

function formatEnergy(wattHours: number): string {
  if (!Number.isFinite(wattHours)) return '—'
  if (Math.abs(wattHours) < 1000) return `${Math.round(wattHours)} Wh`
  return `${(wattHours / 1000).toFixed(2)} kWh`
}

function formatSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  if (seconds < 60) return `${Math.round(seconds)} s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h < 24) return `${h} h ${m} min`
  return `${Math.floor(h / 24)} d ${h % 24} h`
}

const ENERGY_ROWS: Array<{ key: string; label: string; pick: (e: DerivedState['energy']) => string }> = [
  { key: 'pv', label: 'PV generated', pick: (e) => `${formatEnergy(e.pvWh)} · ${formatEnergy(e.pvWhToday)}` },
  { key: 'load', label: 'Load consumed', pick: (e) => `${formatEnergy(e.loadWh)} · ${formatEnergy(e.loadWhToday)}` },
  { key: 'chg', label: 'Battery charged', pick: (e) => `${formatEnergy(e.chargeWh)} · ${formatEnergy(e.chargeWhToday)}` },
  { key: 'dch', label: 'Battery discharged', pick: (e) => `${formatEnergy(e.dischargeWh)} · ${formatEnergy(e.dischargeWhToday)}` },
  { key: 'net', label: 'Net battery', pick: (e) => formatEnergy(e.netWh) }
]

const energyEl = $('#energy')
energyEl.innerHTML = ENERGY_ROWS.map(
  (r) => `<div class="tile"><dt>${r.label}</dt><dd><span data-energy="${r.key}">—</span></dd></div>`
).join('')

const PEAK_ROWS: Array<{ key: string; label: string; pick: (p: DerivedState['peaks']) => string }> = [
  { key: 'pv', label: 'PV peak', pick: (p) => `${p.pvMaxW} W` },
  { key: 'load', label: 'Load peak', pick: (p) => `${p.loadMaxW} W` },
  { key: 'batt', label: 'Battery range', pick: (p) => `${p.battVMin} – ${p.battVMax} V` },
  { key: 'grid', label: 'Grid range', pick: (p) => `${p.gridVMin} – ${p.gridVMax} V` },
  { key: 'temp', label: 'Peak temp', pick: (p) => `${p.tempMax} °C` }
]

const peaksEl = $('#peaks')
peaksEl.innerHTML = PEAK_ROWS.map(
  (r) => `<div class="tile"><dt>${r.label}</dt><dd><span data-peak="${r.key}">—</span></dd></div>`
).join('')

function renderDerived(d: DerivedState): void {
  // Battery health
  const b = d.battery
  setText('#health-score', String(b.healthScore))
  setText('#health-verdict', b.verdict)
  const scoreBar = $('#health-bar')
  scoreBar.style.transform = `scaleX(${clamp(b.healthScore / 100).toFixed(3)})`
  scoreBar.style.background = VERDICT_TONE[b.verdict] ?? 'var(--muted)'

  setText('#soc-voltage', `${b.socVoltage}%`)
  setText('#soc-reported', `${b.socReported}%`)
  const delta = b.socDelta
  const deltaEl = $('#soc-delta')
  deltaEl.textContent = delta > 0 ? `+${delta}%` : `${delta}%`
  deltaEl.style.color = Math.abs(delta) > 15 ? 'var(--load)' : ''
  setText('#internal-r', `${b.internalResistanceMOhm} mΩ`)
  setText('#voltage-sag', `${b.sagVoltage.toFixed(3)} V`)
  setText('#min-voltage', `${b.minVoltage} V`)
  setText('#max-discharge', `${b.maxDischargeA} A`)

  const notes = $('#health-notes')
  notes.innerHTML = b.notes.length
    ? b.notes.map((n) => `<li class="chip">${escapeHtml(n)}</li>`).join('')
    : '<li class="chip chip--ok">no concerns</li>'

  // Runtime
  const r = d.runtime
  setText('#runtime-value', formatDuration(r.minutes))
  setText('#runtime-label', r.minutes === null ? (d.onBattery ? 'charging or idle' : 'on grid') : `based on ${r.basis}`)
  setText('#remaining-wh', formatEnergy(r.remainingWh))
  setText('#bank-wh', formatEnergy(r.bankWh))
  setText('#load-now', `${r.loadW} W`)
  setText('#on-battery', d.onBattery ? 'yes' : 'no')
  setText('#time-on-batt', formatSeconds(d.secondsOnBattery))
  setText('#since-grid', formatSeconds(d.secondsSinceGridFail))
  setText('#pv-eff', d.pvEfficiency === null ? '—' : `${d.pvEfficiency}%`)
  setText('#charge-discharge', `+${d.chargeRateA} / −${d.dischargeRateA} A`)

  // Energy + peaks
  for (const row of ENERGY_ROWS) setText(`[data-energy="${row.key}"]`, row.pick(d.energy))
  for (const row of PEAK_ROWS) setText(`[data-peak="${row.key}"]`, row.pick(d.peaks))

  renderAlarms(d.alarms)
  drawCharts(d.history)
}

function renderAlarms(alarms: AlarmEvent[]): void {
  setText('#alarm-count', String(alarms.length))
  const host = $('#alarms')
  if (!alarms.length) {
    host.innerHTML = '<li class="alarms__empty">no alarms recorded</li>'
    return
  }
  host.innerHTML = alarms
    .map((a) => {
      const start = new Date(a.at).toLocaleTimeString('en-GB', { hour12: false })
      const dur = a.clearedAt ? formatSeconds(Math.round((a.clearedAt - a.at) / 1000)) : 'active'
      const cls = a.clearedAt ? 'alarm--cleared' : 'alarm--active'
      return `<li class="alarm ${cls}"><span class="alarm__time">${start}</span><span class="alarm__name">${escapeHtml(a.warning)}</span><span class="alarm__dur">${dur}</span></li>`
    })
    .join('')
}

// -------------------------------------------------------------------- charts

function drawLine(
  canvas: HTMLCanvasElement,
  series: Array<{ points: number[]; color: string; fill?: boolean }>,
  opts: { min?: number; max?: number } = {}
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth || canvas.width
  const cssH = canvas.clientHeight || canvas.height
  if (canvas.width !== Math.round(cssW * dpr)) canvas.width = Math.round(cssW * dpr)
  if (canvas.height !== Math.round(cssH * dpr)) canvas.height = Math.round(cssH * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  ctx.clearRect(0, 0, cssW, cssH)
  if (!series.length || !series[0].points.length) return

  let lo = opts.min
  let hi = opts.max
  if (lo === undefined || hi === undefined) {
    let dataLo = Infinity
    let dataHi = -Infinity
    for (const s of series) {
      for (const p of s.points) {
        if (!Number.isFinite(p)) continue
        if (p < dataLo) dataLo = p
        if (p > dataHi) dataHi = p
      }
    }
    if (!Number.isFinite(dataLo)) return
    const pad = (dataHi - dataLo) * 0.1 || 1
    lo = lo ?? dataLo - pad
    hi = hi ?? dataHi + pad
  }
  if (hi - lo < 1e-6) hi = lo + 1

  // Horizontal guide lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  for (let i = 0; i <= 3; i++) {
    const y = Math.round((cssH - 1) * (i / 3)) + 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(cssW, y)
    ctx.stroke()
  }

  for (const s of series) {
    const n = s.points.length
    if (n < 2) continue

    const xAt = (i: number) => (i / (n - 1)) * cssW
    const yAt = (v: number) => cssH - 2 - ((v - lo) / (hi - lo)) * (cssH - 4)

    ctx.beginPath()
    s.points.forEach((v, i) => {
      const x = xAt(i)
      const y = yAt(Number.isFinite(v) ? v : lo)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })

    if (s.fill) {
      ctx.save()
      ctx.lineTo(cssW, cssH)
      ctx.lineTo(0, cssH)
      ctx.closePath()
      ctx.fillStyle = s.color.replace(')', ', 0.15)').replace('rgb', 'rgba')
      if (!s.color.startsWith('rgb')) ctx.fillStyle = s.color + '26'
      ctx.fill()
      ctx.restore()
      // Redraw the stroke on top of the fill
      ctx.beginPath()
      s.points.forEach((v, i) => {
        const x = xAt(i)
        const y = yAt(Number.isFinite(v) ? v : lo)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
    }

    ctx.strokeStyle = s.color
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.stroke()
  }
}

function drawCharts(history: HistoryPoint[]): void {
  const powerCanvas = $('#chart-power') as HTMLCanvasElement | null
  const voltCanvas = $('#chart-voltage') as HTMLCanvasElement | null
  if (!powerCanvas || !voltCanvas) return

  // Downsample to ~120 points for the canvas.
  const step = Math.max(1, Math.floor(history.length / 120))
  const pts = history.filter((_, i) => i % step === 0)

  drawLine(
    powerCanvas,
    [
      { points: pts.map((p) => p.pvW), color: '#38d39f', fill: true },
      { points: pts.map((p) => p.loadW), color: '#f6b73c', fill: true }
    ],
    { min: 0 }
  )

  const volts = pts.map((p) => p.battV).filter((v) => v > 0)
  drawLine(voltCanvas, [{ points: volts, color: '#5b9bff', fill: true }], { min: 10.5, max: 14.5 })
}

const CONNECTION_LABEL: Record<string, string> = {
  absent: 'disconnected',
  connecting: 'connecting',
  handshaking: 'handshaking',
  ready: 'connected',
  error: 'error'
}

// Ages are re-rendered on their own clock: state only arrives while the link is
// healthy, so a frozen "updated 3s ago" was the last thing the UI showed when
// the device dropped - exactly when the age matters most.
let lastConnection = 'absent'
let lastTelemetryAt: number | null = null
let lastSettingsAt: number | null = null

function refreshHints(): void {
  // Runs on a timer, so it must never throw: $() raises on a missing node and an
  // uncaught timer error is reported as a renderer crash. setText is null-safe.
  setText('#stale', lastTelemetryAt ? `updated ${when(lastTelemetryAt)}` : '—')
  setText(
    '#settings-hint',
    lastSettingsAt
      ? `updated ${when(lastSettingsAt)}`
      : lastConnection === 'ready'
        ? 'loading…'
        : '—'
  )
}

window.setInterval(refreshHints, 1000)

function renderState(state: DeviceState): void {
  try {
    currentMode = state.mode
    lastConnection = state.connection

    const pill = $('#pill-connection')
    pill.textContent = CONNECTION_LABEL[state.connection] ?? state.connection
    pill.dataset.tone = state.connection

    const hs = state.handshake
    setText('#pill-dialect', hs ? `dialect ${hs.dialect}` : 'dialect —')
    setText(
      '#pill-link',
      hs?.writeMode ? `${hs.writeMode} · ${hs.crcEnabled ? 'crc' : 'plain'}` : 'link —'
    )
    setText('#pill-protocol', hs?.protocolId ?? '—')

    const meta: string[] = []
    if (hs?.model) meta.push(hs.model)
    if (hs?.serial) meta.push(`SN ${hs.serial}`)
    if (hs?.firmware) meta.push(`fw ${hs.firmware}`)
    meta.push(`${state.stats.ok} ok / ${state.stats.failed} failed`, `${state.stats.meanPollMs} ms`)
    if (state.stats.lastFailure) meta.push(`last error: ${state.stats.lastFailure}`)
    setText('#meta', meta.join(' · '))

    const notice = $('#notice')
    if (state.conflicts.length) {
      notice.textContent = `${state.conflicts.join(', ')} is running and can take the USB device from this app. Close it for a stable link.`
      notice.hidden = false
    } else {
      notice.hidden = true
    }

    if (state.telemetry) {
      renderTelemetry(state.telemetry)
      lastTelemetryAt = state.telemetry.at
    }

    if (state.derived) renderDerived(state.derived)

    if (state.settings) {
      lastSettingsAt = state.settings.at
      renderSettings(state.settings)
    }

    renderConfiguration(state)

    setText('#mode', state.mode ? (MODE_LABEL[state.mode] ?? state.mode) : '—')

    refreshHints()

    const warnings = $('#warnings')
    if (!state.warnings || state.warnings.active.length === 0) {
      warnings.innerHTML = '<li class="chip chip--ok">none</li>'
    } else {
      warnings.innerHTML = state.warnings.active
        .map((w) => `<li class="chip chip--fault">${escapeHtml(w)}</li>`)
        .join('')
    }
  } catch (err) {
    // A malformed frame must never be able to kill the renderer.
    console.error('[aerox] render failed:', err)
    appendLog({ at: Date.now(), kind: 'err', text: `render failed: ${String(err)}` })
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

$('#btn-eeprom').addEventListener('click', () => {
  void window.aerox
    .send({ command: 'PSAVE' })
    .then((result) => {
      appendLog({
        at: Date.now(),
        kind: result.ok ? 'tx' : 'err',
        text: `PSAVE → ${result.rx ?? result.error ?? 'no reply'}${result.crcValid === false ? ' [crc mismatch]' : ''}`
      })
    })
    .catch((err: unknown) => appendLog({ at: Date.now(), kind: 'err', text: String(err) }))
})

$('#btn-reset').addEventListener('click', () => {
  void window.aerox
    .resetAnalytics()
    .then(() => appendLog({ at: Date.now(), kind: 'sys', text: 'analytics counters reset' }))
    .catch((err: unknown) => appendLog({ at: Date.now(), kind: 'err', text: String(err) }))
})

async function boot(): Promise<void> {
  window.aerox.onLog(appendLog)
  window.aerox.onState(renderState)

  try {
    const { state, logs, logFile } = await window.aerox.getState()
    logs.forEach(appendLog)
    renderState(state)
    if (logFile) appendLog({ at: Date.now(), kind: 'sys', text: `log file: ${logFile}` })
  } catch (err) {
    appendLog({ at: Date.now(), kind: 'err', text: `boot: ${String(err)}` })
  }
}

void boot()
