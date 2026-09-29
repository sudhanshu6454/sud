/*
 * "Download QR": the matrix (qrcode-generator) and the PNG (lib/links.ts's
 * own encoder). The QR is checked by an independent reader written here
 * from the QR spec (ISO/IEC 18004) — format information with its BCH code,
 * the data mask, the zig-zag module order, block de-interleaving,
 * Reed–Solomon syndromes and byte-mode parsing — for versions 1–6, and the
 * PNG is inflated with node:zlib and read back module by module.
 */
import { inflateSync } from 'node:zlib';
import * as zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, qrMatrix, qrPng } from '../lib/qr';

/* ---------- a minimal QR reader (byte mode, versions 1–6) ---------- */

const EC_BITS: Record<number, 'L' | 'M' | 'Q' | 'H'> = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' };

/** [blocks, total codewords per block, data codewords per block] for versions 1–6 (all equal-size blocks). */
const BLOCKS: Record<'L' | 'M' | 'Q' | 'H', ReadonlyArray<[number, number, number]>> = {
  L: [[1, 26, 19], [1, 44, 34], [1, 70, 55], [1, 100, 80], [1, 134, 108], [2, 86, 68]],
  M: [[1, 26, 16], [1, 44, 28], [1, 70, 44], [2, 50, 32], [2, 67, 43], [4, 43, 27]],
  Q: [[1, 26, 13], [1, 44, 22], [2, 35, 17], [2, 50, 24], [0, 0, 0], [4, 43, 19]], // v5-Q has unequal blocks: unsupported
  H: [[1, 26, 9], [1, 44, 16], [2, 35, 13], [4, 25, 9], [0, 0, 0], [4, 43, 15]],
};

function bchFormat(data5: number): number {
  let v = data5 << 10;
  for (let i = 14; i >= 10; i -= 1) if (v & (1 << i)) v ^= 0x537 << (i - 10);
  return ((data5 << 10) | v) ^ 0x5412;
}

function readFormat(m: boolean[][]): { level: 'L' | 'M' | 'Q' | 'H'; mask: number } {
  // zxing order: row 8 cols 0–5, (8,7), (8,8), (7,8), then col 8 rows 5–0; first bit read = MSB.
  const cells: Array<[number, number]> = [];
  for (let c = 0; c <= 5; c += 1) cells.push([8, c]);
  cells.push([8, 7], [8, 8], [7, 8]);
  for (let r = 5; r >= 0; r -= 1) cells.push([r, 8]);
  let bits = 0;
  for (const [r, c] of cells) bits = (bits << 1) | (m[r]![c]! ? 1 : 0);
  for (let data = 0; data < 32; data += 1) {
    if (bchFormat(data) === bits) return { level: EC_BITS[data >> 3]!, mask: data & 7 };
  }
  throw new Error(`format information ${bits.toString(2)} matches no valid code word`);
}

const MASKS: ReadonlyArray<(i: number, j: number) => boolean> = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

function isFunction(version: number, n: number, r: number, c: number): boolean {
  if (r <= 8 && c <= 8) return true; // top-left finder, separator, format
  if (r <= 8 && c >= n - 8) return true; // top-right
  if (r >= n - 8 && c <= 8) return true; // bottom-left (+ dark module)
  if (r === 6 || c === 6) return true; // timing
  if (version >= 2) {
    const a = 4 * version + 10;
    if (Math.abs(r - a) <= 2 && Math.abs(c - a) <= 2) return true;
  }
  return false;
}

// GF(256), primitive polynomial 0x11d.
const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]!;
}
const gmul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

/** Every syndrome of a valid Reed–Solomon code word is 0. */
function syndromesZero(block: number[], ecCount: number): boolean {
  for (let k = 0; k < ecCount; k += 1) {
    let s = 0;
    for (const byte of block) s = gmul(s, EXP[k]!) ^ byte;
    if (s !== 0) return false;
  }
  return true;
}

function decodeQr(m: boolean[][]): { text: string; version: number; level: string } {
  const n = m.length;
  const version = (n - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 6) throw new Error(`unsupported size ${n}`);
  const { level, mask } = readFormat(m);
  const bits: number[] = [];
  let upward = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let k = 0; k < n; k += 1) {
      const r = upward ? n - 1 - k : k;
      for (const c of [right, right - 1]) {
        if (isFunction(version, n, r, c)) continue;
        bits.push((m[r]![c]! !== MASKS[mask]!(r, c)) ? 1 : 0);
      }
    }
    upward = !upward;
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  const [blockCount, total, dataPer] = BLOCKS[level][version - 1]!;
  if (!blockCount) throw new Error('unsupported block layout');
  const ecPer = total - dataPer;
  const blocks: number[][] = Array.from({ length: blockCount }, () => []);
  for (let i = 0; i < dataPer * blockCount; i += 1) blocks[i % blockCount]!.push(codewords[i]!);
  for (let i = 0; i < ecPer * blockCount; i += 1) blocks[i % blockCount]!.push(codewords[dataPer * blockCount + i]!);
  for (const block of blocks) if (!syndromesZero(block, ecPer)) throw new Error('Reed–Solomon check failed');
  const data = blocks.flatMap((b) => b.slice(0, dataPer));
  const stream = data.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1));
  let at = 0;
  const read = (count: number) => {
    let v = 0;
    for (let i = 0; i < count; i += 1) v = (v << 1) | stream[at++]!;
    return v;
  };
  const mode = read(4);
  if (mode !== 0b0100) throw new Error(`mode ${mode.toString(2)} is not byte mode`);
  const length = read(8);
  const bytes = Array.from({ length }, () => read(8));
  return { text: new TextDecoder().decode(new Uint8Array(bytes)), version, level };
}

/* ---------- PNG reader ---------- */

function readPng(png: Uint8Array): { width: number; height: number; bitDepth: number; colorType: number; pixel: (x: number, y: number) => number } {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  expect(Array.from(png.subarray(0, 8))).toEqual(sig);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  const chunks: Array<{ type: string; data: Uint8Array }> = [];
  while (at < png.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + len);
    const crc = view.getUint32(at + 8 + len);
    const typeAndData = png.subarray(at + 4, at + 8 + len);
    // Node's own CRC-32 where available (independent of lib/links.ts), else ours.
    const expected = typeof (zlib as { crc32?: (d: Uint8Array) => number }).crc32 === 'function'
      ? (zlib as unknown as { crc32: (d: Uint8Array) => number }).crc32(typeAndData)
      : crc32(typeAndData);
    expect(crc >>> 0).toBe(expected >>> 0);
    chunks.push({ type, data });
    at += 12 + len;
  }
  expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  const ihdr = new DataView(chunks[0]!.data.buffer, chunks[0]!.data.byteOffset, 13);
  const width = ihdr.getUint32(0);
  const height = ihdr.getUint32(4);
  const bitDepth = ihdr.getUint8(8);
  const colorType = ihdr.getUint8(9);
  const raw = inflateSync(chunks[1]!.data);
  const rowBytes = Math.ceil(width / 8);
  expect(raw.length).toBe((rowBytes + 1) * height);
  return {
    width,
    height,
    bitDepth,
    colorType,
    pixel: (x, y) => {
      const row = y * (rowBytes + 1);
      expect(raw[row]).toBe(0); // filter type None
      return (raw[row + 1 + (x >> 3)]! >> (7 - (x & 7))) & 1;
    },
  };
}

/* ---------- tests ---------- */

const LINKS = [
  'https://afflino.demo.invalid/r/demo-priya/demo-style?s=short-diwali-02', // 3c demo link
  'https://afflino.demo.invalid/r/demo-priya/demo-payupi?s=reel-oct-01', // 1e demo link
  'http://localhost:3001/r/9f2c1ab4e5d64f7a8b9c0d1e2f3a4b5c', // a live /r/{32-hex} link (openapi example)
  'https://redirect.demo.invalid/r/demo-abc12345', // offline fallback
  `https://afflino.demo.invalid/r/demo-priya/demo-payupi?s=${'a'.repeat(32)}`, // longest sub-ID
  'https://afflino.demo.invalid/r/x',
];

describe('QR code for a link', () => {
  it.each(LINKS)('%s decodes back to the same text at error correction M', (text) => {
    const m = qrMatrix(text);
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === m.length)).toBe(true);
    const decoded = decodeQr(m);
    expect(decoded.text).toBe(text);
    expect(decoded.level).toBe('M');
  });

  it('uses the smallest version that fits and draws the three finder patterns', () => {
    const m = qrMatrix(LINKS[0]!);
    expect(m.length).toBe(37); // version 5: 70 bytes fit in 5-M's 84 (4-M holds 62)
    const finderAt = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
          expect(m[r0 + r]![c0 + c]).toBe(ring !== 2);
        }
      }
    };
    finderAt(0, 0);
    finderAt(0, m.length - 7);
    finderAt(m.length - 7, 0);
    for (let i = 8; i < m.length - 8; i += 1) {
      expect(m[6]![i]).toBe(i % 2 === 0); // timing patterns
      expect(m[i]![6]).toBe(i % 2 === 0);
    }
  });

  it('the reader is strict: one flipped data module fails the Reed–Solomon check', () => {
    const m = qrMatrix(LINKS[0]!).map((row) => [...row]);
    const n = m.length;
    m[n - 1]![n - 1] = !m[n - 1]![n - 1];
    expect(() => decodeQr(m)).toThrow(/Reed–Solomon/);
    const f = qrMatrix(LINKS[0]!).map((row) => [...row]);
    f[8]![0] = !f[8]![0]; // damage the format information
    expect(() => decodeQr(f)).toThrow(/format information/);
  });

  it('keeps non-ASCII text intact (UTF-8 bytes)', () => {
    expect(decodeQr(qrMatrix('https://shop.example.com/₹-offer')).text).toBe('https://shop.example.com/₹-offer');
  });

  it('refuses empty text', () => {
    expect(() => qrMatrix('')).toThrow();
  });
});

describe('QR PNG ("Download QR")', () => {
  it('is a valid 1-bit greyscale PNG whose pixels are the matrix at 8px per module with a 4-module quiet zone', () => {
    const text = LINKS[0]!;
    const png = qrPng(text);
    expect(png.length).toBeGreaterThan(100);
    const img = readPng(png);
    const m = qrMatrix(text);
    const modules = m.length + 8;
    expect(img).toMatchObject({ width: modules * 8, height: modules * 8, bitDepth: 1, colorType: 0 });
    // Sample every module's centre: 0 = black (dark), 1 = white.
    const read: boolean[][] = [];
    for (let r = 0; r < modules; r += 1) {
      const row: boolean[] = [];
      for (let c = 0; c < modules; c += 1) row.push(img.pixel(c * 8 + 4, r * 8 + 4) === 0);
      read.push(row);
    }
    // The quiet zone is white all round.
    for (let i = 0; i < modules; i += 1) {
      for (const k of [0, 1, 2, 3, modules - 4, modules - 3, modules - 2, modules - 1]) {
        expect(read[k]![i]).toBe(false);
        expect(read[i]![k]).toBe(false);
      }
    }
    const inner = read.slice(4, modules - 4).map((row) => row.slice(4, modules - 4));
    expect(inner).toEqual(m);
    expect(decodeQr(inner).text).toBe(text);
    // Every pixel inside a module has the module's colour.
    expect(img.pixel(4 * 8, 4 * 8)).toBe(0);
    expect(img.pixel(4 * 8 + 7, 4 * 8 + 7)).toBe(0);
  });

  it('honours scale and margin, and larger images span several stored deflate blocks', () => {
    const img = readPng(qrPng(LINKS[2]!, { scale: 3, margin: 2 }));
    const n = qrMatrix(LINKS[2]!).length;
    expect(img.width).toBe((n + 4) * 3);
    const big = qrPng(LINKS[4]!, { scale: 40, margin: 4 }); // > 65,535 raw bytes
    const bigImg = readPng(big);
    expect(bigImg.width).toBe((qrMatrix(LINKS[4]!).length + 8) * 40);
  });

  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
