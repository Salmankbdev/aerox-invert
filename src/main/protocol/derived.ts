import {
  DEFAULT_BATTERY,
  type AlarmEvent,
  type BatteryConfig,
  type BatteryHealth,
  type DerivedState,
  type HistoryPoint,
  type Telemetry,
  type WarningState
} from '@shared/types'

/**
 * Everything the dashboard shows that the inverter does not say directly.
 *
 * The unit only streams instantaneous QPIGS values once a second. Battery
 * health, remaining runtime, energy totals and peaks all have to be integrated
 * or inferred from that stream, so they live here rather than in the parser.
 * The shapes are declared in shared/types.ts so the renderer can use them.
 */

// ---------------------------------------------------------------- battery model

/**
 * Rested open-circuit voltage -> state of charge for a 12 V lead-acid bank.
 * Values are per-cell-table averages; interpolation happens in socFromVoltage.
 */
const LEAD_ACID_OCV_SOC: ReadonlyArray<readonly [number, number]> = [
  [12.7, 100],
  [12.6, 90],
  [12.45, 80],
  [12.32, 70],
  [12.24, 60],
  [12.1, 50],
  [11.98, 40],
  [11.85, 30],
  [11.75, 20],
  [11.6, 10],
  [11.3, 0]
]

function socFromVoltage(ocv: number): number {
  const curve = LEAD_ACID_OCV_SOC
  if (ocv >= curve[0][0]) return 100
  if (ocv <= curve[curve.length - 1][0]) return 0

  for (let i = 1; i < curve.length; i++) {
    const [hiV, hiSoc] = curve[i - 1]
    const [loV, loSoc] = curve[i]
    if (ocv <= hiV && ocv >= loV) {
      const t = (hiV - ocv) / (hiV - loV)
      return hiSoc + (loSoc - hiSoc) * t
    }
  }
  return 0
}

// ----------------------------------------------------------------- accumulator

const HISTORY_MAX = 600
const REGRESSION_MAX = 120

export class Deriver {
  private cfg: BatteryConfig = { ...DEFAULT_BATTERY }

  private startedAt = 0
  private lastAt = 0
  private lastDay = -1

  private pvWh = 0
  private loadWh = 0
  private chargeWh = 0
  private dischargeWh = 0

  private pvWhDay = 0
  private loadWhDay = 0
  private chargeWhDay = 0
  private dischargeWhDay = 0

  private pvPeakW = 0
  private loadPeakW = 0

  private pvMaxW = 0
  private pvMaxAt = 0
  private loadMaxW = 0
  private loadMaxAt = 0
  private battVMax = -Infinity
  private battVMaxAt = 0
  private battVMin = Infinity
  private battVMinAt = 0
  private gridVMax = -Infinity
  private gridVMin = Infinity
  private tempMax = -Infinity
  private tempMaxAt = 0

  private minBattV = Infinity
  private maxDischargeA = 0
  private resistanceMOhm = 10

  private onBattery = false
  private secondsOnBattery = 0
  private lastGridFailAt: number | null = null

  private alarms: AlarmEvent[] = []
  private lastWarnings = new Set<string>()

  private history: HistoryPoint[] = []
  /** (current, voltage) samples for the internal-resistance regression. */
  private regression: Array<readonly [number, number]> = []

  configure(cfg: Partial<BatteryConfig>): void {
    this.cfg = { ...this.cfg, ...cfg }
  }

  get config(): BatteryConfig {
    return this.cfg
  }

  reset(): void {
    this.startedAt = 0
    this.lastAt = 0
    this.lastDay = -1
    this.pvWh = this.loadWh = this.chargeWh = this.dischargeWh = 0
    this.pvWhDay = this.loadWhDay = this.chargeWhDay = this.dischargeWhDay = 0
    this.pvPeakW = this.loadPeakW = 0
    this.pvMaxW = this.loadMaxW = 0
    this.pvMaxAt = this.loadMaxAt = 0
    this.battVMax = -Infinity
    this.battVMin = Infinity
    this.battVMaxAt = this.battVMinAt = 0
    this.gridVMax = -Infinity
    this.gridVMin = Infinity
    this.tempMax = -Infinity
    this.tempMaxAt = 0
    this.minBattV = Infinity
    this.maxDischargeA = 0
    this.resistanceMOhm = 10
    this.onBattery = false
    this.secondsOnBattery = 0
    this.lastGridFailAt = null
    this.alarms = []
    this.lastWarnings.clear()
    this.history = []
    this.regression = []
  }

  /** Feed one clean QPIGS sample. Returns the full derived snapshot. */
  ingest(t: Telemetry, warnings: WarningState | null, now = Date.now()): DerivedState {
    if (!this.startedAt) this.startedAt = now

    const dtHours = this.lastAt ? (now - this.lastAt) / 3_600_000 : 0
    this.lastAt = now

    this.rolloverDay(now)

    const pvW = finite(t.pvInputPower) || finite(t.pvVoltage * t.pvCurrent) || 0
    const loadW = finite(t.acOutputActivePower) || 0
    const battV = finite(t.batteryVoltage) || 0
    const chargeA = finite(t.batteryChargingCurrent) || 0
    const dischargeA = finite(t.batteryDischargeCurrent) || 0
    const netA = chargeA - dischargeA

    // Integrate energy. Battery power is signed: charging is positive.
    if (dtHours > 0 && dtHours < 0.01) {
      this.pvWh += pvW * dtHours
      this.loadWh += loadW * dtHours
      this.pvWhDay += pvW * dtHours
      this.loadWhDay += loadW * dtHours
      if (netA > 0) {
        const wh = battV * netA * dtHours
        this.chargeWh += wh
        this.chargeWhDay += wh
      } else if (netA < 0) {
        const wh = battV * -netA * dtHours
        this.dischargeWh += wh
        this.dischargeWhDay += wh
      }
    }

    // Peaks
    if (pvW > this.pvPeakW) this.pvPeakW = pvW
    if (loadW > this.loadPeakW) this.loadPeakW = loadW
    if (pvW > this.pvMaxW) {
      this.pvMaxW = pvW
      this.pvMaxAt = now
    }
    if (loadW > this.loadMaxW) {
      this.loadMaxW = loadW
      this.loadMaxAt = now
    }
    if (battV > this.battVMax) {
      this.battVMax = battV
      this.battVMaxAt = now
    }
    if (battV < this.battVMin) {
      this.battVMin = battV
      this.battVMinAt = now
    }
    const gridV = finite(t.acInputVoltage) || 0
    if (gridV > this.gridVMax) this.gridVMax = gridV
    if (gridV < this.gridVMin) this.gridVMin = gridV
    const temp = finite(t.heatSinkTemperature) || 0
    if (temp > this.tempMax) {
      this.tempMax = temp
      this.tempMaxAt = now
    }

    // Track the worst the bank has been pushed this session.
    if (battV > 0 && battV < this.minBattV) this.minBattV = battV
    if (dischargeA > this.maxDischargeA) this.maxDischargeA = dischargeA

    // Internal resistance from (net current, terminal voltage) slope. Only
    // worth sampling when the bank is actually being worked, so the regression
    // has spread to fit against.
    if (Math.abs(netA) > 1) {
      this.regression.push([netA, battV])
      if (this.regression.length > REGRESSION_MAX) this.regression.shift()
      const r = this.fitResistance()
      if (r !== null) this.resistanceMOhm = r
    }

    // Grid / battery state. A few volts of ghost reading means no grid.
    const gridPresent = gridV > 40
    this.trackBatteryState(gridPresent, now, dtHours)

    this.trackAlarms(warnings, now)

    const history: HistoryPoint = {
      at: now,
      pvW,
      loadW,
      battV,
      battI: netA,
      soc: Math.round(finite(t.batteryCapacity) || 0),
      onBattery: this.onBattery
    }
    this.history.push(history)
    if (this.history.length > HISTORY_MAX) this.history.shift()

    const bankWh = this.cfg.capacityAh * this.cfg.nominalVoltage
    const socReported = clamp(finite(t.batteryCapacity) || 0, 0, 100)
    const sag = this.sagVoltage(battV, netA)
    const ocv = battV + sag
    const socVoltage = this.cfg.chemistry === 'lead-acid' ? socFromVoltage(ocv) : socReported
    const healthScore = this.scoreHealth(socVoltage, socReported, dischargeA, battV)

    const remainingWh = (socVoltage / 100) * bankWh
    const charging = netA > 0.5
    const runtimeMinutes =
      this.onBattery && !charging && loadW > 1 ? Math.round((remainingWh / loadW) * 60) : null

    return {
      battery: {
        chemistry: this.cfg.chemistry,
        socVoltage: Math.round(socVoltage),
        socReported: Math.round(socReported),
        socDelta: Math.round(socVoltage - socReported),
        internalResistanceMOhm: Math.round(this.resistanceMOhm * 10) / 10,
        sagVoltage: Math.round(sag * 1000) / 1000,
        healthScore,
        verdict: verdictFor(healthScore),
        minVoltage: this.minBattV === Infinity ? 0 : Math.round(this.minBattV * 100) / 100,
        maxDischargeA: Math.round(this.maxDischargeA),
        notes: this.healthNotes(socVoltage, socReported, dischargeA)
      },
      runtime: {
        bankWh: Math.round(bankWh),
        remainingWh: Math.round(remainingWh),
        loadW: Math.round(loadW),
        minutes: runtimeMinutes,
        onBattery: this.onBattery,
        basis: this.cfg.chemistry === 'lead-acid' ? 'voltage-derived SoC' : 'reported SoC'
      },
      energy: {
        pvWh: Math.round(this.pvWh),
        loadWh: Math.round(this.loadWh),
        chargeWh: Math.round(this.chargeWh),
        dischargeWh: Math.round(this.dischargeWh),
        pvWhToday: Math.round(this.pvWhDay),
        loadWhToday: Math.round(this.loadWhDay),
        chargeWhToday: Math.round(this.chargeWhDay),
        dischargeWhToday: Math.round(this.dischargeWhDay),
        pvPeakW: Math.round(this.pvPeakW),
        loadPeakW: Math.round(this.loadPeakW),
        netWh: Math.round(this.chargeWh - this.dischargeWh)
      },
      peaks: {
        pvMaxW: Math.round(this.pvMaxW),
        pvMaxAt: this.pvMaxAt,
        loadMaxW: Math.round(this.loadMaxW),
        loadMaxAt: this.loadMaxAt,
        battVMax: this.battVMax === -Infinity ? 0 : Math.round(this.battVMax * 100) / 100,
        battVMaxAt: this.battVMaxAt,
        battVMin: this.battVMin === Infinity ? 0 : Math.round(this.battVMin * 100) / 100,
        battVMinAt: this.battVMinAt,
        gridVMax: this.gridVMax === -Infinity ? 0 : Math.round(this.gridVMax),
        gridVMin: this.gridVMin === Infinity ? 0 : Math.round(this.gridVMin),
        tempMax: this.tempMax === -Infinity ? 0 : Math.round(this.tempMax),
        tempMaxAt: this.tempMaxAt
      },
      alarms: this.alarms.slice(-20).reverse(),
      history: [...this.history],
      secondsOnBattery: Math.round(this.secondsOnBattery),
      secondsSinceGridFail:
        this.lastGridFailAt === null ? null : Math.round((now - this.lastGridFailAt) / 1000),
      onBattery: this.onBattery,
      chargeRateA: Math.round(chargeA * 10) / 10,
      dischargeRateA: Math.round(dischargeA * 10) / 10,
      pvEfficiency: pvW > 1 && battV > 0 && netA > 0 ? Math.round((battV * netA * 100) / pvW) : null
    }
  }

  // ------------------------------------------------------------------ private

  private rolloverDay(now: number): void {
    const day = new Date(now).getDate()
    if (this.lastDay === -1) {
      this.lastDay = day
      return
    }
    if (day !== this.lastDay) {
      this.lastDay = day
      this.pvWhDay = 0
      this.loadWhDay = 0
      this.chargeWhDay = 0
      this.dischargeWhDay = 0
    }
  }

  private trackBatteryState(gridPresent: boolean, now: number, dtHours: number): void {
    if (!gridPresent && !this.onBattery) {
      this.onBattery = true
      this.lastGridFailAt = now
    } else if (gridPresent && this.onBattery) {
      this.onBattery = false
    }
    if (this.onBattery) this.secondsOnBattery += dtHours * 3600
  }

  private trackAlarms(warnings: WarningState | null, now: number): void {
    if (!warnings) return
    const active = new Set(warnings.active.filter(Boolean))

    for (const w of active) {
      if (!this.lastWarnings.has(w)) {
        const open = this.alarms.find((a) => a.warning === w && a.clearedAt === null)
        if (!open) this.alarms.push({ at: now, warning: w, clearedAt: null })
      }
    }
    for (const w of this.lastWarnings) {
      if (!active.has(w)) {
        const open = [...this.alarms].reverse().find((a) => a.warning === w && a.clearedAt === null)
        if (open) open.clearedAt = now
      }
    }
    this.lastWarnings = active

    if (this.alarms.length > 100) this.alarms.splice(0, this.alarms.length - 100)
  }

  /** OCV minus terminal voltage at the observed net current. */
  private sagVoltage(battV: number, netA: number): number {
    if (battV <= 0) return 0
    const r = this.resistanceMOhm / 1000
    // Only compensate while discharging; charging pushes the terminal up.
    return netA < 0 ? -netA * r : 0
  }

  /** Least-squares slope of voltage against current -> internal resistance. */
  private fitResistance(): number | null {
    const pts = this.regression
    if (pts.length < 12) return null

    let sumI = 0
    let sumV = 0
    let sumII = 0
    let sumIV = 0
    for (const [i, v] of pts) {
      sumI += i
      sumV += v
      sumII += i * i
      sumIV += i * v
    }
    const n = pts.length
    const denom = n * sumII - sumI * sumI
    if (Math.abs(denom) < 1e-6) return null

    // V = OCV + R*I, so the slope is R (ohms).
    const slope = (n * sumIV - sumI * sumV) / denom
    const milliohms = Math.abs(slope) * 1000
    // Clamp to the plausible band for a 12 V starter/deep-cycle bank.
    return milliohms < 1 ? null : Math.min(milliohms, 200)
  }

  private scoreHealth(
    socVoltage: number,
    socReported: number,
    dischargeA: number,
    battV: number
  ): number {
    if (battV <= 0) return 0
    let score = 100
    const notes: string[] = []

    // 1. Voltage sag under load. A healthy 12 V bank at ~30 A should stay
    //    above ~11.8 V; deeper sag means higher internal resistance.
    if (dischargeA > 5) {
      const sagLimit = 12.6 - dischargeA * 0.012
      if (battV < sagLimit) score -= Math.min(40, (sagLimit - battV) * 40)
      if (battV < 11.5) notes.push('sags hard under load')
    }

    // 2. Agreement between the inverter's own capacity% and the voltage curve.
    const delta = Math.abs(socVoltage - socReported)
    if (delta > 25) score -= 15
    else if (delta > 15) score -= 8

    // 3. Worst voltage seen this session.
    if (this.minBattV < 11.5) score -= 15
    else if (this.minBattV < 11.8) score -= 7

    // 4. Internal resistance creeping up is the clearest age signal.
    if (this.resistanceMOhm > 40) score -= 25
    else if (this.resistanceMOhm > 20) score -= 12
    else if (this.resistanceMOhm > 12) score -= 5

    if (notes.length === 0 && score >= 80) notes.push('holds voltage well')
    if (this.resistanceMOhm <= 12 && dischargeA > 10) notes.push('low internal resistance')

    return Math.round(clamp(score, 0, 100))
  }

  private healthNotes(socVoltage: number, socReported: number, dischargeA: number): string[] {
    const notes: string[] = []
    if (this.minBattV !== Infinity && this.minBattV < 11.5) {
      notes.push(`dropped to ${this.minBattV.toFixed(2)} V under load`)
    }
    if (dischargeA > 20) notes.push(`heavy draw ${Math.round(dischargeA)} A`)
    const delta = socVoltage - socReported
    if (delta > 15) notes.push('inverter SoC is optimistic')
    else if (delta < -15) notes.push('inverter SoC is pessimistic')
    if (this.resistanceMOhm > 25) notes.push('internal resistance elevated')
    return notes
  }
}

// -------------------------------------------------------------------- helpers

function finite(n: number | null | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n
}

function verdictFor(score: number): BatteryHealth['verdict'] {
  if (score <= 0) return 'unknown'
  if (score >= 80) return 'good'
  if (score >= 60) return 'fair'
  if (score >= 35) return 'poor'
  return 'critical'
}

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—'
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h < 48) return m ? `${h}h ${m}m` : `${h}h`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

export function formatEnergy(wattHours: number): string {
  if (!Number.isFinite(wattHours)) return '—'
  if (Math.abs(wattHours) < 1000) return `${Math.round(wattHours)} Wh`
  return `${(wattHours / 1000).toFixed(2)} kWh`
}

export function formatSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h < 24) return `${h}h ${m}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}
