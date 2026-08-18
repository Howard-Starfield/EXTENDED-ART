#!/usr/bin/env python3
"""Deterministic extended-art print package builder.

This module performs no AI generation and makes no network requests. It takes
one completed full-page image, crops or fits it to a selected physical product
profile, exports the master and finished pieces, and creates print-ready PDFs.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageOps
from reportlab.lib.colors import Color, white
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from version import APP_VERSION


DPI = 300
MM_PER_INCH = 25.4
TRIM_GUIDE_CLEARANCE_PT = 0.25
PSA_OUTER_MM = (80.264, 135.128)
PSA_LABEL_MM = (69.85, 21.59)
PSA_LABEL_TOP_MM = 5.0
PSA_CARD_MM = (63.0, 88.0)
PSA_CARD_TOP_MM = 36.0
# PSA Cover Edition (CASE) — same shape as the modern PSA holder envelope
# but shaved ~0.51 mm off each axis so the artwork seats safely inside a
# slim cover/case without binding the edges. Target 3.14" × 5.30".
PSA_CASE_OUTER_MM = (79.756, 134.62)
PSA_CASE_CARD_MM = (63.0, 88.0)
# Card is centered vertically inside the slim cover (no PSA label area below).
PSA_CASE_CARD_TOP_MM = (PSA_CASE_OUTER_MM[1] - PSA_CASE_CARD_MM[1]) / 2
# PSA SLAB (CASE) — slim labeled variant of the psa profile. The outer envelope
# is the same 3.14 × 5.30 in as PSA Cover Edition (CASE), but the internal PSA
# label cutout and card chamber are kept at the same millimetre positions as
# the full psa profile so existing artwork can be reused.
PSA_MINI_OUTER_MM = (79.756, 134.62)
PSA_MINI_CARD_MM = (63.0, 88.0)
PSA_MINI_CARD_TOP_MM = 36.0  # same internal position as the full psa


@dataclass(frozen=True)
class Profile:
    name: str
    label: str
    insert_w_mm: float
    insert_h_mm: float
    columns: int
    rows: int
    card_box: tuple[float, float, float, float]
    description: str
    label_box: tuple[float, float, float, float] | None
    recommended_corner_radius_mm: float

    @property
    def insert_px(self) -> tuple[int, int]:
        return (
            round(self.insert_w_mm / MM_PER_INCH * DPI),
            round(self.insert_h_mm / MM_PER_INCH * DPI),
        )

    @property
    def master_px(self) -> tuple[int, int]:
        return (
            round(self.insert_w_mm * self.columns / MM_PER_INCH * DPI),
            round(self.insert_h_mm * self.rows / MM_PER_INCH * DPI),
        )

    @property
    def master_mm(self) -> tuple[float, float]:
        return (self.insert_w_mm * self.columns, self.insert_h_mm * self.rows)

    @property
    def piece_count(self) -> int:
        return self.columns * self.rows


@dataclass(frozen=True)
class BuildOptions:
    profile: str = "standard"
    source_mode: str = "crop"
    focus_x: float = 0.5
    focus_y: float = 0.5
    gap_mm: float = 2.0
    scale_mode: str = "fit"
    safe_margin_mm: float = 4.0
    corner_radius_mm: float = 0.0
    paper_format: str = "both"
    include_pieces: bool = False
    include_master: bool = False
    include_full_art_pdf: bool = False
    cutout_card_zone: bool = False
    psa_label_width_mm: float = PSA_LABEL_MM[0]
    psa_label_height_mm: float = PSA_LABEL_MM[1]


def normalized_box_from_mm(
    total_w_mm: float,
    total_h_mm: float,
    left_mm: float,
    top_mm: float,
    width_mm: float,
    height_mm: float,
) -> tuple[float, float, float, float]:
    """Convert an audited physical opening to normalized profile coordinates."""
    return (
        left_mm / total_w_mm,
        top_mm / total_h_mm,
        (left_mm + width_mm) / total_w_mm,
        (top_mm + height_mm) / total_h_mm,
    )


PSA_LABEL_BOX = normalized_box_from_mm(
    *PSA_OUTER_MM,
    (PSA_OUTER_MM[0] - PSA_LABEL_MM[0]) / 2,
    PSA_LABEL_TOP_MM,
    *PSA_LABEL_MM,
)
PSA_CARD_BOX = normalized_box_from_mm(
    *PSA_OUTER_MM,
    (PSA_OUTER_MM[0] - PSA_CARD_MM[0]) / 2,
    PSA_CARD_TOP_MM,
    *PSA_CARD_MM,
)
PSA_CASE_CARD_BOX = normalized_box_from_mm(
    *PSA_CASE_OUTER_MM,
    (PSA_CASE_OUTER_MM[0] - PSA_CASE_CARD_MM[0]) / 2,
    PSA_CASE_CARD_TOP_MM,
    *PSA_CASE_CARD_MM,
)
PSA_MINI_LABEL_BOX = normalized_box_from_mm(
    *PSA_MINI_OUTER_MM,
    (PSA_MINI_OUTER_MM[0] - PSA_LABEL_MM[0]) / 2,
    PSA_LABEL_TOP_MM,
    *PSA_LABEL_MM,
)
PSA_MINI_CARD_BOX = normalized_box_from_mm(
    *PSA_MINI_OUTER_MM,
    (PSA_MINI_OUTER_MM[0] - PSA_MINI_CARD_MM[0]) / 2,
    PSA_MINI_CARD_TOP_MM,
    *PSA_MINI_CARD_MM,
)


def profile_for_options(profile: Profile, options: BuildOptions) -> Profile:
    """Return a profile with per-job physical cutout settings applied."""
    if profile.name not in ("psa", "psaMini"):
        return profile
    outer_mm = PSA_OUTER_MM if profile.name == "psa" else PSA_MINI_OUTER_MM
    width_mm = float(options.psa_label_width_mm)
    height_mm = float(options.psa_label_height_mm)
    label_box = normalized_box_from_mm(
        *outer_mm,
        (outer_mm[0] - width_mm) / 2,
        PSA_LABEL_TOP_MM,
        width_mm,
        height_mm,
    )
    return replace(profile, label_box=label_box)


PROFILES = {
    "standard": Profile(
        "standard",
        "Standard 3×3 Binder",
        63.0,
        88.0,
        3,
        3,
        (1 / 3, 1 / 3, 2 / 3, 2 / 3),
        "Nine standard trading-card inserts with a center card reference.",
        None,
        3.0,
    ),
    "vaultx": Profile(
        "vaultx",
        "Vault Binder",
        66.0,
        94.0,
        3,
        3,
        (1 / 3, 1 / 3, 2 / 3, 2 / 3),
        "Nine 66 x 94 mm inserts for Vault-style binder pockets.",
        None,
        3.0,
    ),
    "psa": Profile(
        "psa",
        "PSA Slab",
        *PSA_OUTER_MM,
        1,
        1,
        PSA_CARD_BOX,
        "One extended-art insert sized to a modern PSA holder envelope.",
        PSA_LABEL_BOX,
        3.0,
    ),
    "psaCase": Profile(
        "psaCase",
        "PSA Cover Edition (CASE)",
        *PSA_CASE_OUTER_MM,
        1,
        1,
        PSA_CASE_CARD_BOX,
        "One extended-art insert sized to a slim 3.14 x 5.30 in PSA cover case.",
        None,
        3.0,
    ),
    "psaMini": Profile(
        "psaMini",
        "PSA SLAB (CASE)",
        *PSA_MINI_OUTER_MM,
        1,
        1,
        PSA_MINI_CARD_BOX,
        "One extended-art insert sized to a slim 3.14 x 5.30 in PSA slab case (with label area).",
        PSA_MINI_LABEL_BOX,
        3.0,
    ),
    "photo8x10": Profile(
        "photo8x10",
        "8x10 Photo Frame",
        203.2,
        254.0,
        1,
        1,
        normalized_box_from_mm(203.2, 254.0, 70.1, 83.0, 63.0, 88.0),
        "One 8 x 10 inch display print with a centered card reference.",
        None,
        0.0,
    ),
}

PAPER_SIZES_MM = {
    "a4": (210.0, 297.0),
    "letter": (215.9, 279.4),
}


def mm_to_pt(mm: float) -> float:
    return mm / MM_PER_INCH * 72.0


def calculate_page_layout(
    profile: Profile,
    paper_name: str,
    gap_mm: float = 2.0,
    safe_margin_mm: float = 4.0,
    scale_mode: str = "fit",
) -> dict:
    """Return the shared physical page placement contract used by PDF and UI."""
    if paper_name not in PAPER_SIZES_MM:
        raise ValueError("paper_name must be a4 or letter")
    page_w_mm, page_h_mm = PAPER_SIZES_MM[paper_name]
    base_w = profile.insert_w_mm * profile.columns + gap_mm * (profile.columns - 1)
    base_h = profile.insert_h_mm * profile.rows + gap_mm * (profile.rows - 1)
    scale = 1.0
    warning = None
    if base_w + safe_margin_mm * 2 > page_w_mm or base_h + safe_margin_mm * 2 > page_h_mm:
        if scale_mode != "fit":
            warning = (
                f"{profile.name} {paper_name} cannot fit at exact size with the selected "
                "gaps and margins"
            )
        else:
            scale = min(
                (page_w_mm - safe_margin_mm * 2) / base_w,
                (page_h_mm - safe_margin_mm * 2) / base_h,
            )
            warning = f"Scaled to {scale * 100:.2f}% to fit {paper_name}"
    layout_w = base_w * scale
    layout_h = base_h * scale
    return {
        "paper": paper_name,
        "page_mm": [page_w_mm, page_h_mm],
        "content_mm": [base_w, base_h],
        "layout_mm": [layout_w, layout_h],
        "offset_mm": [(page_w_mm - layout_w) / 2, (page_h_mm - layout_h) / 2],
        "scale": round(scale, 6),
        "warning": warning,
        "gap_mm": gap_mm,
        "safe_margin_mm": safe_margin_mm,
    }


def safe_slug(value: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in "-_" else "_" for char in value)
    return cleaned.strip("_") or "extended_art"


def validate_options(options: BuildOptions) -> None:
    if options.profile not in {*PROFILES, "both"}:
        raise ValueError("profile must be standard, vaultx, psa, psaCase, psaMini, photo8x10, or both")
    if options.paper_format not in {*PAPER_SIZES_MM, "both"}:
        raise ValueError("paper_format must be a4, letter, or both")
    if options.source_mode not in {"crop", "fit"}:
        raise ValueError("source_mode must be crop or fit")
    if options.scale_mode not in {"fit", "warn"}:
        raise ValueError("scale_mode must be fit or warn")
    if not 0.0 <= options.focus_x <= 1.0 or not 0.0 <= options.focus_y <= 1.0:
        raise ValueError("focus_x and focus_y must be between 0 and 1")
    if options.gap_mm < 0 or options.safe_margin_mm < 0:
        raise ValueError("gap_mm and safe_margin_mm cannot be negative")
    if not 0.0 <= options.corner_radius_mm <= 12.0:
        raise ValueError("corner_radius_mm must be between 0 and 12")
    if not 40.0 <= options.psa_label_width_mm <= 76.0:
        raise ValueError("PSA label cutout width must be between 40 and 76 mm")
    if not 10.0 <= options.psa_label_height_mm <= 30.0:
        raise ValueError("PSA label cutout height must be between 10 and 30 mm")


def verify_image(path: Path) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"Input image not found: {path}")
    with Image.open(path) as check:
        check.verify()


def crop_geometry(
    source_size: tuple[int, int],
    target_size: tuple[int, int],
    focus_x: float,
    focus_y: float,
) -> tuple[int, int, int, int]:
    source_w, source_h = source_size
    target_w, target_h = target_size
    target_ratio = target_w / target_h
    source_ratio = source_w / source_h

    if source_ratio > target_ratio:
        crop_h = source_h
        crop_w = round(crop_h * target_ratio)
    else:
        crop_w = source_w
        crop_h = round(crop_w / target_ratio)

    max_left = source_w - crop_w
    max_top = source_h - crop_h
    left = round(max_left * focus_x)
    top = round(max_top * focus_y)
    return left, top, left + crop_w, top + crop_h


def normalize_master(
    source: Image.Image,
    profile: Profile,
    source_mode: str,
    focus_x: float,
    focus_y: float,
) -> tuple[Image.Image, dict]:
    source = ImageOps.exif_transpose(source).convert("RGB")
    target_w, target_h = profile.master_px

    if source_mode == "fit":
        canvas_img = Image.new("RGB", (target_w, target_h), (245, 245, 245))
        fitted = ImageOps.contain(source, (target_w, target_h), Image.Resampling.LANCZOS)
        left = (target_w - fitted.width) // 2
        top = (target_h - fitted.height) // 2
        canvas_img.paste(fitted, (left, top))
        return canvas_img, {
            "mode": "fit",
            "source_region_px": [0, 0, source.width, source.height],
            "placed_region_px": [left, top, left + fitted.width, top + fitted.height],
            "scale_factor": round(min(fitted.width / source.width, fitted.height / source.height), 4),
        }

    crop_box = crop_geometry(source.size, (target_w, target_h), focus_x, focus_y)
    cropped = source.crop(crop_box)
    scale_factor = max(target_w / cropped.width, target_h / cropped.height)
    return (
        cropped.resize((target_w, target_h), Image.Resampling.LANCZOS),
        {
            "mode": "crop",
            "source_region_px": list(crop_box),
            "cropped_pixels": [cropped.width, cropped.height],
            "scale_factor": round(scale_factor, 4),
        },
    )


def apply_corner_radius(image: Image.Image, radius_px: int) -> Image.Image:
    if radius_px <= 0:
        return image
    rounded = image.convert("RGBA")
    mask = Image.new("L", rounded.size, 0)
    radius_px = min(radius_px, rounded.width // 2, rounded.height // 2)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, rounded.width - 1, rounded.height - 1),
        radius=radius_px,
        fill=255,
    )
    rounded.putalpha(mask)
    return rounded


def split_pieces(
    master: Image.Image,
    profile: Profile,
    corner_radius_mm: float = 0.0,
) -> list[Image.Image]:
    piece_w, piece_h = profile.insert_px
    radius_px = round(corner_radius_mm / MM_PER_INCH * DPI)
    pieces: list[Image.Image] = []
    x_edges = [round(i * master.width / profile.columns) for i in range(profile.columns + 1)]
    y_edges = [round(i * master.height / profile.rows) for i in range(profile.rows + 1)]
    for row in range(profile.rows):
        for col in range(profile.columns):
            crop = master.crop((x_edges[col], y_edges[row], x_edges[col + 1], y_edges[row + 1]))
            resized = crop.resize((piece_w, piece_h), Image.Resampling.LANCZOS)
            pieces.append(apply_corner_radius(resized, radius_px))
    return pieces


def cutout_regions(
    profile: Profile,
    cutout_card_zone: bool,
) -> list[tuple[str, tuple[float, float, float, float], float]]:
    if profile.piece_count != 1:
        return []
    regions: list[tuple[str, tuple[float, float, float, float], float]] = []
    if profile.label_box is not None:
        regions.append(("PSA label", profile.label_box, 1.0))
    if cutout_card_zone:
        regions.append(("card chamber", profile.card_box, 3.0))
    return regions


def normalized_box_to_mm(
    profile: Profile,
    box: tuple[float, float, float, float],
) -> list[float]:
    left, top, right, bottom = box
    return [
        round(left * profile.insert_w_mm, 3),
        round(top * profile.insert_h_mm, 3),
        round((right - left) * profile.insert_w_mm, 3),
        round((bottom - top) * profile.insert_h_mm, 3),
    ]


def draw_cut_page(
    pdf_path: Path,
    pieces: Iterable[Image.Image],
    profile: Profile,
    paper_name: str,
    gap_mm: float,
    scale_mode: str,
    safe_margin_mm: float,
    corner_radius_mm: float,
    cutout_card_zone: bool,
) -> dict:
    layout = calculate_page_layout(profile, paper_name, gap_mm, safe_margin_mm, scale_mode)
    page_w_mm, page_h_mm = layout["page_mm"]
    scale = layout["scale"]
    warning = layout["warning"]
    left_mm, top_mm = layout["offset_mm"]
    page_w_pt, page_h_pt = mm_to_pt(page_w_mm), mm_to_pt(page_h_mm)

    pdf = canvas.Canvas(str(pdf_path), pagesize=(page_w_pt, page_h_pt))
    pdf.setTitle(f"{profile.label} extended art - {paper_name.upper()}")
    pdf.setFillColor(white)
    pdf.rect(0, 0, page_w_pt, page_h_pt, stroke=0, fill=1)

    piece_list = list(pieces)
    line_color = Color(0.42, 0.42, 0.42, alpha=0.9)
    index = 0
    cutouts = cutout_regions(profile, cutout_card_zone)
    for row in range(profile.rows):
        for col in range(profile.columns):
            x_mm = left_mm + col * (profile.insert_w_mm + gap_mm) * scale
            y_mm = page_h_mm - top_mm - (row + 1) * profile.insert_h_mm * scale - row * gap_mm * scale
            w_mm = profile.insert_w_mm * scale
            h_mm = profile.insert_h_mm * scale
            x_pt, y_pt = mm_to_pt(x_mm), mm_to_pt(y_mm)
            w_pt, h_pt = mm_to_pt(w_mm), mm_to_pt(h_mm)

            # Keep the trim guide fully outside the artwork. A centered vector
            # stroke at the exact trim boundary can rasterize into the image,
            # while drawing it underneath can make it disappear entirely.
            # Moving its center past half the stroke plus a tiny clearance
            # preserves the finished art edge and leaves a visible cut guide.
            pdf.setStrokeColor(line_color)
            line_width_pt = 0.45 if profile.name == "psa" else 0.35
            guide_offset_pt = line_width_pt / 2 + TRIM_GUIDE_CLEARANCE_PT
            pdf.setLineWidth(line_width_pt)
            if profile.name == "psa":
                pdf.setLineCap(1)
                pdf.setDash(0.6, 1.5)
            guide_x = x_pt - guide_offset_pt
            guide_y = y_pt - guide_offset_pt
            guide_w = w_pt + 2 * guide_offset_pt
            guide_h = h_pt + 2 * guide_offset_pt
            if corner_radius_mm > 0:
                radius_pt = min(mm_to_pt(corner_radius_mm * scale), w_pt / 2, h_pt / 2)
                pdf.roundRect(
                    guide_x,
                    guide_y,
                    guide_w,
                    guide_h,
                    radius_pt + guide_offset_pt,
                    stroke=1,
                    fill=0,
                )
            else:
                pdf.rect(guide_x, guide_y, guide_w, guide_h, stroke=1, fill=0)
            if profile.name == "psa":
                pdf.setDash()
                pdf.setLineCap(0)

            pdf.drawImage(
                ImageReader(piece_list[index]),
                x_pt,
                y_pt,
                width=w_pt,
                height=h_pt,
                preserveAspectRatio=False,
                mask="auto",
            )
            for region_label, region_box, region_radius_mm in cutouts:
                left, top, right, bottom = region_box
                region_x = x_pt + left * w_pt
                region_y = y_pt + (1.0 - bottom) * h_pt
                region_w = (right - left) * w_pt
                region_h = (bottom - top) * h_pt
                region_radius = mm_to_pt(region_radius_mm * scale)
                pdf.setFillColor(white)
                pdf.setStrokeColor(Color(0.34, 0.37, 0.38))
                pdf.setLineWidth(0.55)
                pdf.setLineCap(1)
                pdf.setDash(0.6, 1.5)
                if region_radius_mm > 0:
                    pdf.roundRect(region_x, region_y, region_w, region_h, region_radius, stroke=1, fill=1)
                else:
                    pdf.rect(region_x, region_y, region_w, region_h, stroke=1, fill=1)
                pdf.setDash()
                pdf.setLineCap(0)
            index += 1

    pdf.setFillColor(Color(0.25, 0.25, 0.25))
    pdf.setFont("Helvetica", 6)
    footer = f"{profile.label} | {paper_name.upper()} | print at 100% / Actual Size"
    pdf.drawString(mm_to_pt(5), mm_to_pt(2.5), footer)
    pdf.save()
    return {
        "type": "cut_ready",
        "path": str(pdf_path),
        "paper": paper_name,
        "page_mm": [page_w_mm, page_h_mm],
        "scale": round(scale, 6),
        "warning": warning,
        "gap_mm": gap_mm,
        "safe_margin_mm": safe_margin_mm,
        "corner_radius_mm": corner_radius_mm,
        "cutouts": [
            {
                "label": label,
                "box": list(box),
                "box_mm": normalized_box_to_mm(profile, box),
            }
            for label, box, _ in cutouts
        ],
        "dotted_guides": profile.name == "psa",
    }


def draw_full_art_pdf(pdf_path: Path, master: Image.Image, profile: Profile, paper_name: str) -> dict:
    page_w_mm, page_h_mm = PAPER_SIZES_MM[paper_name]
    page_w_pt, page_h_pt = mm_to_pt(page_w_mm), mm_to_pt(page_h_mm)
    image_w_mm = min(page_w_mm - 12, profile.master_mm[0])
    image_h_mm = image_w_mm * (profile.master_px[1] / profile.master_px[0])
    if image_h_mm > page_h_mm - 20:
        image_h_mm = page_h_mm - 20
        image_w_mm = image_h_mm * (profile.master_px[0] / profile.master_px[1])
    x_mm = (page_w_mm - image_w_mm) / 2
    y_mm = (page_h_mm - image_h_mm) / 2
    pdf = canvas.Canvas(str(pdf_path), pagesize=(page_w_pt, page_h_pt))
    pdf.setTitle(f"{profile.label} full artwork - {paper_name.upper()}")
    pdf.drawImage(
        ImageReader(master),
        mm_to_pt(x_mm),
        mm_to_pt(y_mm),
        width=mm_to_pt(image_w_mm),
        height=mm_to_pt(image_h_mm),
        preserveAspectRatio=False,
        mask="auto",
    )
    pdf.save()
    return {
        "type": "full_artwork",
        "path": str(pdf_path),
        "paper": paper_name,
        "page_mm": [page_w_mm, page_h_mm],
        "image_mm": [round(image_w_mm, 3), round(image_h_mm, 3)],
    }


def draw_print_guide(
    pdf_path: Path,
    profile: Profile,
    page_reports: list[dict],
    guide_paper: str,
) -> None:
    page_w_mm, page_h_mm = PAPER_SIZES_MM[guide_paper]
    pdf = canvas.Canvas(str(pdf_path), pagesize=(mm_to_pt(page_w_mm), mm_to_pt(page_h_mm)))
    pdf.setTitle(f"{profile.label} extended art print guide")
    x = mm_to_pt(14)
    y = mm_to_pt(page_h_mm - 18)
    pdf.setFillColor(Color(0.12, 0.12, 0.12))
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(x, y, "Extended-art print guide")
    y -= mm_to_pt(10)
    pdf.setFont("Helvetica", 10)
    lines = [
        f"Profile: {profile.label}",
        f"Layout: {profile.columns} x {profile.rows} ({profile.piece_count} finished piece(s))",
        f"Final insert: {profile.insert_w_mm:g} x {profile.insert_h_mm:g} mm",
        f"Individual PNG: {profile.insert_px[0]} x {profile.insert_px[1]} pixels at {DPI} DPI",
        "Print at 100% / Actual Size. Disable Fit to Page and borderless expansion.",
        "Measure the square below and test one sheet in the intended binder before selling.",
        "Cut on the thin gray rectangles. Insert pieces left-to-right, top-to-bottom.",
    ]
    cutout_labels = {
        cutout["label"]
        for report in page_reports
        for cutout in report.get("cutouts", [])
    }
    if cutout_labels:
        lines[-1] = "Cut the dotted outer edge and blank " + ", ".join(sorted(cutout_labels)) + " guides."
        cutout_sizes = {
            cutout["label"]: cutout["box_mm"][2:]
            for report in page_reports
            for cutout in report.get("cutouts", [])
        }
        lines.append(
            "Blank openings: "
            + "; ".join(
                f"{label} {size[0]:g} x {size[1]:g} mm"
                for label, size in sorted(cutout_sizes.items())
            )
        )
    for line in lines:
        pdf.drawString(x, y, line)
        y -= mm_to_pt(7)

    y -= mm_to_pt(5)
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(x, y, "Page notes")
    y -= mm_to_pt(7)
    pdf.setFont("Helvetica", 9)
    for report in page_reports:
        if report.get("type") != "cut_ready":
            continue
        note = f"{report['paper'].upper()}: scale {report['scale'] * 100:.2f}%"
        if report.get("warning"):
            note += f" - {report['warning']}"
        pdf.drawString(x, y, note)
        y -= mm_to_pt(6)

    square_mm = 50.0
    y -= mm_to_pt(7)
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawString(x, y, "Calibration square: this must measure exactly 50 x 50 mm")
    y -= mm_to_pt(square_mm + 3)
    pdf.setStrokeColor(Color(0.1, 0.1, 0.1))
    pdf.setLineWidth(0.8)
    pdf.rect(x, y, mm_to_pt(square_mm), mm_to_pt(square_mm), stroke=1, fill=0)
    pdf.save()


def write_customer_instructions(
    path: Path,
    profile_results: dict,
    warnings: list[str],
    paper_format: str,
) -> None:
    profile_lines = []
    for result in profile_results.values():
        profile_lines.append(
            f"- {result['label']}: {result['insert_mm'][0]:g} x {result['insert_mm'][1]:g} mm "
            f"({result['insert_px'][0]} x {result['insert_px'][1]} px per insert)"
        )
    warning_lines = [f"- {warning}" for warning in warnings] or ["- No automated warnings."]
    paper_label = "A4 or Letter" if paper_format == "both" else paper_format.upper()
    total_pieces = sum(result["piece_count"] for result in profile_results.values())
    placement_line = (
        "6. Insert pieces 01-09 left-to-right, top-to-bottom."
        if total_pieces > 1
        else "6. Place the single finished print in the intended holder or frame."
    )
    cutout_labels = {
        cutout["label"]
        for result in profile_results.values()
        for page in result["pages"]
        for cutout in page.get("cutouts", [])
    }
    cut_instruction = (
        "5. Cut the dotted outer edge and blank " + ", ".join(sorted(cutout_labels)) + " guides."
        if cutout_labels
        else "5. Cut on the thin gray rectangle borders."
    )
    content = "\n".join(
        [
            "EXTENDED ART - PRINT FIRST",
            "==========================",
            "",
            "Included profiles:",
            *profile_lines,
            "",
            "Printing:",
            f"1. Open the {paper_label} CUT_READY PDF.",
            "2. Select 100% or Actual Size in the print dialog.",
            "3. Turn off Fit to Page, Shrink Oversized Pages, and borderless expansion.",
            "4. Print the matching print guide and verify its 50 mm calibration square.",
            cut_instruction,
            placement_line,
            "",
            "Automated quality notes:",
            *warning_lines,
            "",
            "Always test one physical print with the actual printer, paper, sleeves, and binder.",
        ]
    )
    path.write_text(content + "\n", encoding="utf-8")


def build_profile(
    source: Image.Image,
    profile: Profile,
    output_root: Path,
    slug: str,
    options: BuildOptions,
) -> dict:
    profile_dir = output_root / profile.name
    pieces_dir = profile_dir / "pieces"
    pages_dir = profile_dir / "pdf"
    profile_dir.mkdir(parents=True, exist_ok=True)
    pages_dir.mkdir(parents=True, exist_ok=True)
    if options.include_pieces:
        pieces_dir.mkdir(parents=True, exist_ok=True)

    master, normalization = normalize_master(
        source, profile, options.source_mode, options.focus_x, options.focus_y
    )
    master_path: Path | None = None
    if options.include_master:
        master_path = profile_dir / f"{slug}_{profile.name}_master_300dpi.png"
        master.save(master_path, format="PNG", dpi=(DPI, DPI))
    pieces = split_pieces(master, profile, options.corner_radius_mm)
    piece_paths = []
    if options.include_pieces:
        for index, piece in enumerate(pieces, start=1):
            path = pieces_dir / f"{slug}_{profile.name}_piece_{index:02d}.png"
            piece.save(path, format="PNG", dpi=(DPI, DPI))
            piece_paths.append(str(path))

    page_reports = []
    paper_names = ("a4", "letter") if options.paper_format == "both" else (options.paper_format,)
    for paper_name in paper_names:
        page_path = pages_dir / f"{slug}_{profile.name}_{paper_name}_cut_ready.pdf"
        page_reports.append(
            draw_cut_page(
                page_path,
                pieces,
                profile,
                paper_name,
                options.gap_mm,
                options.scale_mode,
                options.safe_margin_mm,
                options.corner_radius_mm,
                options.cutout_card_zone,
            )
        )
        if options.include_full_art_pdf:
            full_path = pages_dir / f"{slug}_{profile.name}_{paper_name}_full_artwork.pdf"
            page_reports.append(draw_full_art_pdf(full_path, master, profile, paper_name))

    guide_paper = "a4" if options.paper_format == "both" else options.paper_format
    guide_path = profile_dir / f"{slug}_{profile.name}_{guide_paper}_print_guide.pdf"
    draw_print_guide(guide_path, profile, page_reports, guide_paper)

    return {
        "profile": profile.name,
        "label": profile.label,
        "insert_mm": [profile.insert_w_mm, profile.insert_h_mm],
        "insert_px": list(profile.insert_px),
        "grid": [profile.columns, profile.rows],
        "piece_count": profile.piece_count,
        "master_mm": list(profile.master_mm),
        "master_px": list(profile.master_px),
        "master_dpi": DPI,
        "card_box_mm": normalized_box_to_mm(profile, profile.card_box),
        "label_box_mm": (
            normalized_box_to_mm(profile, profile.label_box)
            if profile.label_box is not None
            else None
        ),
        "master_path": str(master_path) if master_path else None,
        "pieces": piece_paths,
        "pages": page_reports,
        "print_guide": str(guide_path),
        "normalization": normalization,
        "focus": [options.focus_x, options.focus_y],
        "corner_radius_mm": options.corner_radius_mm,
        "included_outputs": {
            "cut_ready_pdf": True,
            "pieces": options.include_pieces,
            "master_png": options.include_master,
            "full_art_pdf": options.include_full_art_pdf,
        },
    }


def build_package(
    input_path: Path,
    output_dir: Path,
    slug: str | None = None,
    options: BuildOptions | None = None,
) -> dict:
    options = options or BuildOptions()
    validate_options(options)
    input_path = input_path.resolve()
    output_dir = output_dir.resolve()
    verify_image(input_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    slug = safe_slug(slug or input_path.stem)

    with Image.open(input_path) as opened:
        source = ImageOps.exif_transpose(opened)
        source.load()
        original = {
            "path": str(input_path),
            "width_px": source.width,
            "height_px": source.height,
            "mode": source.mode,
            "format": opened.format,
        }
        names = ["standard", "vaultx"] if options.profile == "both" else [options.profile]
        results = {
            name: build_profile(
                source,
                profile_for_options(PROFILES[name], options),
                output_dir,
                slug,
                options,
            )
            for name in names
        }

    warnings: list[str] = []
    profile_quality = {}
    for name, data in results.items():
        scale_factor = data["normalization"]["scale_factor"]
        profile_warnings = []
        if scale_factor > 1.001:
            profile_warnings.append(
                f"Source was enlarged {scale_factor:.2f}x for {data['label']}; inspect fine detail at print size."
            )
        profile_warnings.extend(
            page["warning"] for page in data["pages"] if page.get("warning")
        )
        warnings.extend(profile_warnings)
        profile_quality[name] = {
            "status": "PASS_WITH_WARNINGS" if profile_warnings else "PASS",
            "target_master_pixels": data["master_px"],
            "target_insert_pixels": data["insert_px"],
            "normalization": data["normalization"],
            "warnings": profile_warnings,
        }

    manifest = {
        "tool": "ExtendedArt Offline Workflow",
        "version": APP_VERSION,
        "offline": True,
        "input": original,
        "output_dir": str(output_dir),
        "settings": asdict(options),
        "profiles": results,
        "notes": [
            "DPI metadata is not a substitute for sufficient source pixels.",
            "Print PDFs at 100% / Actual Size unless a manifest warning reports scaling.",
            "Physically test every binder, sleeve, paper, and printer combination before publishing.",
        ],
    }
    manifest_path = output_dir / f"{slug}_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    report = {
        "overall_status": "PASS_WITH_WARNINGS" if warnings else "PASS",
        "input_pixels": [original["width_px"], original["height_px"]],
        "profiles": profile_quality,
    }
    report_path = output_dir / f"{slug}_quality_report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    instructions_path = output_dir / "PRINT_INSTRUCTIONS.txt"
    write_customer_instructions(instructions_path, results, warnings, options.paper_format)

    return {
        "manifest": str(manifest_path),
        "quality_report": str(report_path),
        "print_instructions": str(instructions_path),
        "profiles": names,
        "status": report["overall_status"],
        "warnings": warnings,
    }
