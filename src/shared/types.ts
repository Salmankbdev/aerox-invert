export const VENDOR_ID = 0x0665
export const PRODUCT_ID = 0x5161

export type Connection = 'absent' | 'connecting' | 'handshaking' | 'ready' | 'error'
export type WriteMode = 'report' | 'feature'
export type Dialect = 'pi30' | 'voltronic-qs' | 'unknown'

/**
 * Writable inverter parameters. Each maps to one PI30 setter command -
 * see src/shared/settings-spec.ts for the command, ranges and encoding.
 */
export type SettingKey =
  | 'outputSourcePriority'
  | 'chargerSourcePriority'
  | 'inputVoltageRange'
  | 'batteryType'
  | 'batteryBulkChargeVoltage'
  | 'batteryFloatChargeVoltage'
  | 'batteryRechargeVoltage'
  | 'batteryUnderVoltage'
  | 'batteryRedischargeVoltage'
  | 'maxChargingCurrent'
  | 'maxAcChargingCurrent'
  | 'outputFrequency'

export interface DeviceInfo {
  path: string
  vendorId: number
  productId: number
  manufacturer?: string
  product?: string
  serialNumber?: string
  release?: number
}

export interface StatusFlags {
  sbuPriorityVersionAdded: boolean
  configurationChanged: boolean
  sccFirmwareUpdated: boolean
  loadOn: boolean
  batteryVoltageSteadyWhileCharging: boolean
  chargingOn: boolean
  sccChargingOn: boolean
  acChargingOn: boolean
}

export interface Status2Flags {
  chargingToFloat: boolean
  switchedOn: boolean
  reserved: boolean
}

export interface Telemetry {
  at: number
  raw: string
  acInputVoltage: number
  acInputFrequency: number
  acOutputVoltage: number
  acOutputFrequency: number
  acOutputApparentPower: number
  acOutputActivePower: number
  acOutputLoad: number
  busVoltage: number
  batteryVoltage: number
  batteryChargingCurrent: number
  batteryCapacity: number
  heatSinkTemperature: number
  pvCurrent: number
  pvVoltage: number
  batteryVoltageFromScc: number
  batteryDischargeCurrent: number
  pvInputPower: number
  status: StatusFlags
  status2: Status2Flags
}

export const MODE_LABEL: Record<string, string> = {
  P: 'Power on',
  S: 'Standby',
  L: 'Line',
  B: 'Battery',
  F: 'Fault',
  H: 'Power saving',
  Y: 'Bypass'
}

export const BATTERY_TYPE_LABEL = [
  'AGM',
  'Flooded',
  'User',
  'Pylontech',
  'Shinheung',
  'WECO',
  'Soltaro',
  'TBD',
  'LIb-protocol compatible',
  '3rd party Lithium'
]

export const INPUT_RANGE_LABEL = ['Appliance', 'UPS']
export const OUTPUT_PRIORITY_LABEL = ['Utility first', 'Solar first', 'SBU first']
export const CHARGER_PRIORITY_LABEL = [
  'Utility first',
  'Solar first',
  'Solar + Utility',
  'Only solar charging permitted'
]
export const MACHINE_TYPE_LABEL: Record<string, string> = {
  '00': 'Grid tie',
  '01': 'Off grid',
  '10': 'Hybrid'
}
export const OUTPUT_MODE_LABEL = [
  'Single machine output',
  'Parallel output',
  'Phase 1 of 3 phase output',
  'Phase 2 of 3 phase output',
  'Phase 3 of 3 phase output',
  'Phase 1 of 2 phase output',
  'Phase 2 of 2 phase output',
  'Unknown output mode'
]
export const TOPOLOGY_LABEL = ['Transformerless', 'Transformer']

export interface Settings {
  at: number
  raw: string
  acInputVoltage: number | null
  acInputCurrent: number | null
  acOutputVoltage: number | null
  acOutputFrequency: number | null
  acOutputCurrent: number | null
  acOutputApparentPower: number | null
  acOutputActivePower: number | null
  batteryVoltage: number | null
  batteryRechargeVoltage: number | null
  batteryUnderVoltage: number | null
  batteryBulkChargeVoltage: number | null
  batteryFloatChargeVoltage: number | null
  batteryType: string | null
  /** Raw enum indices as the inverter sent them, for preselecting the editor. */
  batteryTypeIndex: number | null
  maxAcChargingCurrent: number | null
  maxChargingCurrent: number | null
  inputVoltageRange: string | null
  inputVoltageRangeIndex: number | null
  outputSourcePriority: string | null
  outputSourcePriorityIndex: number | null
  chargerSourcePriority: string | null
  chargerSourcePriorityIndex: number | null
  maxParallelUnits: number | null
  machineType: string | null
  outputMode: string | null
  batteryRedischargeVoltage: number | null
  missing: number
}

export interface WarningState {
  at: number
  raw: string
  active: string[]
}

export interface Handshake {
  protocolId: string | null
  dialect: Dialect
  writeMode: WriteMode | null
  crcEnabled: boolean | null
  firmware: string | null
  serial: string | null
  model: string | null
  attempts: HandshakeAttempt[]
}

export interface HandshakeAttempt {
  step: string
  ok: boolean
  detail: string
}

export interface LinkStats {
  ok: number
  failed: number
  consecutiveFailures: number
  lastOkAt: number | null
  lastFailure: string | null
  meanPollMs: number
}

export interface DeviceState {
  connection: Connection
  info: DeviceInfo | null
  handshake: Handshake | null
  mode: string | null
  telemetry: Telemetry | null
  settings: Settings | null
  warnings: WarningState | null
  /**
   * Battery health, runtime, energy totals, peaks, alarms and history.
   * Computed in the main process from the QPIGS stream - the inverter never
   * sends these directly. See src/main/protocol/derived.ts.
   */
  derived: DerivedState | null
  stats: LinkStats
  /**
   * Vendor apps (WatchPower / SolarPower) that are running and contend for the
   * same HID bridge. Surfaced so the UI can say why the link is flaky instead
   * of leaving the user to guess.
   */
  conflicts: string[]
}

export interface LogLine {
  at: number
  kind: 'tx' | 'rx' | 'sys' | 'err'
  text: string
  /** Per-frame chatter. Shown in the console, but kept out of logs.txt unless AEROX_DEBUG=1. */
  debug?: boolean
}

// ------------------------------------------------------------- derived metrics
//
// Computed in the main process from the QPIGS stream. The inverter never sends
// these directly - they are integrated or inferred, so they live in
// src/main/protocol/derived.ts and only the shapes are shared here.

export interface BatteryConfig {
  chemistry: 'lead-acid' | 'lithium'
  nominalVoltage: number
  capacityAh: number
}

export const DEFAULT_BATTERY: BatteryConfig = {
  chemistry: 'lead-acid',
  nominalVoltage: 12,
  capacityAh: 100
}

export interface BatteryHealth {
  chemistry: string
  /** SoC estimated from sag-compensated open-circuit voltage. */
  socVoltage: number
  /** capacity% reported by the inverter. */
  socReported: number
  /** voltage-derived minus reported. Positive = the inverter is pessimistic. */
  socDelta: number
  /** Estimated internal resistance, milliohms. Rises as the bank ages. */
  internalResistanceMOhm: number
  /** OCV minus terminal voltage while under load. */
  sagVoltage: number
  healthScore: number
  verdict: 'good' | 'fair' | 'poor' | 'critical' | 'unknown'
  minVoltage: number
  maxDischargeA: number
  notes: string[]
}

export interface RuntimeEstimate {
  bankWh: number
  remainingWh: number
  loadW: number
  /** null when charging or on grid - the number would be meaningless. */
  minutes: number | null
  onBattery: boolean
  basis: string
}

export interface EnergyStats {
  pvWh: number
  loadWh: number
  chargeWh: number
  dischargeWh: number
  /** Same counters, zeroed at local midnight. */
  pvWhToday: number
  loadWhToday: number
  chargeWhToday: number
  dischargeWhToday: number
  pvPeakW: number
  loadPeakW: number
  /** Net battery energy this session. Positive = the bank gained charge. */
  netWh: number
}

export interface Peaks {
  pvMaxW: number
  pvMaxAt: number
  loadMaxW: number
  loadMaxAt: number
  battVMax: number
  battVMaxAt: number
  battVMin: number
  battVMinAt: number
  gridVMax: number
  gridVMin: number
  tempMax: number
  tempMaxAt: number
}

export interface AlarmEvent {
  at: number
  warning: string
  clearedAt: number | null
}

export interface HistoryPoint {
  at: number
  pvW: number
  loadW: number
  battV: number
  /** net battery current, positive = charging. */
  battI: number
  soc: number
  onBattery: boolean
}

export interface DerivedState {
  battery: BatteryHealth
  runtime: RuntimeEstimate
  energy: EnergyStats
  peaks: Peaks
  alarms: AlarmEvent[]
  /** Rolling window, oldest first. */
  history: HistoryPoint[]
  /** Seconds the inverter has spent on battery since app start. */
  secondsOnBattery: number
  secondsSinceGridFail: number | null
  onBattery: boolean
  chargeRateA: number
  dischargeRateA: number
  /** PV conversion efficiency at this instant, or null when PV is idle. */
  pvEfficiency: number | null
}

export const IPC = {
  state: 'inv:state',
  log: 'inv:log',
  getState: 'inv:get-state',
  send: 'inv:send',
  setSetting: 'inv:set-setting',
  configureBattery: 'inv:configure-battery',
  resetAnalytics: 'inv:reset-analytics'
} as const

export interface SendRequest {
  command: string
}

export interface SendResult {
  ok: boolean
  tx: string
  rx: string | null
  error: string | null
  crcValid: boolean | null
}

export interface SetSettingRequest {
  key: SettingKey
  value: number
}

export interface SetSettingResult {
  ok: boolean
  key: SettingKey
  /** The exact command that went on the wire, e.g. `POP02`. */
  command: string
  rx: string | null
  error: string | null
}
