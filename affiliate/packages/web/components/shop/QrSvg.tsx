import { qrMatrix } from '../../lib/qr';

/**
 * A QR code of an afflino.com page as an inline SVG (rendered on the server:
 * no script, no request). Only ever a page URL of the site — a storefront —
 * never a tracked /r/ link (Amazon's links are not for offline use).
 */
export function QrSvg({ text, size = 176, label }: { text: string; size?: number; label: string }) {
  const m = qrMatrix(text, 'M');
  const n = m.length;
  const margin = 4;
  const dim = n + margin * 2;
  let d = '';
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (m[y]?.[x]) d += `M${x + margin} ${y + margin}h1v1h-1z`;
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${dim} ${dim}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={dim} height={dim} fill="var(--color-bg)" />
      <path d={d} fill="var(--color-text)" />
    </svg>
  );
}
