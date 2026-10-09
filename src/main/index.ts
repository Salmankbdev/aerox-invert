import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { IPC, type SendRequest } from '@shared/types'
import { crcPIIsValid } from './protocol/crc'
import { InverterService } from './service'

if (!crcPIIsValid()) {
  console.error('[aerox] CRC self-check FAILED - protocol layer is broken, refusing to start')
  process.exit(1)
}

let window: BrowserWindow | null = null
const service = new InverterService()

function broadcast(channel: string, payload: unknown): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
}

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
}

app.whenReady().then(() => {
  service.on('state', (state) => broadcast(IPC.state, state))
  service.on('log', (line) => broadcast(IPC.log, line))

  ipcMain.handle(IPC.getState, () => ({
    state: service.snapshot(),
    logs: service.logSnapshot()
  }))

  ipcMain.handle(IPC.send, (_event, req: SendRequest) => service.sendCommand(req.command))

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
