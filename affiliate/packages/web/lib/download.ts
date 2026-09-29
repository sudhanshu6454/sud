/*
 * Browser downloads (client components only): hand a Blob to the browser
 * as a file through a temporary object URL and a hidden <a download>.
 * Used by every "Export CSV" button and by "Download QR".
 */

/** Save `blob` as `fileName`. */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Save CSV text as `fileName`, with a UTF-8 BOM so spreadsheet apps read ₹, · and dashes correctly. */
export function downloadCsv(fileName: string, text: string): void {
  downloadBlob(fileName, new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
}
