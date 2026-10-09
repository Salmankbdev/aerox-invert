import {
  BATTERY_TYPE_LABEL,
  CHARGER_PRIORITY_LABEL,
  INPUT_RANGE_LABEL,
  MACHINE_TYPE_LABEL,
  MODE_LABEL,
  OUTPUT_MODE_LABEL,
  OUTPUT_PRIORITY_LABEL,
  type Settings,
  type Status2Flags,
  type StatusFlags,
  type Telemetry,
  type WarningState
} from '@shared/types'

/** QPIWS bit names, index-aligned with the reply string (validated against mpp-solar). */
export const WARNING_BITS = [
  '',
  'Inverter fault',
  'Bus over fault',
  'Bus under fault',
  'Bus soft fail fault',
  'Line fail warning',
  'OPV short warning',
  'Inverter voltage too low fault',
  'Inverter voltage too high fault',
  'Over temperature fault',
  'Fan locked fault',
  'Battery voltage too high fault',
  'Battery low alarm warning',
  'Reserved',
  'Battery under shutdown warning',
  'Reserved',
  'Overload fault',
  'EEPROM fault',
  'Inverter over current fault',
  'Inverter soft fail fault',
  'Self test fail fault',
  'OP DC voltage over fault',
  'Battery open fault',
  'Current sensor fail fault',
  'Battery short fault',
  'Power limit warning',
  'PV voltage high warning',
  'MPPT overload fault',
  'MPPT overload warning',
  'Battery too low to charge warning',
  '',
  ''
]

const flag = (s: string, i: number): boolean => s[i] === '1'

function payload(body: string): string {
  return body.startsWith('(') ? body.slice(1) : body
}

function num(token: string | undefined): number {
  if (token === undefined || token === '' || token === '-') return Number.NaN
  const n = Number(token)
  return Number.isFinite(n) ? n : Number.NaN
}

function pick(tokens: string[], index: number): number | null {
  const n = num(tokens[index])
  return Number.isNaN(n) ? null : n
}

export function parseQPIGS(body: string, at = Date.now()): Telemetry | null {
  const t = payload(body).trim().split(/\s+/)
  if (t.length < 16) return null

  const status = t[16] ?? ''
  const status2 = t[20] ?? ''

  const flags: StatusFlags = {
    sbuPriorityVersionAdded: flag(status, 0),
    configurationChanged: flag(status, 1),
    sccFirmwareUpdated: flag(status, 2),
    loadOn: flag(status, 3),
    batteryVoltageSteadyWhileCharging: flag(status, 4),
    chargingOn: flag(status, 5),
    sccChargingOn: flag(status, 6),
    acChargingOn: flag(status, 7)
  }

  const flags2: Status2Flags = {
    chargingToFloat: flag(status2, 0),
    switchedOn: flag(status2, 1),
    reserved: flag(status2, 2)
  }

  return {
    at,
    raw: payload(body),
    acInputVoltage: num(t[0]),
    acInputFrequency: num(t[1]),
    acOutputVoltage: num(t[2]),
    acOutputFrequency: num(t[3]),
    acOutputApparentPower: num(t[4]),
    acOutputActivePower: num(t[5]),
    acOutputLoad: num(t[6]),
    busVoltage: num(t[7]),
    batteryVoltage: num(t[8]),
    batteryChargingCurrent: num(t[9]),
    batteryCapacity: num(t[10]),
    heatSinkTemperature: num(t[11]),
    pvCurrent: num(t[12]),
    pvVoltage: num(t[13]),
    batteryVoltageFromScc: num(t[14]),
    batteryDischargeCurrent: num(t[15]),
    pvInputPower: num(t[19]),
    status: flags,
    status2: flags2
  }
}

const QPIRI_KEYS = [
  'acInputVoltage',
  'acInputCurrent',
  'acOutputVoltage',
  'acOutputFrequency',
  'acOutputCurrent',
  'acOutputApparentPower',
  'acOutputActivePower',
  'batteryVoltage',
  'batteryRechargeVoltage',
  'batteryUnderVoltage',
  'batteryBulkChargeVoltage',
  'batteryFloatChargeVoltage',
  'batteryTypeIndex',
  'maxAcChargingCurrent',
  'maxChargingCurrent',
  'inputVoltageRangeIndex',
  'outputSourcePriorityIndex',
  'chargerSourcePriorityIndex',
  'maxParallelUnits',
  'machineTypeIndex',
  'topologyIndex',
  'outputModeIndex',
  'batteryRedischargeVoltage',
  'pvOkIndex',
  'pvPowerBalanceIndex'
] as const

export function parseQPIRI(body: string, at = Date.now()): Settings | null {
  const t = payload(body).trim().split(/\s+/)
  if (t.length < 12) return null

  const numAt = (i: number): number | null => pick(t, i)
  const labelAt = (i: number, table: string[]): string | null => {
    const n = num(t[i])
    if (n === null) return null
    return table[n] ?? `unknown(${t[i]})`
  }

  const machineRaw = t[19]
  const machineType = machineRaw === undefined ? null : (MACHINE_TYPE_LABEL[machineRaw] ?? machineRaw)

  return {
    at,
    raw: payload(body),
    acInputVoltage: numAt(0),
    acInputCurrent: numAt(1),
    acOutputVoltage: numAt(2),
    acOutputFrequency: numAt(3),
    acOutputCurrent: numAt(4),
    acOutputApparentPower: numAt(5),
    acOutputActivePower: numAt(6),
    batteryVoltage: numAt(7),
    batteryRechargeVoltage: numAt(8),
    batteryUnderVoltage: numAt(9),
    batteryBulkChargeVoltage: numAt(10),
    batteryFloatChargeVoltage: numAt(11),
    batteryType: labelAt(12, BATTERY_TYPE_LABEL),
    batteryTypeIndex: numAt(12),
    maxAcChargingCurrent: numAt(13),
    maxChargingCurrent: numAt(14),
    inputVoltageRange: labelAt(15, INPUT_RANGE_LABEL),
    inputVoltageRangeIndex: numAt(15),
    outputSourcePriority: labelAt(16, OUTPUT_PRIORITY_LABEL),
    outputSourcePriorityIndex: numAt(16),
    chargerSourcePriority: labelAt(17, CHARGER_PRIORITY_LABEL),
    chargerSourcePriorityIndex: numAt(17),
    maxParallelUnits: numAt(18),
    machineType,
    outputMode: labelAt(21, OUTPUT_MODE_LABEL),
    batteryRedischargeVoltage: numAt(22),
    missing: Math.max(0, QPIRI_KEYS.length - t.length)
  }
}

export function parseQMOD(body: string): string | null {
  const code = payload(body).trim().charAt(0).toUpperCase()
  return MODE_LABEL[code] ? code : null
}

export function parseQPIWS(body: string, at = Date.now()): WarningState {
  const bits = payload(body).trim()
  const active: string[] = []
  bits.split('').forEach((ch, i) => {
    if (ch !== '1') return
    active.push(WARNING_BITS[i] ?? `Reserved bit ${i}`)
  })
  return { at, raw: bits, active }
}

export function parseProtocolId(body: string): string | null {
  const id = payload(body).trim()
  return /^PI\w{2}$/i.test(id) ? id.toUpperCase() : null
}

export function parseString(body: string): string {
  return payload(body).trim()
}

export function parseFirmware(body: string): string | null {
  const m = payload(body).match(/VERFW:([0-9.]+)/i)
  return m ? m[1] : payload(body).trim() || null
}
