import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'fs'
import { join } from 'path'

const MAX_BYTES = 2 * 1024 * 1024

let cachedPath: string | null = null
let verbose = false

export function logPath(): string {
  if (cachedPath) return cachedPath
  const dir = app.getPath('logs')
  mkdirSync(dir, { recursive: true })
  cachedPath = join(dir, 'logs.txt')
  return cachedPath
}

function rotate(file: string): void {
  try {
    if (!existsSync(file)) return
    if (statSync(file).size < MAX_BYTES) return
    const previous = `${file}.1`
    rmSync(previous, { force: true })
    renameSync(file, previous)
    appendFileSync(file, `[${new Date().toISOString()}] rotated (was over ${MAX_BYTES} bytes)\n`)
  } catch {
    /* never let housekeeping kill the app */
  }
}

/** Trim the oldest half of the in-memory log ring the renderer has already seen. */
export function writeLog(level: string, message: string, debug = false): void {
  if (debug && !verbose) return

  const text = String(message)
  const stamp = new Date().toISOString()
  const file = logPath()
  const line = `${stamp}  ${level.toUpperCase().padEnd(5)}  ${text}\n`

  try {
    rotate(file)
    appendFileSync(file, line)
  } catch (err) {
    console.error('[aerox] logger write failed:', err)
    return
  }

  if (level === 'err' || level === 'sys' || verbose) {
    console.log(`[${stamp}] ${level.toUpperCase()} ${text}`)
  }
}

export function initLogging(): void {
  verbose = /^(1|true|yes)$/i.test(process.env.AEROX_DEBUG ?? '')
  const file = logPath()
  writeLog('sys', `log file: ${file}`)
  writeLog(
    'sys',
    `app=${app.getVersion()} electron=${process.versions.electron} node=${process.versions.node} platform=${process.platform} ${process.arch}`
  )
  writeLog('sys', `verbose=${verbose} (set AEROX_DEBUG=1 to log every tx/rx frame)`)
}

/**
 * Everything that would otherwise kill the app silently. The goal is that the
 * next crash leaves a stack trace in logs.txt instead of a bare prompt.
 */
export function installProcessLogging(): void {
  process.on('uncaughtException', (err) => {
    writeLog('err', `uncaughtException: ${err.stack ?? err.message ?? String(err)}`)
    setTimeout(() => app.exit(1), 250)
  })

  process.on('unhandledRejection', (reason) => {
    const err = reason as { stack?: string; message?: string }
    writeLog('err', `unhandledRejection: ${err?.stack ?? err?.message ?? String(reason)}`)
  })

  app.on('render-process-gone', (_event, _webContents, details) => {
    writeLog('err', `renderer gone: reason=${details.reason} exitCode=${details.exitCode}`)
  })

  app.on('child-process-gone', (_event, details) => {
    writeLog('err', `child gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`)
  })

  app.on('gpu-info-update', () => {
    /* noisy, deliberately not logged */
  })

  app.on('window-all-closed', () => writeLog('sys', 'all windows closed'))
  app.on('before-quit', () => writeLog('sys', 'quitting'))
  process.on('exit', () => writeLog('sys', 'process exit'))
}
