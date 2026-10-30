"""Granice i nazwy państw z Natural Earth 1:110m (domena publiczna) → public/data/countries.json.

Użycie: python scripts/kraje.py <folder z ne_110m_admin_0_countries.geojson i ne_110m_populated_places.geojson>
Pobieranie: https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
"""
import json
import sys
from pathlib import Path

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)

countries = json.load(open(SRC / "ne_110m_admin_0_countries.geojson", encoding="utf-8"))["features"]
places = json.load(open(SRC / "ne_110m_populated_places.geojson", encoding="utf-8"))["features"]

capitals = {}
for f in places:
    p = f["properties"]
    if p.get("FEATURECLA") == "Admin-0 capital" and p.get("ADM0CAP") == 1:
        capitals.setdefault(p["ADM0_A3"], []).append(p.get("NAME_PL") or p["NAME"])


def ring(coords):
    out = []
    for lng, lat in coords:
        pt = [round(lng, 2), round(lat, 2)]
        if not out or out[-1] != pt:
            out.append(pt)
    return out


# nazwy, które w Natural Earth brzmią nieoficjalnie
RENAME = {"Południowa Afryka": "Republika Południowej Afryki"}

result = []
for f in countries:
    p = f["properties"]
    g = f["geometry"]
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    result.append(
        {
            "n": RENAME.get(p["NAME_PL"], p["NAME_PL"] or p["NAME"]),
            "iso": p["ISO_A2_EH"],
            "cap": ", ".join(sorted(capitals.get(p["ADM0_A3"], []))),
            "lx": round(p["LABEL_X"], 2),
            "ly": round(p["LABEL_Y"], 2),
            "r": p["LABELRANK"],
            "pop": p["POP_EST"],
            # tylko zewnętrzne pierścienie i dziury, bez innych atrybutów
            "p": [[ring(r) for r in poly] for poly in polys],
        }
    )

path = OUT / "countries.json"
path.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(len(result), "państw,", path.stat().st_size // 1024, "KB, ze stolicą:", sum(1 for c in result if c["cap"]))
