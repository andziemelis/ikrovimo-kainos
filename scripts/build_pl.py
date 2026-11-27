"""Build data/pl.json from Poland's official charging register (EIPA, Urząd Dozoru Technicznego).

The download links are personal (they contain an access key), so they come from GitHub secrets:
EIPA_POOLS, EIPA_STATIONS, EIPA_POINTS, EIPA_DYNAMIC, EIPA_OPERATORS. EIPA limits downloads to
10 per hour for static files and 240 per hour for the dynamic (price/status) file; this runs every 30 minutes.

Output uses the same compact format as data/lt.json, with prices converted from złoty to euros at the
European Central Bank's daily rate, plus each location's city and how it can be paid.

Usage: python scripts/build_pl.py            (downloads using the environment variables)
       python scripts/build_pl.py <folder>   (reads pools.json, stations.json, points.json, dynamic.json, operators.json)
"""
import collections, gzip, json, os, re, sys, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "pl.json"
HOST = "eipa.udt.gov.pl"
ECB = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
FALLBACK_PLN_PER_EUR = 4.25
MAX_BYTES = 150 * 1024 * 1024
PL_BOX = (48.9, 55.0, 14.0, 24.3)            # lat min/max, lon min/max (Poland with a margin)
MAX_PLN_KWH = 20.0                           # anything above is treated as a typo
CTRL = re.compile(r"[\x00-\x1f\x7f<>]")
T2, CCS, CHADEMO = {10, 17}, {29}, {11}      # connector_interface ids from the EIPA dictionary
# station_payment_method / station_authentication_method bits from the EIPA dictionary
PAY_FREE, PAY_CARD, PAY_CASH, PAY_WEB = 1, 4, 8, 128
AUTH_NONE, AUTH_APP = 0, 32
# our own "how to pay" bits, read by the app
P_CARD, P_APP, P_NOREG, P_CASH = 1, 2, 4, 8


def clean(s, limit):
    return CTRL.sub("", str(s or "")).strip()[:limit]


def fetch(url, expect_host=HOST):
    req = urllib.request.Request(url, headers={"User-Agent": "ev-price-map/0.1", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=180) as r:
        final = urllib.parse.urlparse(r.geturl())
        if final.scheme != "https" or final.hostname != expect_host:
            sys.exit("Refusing data from an unexpected address")
        body = r.read(MAX_BYTES + 1)
        enc = r.headers.get("Content-Encoding", "")
    if len(body) > MAX_BYTES:
        sys.exit("Download larger than expected, refusing it")
    if enc == "gzip" or body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return body


def load(name, folder=None):
    if folder:
        return json.loads((Path(folder) / f"{name}.json").read_text(encoding="utf-8"))
    url = os.environ.get("EIPA_" + name.upper(), "").strip()
    if not url:
        sys.exit(f"Secret EIPA_{name.upper()} is missing")
    return json.loads(fetch(url))


def pln_per_eur():
    try:
        root = ET.fromstring(fetch(ECB, "www.ecb.europa.eu"))
        for el in root.iter():
            if el.get("currency") == "PLN":
                v = float(el.get("rate"))
                if 3.0 < v < 6.0:
                    return v
    except Exception:
        pass
    return FALLBACK_PLN_PER_EUR


def bits(v):
    """EIPA gives methods either as a bitmask number or a list of bit values."""
    if isinstance(v, list):
        out = 0
        for x in v:
            try:
                out |= int(x if not isinstance(x, dict) else x.get("id", 0))
            except (TypeError, ValueError):
                pass
        return out
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


LEGAL = re.compile(r"[\s,]*(sp[óo]?[łl]ka\b.*|sp\.?\s*z\s*o\.?\s*o\.?.*|s\.?\s*a\.?$|sp\.?\s*k\.?$|sp\.?\s*j\.?$|s\.?\s*c\.?$|gmbh$|ag$|ltd\.?$|b\.?\s*v\.?$|as$|uab$)", re.I)
COUNTRY = re.compile(r"\s+(Polska|Poland)\b", re.I)


def short_name(s):
    """'GreenWay Polska Sp. z o.o.' -> 'GreenWay', 'Lidl sp. z o.o. sp. k.' -> 'Lidl'."""
    s = clean(s, 80)
    for _ in range(3):
        s = LEGAL.sub("", s).strip(" .,-")
    s = COUNTRY.sub("", s).strip(" .,-")
    return s[:40] or clean(s, 40)


def money_pl(v):
    return f"{v:.2f}".replace(".", ",")


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else None
    pools = load("pools", folder)["data"]
    stations = load("stations", folder)["data"]
    points = load("points", folder)["data"]
    dynamic = load("dynamic", folder)
    operators = load("operators", folder)["data"]
    rate = FALLBACK_PLN_PER_EUR if folder else pln_per_eur()
    pub = clean(dynamic.get("generated"), 40)

    ops = {o.get("id"): short_name(o.get("short_name") or o.get("name")) or "?" for o in operators}
    pool_by_id = {}
    for p in pools:
        try:
            la, lo = float(p["latitude"]), float(p["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        if not p.get("charging") or not (PL_BOX[0] <= la <= PL_BOX[1] and PL_BOX[2] <= lo <= PL_BOX[3]):
            continue
        pool_by_id[p.get("id")] = {"la": la, "lo": lo, "op": ops.get(p.get("operator_id")) or clean(p.get("name"), 60) or "?",
                                   "city": clean(p.get("city"), 40)}
    station = {}
    for s in stations:
        if s.get("type") != "E" or s.get("suspended") or s.get("pool_id") not in pool_by_id:
            continue
        station[s.get("id")] = {"pool": s["pool_id"], "pay": bits(s.get("payment_methods")), "auth": bits(s.get("authentication_methods")),
                                "auth_list": s.get("authentication_methods")}
    prices = collections.defaultdict(list)
    units = collections.Counter()
    for d in dynamic.get("data", []):
        for pr in d.get("prices") or []:
            unit = clean(pr.get("unit"), 12).lower()
            units[unit] += 1
            try:
                v = float(str(pr.get("price")).replace(",", "."))
            except (TypeError, ValueError):
                continue
            prices[d.get("point_id")].append((v, unit))

    # one offer per (location, operator), the same as for Lithuania
    offers = {}
    skipped = 0
    for pt in points:
        st = station.get(pt.get("station_id"))
        if not st:
            skipped += 1
            continue
        pool = pool_by_id[st["pool"]]
        ifaces, kw = set(), 0.0
        for c in pt.get("connectors") or []:
            for i in c.get("interfaces") or []:
                try:
                    ifaces.add(int(i if not isinstance(i, dict) else i.get("id")))
                except (TypeError, ValueError):
                    pass
            try:
                kw = max(kw, float(c.get("power") or 0))
            except (TypeError, ValueError):
                pass
        for cs in pt.get("charging_solutions") or []:
            try:
                kw = max(kw, float(cs.get("power") or 0))
            except (TypeError, ValueError):
                pass
        kw = min(kw, 1000)
        kwh = [v for v, u in prices.get(pt.get("id"), []) if u == "kwh" and 0 < v <= MAX_PLN_KWH]
        timed = [(v, u) for v, u in prices.get(pt.get("id"), []) if u in ("min", "h", "godz", "godzina") and v > 0]
        other = [(v, u) for v, u in prices.get(pt.get("id"), []) if u not in ("kwh", "min", "h", "godz", "godzina") and v > 0]
        k = (round(pool["la"], 5), round(pool["lo"], 5), pool["op"])
        o = offers.setdefault(k, {"op": pool["op"], "city": pool["city"], "kw": 0, "n": 0, "ct": 0, "ac": [], "dc": [], "all": [],
                                  "texts": set(), "pay": 0, "free": False, "timed": False, "fixed": False})
        o["kw"] = max(o["kw"], kw); o["n"] += 1
        o["ct"] |= (1 if ifaces & T2 else 0) | (2 if ifaces & CCS else 0) | (4 if ifaces & CHADEMO else 0)
        (o["dc"] if kw > 22 else o["ac"]).extend(kwh)
        o["all"].extend(kwh)
        for v in kwh:
            o["texts"].add(f"{money_pl(v)} zł/kWh ({'DC' if kw > 22 else 'AC'})")
        for v, u in timed:
            o["texts"].add(f"{money_pl(v)} zł/{u}"); o["timed"] = True
        for v, u in other:
            o["texts"].add(f"{money_pl(v)} zł/{u}"); o["fixed"] = True
        p = st["pay"]
        o["pay"] |= (P_CARD if p & PAY_CARD else 0) | (P_CASH if p & PAY_CASH else 0) | (P_APP if (p & PAY_WEB or st["auth"] & AUTH_APP) else 0)
        if isinstance(st["auth_list"], list) and AUTH_NONE in st["auth_list"]:
            o["pay"] |= P_NOREG
        if p & PAY_FREE and not kwh:
            o["free"] = True

    eur = lambda v: round(v / rate, 3)
    locs = collections.OrderedDict()
    for (la, lo, _), v in offers.items():
        locs.setdefault((la, lo), []).append(v)
    op_names = sorted({v["op"] for v in offers.values()})
    tariffs, tidx = [], {}

    def ti(s):
        if s not in tidx:
            tidx[s] = len(tariffs); tariffs.append(s)
        return tidx[s]

    rows = []
    for (la, lo), vs in locs.items():
        o_rows = []
        for v in vs:
            m = 0.0 if v["free"] else (eur(min(v["all"])) if v["all"] else None)
            ac = eur(min(v["ac"])) if v["ac"] else None
            dc = eur(min(v["dc"])) if v["dc"] else None
            fl = (1 if v["free"] else 0) | (4 if v["timed"] else 0) | (8 if v["fixed"] else 0)
            texts = sorted(v["texts"], key=lambda s: (float(s.split(" ")[0].replace(",", ".")), s))[:8]
            o_rows.append([op_names.index(v["op"]), m, ac, dc, fl, [ti(t) for t in texts], v["pay"]])
        o_rows.sort(key=lambda x: (x[1] is None, x[1] if x[1] is not None else 9))
        city = next((v["city"] for v in vs if v["city"]), "")
        rows.append([la, lo, int(max(v["kw"] for v in vs)), max(v["n"] for v in vs), max(v["ct"] for v in vs) | 0, o_rows, city])
    if len(rows) < 1000:   # protect the live site from a broken or partial download
        sys.exit(f"Only {len(rows)} Polish locations found, refusing to overwrite {OUT}")
    priced = sum(1 for r in rows if any(o[1] is not None for o in r[5]))
    data = {"pub": pub, "cc": "PL", "cur": "PLN", "rate": rate, "ops": op_names, "T": tariffs, "s": rows,
            "info": {"points": len(points), "locations": len(rows), "priced": priced, "skipped_points": skipped,
                     "units": dict(units.most_common(8))}}
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(rows)} Polish locations ({priced} with a price), rate {rate} PLN/EUR, units {dict(units.most_common(5))}")


if __name__ == "__main__":
    main()
