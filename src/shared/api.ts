import type { DeviceState, LogLine, SendRequest, SendResult } from './types'

export interface InitialPayload {
  state: DeviceState
  logs: LogLine[]
}

export interface AeroxApi {
  getState(): Promise<InitialPayload>
  send(req: SendRequest): Promise<SendResult>
  onState(cb: (state: DeviceState) => void): () => void
  onLog(cb: (line: LogLine) => void): () => void
}
