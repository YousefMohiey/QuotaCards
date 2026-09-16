#!/usr/bin/env python3
"""Tune the icon master so every derived size reads, without per-size hacks.

Applied once to res/app-icon-src.png (the original is kept beside it as
res/app-icon-src.orig.png). Why each change:

1. Tile lift. The art's tile runs from #27272b at the top to #0b0b0d at the
   bottom. That bottom end is indistinguishable from a dark taskbar, which is
   why the icon disappeared there and why per-size rim hacks were needed.
   Lifting only the tile (never the mark) keeps the brand blue untouched.

2. Baked edge. A ~4px band of slightly lighter tone along the tile's outline,
   brighter towards the top, so even a 16px downscale inherits an edge.

3. Mark growth. The mark is scaled 8% about its own centre and re-composited
   through its own mask, so the ring and its counter survive the raster at
   16-24px instead of needing a per-size magnification.

Run:  python tools/tune-master.py          (idempotent, keeps the backup)
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "res" / "app-icon-src.png"
BACKUP = ROOT / "res" / "app-icon-src.orig.png"

TILE_LIFT = 1.45      # brightness on tile pixels only
TILE_GAMMA = 0.92     # gentle curve so the top does not blow out
EDGE_WIDTH = 5        # px at master scale
MARK_ZOOM = 1.08      # about the mark's own centre
MARK_INSET = 0.06     # ignore this share of the tile when finding the mark


def mark_mask(tile: Image.Image) -> Image.Image:
    rgb = tile.convert("RGB")
    r, _, b = rgb.split()
    bright = rgb.convert("L").point(lambda v: 255 if v > 150 else 0)
    blue = ImageChops.subtract(b, r).point(lambda v: 255 if v > 30 else 0)
    return ImageChops.lighter(bright, blue)


def main() -> int:
    if not BACKUP.exists():
        Image.open(MASTER).save(BACKUP)
        print("backed up the original to", BACKUP)
    im = Image.open(MASTER).convert("RGBA")
    w, h = im.size

    alpha = im.getchannel("A")
    solid = alpha.point(lambda v: 255 if v > 64 else 0)
    x0, y0, x1, y1 = solid.getbbox()

    # work on the tile only; the art keeps everything outside it untouched
    tile = im.crop((x0, y0, x1, y1))
    tw, th = tile.size

    # the mark, searched away from the tile's own edge so its AA never counts
    inset = int(min(tw, th) * MARK_INSET)
    inner = mark_mask(tile)
    border = Image.new("L", (tw, th), 0)
    border.paste(255, (inset, inset, tw - inset, th - inset))
    mark = ImageChops.multiply(inner, border)

    # 1. lift the tile, sparing the mark
    lifted = ImageEnhance.Brightness(tile.convert("RGB")).enhance(TILE_LIFT)
    lifted = lifted.point(lambda v: int(255 * pow(v / 255, TILE_GAMMA)))
    rgb = Image.composite(tile.convert("RGB"), lifted, mark)

    # 2. baked edge: the band between the alpha and its eroded self
    tile_alpha = tile.getchannel("A")
    eroded = tile_alpha.filter(ImageFilter.MinFilter(2 * EDGE_WIDTH + 1))
    band = ImageChops.subtract(tile_alpha, eroded).filter(ImageFilter.GaussianBlur(EDGE_WIDTH / 2))
    grad = Image.linear_gradient("L").resize((tw, th))
    edge = Image.composite(
        Image.new("RGB", (tw, th), (150, 164, 190)),
        Image.new("RGB", (tw, th), (70, 78, 96)),
        grad,
    )
    rgb = Image.composite(edge, rgb, band)

    # 3. grow the mark about its own centre, through its own mask
    box = mark.getbbox()
    if box:
        mx0, my0, mx1, my1 = box
        pad = max(4, int(max(mx1 - mx0, my1 - my0) * 0.35))
        crop = (max(0, mx0 - pad), max(0, my0 - pad), min(tw, mx1 + pad), min(th, my1 + pad))
        src = tile.crop(crop).convert("RGB")
        msk = mark.crop(crop)
        big = src.resize((max(1, round(src.width * MARK_ZOOM)), max(1, round(src.height * MARK_ZOOM))), Image.LANCZOS)
        bmask = msk.resize(big.size, Image.LANCZOS)
        px = (mx0 + mx1) // 2 - big.width // 2
        py = (my0 + my1) // 2 - big.height // 2
        layer = Image.new("RGB", (tw, th), (0, 0, 0))
        layer.paste(big, (px, py))
        cover = Image.new("L", (tw, th), 0)
        cover.paste(bmask, (px, py))
        rgb = Image.composite(layer, rgb, cover)

    out_tile = rgb.convert("RGBA")
    out_tile.putalpha(tile_alpha)
    out = im.copy()
    out.paste(out_tile, (x0, y0))
    out.save(MASTER)
    print("wrote", MASTER, out.size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
