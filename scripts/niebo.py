"""Niebo dla Meridiana → public/data/sky.json oraz tekstura Księżyca → public/textures/moon.webp.

Źródła:
  stars.6.json, constellations.lines.json, constellations.json — d3-celestial (Olaf Frohn, licencja BSD-3),
    https://github.com/ofrohn/d3-celestial/tree/master/data (gwiazdy z katalogu Yale Bright Star)
  lroc_color_poles_1k.jpg — NASA SVS CGI Moon Kit (domena publiczna)
Użycie: python scripts/niebo.py <folder z tymi plikami>
"""
import json
import sys
from pathlib import Path

from PIL import Image

SRC = Path(sys.argv[1])
ROOT = Path(__file__).resolve().parent.parent

PL = {
    "And": "Andromeda", "Ant": "Pompa", "Aps": "Ptak Rajski", "Aqr": "Wodnik", "Aql": "Orzeł", "Ara": "Ołtarz",
    "Ari": "Baran", "Aur": "Woźnica", "Boo": "Wolarz", "Cae": "Rylec", "Cam": "Żyrafa", "Cnc": "Rak",
    "CVn": "Psy Gończe", "CMa": "Wielki Pies", "CMi": "Mały Pies", "Cap": "Koziorożec", "Car": "Kil",
    "Cas": "Kasjopeja", "Cen": "Centaur", "Cep": "Cefeusz", "Cet": "Wieloryb", "Cha": "Kameleon", "Cir": "Cyrkiel",
    "Col": "Gołąb", "Com": "Warkocz Bereniki", "CrA": "Korona Południowa", "CrB": "Korona Północna", "Crv": "Kruk",
    "Crt": "Puchar", "Cru": "Krzyż Południa", "Cyg": "Łabędź", "Del": "Delfin", "Dor": "Złota Ryba", "Dra": "Smok",
    "Equ": "Źrebię", "Eri": "Erydan", "For": "Piec", "Gem": "Bliźnięta", "Gru": "Żuraw", "Her": "Herkules",
    "Hor": "Zegar", "Hya": "Hydra", "Hyi": "Wąż Wodny", "Ind": "Indianin", "Lac": "Jaszczurka", "Leo": "Lew",
    "LMi": "Mały Lew", "Lep": "Zając", "Lib": "Waga", "Lup": "Wilk", "Lyn": "Ryś", "Lyr": "Lutnia",
    "Men": "Góra Stołowa", "Mic": "Mikroskop", "Mon": "Jednorożec", "Mus": "Mucha", "Nor": "Węgielnica",
    "Oct": "Oktant", "Oph": "Wężownik", "Ori": "Orion", "Pav": "Paw", "Peg": "Pegaz", "Per": "Perseusz",
    "Phe": "Feniks", "Pic": "Malarz", "Psc": "Ryby", "PsA": "Ryba Południowa", "Pup": "Rufa", "Pyx": "Kompas",
    "Ret": "Sieć", "Sge": "Strzała", "Sgr": "Strzelec", "Sco": "Skorpion", "Scl": "Rzeźbiarz", "Sct": "Tarcza",
    "Ser": "Wąż", "Sex": "Sekstant", "Tau": "Byk", "Tel": "Luneta", "Tri": "Trójkąt", "TrA": "Trójkąt Południowy",
    "Tuc": "Tukan", "UMa": "Wielka Niedźwiedzica", "UMi": "Mała Niedźwiedzica", "Vel": "Żagiel", "Vir": "Panna",
    "Vol": "Ryba Latająca", "Vul": "Lisek",
}


def ra(lon):
    return round(lon % 360, 3)


def bv_rgb(bv):
    """Przybliżony kolor gwiazdy z indeksu barwy B−V (niebieskie gorące, czerwone chłodne)."""
    t = max(-0.4, min(2.0, bv))
    if t < 0.0:
        return (0.62, 0.72, 1.0)
    if t < 0.4:
        return (0.78 + t * 0.4, 0.84 + t * 0.3, 1.0)
    if t < 0.8:
        return (1.0, 0.96 - (t - 0.4) * 0.1, 0.9 - (t - 0.4) * 0.5)
    if t < 1.4:
        return (1.0, 0.92 - (t - 0.8) * 0.3, 0.7 - (t - 0.8) * 0.5)
    return (1.0, 0.72, 0.4)


stars = []
for f in json.load(open(SRC / "stars.6.json", encoding="utf-8"))["features"]:
    lon, lat = f["geometry"]["coordinates"]
    try:
        bv = float(f["properties"].get("bv") or 0.6)
    except ValueError:
        bv = 0.6
    r, g, b = bv_rgb(bv)
    stars.append([ra(lon), round(lat, 3), f["properties"]["mag"], round(r, 2), round(g, 2), round(b, 2)])

lines = []
for f in json.load(open(SRC / "constellations.lines.json", encoding="utf-8"))["features"]:
    for line in f["geometry"]["coordinates"]:
        lines.append([[ra(lon), round(lat, 3)] for lon, lat in line])

names = []
for f in json.load(open(SRC / "constellations.json", encoding="utf-8"))["features"]:
    code = f["id"].rstrip("12")
    lon, lat = f["geometry"]["coordinates"]
    if code not in PL:
        raise SystemExit(f"brak polskiej nazwy dla {f['id']}")
    names.append([ra(lon), round(lat, 3), PL[code], int(f["properties"].get("rank", 3))])

out = ROOT / "public" / "data" / "sky.json"
out.write_text(json.dumps({"s": stars, "l": lines, "n": names}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(len(stars), "gwiazd,", len(lines), "linii,", len(names), "nazw,", out.stat().st_size // 1024, "KB")

moon = Image.open(SRC / "lroc_color_poles_1k.jpg").convert("RGB").resize((1024, 512), Image.LANCZOS)
mp = ROOT / "public" / "textures" / "moon.webp"
moon.save(mp, quality=82, method=6)
print("Księżyc", mp.stat().st_size // 1024, "KB")
