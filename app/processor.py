#!/usr/bin/env python3
"""Deterministic 3x3 extended-art print package builder.

This module performs no AI generation and makes no network requests. It takes
one completed full-page image, crops or fits it to a selected 3x3 insert
profile, exports the master and nine pieces, and creates print-ready PDFs.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageOps
from reportlab.lib.colors import Color, white
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


DPI = 300
MM_PER_INCH = 25.4


@dataclass(frozen=True)
class Profile:
    name: str
    label: str
    insert_w_mm: float
    insert_h_mm: float

    @property
    def insert_px(self) -> tuple[int, int]:
        return (
            round(self.insert_w_mm / MM_PER_INCH * DPI),
            round(self.insert_h_mm / MM_PER_INCH * DPI),
        )

    @property
    def master_px(self) -> tuple[int, int]:
        return (
            round(self.insert_w_mm * 3 / MM_PER_INCH * DPI),
            round(self.insert_h_mm * 3 / MM_PER_INCH * DPI),
        )


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


PROFILES = {
    "standard": Profile("standard", "Standard", 63.0, 88.0),
    "vaultx": Profile("vaultx", "Vault X-compatible", 66.0, 94.0),
}

PAPER_SIZES_MM = {
    "a4": (210.0, 297.0),
    "letter": (215.9, 279.4),
}


def mm_to_pt(mm: float) -> float:
    return mm / MM_PER_INCH * 72.0


def safe_slug(value: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in "-_" else "_" for char in value)
    return cleaned.strip("_") or "extended_art"


def validate_options(options: BuildOptions) -> None:
    if options.profile not in {"standard", "vaultx", "both"}:
        raise ValueError("profile must be standard, vaultx, or both")
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
    x_edges = [round(i * master.width / 3) for i in range(4)]
    y_edges = [round(i * master.height / 3) for i in range(4)]
    for row in range(3):
        for col in range(3):
            crop = master.crop((x_edges[col], y_edges[row], x_edges[col + 1], y_edges[row + 1]))
            resized = crop.resize((piece_w, piece_h), Image.Resampling.LANCZOS)
            pieces.append(apply_corner_radius(resized, radius_px))
    return pieces


def draw_cut_page(
    pdf_path: Path,
    pieces: Iterable[Image.Image],
    profile: Profile,
    paper_name: str,
    gap_mm: float,
    scale_mode: str,
    safe_margin_mm: float,
    corner_radius_mm: float,
) -> dict:
    page_w_mm, page_h_mm = PAPER_SIZES_MM[paper_name]
    base_w = profile.insert_w_mm * 3 + gap_mm * 2
    base_h = profile.insert_h_mm * 3 + gap_mm * 2
    scale = 1.0
    warning = None

    if base_w + safe_margin_mm * 2 > page_w_mm or base_h + safe_margin_mm * 2 > page_h_mm:
        if scale_mode != "fit":
            warning = f"{profile.name} {paper_name} cannot fit at exact size with the selected gaps and margins"
        else:
            scale = min(
                (page_w_mm - safe_margin_mm * 2) / base_w,
                (page_h_mm - safe_margin_mm * 2) / base_h,
            )
            warning = f"Scaled to {scale * 100:.2f}% to fit {paper_name}"

    layout_w = base_w * scale
    layout_h = base_h * scale
    left_mm = (page_w_mm - layout_w) / 2
    top_mm = (page_h_mm - layout_h) / 2
    page_w_pt, page_h_pt = mm_to_pt(page_w_mm), mm_to_pt(page_h_mm)

    pdf = canvas.Canvas(str(pdf_path), pagesize=(page_w_pt, page_h_pt))
    pdf.setTitle(f"{profile.label} extended art - {paper_name.upper()}")
    pdf.setFillColor(white)
    pdf.rect(0, 0, page_w_pt, page_h_pt, stroke=0, fill=1)

    piece_list = list(pieces)
    line_color = Color(0.42, 0.42, 0.42, alpha=0.9)
    index = 0
    for row in range(3):
        for col in range(3):
            x_mm = left_mm + col * (profile.insert_w_mm + gap_mm) * scale
            y_mm = page_h_mm - top_mm - (row + 1) * profile.insert_h_mm * scale - row * gap_mm * scale
            w_mm = profile.insert_w_mm * scale
            h_mm = profile.insert_h_mm * scale
            x_pt, y_pt = mm_to_pt(x_mm), mm_to_pt(y_mm)
            w_pt, h_pt = mm_to_pt(w_mm), mm_to_pt(h_mm)
            pdf.drawImage(
                ImageReader(piece_list[index]),
                x_pt,
                y_pt,
                width=w_pt,
                height=h_pt,
                preserveAspectRatio=False,
                mask="auto",
            )
            pdf.setStrokeColor(line_color)
            pdf.setLineWidth(0.35)
            if corner_radius_mm > 0:
                radius_pt = min(mm_to_pt(corner_radius_mm * scale), w_pt / 2, h_pt / 2)
                pdf.roundRect(x_pt, y_pt, w_pt, h_pt, radius_pt, stroke=1, fill=0)
            else:
                pdf.rect(x_pt, y_pt, w_pt, h_pt, stroke=1, fill=0)
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
    }


def draw_full_art_pdf(pdf_path: Path, master_path: Path, profile: Profile, paper_name: str) -> dict:
    page_w_mm, page_h_mm = PAPER_SIZES_MM[paper_name]
    page_w_pt, page_h_pt = mm_to_pt(page_w_mm), mm_to_pt(page_h_mm)
    image_w_mm = min(page_w_mm - 12, profile.insert_w_mm * 3)
    image_h_mm = image_w_mm * (profile.master_px[1] / profile.master_px[0])
    if image_h_mm > page_h_mm - 20:
        image_h_mm = page_h_mm - 20
        image_w_mm = image_h_mm * (profile.master_px[0] / profile.master_px[1])
    x_mm = (page_w_mm - image_w_mm) / 2
    y_mm = (page_h_mm - image_h_mm) / 2
    pdf = canvas.Canvas(str(pdf_path), pagesize=(page_w_pt, page_h_pt))
    pdf.setTitle(f"{profile.label} full artwork - {paper_name.upper()}")
    pdf.drawImage(
        ImageReader(str(master_path)),
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


def draw_print_guide(pdf_path: Path, profile: Profile, page_reports: list[dict]) -> None:
    page_w_mm, page_h_mm = PAPER_SIZES_MM["a4"]
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
        f"Final insert: {profile.insert_w_mm:g} x {profile.insert_h_mm:g} mm",
        f"Individual PNG: {profile.insert_px[0]} x {profile.insert_px[1]} pixels at {DPI} DPI",
        "Print at 100% / Actual Size. Disable Fit to Page and borderless expansion.",
        "Measure the square below and test one sheet in the intended binder before selling.",
        "Cut on the thin gray rectangles. Insert pieces left-to-right, top-to-bottom.",
    ]
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


def write_customer_instructions(path: Path, profile_results: dict, warnings: list[str]) -> None:
    profile_lines = []
    for result in profile_results.values():
        profile_lines.append(
            f"- {result['label']}: {result['insert_mm'][0]:g} x {result['insert_mm'][1]:g} mm "
            f"({result['insert_px'][0]} x {result['insert_px'][1]} px per insert)"
        )
    warning_lines = [f"- {warning}" for warning in warnings] or ["- No automated warnings."]
    content = "\n".join(
        [
            "EXTENDED ART - PRINT FIRST",
            "==========================",
            "",
            "Included profiles:",
            *profile_lines,
            "",
            "Printing:",
            "1. Open the A4 or Letter CUT_READY PDF for your paper.",
            "2. Select 100% or Actual Size in the print dialog.",
            "3. Turn off Fit to Page, Shrink Oversized Pages, and borderless expansion.",
            "4. Print the matching print guide and verify its 50 mm calibration square.",
            "5. Cut on the thin gray rectangle borders.",
            "6. Insert pieces 01-09 left-to-right, top-to-bottom.",
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
    pieces_dir.mkdir(parents=True, exist_ok=True)
    pages_dir.mkdir(parents=True, exist_ok=True)

    master, normalization = normalize_master(
        source, profile, options.source_mode, options.focus_x, options.focus_y
    )
    master_path = profile_dir / f"{slug}_{profile.name}_master_300dpi.png"
    master.save(master_path, format="PNG", dpi=(DPI, DPI))
    pieces = split_pieces(master, profile, options.corner_radius_mm)
    piece_paths = []
    for index, piece in enumerate(pieces, start=1):
        path = pieces_dir / f"{slug}_{profile.name}_piece_{index:02d}.png"
        piece.save(path, format="PNG", dpi=(DPI, DPI))
        piece_paths.append(str(path))

    page_reports = []
    for paper_name in ("a4", "letter"):
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
            )
        )
        full_path = pages_dir / f"{slug}_{profile.name}_{paper_name}_full_artwork.pdf"
        page_reports.append(draw_full_art_pdf(full_path, master_path, profile, paper_name))

    guide_path = profile_dir / f"{slug}_{profile.name}_print_guide.pdf"
    draw_print_guide(guide_path, profile, page_reports)

    return {
        "profile": profile.name,
        "label": profile.label,
        "insert_mm": [profile.insert_w_mm, profile.insert_h_mm],
        "insert_px": list(profile.insert_px),
        "master_mm": [profile.insert_w_mm * 3, profile.insert_h_mm * 3],
        "master_px": list(profile.master_px),
        "master_dpi": DPI,
        "master_path": str(master_path),
        "pieces": piece_paths,
        "pages": page_reports,
        "print_guide": str(guide_path),
        "normalization": normalization,
        "focus": [options.focus_x, options.focus_y],
        "corner_radius_mm": options.corner_radius_mm,
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
            name: build_profile(source, PROFILES[name], output_dir, slug, options)
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
        "version": "1.0.0",
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
    write_customer_instructions(instructions_path, results, warnings)

    return {
        "manifest": str(manifest_path),
        "quality_report": str(report_path),
        "print_instructions": str(instructions_path),
        "profiles": names,
        "status": report["overall_status"],
        "warnings": warnings,
    }
