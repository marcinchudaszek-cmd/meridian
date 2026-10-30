"""Ikona Meridiana: globus z teksturami NASA (dzień i światła nocy) ze złotym południkiem.

Użycie:  python scripts/ikony.py
Wynik:   android/app/src/main/res/mipmap-*/ i drawable*/splash.png, public/icon*.png, public/og.jpg,
         play-assets/icon-512.png i play-assets/grafika-1024x500.png
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android" / "app" / "src" / "main" / "res"
TEX = ROOT / "public" / "textures"
BG = (5, 7, 12)
GOLD = (228, 181, 106)

day = np.asarray(Image.open(TEX / "earth-day.webp").convert("RGB").resize((2048, 1024), Image.LANCZOS)).astype(np.float32) / 255
night = np.asarray(Image.open(TEX / "earth-night.webp").convert("RGB").resize((2048, 1024), Image.LANCZOS)).astype(np.float32) / 255


def globe(size, center_lat=28.0, center_lng=22.0, sun=(-0.75, 0.35, 0.56)):
    """Rzut ortograficzny kuli z oświetleniem: lewa część w dzień, prawa nocą."""
    ss = size * 2
    y, x = np.mgrid[0:ss, 0:ss].astype(np.float32)
    nx = (x + 0.5) / ss * 2 - 1
    ny = 1 - (y + 0.5) / ss * 2
    r2 = nx**2 + ny**2
    inside = r2 <= 1
    nz = np.sqrt(np.clip(1 - r2, 0, 1))
    # obrót widoku: najpierw szerokość (wokół osi X), potem długość
    la = np.radians(center_lat)
    y2 = ny * np.cos(la) + nz * np.sin(la)
    z2 = -ny * np.sin(la) + nz * np.cos(la)
    lat = np.degrees(np.arcsin(np.clip(y2, -1, 1)))
    lng = np.degrees(np.arctan2(nx, z2)) + center_lng
    u = ((lng + 180) % 360) / 360 * (day.shape[1] - 1)
    v = (90 - lat) / 180 * (day.shape[0] - 1)
    ui, vi = u.astype(int), v.astype(int)
    d = day[vi, ui]
    n = night[vi, ui]
    s = np.array(sun, dtype=np.float32)
    s /= np.linalg.norm(s)
    ndl = nx * s[0] + ny * s[1] + nz * s[2]
    mix = np.clip((ndl + 0.1) / 0.26, 0, 1)[..., None]
    lit = d * (0.04 + 1.15 * np.clip(ndl, 0, 1))[..., None]
    col = n * 1.6 * (1 - mix) + lit * mix
    rim = (np.clip(1 - nz, 0, 1) ** 3)[..., None]
    col = col + np.array([0.35, 0.55, 1.0]) * rim * 0.55 * (0.15 + 0.85 * mix)
    rgba = np.zeros((ss, ss, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(col, 0, 1)
    rgba[..., 3] = inside
    img = Image.fromarray((rgba * 255).astype(np.uint8), "RGBA")
    return img.resize((size, size), Image.LANCZOS)


def mark(size, scale):
    """Globus z poświatą i złotym pierścieniem-południkiem, na przezroczystym tle."""
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    g = round(size * scale)
    off = (size - g) // 2
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((off - g * 0.04, off - g * 0.04, off + g * 1.04, off + g * 1.04), fill=(90, 140, 255, 120))
    out.alpha_composite(glow.filter(ImageFilter.GaussianBlur(size * 0.03)))
    out.alpha_composite(globe(g), (off, off))
    # złota elipsa południka, przechylona jak oś Ziemi
    big = size * 4
    ring = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    rw = big * scale * 0.54
    rh = big * scale * 0.2
    c = big / 2
    ImageDraw.Draw(ring).ellipse((c - rh, c - rw, c + rh, c + rw), outline=GOLD + (255,), width=max(2, round(big * 0.012)))
    ring = ring.rotate(-23.4, resample=Image.BICUBIC).resize((size, size), Image.LANCZOS)
    out.alpha_composite(ring)
    dot_r = size * 0.028
    cx, cy = size / 2 + size * scale * 0.06, size / 2 - size * scale * 0.2
    ImageDraw.Draw(out).ellipse((cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r), fill=(255, 226, 160, 255))
    return out


def background(size):
    img = Image.new("RGB", (size, size), BG)
    px = np.asarray(img).astype(np.float32)
    y, x = np.mgrid[0:size, 0:size]
    d = np.sqrt((x - size * 0.5) ** 2 + (y - size * 0.45) ** 2) / size
    glow = np.clip(1 - d * 1.6, 0, 1)[..., None] ** 2
    px = px + np.array([16, 24, 46]) * glow
    rng = np.random.default_rng(7)
    for _ in range(int(size * size / 2600)):
        sx, sy = rng.integers(0, size, 2)
        px[sy, sx] = np.minimum(255, px[sy, sx] + rng.integers(60, 170))
    return Image.fromarray(np.clip(px, 0, 255).astype(np.uint8), "RGB").convert("RGBA")


def full_icon(size, shape="rounded"):
    img = background(size)
    img.alpha_composite(mark(size, 0.76))
    if shape == "square":
        return img
    mask = Image.new("L", (size * 4, size * 4), 0)
    d = ImageDraw.Draw(mask)
    if shape == "round":
        d.ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    else:
        d.rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=size * 4 * 0.22, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask.resize((size, size), Image.LANCZOS))
    return out


def font(name, size):
    for f in (name, "georgia.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def banner(w, h, path, title_size):
    img = background(max(w, h)).crop((0, 0, w, h))
    g = round(h * 1.15)
    m = mark(g, 0.82)
    img.alpha_composite(m, (w - round(g * 0.74), (h - g) // 2))
    d = ImageDraw.Draw(img)
    x = round(w * 0.07)
    d.text((x, h * 0.3), "ATLAS NOCY", font=font("segoeui.ttf", round(title_size * 0.22)), fill=GOLD)
    d.text((x, h * 0.37), "Meridian", font=font("georgiab.ttf", title_size), fill=(236, 231, 219))
    d.text((x, h * 0.37 + title_size * 1.25), "Globus z prawdziwym dniem i nocą", font=font("segoeui.ttf", round(title_size * 0.3)), fill=(170, 176, 190))
    img.convert("RGB").save(path, quality=88)


def main():
    densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
    for name, f in densities.items():
        folder = RES / f"mipmap-{name}"
        folder.mkdir(parents=True, exist_ok=True)
        legacy = round(48 * f)
        full_icon(legacy).save(folder / "ic_launcher.png")
        full_icon(legacy, "round").save(folder / "ic_launcher_round.png")
        # pierwszy plan ikony adaptacyjnej: 108 dp, globus w bezpiecznym kole 66 dp
        fg = round(108 * f)
        mark(fg, 0.56).save(folder / "ic_launcher_foreground.png")

    (RES / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#05070C</color>\n</resources>\n',
        encoding="utf-8",
    )

    for folder in RES.glob("drawable*"):
        splash = folder / "splash.png"
        if not splash.exists():
            continue
        w, h = Image.open(splash).size
        img = Image.new("RGBA", (w, h), BG + (255,))
        side = round(min(w, h) * 0.42)
        img.alpha_composite(mark(side, 0.8), ((w - side) // 2, (h - side) // 2))
        img.convert("RGB").save(splash)

    public = ROOT / "public"
    full_icon(512).save(public / "icon.png")
    full_icon(512, "square").convert("RGB").save(public / "icon-maskable.png")
    banner(1200, 630, public / "og.jpg", 118)
    play = ROOT / "play-assets"
    play.mkdir(exist_ok=True)
    full_icon(512, "square").convert("RGB").save(play / "icon-512.png")
    banner(1024, 500, play / "grafika-1024x500.png", 96)
    print("ikony gotowe")


if __name__ == "__main__":
    main()
