/**
 * Voltronic "crcPI" - the checksum every PI30 frame is wrapped in.
 *
 * It is CRC-16/CCITT (poly 0x1021, init 0x0000, non-reflected) evaluated
 * nibble-at-a-time, followed by a vendor quirk: if either output byte lands
 * on one of the framing characters 0x28 '(' 0x0D CR 0x0A LF 0x00 NUL, that
 * byte is incremented so it can never be mistaken for a delimiter.
 *
 * Verified against mpp-solar's fixtures:
 *   "(PI30"    -> 9A 0B
 *   "(ACK"     -> 39 20
 *   "(NAK"     -> 73 73
 *   QPIGS test -> 24 8C
 * and against the command checksums the Voltronic poller logs:
 *   "QPIGS"    -> B7 A9
 *   "QPIRI"    -> F8 54
 */

const CRC_TA = [
  0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7, 0x8108, 0x9129, 0xa14a, 0xb16b, 0xc18c,
  0xd1ad, 0xe1ce, 0xf1ef
]

const BUMP = new Set([0x28, 0x0d, 0x0a, 0x00])

function bump(byte: number): number {
  return BUMP.has(byte) ? (byte + 1) & 0xff : byte
}

export function crcPI(data: Uint8Array | string): [number, number] {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'latin1') : data
  let crc = 0

  for (const c of bytes) {
    let index = ((crc >> 8) >> 4) ^ (c >> 4)
    crc = (crc << 4) & 0xffff
    crc ^= CRC_TA[index]

    index = ((crc >> 8) >> 4) ^ (c & 0x0f)
    crc = (crc << 4) & 0xffff
    crc ^= CRC_TA[index]
  }

  return [bump((crc >> 8) & 0xff), bump(crc & 0xff)]
}

export function crcPIHex(data: Uint8Array | string): string {
  const [hi, lo] = crcPI(data)
  return `${hi.toString(16).padStart(2, '0')} ${lo.toString(16).padStart(2, '0')}`
}

/**
 * Self-check vectors captured from mpp-solar fixtures and live Voltronic pollers.
 * Run at startup so a typo in this table can never masquerade as a dead device.
 */
export const CRC_VECTORS: Array<[string, string]> = [
  ['(PI30', '9a 0b'],
  ['(ACK', '39 20'],
  ['(NAK', '73 73'],
  ['QPIGS', 'b7 a9'],
  ['QPIRI', 'f8 54'],
  ['QDI', '71 1b'],
  ['QFLAG', '98 74'],
  ['QID', 'd6 ea']
]

export function crcPIIsValid(): boolean {
  return CRC_VECTORS.every(([input, expected]) => crcPIHex(input) === expected)
}
