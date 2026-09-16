#!/usr/bin/env python3
"""Regenerate every QuotaCards app icon from the single master art.

Source of truth: res/app-icon-src.png (1254x1254).
Outputs:
  res/app-icon.ico                      (embedded into the exe by build.rs / windres)
  desktop/src-tauri/icons/{icon.ico,32x32.png,128x128.png,128x128@2x.png,icon.png}
  android/tauri-app/src-tauri/icons/{icon.ico,icon.png}
  res/icon16.png res/icon32.png res/icon48.png res/icon256.png
  desktop/ui/icon.png

Why a script: small frames are NOT plain downscales. Sizes <=48px get a tuned
unsharp mask (RGB only, alpha stays clean) so the ring stays crisp at the
sizes Windows actually shows (installer header 24px, explorer 16/32/48px).
Frame set is the VS-classic 10 sizes so every DPI bucket finds its own frame.
"""
import io
import struct
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "res" / "app-icon-src.png"

SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256]
# size -> unsharp (radius, percent); None = no sharpening
SHARPEN = {
    16: (0.6, 130), 20: (0.6, 125), 24: (0.6, 120), 30: (0.6, 110),
    32: (0.6, 105), 36: (0.6, 100), 40: (0.6, 80), 48: (0.6, 80),
    60: (0.5, 60), 64: (0.5, 55), 72: (0.5, 45), 80: (0.5, 40),
    96: (0.5, 25), 128: None, 256: None,
}
# Sizes Windows shows at 100-150% scaling on the taskbar and in Explorer. They
# get a contrast and saturation lift: the downscale averages the thin ring into
# the dark tile and the mark goes muddy exactly where it is smallest.
SMALL_LIFT = {16, 20, 24, 30, 32, 36}
# Below ~24px the mark's ring is a single antialiased pixel across and the
# counter fills in, so the mark reads as a smudge. These sizes get the mark
# itself magnified in place (glyph only, tile untouched) so the stroke and the
# counter both survive the raster. Growing the bright pixels instead turned the
# ring into a white blob - never do that.
SMALL_MARK = {16, 20, 24, 30, 32}
MARK_ZOOM = 1.28
# On a dark taskbar the near-black tile disappears and only the mark floats.
# The smallest sizes get a flat lift of the whole frame instead of an outline:
# the ring is already white, so only the tile and the blue move, and the icon
# reads as a tile sitting on the taskbar rather than a sticker with a border.
TILE_LIFT = {16}
# From 20px up there is room for a real rim: a one-pixel top-lit edge, which
# reads as light falling on the tile. Verified clean at 24 and 32.
RIM = {20, 24, 30, 32, 36}


def mark_mask(im: Image.Image) -> Image.Image:
    """The mark itself: the light ring plus the saturated blue tail."""
    rgb = im.convert("RGB")
    r, g, b = rgb.split()
    bright = rgb.convert("L").point(lambda v: 255 if v > 150 else 0)
    blue = ImageChops.subtract(b, r).point(lambda v: 255 if v > 30 else 0)
    return ImageChops.lighter(bright, blue)
# The master carries ~14% empty margin around the tile. Trimmed to this much
# margin so the tile fills the frame: Windows renders tray and shortcut icons
# at 16-48px, and art that sits at 72% of the canvas reads as a smaller icon
# than every neighbour in the tray.
MARGIN = 0.02


def source_master() -> Image.Image:
    master = Image.open(MASTER).convert("RGBA")
    # getbbox() counts ANY non-zero pixel, and the art carries a barely-there
    # alpha haze (alpha 1-7) well outside the tile, which would defeat the
    # trim. Threshold first so the box is the tile, not the haze.
    solid = master.getchannel("A").point(lambda v: 255 if v > 64 else 0)
    bbox = solid.getbbox()
    if not bbox:
        return master
    x0, y0, x1, y1 = bbox
    w, h = x1 - x0, y1 - y0
    side = max(w, h)
    pad = round(side * MARGIN)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    half = side / 2 + pad
    left, top = round(cx - half), round(cy - half)
    right, bottom = round(cx + half), round(cy + half)
    canvas = Image.new("RGBA", (right - left, bottom - top), (0, 0, 0, 0))
    canvas.paste(master.crop((left, top, right, bottom)), (0, 0))
    return canvas


def render(master: Image.Image, size: int) -> Image.Image:
    im = master.resize((size, size), Image.LANCZOS)
    spec = SHARPEN.get(size)
    if spec:
        radius, percent = spec
        rgb = im.convert("RGB")
        if size in SMALL_MARK:
            # Magnify the mark in place. Only the mark's own pixels are pasted
            # back, so the tile underneath (and its rounded corners) is never
            # disturbed by the enlargement.
            mask = mark_mask(im)
            box = mask.getbbox()
            if box:
                x0, y0, x1, y1 = box
                pad = max(2, round(max(x1 - x0, y1 - y0) * 0.55))
                crop = (max(0, x0 - pad), max(0, y0 - pad), min(size, x1 + pad), min(size, y1 + pad))
                mark = im.crop(crop)
                mmask = mask.crop(crop)
                z = MARK_ZOOM
                big = mark.resize((max(1, round(mark.width * z)), max(1, round(mark.height * z))), Image.LANCZOS)
                bmask = mmask.resize(big.size, Image.LANCZOS)
                px = (x0 + x1) // 2 - big.width // 2
                py = (y0 + y1) // 2 - big.height // 2
                layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
                layer.paste(big, (px, py))
                base = Image.new("RGBA", im.size, (0, 0, 0, 0))
                base.paste(bmask, (px, py))
                rgb = Image.composite(layer.convert("RGB"), rgb, base.getchannel("A"))
        if size in SMALL_LIFT:
            # Lift before sharpening so the ring and the glyph survive the
            # average: at 16-36px the unmodified downscale reads as a smudge.
            rgb = ImageEnhance.Contrast(rgb).enhance(1.16)
            rgb = ImageEnhance.Color(rgb).enhance(1.25)
        if size in TILE_LIFT:
            rgb = ImageEnhance.Brightness(rgb).enhance(1.6)
        if size in RIM:
            # A one-pixel lighter edge on the tile so the icon is not a black
            # square on a black taskbar. Slightly brighter at the top, so it
            # reads as light falling on the tile rather than a sticker outline,
            # and pushed harder at the smallest sizes where the band is barely
            # a pixel wide.
            alpha = im.getchannel("A")
            inner = alpha.filter(ImageFilter.MinFilter(3))
            edge = ImageChops.subtract(alpha, inner)
            if size <= 24:
                edge = edge.point(lambda v: min(255, int(v * 1.8)))
            edge = edge.filter(ImageFilter.GaussianBlur(0.6))
            g = Image.linear_gradient("L").resize(im.size)
            rim = Image.composite(
                Image.new("RGB", im.size, (150, 166, 196)),
                Image.new("RGB", im.size, (92, 104, 130)),
                g,
            )
            rgb = Image.composite(rim, rgb, edge)
        rgb = rgb.filter(
            ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=1)
        ).convert("RGBA")
        rgb.putalpha(im.getchannel("A"))
        im = rgb
    return im


def dib_frame(im: Image.Image) -> bytes:
    """32bpp BGRA bottom-up DIB + AND mask (classic .ico frame format)."""
    w, h = im.size
    px = im.convert("RGBA").load()
    rows = []
    for y in range(h - 1, -1, -1):
        row = bytearray()
        for x in range(w):
            r, g, b, a = px[x, y]
            row += bytes((b, g, r, a))
        rows.append(bytes(row))
    xor = b"".join(rows)
    and_row = ((w + 31) // 32) * 4
    and_mask = b"\x00" * (and_row * h)
    hdr = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    return hdr + xor + and_mask


def png_frame(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def write_ico(path: Path, entries):
    """entries: list of (PIL image, use_png)."""
    blobs = [png_frame(im) if use_png else dib_frame(im) for im, use_png in entries]
    n = len(blobs)
    header = struct.pack("<HHH", 0, 1, n)
    offset = 6 + 16 * n
    dirs = b""
    data = b""
    for (im, _), blob in zip(entries, blobs):
        w, h = im.size
        dirs += struct.pack(
            "<BBBBHHII",
            w if w < 256 else 0,
            h if h < 256 else 0,
            0, 0, 1, 32, len(blob), offset,
        )
        data += blob
        offset += len(blob)
    path.write_bytes(header + dirs + data)
    return path


def build():
    master = source_master()
    frames = {s: render(master, s) for s in SIZES}

    # multi-size .ico: DIB frames for <=128 (max compatibility incl. windres),
    # PNG frame for 256 (standard, keeps the file small).
    entries = [(frames[s], s == 256) for s in SIZES]
    for p in [
        ROOT / "res" / "app-icon.ico",
        ROOT / "desktop" / "src-tauri" / "icons" / "icon.ico",
        ROOT / "android" / "tauri-app" / "src-tauri" / "icons" / "icon.ico",
    ]:
        write_ico(p, entries)
        print("wrote", p)

    # plain PNGs
    pngs = {
        ROOT / "desktop" / "src-tauri" / "icons" / "32x32.png": frames[32],
        ROOT / "desktop" / "src-tauri" / "icons" / "128x128.png": frames[128],
        ROOT / "desktop" / "src-tauri" / "icons" / "128x128@2x.png": frames[256],
        ROOT / "desktop" / "src-tauri" / "icons" / "icon.png": render(master, 512),
        ROOT / "android" / "tauri-app" / "src-tauri" / "icons" / "icon.png": render(master, 512),
        ROOT / "desktop" / "ui" / "icon.png": frames[128],
        ROOT / "desktop" / "ui-next" / "public" / "icon.png": frames[128],
        ROOT / "res" / "icon16.png": frames[16],
        ROOT / "res" / "icon32.png": frames[32],
        ROOT / "res" / "icon48.png": frames[48],
        ROOT / "res" / "icon256.png": frames[256],
    }
    for p, im in pngs.items():
        im.save(p, optimize=True)
        print("wrote", p)

    # Android launcher mipmaps (staging folder that tauri packs into the APK).
    # Framing replicates the previous launcher geometry: the tile occupies
    # 75% of the launcher canvas / 78% of the adaptive foreground, centered.
    tile = master.crop(master.getchannel("A").getbbox())

    def on_canvas(size: int, content: float, percent: int) -> Image.Image:
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        inner = max(1, round(size * content))
        t = tile.resize((inner, inner), Image.LANCZOS)
        if percent:
            rgb = t.convert("RGB").filter(
                ImageFilter.UnsharpMask(radius=0.7, percent=percent, threshold=2)
            ).convert("RGBA")
            rgb.putalpha(t.getchannel("A"))
            t = rgb
        off = (size - inner) // 2
        canvas.paste(t, (off, off), t)
        return canvas

    res = ROOT / "android" / "tauri-app" / "src-tauri" / "gen" / "android" / "app" / "src" / "main" / "res"
    mipmaps = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    fg = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
    launcher_pct = {48: 95, 72: 80, 96: 65, 144: 45, 192: 30}
    fg_pct = {108: 60, 162: 45, 216: 35, 324: 20, 432: 0}
    if res.exists():
        for d, size in mipmaps.items():
            im = on_canvas(size, 0.75, launcher_pct.get(size, 0))
            for name in ["ic_launcher.png", "ic_launcher_round.png"]:
                im.save(res / f"mipmap-{d}" / name, optimize=True)
                print("wrote", res / f"mipmap-{d}" / name)
            fgm = on_canvas(fg[d], 0.78, fg_pct.get(fg[d], 0))
            fgm.save(res / f"mipmap-{d}" / "ic_launcher_foreground.png", optimize=True)
            print("wrote", res / f"mipmap-{d}" / "ic_launcher_foreground.png")
    else:
        print("skip mipmaps: staging dir missing", res)

    # verify: reopen the icos, compare every frame to the tuned render
    from PIL import ImageChops, ImageStat
    ok = True
    for p in [
        ROOT / "res" / "app-icon.ico",
        ROOT / "desktop" / "src-tauri" / "icons" / "icon.ico",
        ROOT / "android" / "tauri-app" / "src-tauri" / "icons" / "icon.ico",
    ]:
        im = Image.open(p)
        got = sorted(im.ico.sizes())
        want = sorted((s, s) for s in SIZES)
        if got != want:
            print("FRAME SET MISMATCH", p, got)
            ok = False
            continue
        for s in SIZES:
            fr = im.ico.getimage((s, s)).convert("RGBA")
            diff = ImageChops.difference(fr.convert("RGB"), frames[s].convert("RGB"))
            rms = ImageStat.Stat(diff).rms
            if max(rms) > 0.5:
                print(f"FRAME CONTENT MISMATCH {p} {s}px rms={rms}")
                ok = False
    print("ALL_VERIFIED" if ok else "VERIFY_FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(build())
