import type { SettingKey } from './types'

/**
 * The writable parameters, each mapped to its PI30 setter command.
 *
 * Command verbs and argument widths come from mpp-solar's `protocols/pi30.py`
 * (the same provenance as the QPIGS / QPIRI field maps): POP and PCP take two
 * digits, the voltage setters take `dd.d`, and the current setters take three.
 * A wrong width is not "close enough" - the firmware answers NAK.
 *
 * This module is imported by both processes and must stay free of Node APIs.
 * The renderer uses it for labels, options and ranges; the main process uses
 * the same table (see `src/main/protocol/setters.ts`) so the two can never
 * disagree about what a value will be encoded as.
 */

export interface SettingOption {
  value: number
  label: string
}

export interface SettingSpec {
  key: SettingKey
  /** PI30 setter verb, e.g. `POP`. */
  command: string
  label: string
  kind: 'select' | 'number'
  unit: string
  min: number
  max: number
  step: number
  /** Present for `select`; also the allowed-value list the validator enforces. */
  options?: SettingOption[]
  help: string
  encode: (value: number) => string
}

/** Zero-padded fixed-width integer argument, e.g. `POP` + `02`. */
const int = (width: number) => (value: number): string =>
  String(Math.round(value)).padStart(width, '0')

/** `dd.d` - the voltage setters reject anything else, including `14.10`. */
const volts = (value: number): string => value.toFixed(1).padStart(4, '0')

const opt = (values: Array<[number, string]>): SettingOption[] =>
  values.map(([value, label]) => ({ value, label }))

const OUTPUT_PRIORITY = opt([
  [0, 'Utility first'],
  [1, 'Solar first'],
  [2, 'SBU first']
])

const CHARGER_PRIORITY = opt([
  [0, 'Utility first'],
  [1, 'Solar first'],
  [2, 'Solar + Utility'],
  [3, 'Only solar']
])

const INPUT_RANGE = opt([
  [0, 'Appliance'],
  [1, 'UPS']
])

/** PBT only accepts these three; QPIRI can report ten (Pylontech, WECO, ...). */
const BATTERY_TYPE = opt([
  [0, 'AGM'],
  [1, 'Flooded'],
  [2, 'User']
])

const OUTPUT_FREQUENCY = opt([
  [50, '50 Hz'],
  [60, '60 Hz']
])

/** 12 V-unit ladder documented in the protocol notes; the device NAKs rejects. */
const RECHARGE_VOLTAGES = opt([
  [11, '11.0 V'],
  [11.3, '11.3 V'],
  [11.5, '11.5 V'],
  [11.8, '11.8 V'],
  [12, '12.0 V'],
  [12.3, '12.3 V'],
  [12.5, '12.5 V'],
  [12.8, '12.8 V']
])

const REDISCHARGE_VOLTAGES = opt([
  [0, '0.0 V (battery full)'],
  [11, '11.0 V'],
  [12, '12.0 V'],
  [12.3, '12.3 V'],
  [12.5, '12.5 V'],
  [12.8, '12.8 V'],
  [13, '13.0 V'],
  [13.3, '13.3 V'],
  [13.5, '13.5 V'],
  [13.8, '13.8 V'],
  [14, '14.0 V'],
  [14.3, '14.3 V'],
  [14.5, '14.5 V']
])

const CHARGE_CURRENTS = opt(
  Array.from({ length: 12 }, (_, i): [number, string] => {
    const amps = (i + 1) * 10
    return [amps, `${amps} A`]
  })
)

/** QMUCHGC's ladder additionally offers 2 A. */
const UTILITY_CHARGE_CURRENTS = opt([
  [2, '2 A'],
  ...Array.from({ length: 12 }, (_, i): [number, string] => {
    const amps = (i + 1) * 10
    return [amps, `${amps} A`]
  })
])

export const SETTING_SPECS: readonly SettingSpec[] = [
  {
    key: 'outputSourcePriority',
    command: 'POP',
    label: 'Output source priority',
    kind: 'select',
    unit: '',
    min: 0,
    max: 2,
    step: 1,
    options: OUTPUT_PRIORITY,
    help: 'Which source feeds the load first.',
    encode: int(2)
  },
  {
    key: 'chargerSourcePriority',
    command: 'PCP',
    label: 'Charger source priority',
    kind: 'select',
    unit: '',
    min: 0,
    max: 3,
    step: 1,
    options: CHARGER_PRIORITY,
    help: 'Which source charges the battery first.',
    encode: int(2)
  },
  {
    key: 'inputVoltageRange',
    command: 'PGR',
    label: 'Input voltage range',
    kind: 'select',
    unit: '',
    min: 0,
    max: 1,
    step: 1,
    options: INPUT_RANGE,
    help: 'Appliance accepts a wider grid window than UPS.',
    encode: int(2)
  },
  {
    key: 'batteryType',
    command: 'PBT',
    label: 'Battery type',
    kind: 'select',
    unit: '',
    min: 0,
    max: 2,
    step: 1,
    options: BATTERY_TYPE,
    help: 'Lithium profiles reported by the inverter cannot be set from here.',
    encode: int(2)
  },
  {
    key: 'batteryBulkChargeVoltage',
    command: 'PCVV',
    label: 'Battery bulk (C.V.) voltage',
    kind: 'number',
    unit: 'V',
    min: 12,
    max: 14.6,
    step: 0.1,
    help: 'Constant-voltage / absorb stage. Check the battery datasheet first.',
    encode: volts
  },
  {
    key: 'batteryFloatChargeVoltage',
    command: 'PBFT',
    label: 'Battery float voltage',
    kind: 'number',
    unit: 'V',
    min: 12,
    max: 14.6,
    step: 0.1,
    help: 'Float stage voltage.',
    encode: volts
  },
  {
    key: 'batteryRechargeVoltage',
    command: 'PBCV',
    label: 'Battery re-charge voltage',
    kind: 'select',
    unit: 'V',
    min: 11,
    max: 12.8,
    step: 0.1,
    options: RECHARGE_VOLTAGES,
    help: 'Voltage at which the charger restarts after a discharge.',
    encode: volts
  },
  {
    key: 'batteryUnderVoltage',
    command: 'PSDV',
    label: 'Battery cut-off voltage',
    kind: 'number',
    unit: 'V',
    min: 10,
    max: 12,
    step: 0.1,
    help: 'Discharge stops here. Setting it too low ages the bank.',
    encode: volts
  },
  {
    key: 'batteryRedischargeVoltage',
    command: 'PBDV',
    label: 'Battery re-discharge voltage',
    kind: 'select',
    unit: 'V',
    min: 0,
    max: 14.5,
    step: 0.1,
    options: REDISCHARGE_VOLTAGES,
    help: 'Voltage at which output returns to battery after switching to grid.',
    encode: volts
  },
  {
    key: 'maxChargingCurrent',
    command: 'MCHGC',
    label: 'Max charging current',
    kind: 'select',
    unit: 'A',
    min: 10,
    max: 120,
    step: 10,
    options: CHARGE_CURRENTS,
    help: 'Total charge current ceiling (solar plus utility).',
    encode: int(3)
  },
  {
    key: 'maxAcChargingCurrent',
    command: 'MUCHGC',
    label: 'Max utility charging current',
    kind: 'select',
    unit: 'A',
    min: 2,
    max: 120,
    step: 10,
    options: UTILITY_CHARGE_CURRENTS,
    help: 'Charge current drawn from the grid.',
    encode: int(3)
  },
  {
    key: 'outputFrequency',
    command: 'F',
    label: 'Output frequency',
    kind: 'select',
    unit: 'Hz',
    min: 50,
    max: 60,
    step: 10,
    options: OUTPUT_FREQUENCY,
    help: 'Changes the inverter output frequency.',
    encode: (value) => (value >= 60 ? '60' : '50')
  }
]

export const SETTING_SPEC_BY_KEY: Record<SettingKey, SettingSpec> = Object.fromEntries(
  SETTING_SPECS.map((spec) => [spec.key, spec])
) as Record<SettingKey, SettingSpec>
