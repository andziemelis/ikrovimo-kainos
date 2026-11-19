"""Build data/cars.json from Open EV Data (https://github.com/KilowattApp/open-ev-data).

Usage: python scripts/build_cars.py path/to/ev-data.json
Licence: MIT with attribution requirement; credit "Open EV Data" in the About screen and README.
"""
import json, sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "cars.json"
src = json.load(open(sys.argv[1], encoding="utf-8"))
rows = []
for v in src["data"]:
    if v.get("vehicle_type") == "motorbike":
        continue
    dc, ac = v.get("dc_charger") or {}, v.get("ac_charger") or {}
    ports = set(dc.get("ports") or [])
    flags = (1 if ports & {"ccs", "tesla_ccs"} else 0) | (2 if "chademo" in ports else 0) | (4 if "tesla_suc" in ports else 0)
    cons = (v.get("energy_consumption") or {}).get("average_consumption")
    rows.append([v["brand"], v["model"], (v.get("variant") or "").strip(), v.get("release_year"),
                 v.get("usable_battery_size"), cons, ac.get("max_power"), dc.get("max_power"), flags])
rows.sort(key=lambda r: (r[0].lower(), r[1].lower(), -(r[3] or 0), r[2]))
OUT.write_text(json.dumps({"source": "Open EV Data", "updated": src["meta"].get("updated_at"), "cars": rows},
                          ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(len(rows), "cars ->", OUT, OUT.stat().st_size, "bytes")
