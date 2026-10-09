import type {
  BatteryConfig,
  DeviceState,
  LogLine,
  SendRequest,
  SendResult,
  SetSettingRequest,
  SetSettingResult
} from './types'

export interface InitialPayload {
  state: DeviceState
  logs: LogLine[]
  logFile: string
  battery: BatteryConfig
}

export interface AeroxApi {
  getState(): Promise<InitialPayload>
  send(req: SendRequest): Promise<SendResult>
  setSetting(req: SetSettingRequest): Promise<SetSettingResult>
  configureBattery(cfg: Partial<BatteryConfig>): Promise<BatteryConfig>
  resetAnalytics(): Promise<boolean>
  onState(cb: (state: DeviceState) => void): () => void
  onLog(cb: (line: LogLine) => void): () => void
}
