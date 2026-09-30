/** Shared navigation model for the shells. */

export interface NavItem {
  label: string;
  /** Route, optionally with a #fragment (an in-page section, e.g. /agency#clients). */
  href: string;
  /**
   * 'exact' — active only on this path (a section root such as /app);
   * 'prefix' (default) — also active on sub-routes (/app/payouts → /app/payouts/disputes).
   */
  match?: 'exact' | 'prefix';
  /** Other path prefixes this item also stands for (one tab for a group of screens, each with a sub-nav). */
  also?: ReadonlyArray<string>;
}

/** Path and #fragment of an href; a ?query (e.g. ?workspace=) never affects matching. */
function splitHref(href: string): { path: string; fragment: string } {
  const i = href.indexOf('#');
  const beforeHash = i < 0 ? href : href.slice(0, i);
  const q = beforeHash.indexOf('?');
  return { path: q < 0 ? beforeHash : beforeHash.slice(0, q), fragment: i < 0 ? '' : href.slice(i) };
}

/**
 * Index of the active item for a pathname (and location hash), or -1.
 * A #fragment item wins when both its path and fragment match; otherwise
 * the longest matching href wins, so /app/payouts beats /app on
 * /app/payouts/statements.
 */
export function activeNavIndex(items: ReadonlyArray<NavItem>, pathname: string, hash = ''): number {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const byFragment = items.findIndex((item) => {
    const { path: p, fragment } = splitHref(item.href);
    return fragment !== '' && p === path && fragment === hash;
  });
  if (byFragment >= 0) return byFragment;

  let best = -1;
  let bestLength = -1;
  items.forEach((item, i) => {
    const { path: p, fragment } = splitHref(item.href);
    if (fragment !== '') return;
    const hit = path === p || (item.match !== 'exact' && path.startsWith(p === '/' ? '/' : `${p}/`));
    if (hit && p.length > bestLength) {
      best = i;
      bestLength = p.length;
    }
    for (const extra of item.also ?? []) {
      if ((path === extra || path.startsWith(`${extra}/`)) && extra.length > bestLength) {
        best = i;
        bestLength = extra.length;
      }
    }
  });
  return best;
}
