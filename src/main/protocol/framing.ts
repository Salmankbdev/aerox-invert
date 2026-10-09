import { crcPI } from './crc'

export const CR = 0x0d

/** hidapi wants the report id in byte 0; this bridge uses a single unnumbered report. */
export const REPORT_ID = 0x00

export function encodeCommand(command: string, withCrc: boolean): Buffer {
  const body = Buffer.from(command, 'latin1')
  if (!withCrc) return Buffer.concat([body, Buffer.from([CR])])
  const [hi, lo] = crcPI(body)
  return Buffer.concat([body, Buffer.from([hi, lo, CR])])
}

/** Frame as it goes on the wire: report id + payload. */
export function toReport(frame: Buffer): Buffer {
  return Buffer.concat([Buffer.from([REPORT_ID]), frame])
}

export interface DecodedReply {
  raw: string
  body: string
  crcValid: boolean | null
  kind: 'ack' | 'nak' | 'payload' | 'empty'
}

/**
 * Strip the CR terminator and the trailing 2-byte checksum. Replies without a
 * checksum still decode - crcValid just comes back null.
 */
export function decodeReply(frame: Buffer): DecodedReply {
  const raw = frame.toString('latin1').replace(/\r+$/, '')
  if (!raw) return { raw, body: '', crcValid: null, kind: 'empty' }
  if (raw.length < 3) return { raw, body: raw, crcValid: null, kind: 'payload' }

  const body = raw.slice(0, -2)
  const tail = raw.slice(-2)
  const [hi, lo] = crcPI(body)
  const expected = String.fromCharCode(hi, lo)
  const crcValid = expected === tail

  const upper = body.toUpperCase()
  const kind = upper.startsWith('(ACK') ? 'ack' : upper.startsWith('(NAK') ? 'nak' : 'payload'
  return { raw, body, crcValid, kind }
}

export function toHex(buf: Uint8Array, max = 96): string {
  const slice = buf.length > max ? buf.subarray(0, max) : buf
  const hex = Array.from(slice, (b) => b.toString(16).padStart(2, '0')).join(' ')
  return buf.length > max ? `${hex} …(+${buf.length - max})` : hex
}

export function toPrintable(buf: Uint8Array, max = 96): string {
  const slice = buf.length > max ? buf.subarray(0, max) : buf
  const text = Array.from(slice, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
  return buf.length > max ? `${text}…` : text
}
