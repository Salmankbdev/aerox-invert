import { execFile } from 'child_process'

/**
 * Vendor apps that talk to the same 0665:5161 bridge.
 *
 * Windows lets several processes hold a HID handle at once, so WatchPower does
 * not fail loudly - it just interleaves its own commands with ours, and the
 * replies arrive stale or interleaved enough to time out. Telling the user
 * beats debugging a link that looks broken for no reason.
 */
const KNOWN_CONFLICTS = ['WatchPower.exe', 'SolarPower.exe', 'SolarPowerMonitor.exe']

export function detectConflicts(): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([])

  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/NH', '/FO', 'CSV'],
      { windowsHide: true, timeout: 4000 },
      (err, stdout) => {
        if (err || !stdout) return resolve([])
        const haystack = stdout.toLowerCase()
        resolve(KNOWN_CONFLICTS.filter((name) => haystack.includes(`"${name.toLowerCase()}"`)))
      }
    )
  })
}
