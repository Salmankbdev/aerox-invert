export const VENDOR_ID = 0x0665
export const PRODUCT_ID = 0x5161

export type Connection = 'absent' | 'connecting' | 'handshaking' | 'ready' | 'error'
export type WriteMode = 'report' | 'feature'
export type Dialect = 'pi30' | 'voltronic-qs' | 'unknown'

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
  maxAcChargingCurrent: number | null
  maxChargingCurrent: number | null
  inputVoltageRange: string | null
  outputSourcePriority: string | null
  chargerSourcePriority: string | null
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
  stats: LinkStats
}

export interface LogLine {
  at: number
  kind: 'tx' | 'rx' | 'sys' | 'err'
  text: string
}

export const IPC = {
  state: 'inv:state',
  log: 'inv:log',
  getState: 'inv:get-state',
  send: 'inv:send'
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
