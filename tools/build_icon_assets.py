#!/usr/bin/env python3
"""Build crisp Windows icon assets from the high-resolution transparent logo."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

# Union of the exact Windows 11 display targets for title/tray icons,
# taskbar/search icons, Start pins, and large Explorer views. Supplying the
# intermediate 30/36/60/72/80 px frames prevents Windows from resampling a
# nearby frame at common 125%, 150%, 250%, and 300% display scales.
ICON_SIZES = (16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256)
TASKBAR_SIZES = (24, 30, 36, 48, 60, 72, 96)
SOURCE_NAME = "psa-game-card-source.png"
PNG_NAME = "extendedart-icon.png"
ICO_NAME = "extendedart.ico"


def strong_alpha_bbox(image: Image.Image, threshold: int = 24) -> tuple[int, int, int, int]:
    """Return the bounding box of meaningful artwork, ignoring very faint AI shadow noise."""
    alpha = image.getchannel("A")
    mask = alpha.point(lambda value: 255 if value >= threshold else 0)
    bbox = mask.getbbox()
    if bbox is None:
        raise ValueError("The source logo has no visible pixels.")
    return bbox


def square_crop(image: Image.Image, padding_fraction: float = 0.045) -> Image.Image:
    """Crop transparent margins while retaining consistent safe padding around the logo."""
    left, top, right, bottom = strong_alpha_bbox(image)
    width = right - left
    height = bottom - top
    side = math.ceil(max(width, height) / (1.0 - 2.0 * padding_fraction))
    center_x = (left + right) / 2.0
    center_y = (top + bottom) / 2.0
    crop_left = math.floor(center_x - side / 2.0)
    crop_top = math.floor(center_y - side / 2.0)

    # Pillow pads out-of-bounds crop areas with transparent pixels for RGBA images.
    return image.crop((crop_left, crop_top, crop_left + side, crop_top + side))


def sharpen_for_size(image: Image.Image, size: int) -> Image.Image:
    """Apply restrained, target-size sharpening without changing edge transparency."""
    if size <= 24:
        radius, percent, contrast = 0.35, 180, 1.10
    elif size <= 36:
        radius, percent, contrast = 0.45, 165, 1.08
    elif size <= 48:
        radius, percent, contrast = 0.55, 145, 1.06
    elif size <= 96:
        radius, percent, contrast = 0.70, 105, 1.04
    elif size <= 256:
        radius, percent, contrast = 0.90, 70, 1.02
    else:
        radius, percent, contrast = 1.00, 45, 1.00

    alpha = image.getchannel("A")
    rgb = image.convert("RGB")
    rgb = ImageEnhance.Contrast(rgb).enhance(contrast)
    rgb = rgb.filter(ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=2))
    result = rgb.convert("RGBA")
    result.putalpha(alpha)
    return result


def render_frame(cropped: Image.Image, size: int) -> Image.Image:
    frame = cropped.resize((size, size), Image.Resampling.LANCZOS, reducing_gap=3.0)
    return sharpen_for_size(frame, size)


def build_assets(source: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as opened:
        original = opened.convert("RGBA")

    if original.width < 512 or original.height < 512:
        raise ValueError("Use a source logo of at least 512 x 512 pixels; 1024 x 1024 is preferred.")

    cropped = square_crop(original)
    normalized = render_frame(cropped, 1024)
    normalized.save(output_dir / PNG_NAME, format="PNG", optimize=True)

    frames = [render_frame(cropped, size) for size in ICON_SIZES]
    # Pillow only writes requested sizes up to the primary image dimensions,
    # so use the 256 px frame as the primary and provide the remaining
    # hand-tuned frames through append_images.
    primary = frames[-1]
    primary.save(
        output_dir / ICO_NAME,
        format="ICO",
        sizes=[(size, size) for size in ICON_SIZES],
        append_images=frames[:-1],
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("assets") / "branding" / SOURCE_NAME,
        help="High-resolution transparent PNG source.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("assets") / "branding",
        help="Directory for the normalized PNG and Windows ICO.",
    )
    args = parser.parse_args()
    build_assets(args.source, args.output_dir)
    print(f"Wrote {args.output_dir / PNG_NAME}")
    print(f"Wrote {args.output_dir / ICO_NAME} with sizes: {', '.join(map(str, ICON_SIZES))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
