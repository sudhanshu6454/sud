#!/usr/bin/env python3
"""Point every site's domain at the server.

  python3 infra/dns.py --ip 1.2.3.4                     # GoDaddy DNS API (default)
  python3 infra/dns.py --ip 1.2.3.4 --provider linode   # Linode DNS + switch GoDaddy nameservers

GoDaddy: needs GODADDY_API_KEY / GODADDY_API_SECRET (production keys from developer.godaddy.com).
GoDaddy only grants API access to accounts with 10+ domains or a Discount Domain Club plan; if you
get 403, use --provider linode, which hosts the zone on Linode and only needs to change the
nameservers at GoDaddy (done automatically when the GoDaddy keys work, otherwise printed for you).
Linode: needs LINODE_TOKEN.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).resolve().parents[1]
GODADDY = "https://api.godaddy.com/v1"
LINODE = "https://api.linode.com/v4"
LINODE_NS = [f"ns{i}.linode.com" for i in range(1, 6)]


def load_env(path: Path = ROOT / ".env") -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def domains() -> list[str]:
    with open(ROOT / "autopub" / "config" / "sites.yaml") as fh:
        return [s["domain"] for s in yaml.safe_load(fh)["sites"]]


# ---------------------------------------------------------------- GoDaddy
def gd_headers() -> dict:
    key, secret = os.environ.get("GODADDY_API_KEY"), os.environ.get("GODADDY_API_SECRET")
    if not key or not secret:
        sys.exit("GODADDY_API_KEY / GODADDY_API_SECRET not set")
    return {"Authorization": f"sso-key {key}:{secret}", "Content-Type": "application/json"}


def godaddy_set_a(domain: str, ip: str, ttl: int = 600) -> None:
    for name in ("@", "www"):
        r = requests.put(f"{GODADDY}/domains/{domain}/records/A/{name}", headers=gd_headers(),
                         json=[{"data": ip, "ttl": ttl}], timeout=30)
        if r.status_code == 403:
            sys.exit(f"GoDaddy refused API access for {domain} (403). Use --provider linode.\n{r.text}")
        r.raise_for_status()
        print(f"  {name}.{domain} A -> {ip}")
    # a stale www CNAME would conflict with the A record we just set
    requests.delete(f"{GODADDY}/domains/{domain}/records/CNAME/www", headers=gd_headers(), timeout=30)


def godaddy_set_nameservers(domain: str, nameservers: list[str]) -> bool:
    r = requests.patch(f"{GODADDY}/domains/{domain}", headers=gd_headers(), json={"nameServers": nameservers}, timeout=30)
    if r.status_code in (200, 204):
        print(f"  nameservers for {domain} -> {', '.join(nameservers)}")
        return True
    print(f"  could not change nameservers for {domain} ({r.status_code}): {r.text[:200]}")
    return False


# ---------------------------------------------------------------- Linode DNS
def li_headers() -> dict:
    token = os.environ.get("LINODE_TOKEN")
    if not token:
        sys.exit("LINODE_TOKEN not set")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def linode_zone(domain: str, soa_email: str) -> int:
    r = requests.get(f"{LINODE}/domains", headers=li_headers(), params={"page_size": 500}, timeout=30)
    r.raise_for_status()
    for d in r.json()["data"]:
        if d["domain"] == domain:
            return d["id"]
    r = requests.post(f"{LINODE}/domains", headers=li_headers(), json={"domain": domain, "type": "master", "soa_email": soa_email, "ttl_sec": 300}, timeout=30)
    r.raise_for_status()
    print(f"  created zone {domain}")
    return r.json()["id"]


def linode_set_a(domain: str, ip: str, soa_email: str) -> None:
    zone = linode_zone(domain, soa_email)
    r = requests.get(f"{LINODE}/domains/{zone}/records", headers=li_headers(), params={"page_size": 500}, timeout=30)
    r.raise_for_status()
    existing = {(rec["type"], rec["name"]): rec for rec in r.json()["data"]}
    for name in ("", "www"):
        body = {"type": "A", "name": name, "target": ip, "ttl_sec": 300}
        rec = existing.get(("A", name))
        if rec:
            requests.put(f"{LINODE}/domains/{zone}/records/{rec['id']}", headers=li_headers(), json=body, timeout=30).raise_for_status()
        else:
            requests.post(f"{LINODE}/domains/{zone}/records", headers=li_headers(), json=body, timeout=30).raise_for_status()
        print(f"  {name or '@'}.{domain} A -> {ip} (Linode DNS)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ip", required=True, help="public IPv4 of the Linode")
    ap.add_argument("--provider", choices=["godaddy", "linode"], default="godaddy")
    ap.add_argument("--domain", action="append", help="limit to these domains (default: all in sites.yaml)")
    args = ap.parse_args()
    load_env()
    targets = args.domain or domains()
    soa = os.environ.get("LETSENCRYPT_EMAIL", "hostmaster@" + targets[0])
    for domain in targets:
        print(f"{domain}:")
        if args.provider == "godaddy":
            godaddy_set_a(domain, args.ip)
        else:
            linode_set_a(domain, args.ip, soa)
            if os.environ.get("GODADDY_API_KEY"):
                godaddy_set_nameservers(domain, LINODE_NS)
            else:
                print(f"  -> set nameservers for {domain} at GoDaddy to: {', '.join(LINODE_NS)}")
    print("\nDNS updated. Propagation usually takes 5-30 minutes; Let's Encrypt certificates are issued automatically after that.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
