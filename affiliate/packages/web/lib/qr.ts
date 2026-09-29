/**
 * The link's QR code for "Download QR" (3c, 1e): qrcode-generator (MIT,
 * error correction M) and a dependency-free PNG encoder (1-bit greyscale,
 * stored deflate blocks), so the download works without a canvas and is
 * testable. Kept out of lib/links.ts: only components/creator/links/
 * downloadQr.ts imports it, so the offer browser (which uses lib/links for
 * sorting and filtering) does not ship the generator.
 *
 * Relative imports only (vitest has no @/ alias).
 */

import qrcode from 'qrcode-generator';

export type QrLevel = 'L' | 'M' | 'Q' | 'H';

/** QR modules for `text` (byte mode, UTF-8, smallest version that fits): true = dark. */
export function qrMatrix(text: string, level: QrLevel = 'M'): boolean[][] {
  if (text === '') throw new Error('qrMatrix: empty text');
  const qr = qrcode(0, level);
  // Byte mode takes one byte per char code: hand it the UTF-8 bytes so any URL survives intact.
  const utf8 = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of utf8) binary += String.fromCharCode(byte);
  qr.addData(binary, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let r = 0; r < n; r += 1) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c += 1) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

let crcTable: Uint32Array | null = null;

/** CRC-32 (IEEE 802.3), as PNG chunks use. */
export function crc32(bytes: Uint8Array, seed = 0): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([...type].map((ch) => ch.charCodeAt(0)));
  return concat([u32(data.length), typeBytes, data, u32(crc32(concat([typeBytes, data])))]);
}

/** zlib stream of stored (uncompressed) deflate blocks. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  const MAX = 65535;
  for (let at = 0; at < raw.length || at === 0; at += MAX) {
    const block = raw.subarray(at, Math.min(at + MAX, raw.length));
    const final = at + MAX >= raw.length ? 1 : 0;
    const len = block.length;
    parts.push(new Uint8Array([final, len & 0xff, (len >>> 8) & 0xff, ~len & 0xff, (~len >>> 8) & 0xff]), block);
    if (raw.length === 0) break;
  }
  parts.push(u32(adler32(raw)));
  return concat(parts);
}

export interface QrPngOptions {
  /** Pixels per module (default 8). */
  scale?: number;
  /** Quiet zone in modules (default 4, the QR minimum). */
  margin?: number;
  level?: QrLevel;
}

/** A PNG of the link's QR code (1-bit greyscale: dark modules black on white). */
export function qrPng(text: string, { scale = 8, margin = 4, level = 'M' }: QrPngOptions = {}): Uint8Array {
  const matrix = qrMatrix(text, level);
  const n = matrix.length;
  const size = (n + margin * 2) * scale;
  const rowBytes = Math.ceil(size / 8);
  const raw = new Uint8Array((rowBytes + 1) * size); // each row: filter byte 0, then packed bits (1 = white)
  for (let y = 0; y < size; y += 1) {
    const my = Math.floor(y / scale) - margin;
    const rowStart = y * (rowBytes + 1);
    for (let x = 0; x < size; x += 1) {
      const mx = Math.floor(x / scale) - margin;
      const dark = my >= 0 && my < n && mx >= 0 && mx < n && matrix[my]![mx]!;
      if (!dark) raw[rowStart + 1 + (x >> 3)]! |= 0x80 >> (x & 7);
    }
    // Pad bits past the image edge stay 0 (ignored by decoders).
  }
  const ihdr = concat([u32(size), u32(size), new Uint8Array([1, 0, 0, 0, 0])]); // depth 1, greyscale, deflate, filter 0, no interlace
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
