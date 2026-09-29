'use client';

import { downloadBlob } from '@/lib/download';
import { qrPng } from '@/lib/links';

/** Save the link's QR code as a PNG (8px modules, 4-module quiet zone, error correction M). */
export function downloadQrPng(href: string, fileName: string): void {
  const bytes = qrPng(href, { scale: 8, margin: 4 });
  // Copy into a plain ArrayBuffer (BlobPart rejects a possibly-shared buffer type).
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  downloadBlob(fileName, new Blob([buffer], { type: 'image/png' }));
}
