#!/usr/bin/env python3
"""Afflino: plan the Amazon.in tracking IDs of the in-house network (called by amazon.sh plan).

  AFFLINO_PLAN_STORE=<store id> python3 amazon-plan.py <template.csv> <meta dir> <N> <out.csv>

Keeps the N most-viewed Facebook / Instagram pages of the template (written by
`amazon.sh template`: platform,account,tracking_id,url), ranked by the 28-day
views of the owner's Meta exports in <meta dir> (the files the network was
built from; accounts matched as db/meta-network.ts does: Facebook by page ID,
Instagram by handle), plus every web row. Tracking IDs are numbered under the
Store ID, <store>-p01-21 ... and <store>-web-21 for the site. Writes <out.csv>
in the format `amazon.sh setup` reads and prints the list to create in
Associates Central. Exits non-zero, writing nothing useful, when the inputs
do not match. Tested by packages/api/test/amazon-plan.test.ts.
"""
import csv, glob, os, re, sys
tpl, meta, n, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
store = os.environ["AFFLINO_PLAN_STORE"]
prefix = store[:-3] if store.endswith("-21") else store
def read(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))
views, names = {}, {}
for path in sorted(glob.glob(os.path.join(meta, "*.csv"))):
    for r in read(path):
        p = (r.get("Platform") or "").strip().lower()
        url = (r.get("Channel URL") or "").strip()
        if p == "facebook":
            m = re.match(r"^https?://(?:www\.|m\.|web\.)?facebook\.com/(?:profile\.php\?id=)?([A-Za-z0-9.]+)/?", url, re.I)
        elif p == "instagram":
            m = re.match(r"^https?://(?:www\.)?instagram\.com/([A-Za-z0-9._]+)/?", url, re.I)
        else:
            continue
        acct = (m.group(1) if m else (r.get("Handle") or "").strip().lstrip("@")).lower()
        if not acct:
            continue
        try:
            v = int((r.get("Views (28d)") or "0").replace(",", "") or 0)
        except ValueError:
            v = 0
        k = (p, acct)
        if v >= views.get(k, -1):
            views[k] = v
            names[k] = re.sub(r"\s+", " ", (r.get("Channel") or "").strip())
rows = read(tpl)
for need in ("platform", "account"):
    if not rows or need not in rows[0]:
        sys.exit(f"{tpl} has no '{need}' column (run the template step again)")
key = lambda t: (t["platform"].strip().lower(), t["account"].strip().lower())
pages = [t for t in rows if key(t)[0] in ("facebook", "instagram") and key(t) in views]
sites = [t for t in rows if key(t)[0] == "web"]
if not pages:
    sys.exit("no template page matches the Meta exports (were they the ones the network was built from?)")
pages.sort(key=lambda t: (-views[key(t)], key(t)))
chosen = pages[:n]
total = sum(views[key(t)] for t in pages)
share = sum(views[key(t)] for t in chosen) / total if total else 0
plan = [(t, f"{prefix}-p{i:02d}-21") for i, t in enumerate(chosen, 1)]
plan += [(t, f"{prefix}-web-21" if i == 0 else f"{prefix}-web{i + 1}-21") for i, t in enumerate(sites)]
for _, tag in plan:
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,59}-21", tag):
        sys.exit(f"'{tag}' is not a valid tracking ID")
with open(out, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f, lineterminator="\n")
    w.writerow(["platform", "account", "tracking_id", "url"])
    for t, tag in plan:
        w.writerow([t["platform"].strip().lower(), t["account"].strip(), tag, (t.get("url") or "").strip()])
print(f"   {len(chosen)} of {len(pages)} pages chosen by 28-day views ({share:.1%} of those pages' views), plus {len(sites)} website(s).")
print("   Create each tracking ID in Associates Central (Account settings, Manage tracking IDs, Add: type the part before -21),")
print("   and list each page's URL on the account (Account settings, Edit your website and mobile app list):")
print(f"   {'#':>3}  {'tracking ID':<24} {'views (28d)':>15}  page")
for i, (t, tag) in enumerate(plan, 1):
    k = key(t)
    label = names.get(k) or t["account"].strip()
    print(f"   {i:>3}  {tag:<24} {views.get(k, 0):>15,}  {label} ({k[0]})  {(t.get('url') or '').strip()}")
