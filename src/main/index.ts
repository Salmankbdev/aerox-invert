import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { IPC, type BatteryConfig, type LogLine, type SendRequest } from '@shared/types'
import { crcPIIsValid } from './protocol/crc'
import { installProcessLogging, initLogging, logPath, writeLog } from './logger'
import { InverterService } from './service'

installProcessLogging()

// The renderer has no canvas/WebGL, so hardware acceleration buys nothing -
// and on Windows the GPU process is the usual reason a renderer dies with
// exitCode=-1 and no JS error. Turn it off so the window can't be taken down.
app.disableHardwareAcceleration()

let window: BrowserWindow | null = null
let rendererRestarts = 0
const MAX_RENDERER_RESTARTS = 5
const service = new InverterService()

service.on('log', (line: LogLine) => writeLog(line.kind, line.text, line.debug === true))
service.on('state', (state) => {
  if (window && !window.isDestroyed()) window.webContents.send(IPC.state, state)
})

function broadcastLogs(line: LogLine): void {
  if (window && !window.isDestroyed()) window.webContents.send(IPC.log, line)
}
service.on('log', broadcastLogs)

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0e12',
    title: 'Aerox Monitor',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window?.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  window.on('closed', () => {
    window = null
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    writeLog('err', `render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`)
    if (details.reason === 'clean-exit') return

    if (rendererRestarts >= MAX_RENDERER_RESTARTS) {
      writeLog('err', `renderer crashed ${rendererRestarts} times, not restarting again`)
      return
    }
    rendererRestarts++
    writeLog('sys', `reloading renderer (attempt ${rendererRestarts}/${MAX_RENDERER_RESTARTS})`)
    setTimeout(() => {
      if (window && !window.isDestroyed()) window.webContents.reload()
    }, 500)
  })
}

app.whenReady().then(() => {
  initLogging()

  if (!crcPIIsValid()) {
    writeLog('err', 'CRC self-check FAILED - protocol layer is broken, refusing to start')
    app.exit(1)
    return
  }
  writeLog('sys', 'CRC self-check ok')

  ipcMain.handle(IPC.getState, () => ({
    state: service.snapshot(),
    logs: service.logSnapshot(),
    logFile: logPath(),
    battery: service.batteryConfig
  }))

  ipcMain.handle(IPC.send, (_event, req: SendRequest) => service.sendCommand(req.command))

  ipcMain.handle(IPC.configureBattery, (_event, cfg: Partial<BatteryConfig>) => {
    service.configureBattery(cfg)
    return service.batteryConfig
  })

  ipcMain.handle(IPC.resetAnalytics, () => {
    service.resetAnalytics()
    return true
  })

  createWindow()
  service.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  service.stop()
})
