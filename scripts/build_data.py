"""Download Lithuania's open EV charging data (Via Lietuva, DATEX II) and build data/lt.json for the website.

Usage:
  python scripts/build_data.py                 # download from Via Lietuva
  python scripts/build_data.py path/to/file.xml  # use a local file
Data licence: CC BY 4.0, AB Via Lietuva (https://ev.vialietuva.lt/en/data-provision)
"""
import collections, json, re, sys, urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

SOURCE = "https://ev.vialietuva.lt/publicdata/EnergyInfrastructureTablePublication"
OUT = Path(__file__).resolve().parent.parent / "data" / "lt.json"
NS = {"egi": "https://datex2.eu/schema/3/energyInfrastructure", "fac": "https://datex2.eu/schema/3/facilities",
      "com": "https://datex2.eu/schema/3/common", "loc": "https://datex2.eu/schema/3/locationReferencing"}
# Short display names for the bigger networks; everything else keeps its registered name.
OP_NAMES = {"In Balance grid, UAB": "In Balance grid", "EV Infrastruktūra, UAB": "EV Infrastruktūra",
            "Stuart Energy, UAB": "Stuart Energy", "Ignitis, UAB": "Ignitis ON", "Stova, UAB": "Stova",
            "Eldrive Lithuania, UAB": "Eldrive", "Enefit, UAB": "Enefit", "Įkrautas, UAB": "Įkrautas",
            "Elektrum Lietuva, UAB": "Elektrum", "Eleport, UAB": "Eleport", "Lidl Lietuva, UAB": "Lidl",
            "Neste Lietuva, UAB": "Neste", "IONITY GmbH": "IONITY", "VIRŠI Lietuva, UAB": "Virši"}
PRICE = re.compile(r"([\d.]+) ?€/kWh")


def load_xml():
    if len(sys.argv) > 1:
        return ET.parse(sys.argv[1]).getroot()
    req = urllib.request.Request(SOURCE, headers={"User-Agent": "ev-price-map/0.1"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return ET.fromstring(r.read())


def min_price(texts):
    nums = [float(m) for t in texts for m in PRICE.findall(t)]
    return min(nums) if nums else None


def parse(root):
    stations = []
    for st in root.iter("{%s}energyInfrastructureStation" % NS["egi"]):
        op_raw = st.find("egi:energyProvider/fac:name/com:values/com:value", NS).text.strip()
        conns = [(c.find("egi:connectorType", NS).text, float(c.find("egi:maxPowerAtSocket", NS).text or 0))
                 for c in st.findall(".//egi:connector", NS)]
        vals = [v.text.strip() for v in st.findall(".//egi:additionalInformation/com:values/com:value", NS) if v.text]
        ac = dc = None
        if vals and len(vals) == len(conns):  # prices are listed per connector, in order
            ac = min_price([v for v, (_, p) in zip(vals, conns) if p <= 22 and "Nemokam" not in v])
            dc = min_price([v for v, (_, p) in zip(vals, conns) if p > 22 and "Nemokam" not in v])
        all_free = bool(vals) and all("Nemokam" in v for v in vals)
        stations.append({
            "la": round(float(st.find(".//loc:latitude", NS).text), 6),
            "lo": round(float(st.find(".//loc:longitude", NS).text), 6),
            "op": OP_NAMES.get(op_raw, op_raw), "kw": max([p for _, p in conns], default=0),
            "n": len(st.findall("egi:refillPoint", NS)), "ct": {t for t, _ in conns},
            "m": 0.0 if all_free else min_price(vals), "ac": ac, "dc": dc, "f": int(all_free),
            "fo": int(not all_free and any("Nemokam" in v for v in vals)),
            "pk": int(any("parkavimo" in v for v in vals)), "fx": int(any(re.search(r"\d €\s*\+", v) for v in vals)),
            "t": list(dict.fromkeys(vals))[:8]})
    return stations


def build(stations, pub):
    # 1) one offer per (location, operator)
    offers = {}
    for s in stations:
        k = (round(s["la"], 5), round(s["lo"], 5), s["op"])
        if k not in offers:
            offers[k] = dict(s, t=list(s["t"]), ct=set(s["ct"]))
            continue
        a = offers[k]
        a["kw"] = max(a["kw"], s["kw"]); a["n"] += s["n"]; a["ct"] |= s["ct"]
        for f in ("m", "ac", "dc"):
            v = [x for x in (a[f], s[f]) if x is not None]
            a[f] = min(v) if v else None
        a["f"] = int(a["f"] and s["f"])
        for f in ("fo", "pk", "fx"):
            a[f] = int(a[f] or s[f])
        a["t"] = list(dict.fromkeys(a["t"] + s["t"]))[:8]
    # 2) group offers by location (the same spot is often listed by several companies)
    locs = collections.OrderedDict()
    for (la, lo, _), v in offers.items():
        locs.setdefault((la, lo), []).append(v)
    ops = sorted({v["op"] for v in offers.values()})
    tariffs, tidx = [], {}

    def ti(s):
        if s not in tidx:
            tidx[s] = len(tariffs); tariffs.append(s)
        return tidx[s]

    rows = []
    for (la, lo), vs in locs.items():
        cts = set().union(*[v["ct"] for v in vs])
        ct = (1 if "Type 2" in cts else 0) | (2 if "CCS (Combo 2)" in cts else 0) | (4 if "CHAdeMO" in cts else 0)
        o = [[ops.index(v["op"]), v["m"], v["ac"], v["dc"], v["f"] | v["fo"] << 1 | v["pk"] << 2 | v["fx"] << 3,
              [ti(t) for t in v["t"]]] for v in vs]
        o.sort(key=lambda x: (x[1] is None, x[1] if x[1] is not None else 9))
        rows.append([la, lo, int(max(v["kw"] for v in vs)), max(v["n"] for v in vs), ct, o])
    return {"pub": pub, "stations": len(stations), "ops": ops, "T": tariffs, "s": rows}


def main():
    root = load_xml()
    pub = root.find("com:publicationTime", NS).text
    stations = parse(root)
    if len(stations) < 500:  # protect the live site from a broken or partial download
        sys.exit(f"Only {len(stations)} stations found, refusing to overwrite {OUT}")
    data = build(stations, pub)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(stations)} stations -> {len(data['s'])} locations, published {pub}")


if __name__ == "__main__":
    main()
