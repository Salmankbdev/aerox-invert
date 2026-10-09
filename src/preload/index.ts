import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type { AeroxApi } from '@shared/api'
import type { BatteryConfig, DeviceState, LogLine, SendRequest } from '@shared/types'

const api: AeroxApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  send: (req: SendRequest) => ipcRenderer.invoke(IPC.send, req),
  configureBattery: (cfg: Partial<BatteryConfig>) => ipcRenderer.invoke(IPC.configureBattery, cfg),
  resetAnalytics: () => ipcRenderer.invoke(IPC.resetAnalytics),
  onState: (cb) => {
    const listener = (_event: unknown, state: DeviceState) => cb(state)
    ipcRenderer.on(IPC.state, listener)
    return () => ipcRenderer.removeListener(IPC.state, listener)
  },
  onLog: (cb) => {
    const listener = (_event: unknown, line: LogLine) => cb(line)
    ipcRenderer.on(IPC.log, listener)
    return () => ipcRenderer.removeListener(IPC.log, listener)
  }
}

contextBridge.exposeInMainWorld('aerox', api)
