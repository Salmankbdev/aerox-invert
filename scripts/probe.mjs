#!/usr/bin/env node
/**
 * Standalone link probe for the Inverex Aerox (0665:5161) Cypress USB-HID bridge.
 *
 * There is no OUT endpoint on this device, so the command is delivered through
 * one of the control transfers hidapi offers:
 *   report  -> hid_write()          -> WriteFile on the interrupt pipe (zero-padded)
 *   feature -> hid_send_feature_report() -> HidD_SetFeature
 *
 * And PI30 framing may or may not carry the crcPI checksum, depending on the
 * firmware vintage. This script walks the whole matrix and prints what answered.
 *
 *   node scripts/probe.mjs
 *   node scripts/probe.mjs --device 1
 *   node scripts/probe.mjs --quick
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { HID, devices } = require('node-hid')

const VENDOR_ID = 0x0665
const PRODUCT_ID = 0x5161
const CR = 0x0d

const CRC_TA = [
  0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7, 0x8108, 0x9129, 0xa14a, 0xb16b, 0xc18c,
  0xd1ad, 0xe1ce, 0xf1ef
]
const BUMP = new Set([0x28, 0x0d, 0x0a, 0x00])

function crcPI(bytes) {
  let crc = 0
  for (const c of bytes) {
    let index = ((crc >> 8) >> 4) ^ (c >> 4)
    crc = (crc << 4) & 0xffff
    crc ^= CRC_TA[index]
    index = ((crc >> 8) >> 4) ^ (c & 0x0f)
    crc = (crc << 4) & 0xffff
    crc ^= CRC_TA[index]
  }
  const hi = (crc >> 8) & 0xff
  const lo = crc & 0xff
  return [BUMP.has(hi) ? (hi + 1) & 0xff : hi, BUMP.has(lo) ? (lo + 1) & 0xff : lo]
}

const toHex = (buf) =>
  Buffer.from(buf)
    .toString('hex')
    .toUpperCase()
    .replace(/(..)/g, '$1 ')
    .trim()

const toPrintable = (buf) =>
  Buffer.from(buf)
    .toString('latin1')
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0)
      if (code === CR) return '\\r'
      if (code === 0x0a) return '\\n'
      return ch >= ' ' && ch < '~' ? ch : '.'
    })
    .join('')

function verifyCrc(frame) {
  const text = frame.toString('latin1')
  const idx = text.indexOf('\r')
  if (idx < 2) return null
  const body = Buffer.from(text.slice(0, idx), 'latin1')
  const [hi, lo] = crcPI(body)
  return frame[idx - 2] === hi && frame[idx - 1] === lo
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function list() {
  return devices(VENDOR_ID, PRODUCT_ID).filter((d) => d.usagePage === 0xff00 && d.usage === 0x01)
}

function parseArgs(argv) {
  const args = { device: 0, quick: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--quick') args.quick = true
    else if (a === '--device') args.device = Number(argv[++i]) || 0
  }
  return args
}

async function readFrame(dev, timeoutMs) {
  const chunks = []
  let failure = null

  const onData = (chunk) => chunks.push(Buffer.from(chunk))
  const onError = (err) => {
    failure = err
  }

  dev.on('data', onData)
  dev.on('error', onError)

  try {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (failure) throw failure
      const buffer = Buffer.concat(chunks)
      const idx = buffer.indexOf(CR)
      if (idx >= 0) return buffer.subarray(0, idx + 1)
      await sleep(15)
    }
    const rest = Buffer.concat(chunks)
    return rest.length ? rest : null
  } finally {
    dev.removeListener('data', onData)
    dev.removeListener('error', onError)
  }
}

function buildFrame(command, withCrc) {
  const body = Buffer.from(command, 'latin1')
  if (!withCrc) return Buffer.concat([body, Buffer.from([CR])])
  const [hi, lo] = crcPI(body)
  return Buffer.concat([body, Buffer.from([hi, lo, CR])])
}

const USAGE = `aerox probe - exercise the Voltronic PI30 HID link

  node scripts/probe.mjs                full matrix
  node scripts/probe.mjs --quick        one write mode, CRC on, QPIGS only
  node scripts/probe.mjs --device N     pick the Nth matching HID device
`

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return
  }

  const found = devices()
  console.log(`\n=== HID devices (${found.length}) ===`)
  for (const d of found) {
    const mark = d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID ? '  <== aerox' : ''
    console.log(
      `  VID_${d.vendorId.toString(16).padStart(4, '0')}:${d.productId
        .toString(16)
        .padStart(4, '0')}  ${d.product ?? ''}  ${d.manufacturer ?? ''}  page=${d.usagePage
        ?.toString(16)} usage=${d.usage?.toString(16)}${mark}`
    )
  }

  const matches = list()
  if (matches.length === 0) {
    console.error('\n0665:5161 not present - plug the inverter USB cable in and retry.')
    process.exitCode = 2
    return
  }

  const target = matches[Math.min(args.device, matches.length - 1)]
  console.log(`\n=== opening ${target.path} ===`)
  console.log(`  ${target.product ?? ''} / ${target.manufacturer ?? ''} / ${target.serialNumber ?? ''}`)

  const dev = new HID(target.path)
  dev.setNonBlocking(true)

  const writeModes = args.quick ? ['report'] : ['report', 'feature']
  const crcs = args.quick ? [true] : [true, false]
  const commands = args.quick ? ['QPIGS'] : ['QPI', 'QPIGS', 'QMOD', 'QPIRI', 'QID']
  const timeoutMs = 1500

  await sleep(300)
  dev.removeAllListeners()

  const results = []
  let warm = false

  for (const writeMode of writeModes) {
    for (const withCrc of crcs) {
      for (const command of commands) {
        const frame = buildFrame(command, withCrc)
        process.stdout.write(
          `  ${writeMode.padEnd(7)} crc=${withCrc ? 'on ' : 'off'} ${command.padEnd(6)} -> `
        )
        try {
          if (writeMode === 'feature') dev.sendFeatureReport(frame)
          else dev.write(frame)

          const reply = await readFrame(dev, timeoutMs)
          if (!reply || reply.length === 0) {
            console.log('no reply')
            results.push({ writeMode, withCrc, command, ok: false })
          } else {
            const crc = verifyCrc(reply)
            const tag = crc === null ? '' : crc ? '  [crc ok]' : '  [crc MISMATCH]'
            console.log(`${reply.length}B  ${toPrintable(reply)}  ${toHex(reply)}${tag}`)
            results.push({ writeMode, withCrc, command, ok: true, reply })
            if (command === 'QPIGS') warm = true
          }
        } catch (err) {
          console.log(`ERR ${err.message}`)
          results.push({ writeMode, withCrc, command, ok: false, error: err.message })
        }
        await sleep(warm ? 400 : 80)
      }
    }
  }

  console.log('\n=== matrix ===')
  const rows = new Map()
  for (const r of results) {
    const key = `${r.writeMode}+${r.withCrc ? 'crc' : 'plain'}`
    rows.set(key, rows.get(key) ?? { ok: 0, total: 0 })
    rows.get(key).total += 1
    if (r.ok) rows.get(key).ok += 1
  }
  for (const [key, v] of rows) {
    console.log(`  ${key.padEnd(16)} ${v.ok}/${v.total} replies`)
  }

  const best = [...rows.entries()].sort((a, b) => b[1].ok - a[1].ok)[0]
  if (best && best[1].ok > 0) {
    console.log(`\n  best link: ${best[0]}`)
  } else {
    console.log('\n  nothing answered. Close WatchPower/SolarPower if it is running and retry.')
  }

  dev.close()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
