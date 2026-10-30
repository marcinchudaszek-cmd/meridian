"""Przygotowuje tekstury Ziemi z obrazów NASA (domena publiczna) do public/textures/.

Źródła (NASA Visible Earth):
  world.topo.bathy.200412.3x5400x2700.jpg  — Blue Marble Next Generation, grudzień 2004
  BlackMarble_2016_01deg.jpg               — Black Marble 2016 (światła nocą)
  cloud_combined_2048.jpg                  — chmury
Użycie: python scripts/tekstury.py <folder z pobranymi plikami>
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "public" / "textures"
OUT.mkdir(parents=True, exist_ok=True)
W, H = 4096, 2048

day = Image.open(SRC / "world.topo.bathy.200412.3x5400x2700.jpg").convert("RGB").resize((W, H), Image.LANCZOS)
day.save(OUT / "earth-day.webp", quality=84, method=6)

# Maska wody do odblasku słońca: woda w Blue Marble jest ma kanał niebieski co najmniej 1,6× mocniejszy od czerwonego.
a = np.asarray(day).astype(np.int16)
water = ((a[..., 2] > a[..., 0] * 1.6) & (a[..., 2] >= 8)).astype(np.uint8) * 255
mask = Image.fromarray(water, "L").filter(ImageFilter.MedianFilter(5)).resize((2048, 1024), Image.LANCZOS)
mask.save(OUT / "earth-water.webp", quality=80, method=6)

night = Image.open(SRC / "BlackMarble_2016_01deg.jpg").convert("RGB").resize((W, H), Image.LANCZOS)
n = np.asarray(night).astype(np.float32) / 255
lum = n.max(axis=2)
# Wygaszamy ciemnoniebieskie tło lądów — zostają same światła miast.
lights = np.clip((lum - 0.24) / 0.76, 0, 1) ** 1.1
# Śnieg Grenlandii i Antarktydy świeci szaro-niebiesko, miasta ciepło — odcinamy chłodne piksele.
warm = np.clip(((n[..., 0] - n[..., 2]) / np.maximum(lum, 1e-3) - 0.05) / 0.2, 0, 1)
bright = np.clip((lum - 0.45) / 0.2, 0, 1)  # białe centra dużych miast zostają zawsze
lights = (lights * np.maximum(warm, bright)) ** 0.8
rgb = np.stack([lights * 1.0, lights * 0.82, lights * 0.55], axis=2)
Image.fromarray((rgb * 255).astype(np.uint8), "RGB").save(OUT / "earth-night.webp", quality=84, method=6)

clouds = Image.open(SRC / "cloud_combined_2048.jpg").convert("L")
clouds.save(OUT / "earth-clouds.webp", quality=80, method=6)

# lżejsze wersje na telefony: 4096 px to ok. 90 MB pamięci karty graficznej na dwie tekstury
for name in ("earth-day", "earth-night"):
    Image.open(OUT / f"{name}.webp").resize((2048, 1024), Image.LANCZOS).save(OUT / f"{name}-2k.webp", quality=86, method=6)

for f in sorted(OUT.iterdir()):
    print(f.name, f.stat().st_size // 1024, "KB", Image.open(f).size)
