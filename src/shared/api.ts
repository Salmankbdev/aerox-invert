import type { BatteryConfig, DeviceState, LogLine, SendRequest, SendResult } from './types'

export interface InitialPayload {
  state: DeviceState
  logs: LogLine[]
  logFile: string
  battery: BatteryConfig
}

export interface AeroxApi {
  getState(): Promise<InitialPayload>
  send(req: SendRequest): Promise<SendResult>
  configureBattery(cfg: Partial<BatteryConfig>): Promise<BatteryConfig>
  resetAnalytics(): Promise<boolean>
  onState(cb: (state: DeviceState) => void): () => void
  onLog(cb: (line: LogLine) => void): () => void
}
