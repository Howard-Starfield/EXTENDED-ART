#!/usr/bin/env python3
"""Local browser alignment studio for extended-art packaging."""

from __future__ import annotations

import json
import mimetypes
import shutil
import sys
import threading
import webbrowser
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote

from PIL import Image, ImageOps

from drop_workflow import initialize, paths, unique_path, workflow_root, zip_directory
from processor import BuildOptions, PROFILES, build_package, safe_slug

MAX_REQUEST_BYTES = 220 * 1024 * 1024
MAX_IMAGE_BYTES = 100 * 1024 * 1024
APP_VERSION = "1.3.0"
ALIGNMENT_PREVIEW = (180, 252)
ALIGNMENT_REGIONS = (
    ("Illustration panel", (0.08, 0.07, 0.92, 0.58)),
    ("Upper full art", (0.10, 0.10, 0.90, 0.75)),
    ("Center artwork", (0.17, 0.16, 0.83, 0.72)),
    ("Full-bleed artwork", (0.07, 0.07, 0.93, 0.93)),
)
ASSET_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
}


def asset_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS")) / "web"
    return Path(__file__).resolve().parents[1] / "web"


def parse_multipart(content_type: str, body: bytes) -> tuple[dict, dict]:
    header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n"
    message = BytesParser(policy=default).parsebytes(header.encode("ascii") + body)
    fields: dict[str, str] = {}
    files: dict[str, tuple[str, bytes]] = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue
        payload = part.get_payload(decode=True) or b""
        filename = part.get_filename()
        if filename:
            files[name] = (Path(filename).name, payload)
        else:
            fields[name] = payload.decode("utf-8")
    return fields, files


def render_alignment(
    source: Image.Image,
    zoom: float,
    offset_x: float,
    offset_y: float,
) -> tuple[Image.Image, dict]:
    if not 1.0 <= zoom <= 4.0:
        raise ValueError("Zoom must be between 100% and 400%.")
    if not -1.0 <= offset_x <= 1.0 or not -1.0 <= offset_y <= 1.0:
        raise ValueError("Artwork position is outside the allowed range.")
    profile = PROFILES["standard"]
    source = ImageOps.exif_transpose(source).convert("RGB")
    target_w, target_h = profile.master_px
    scale = max(target_w / source.width, target_h / source.height) * zoom
    rendered_w = max(target_w, round(source.width * scale))
    rendered_h = max(target_h, round(source.height * scale))
    rendered = source.resize((rendered_w, rendered_h), Image.Resampling.LANCZOS)
    left = round((target_w - rendered_w) / 2 + offset_x * target_w)
    top = round((target_h - rendered_h) / 2 + offset_y * target_h)
    left = min(0, max(target_w - rendered_w, left))
    top = min(0, max(target_h - rendered_h, top))
    master = Image.new("RGB", (target_w, target_h), (245, 245, 245))
    master.paste(rendered, (left, top))
    return master, {
        "mode": "manual_browser_alignment",
        "original_pixels": [source.width, source.height],
        "target_pixels": [target_w, target_h],
        "zoom": round(zoom, 6),
        "offset": [round(offset_x, 6), round(offset_y, 6)],
        "render_scale": round(scale, 6),
        "rendered_pixels": [rendered_w, rendered_h],
        "placement_pixels": [left, top],
    }


def _float_range(center: float, radius: float, step: float, low: float, high: float) -> list[float]:
    start = max(low, center - radius)
    stop = min(high, center + radius)
    count = max(1, round((stop - start) / step))
    values = [start + index * (stop - start) / count for index in range(count + 1)]
    return [round(value, 6) for value in values]


def _crop_region(image: Image.Image, fractions: tuple[float, float, float, float]) -> Image.Image:
    left, top, right, bottom = fractions
    return image.crop(
        (
            round(left * image.width),
            round(top * image.height),
            round(right * image.width),
            round(bottom * image.height),
        )
    )



def _correlation(first: tuple[int, ...], second: tuple[int, ...]) -> float:
    first_mean = sum(first) / len(first)
    second_mean = sum(second) / len(second)
    numerator = 0.0
    first_energy = 0.0
    second_energy = 0.0
    for first_value, second_value in zip(first, second):
        first_delta = first_value - first_mean
        second_delta = second_value - second_mean
        numerator += first_delta * second_delta
        first_energy += first_delta * first_delta
        second_energy += second_delta * second_delta
    denominator = (first_energy * second_energy) ** 0.5
    return numerator / denominator if denominator > 0.000001 else 0.0



def _image_signature(image: Image.Image) -> tuple[tuple[int, ...], tuple[int, ...], tuple[int, ...]]:
    sample = image.convert("RGB").resize((24, 24), Image.Resampling.BILINEAR)
    gray_image = ImageOps.autocontrast(sample.convert("L"))
    gray = tuple(gray_image.getdata())
    edges: list[int] = []
    for y in range(1, 23):
        row = y * 24
        for x in range(1, 23):
            index = row + x
            horizontal = abs(gray[index + 1] - gray[index - 1])
            vertical = abs(gray[index + 24] - gray[index - 24])
            edges.append(min(255, horizontal + vertical))
    color_sample = sample.resize((12, 12), Image.Resampling.BILINEAR)
    color = tuple(channel for pixel in color_sample.getdata() for channel in pixel)
    return gray, tuple(edges), color



def _signature_score(
    first: tuple[tuple[int, ...], tuple[int, ...], tuple[int, ...]],
    second: tuple[tuple[int, ...], tuple[int, ...], tuple[int, ...]],
) -> float:
    gray_score = _correlation(first[0], second[0])
    edge_score = _correlation(first[1], second[1])
    color_difference = sum(abs(a - b) for a, b in zip(first[2], second[2]))
    color_similarity = 1.0 - color_difference / (255 * len(first[2]))
    color_score = color_similarity * 2.0 - 1.0
    return 0.55 * gray_score + 0.30 * edge_score + 0.15 * color_score



def _render_alignment_preview(
    source: Image.Image,
    zoom: float,
    offset_x: float,
    offset_y: float,
) -> tuple[Image.Image, float, float]:
    target_w, target_h = ALIGNMENT_PREVIEW
    scale = max(target_w / source.width, target_h / source.height) * zoom
    rendered_w = max(target_w, round(source.width * scale))
    rendered_h = max(target_h, round(source.height * scale))
    rendered = source.resize((rendered_w, rendered_h), Image.Resampling.BILINEAR)
    left = round((target_w - rendered_w) / 2 + offset_x * target_w)
    top = round((target_h - rendered_h) / 2 + offset_y * target_h)
    left = min(0, max(target_w - rendered_w, left))
    top = min(0, max(target_h - rendered_h, top))
    preview = Image.new("RGB", ALIGNMENT_PREVIEW)
    preview.paste(rendered, (left, top))
    effective_x = (left - (target_w - rendered_w) / 2) / target_w
    effective_y = (top - (target_h - rendered_h) / 2) / target_h
    return preview, effective_x, effective_y



def suggest_alignment(source: Image.Image, card: Image.Image) -> dict:
    """Suggest artwork zoom and position using robust, model-free visual matching."""
    source = ImageOps.exif_transpose(source).convert("RGB")
    card = ImageOps.exif_transpose(card).convert("RGB")
    if source.width < 300 or source.height < 300:
        raise ValueError("The extended artwork is too small to auto align.")
    if card.width < 120 or card.height < 160:
        raise ValueError("The original card image is too small to auto align.")

    source.thumbnail((900, 1260), Image.Resampling.LANCZOS)
    cell_w = ALIGNMENT_PREVIEW[0] // 3
    cell_h = ALIGNMENT_PREVIEW[1] // 3
    center_box = (cell_w, cell_h, cell_w * 2, cell_h * 2)
    fitted_card = ImageOps.fit(card, (cell_w, cell_h), Image.Resampling.LANCZOS)
    card_signatures = {
        label: _image_signature(_crop_region(fitted_card, region))
        for label, region in ALIGNMENT_REGIONS
    }

    best = {
        "score": -2.0,
        "zoom": 1.0,
        "offset_x": 0.0,
        "offset_y": 0.0,
        "matched_region": ALIGNMENT_REGIONS[0][0],
    }

    def search(zooms: list[float], offsets_x: list[float], offsets_y: list[float]) -> None:
        nonlocal best
        for zoom in zooms:
            for offset_y in offsets_y:
                for offset_x in offsets_x:
                    preview, effective_x, effective_y = _render_alignment_preview(
                        source, zoom, offset_x, offset_y
                    )
                    center = preview.crop(center_box)
                    for label, region in ALIGNMENT_REGIONS:
                        signature = _image_signature(_crop_region(center, region))
                        score = _signature_score(card_signatures[label], signature)
                        if score > best["score"]:
                            best = {
                                "score": score,
                                "zoom": zoom,
                                "offset_x": effective_x,
                                "offset_y": effective_y,
                                "matched_region": label,
                            }

    search(
        [round(1.0 + index * 0.1, 6) for index in range(11)],
        [round(-0.28 + index * 0.07, 6) for index in range(9)],
        [round(-0.28 + index * 0.07, 6) for index in range(9)],
    )
    search(
        _float_range(best["zoom"], 0.08, 0.04, 1.0, 2.5),
        _float_range(best["offset_x"], 0.05, 0.025, -1.0, 1.0),
        _float_range(best["offset_y"], 0.05, 0.025, -1.0, 1.0),
    )
    search(
        _float_range(best["zoom"], 0.025, 0.0125, 1.0, 2.5),
        _float_range(best["offset_x"], 0.016, 0.008, -1.0, 1.0),
        _float_range(best["offset_y"], 0.016, 0.008, -1.0, 1.0),
    )

    confidence = round(max(0.0, min(100.0, (best["score"] - 0.08) / 0.82 * 100.0)))
    quality = "high" if confidence >= 72 else "medium" if confidence >= 48 else "low"
    return {
        "zoom": round(best["zoom"], 4),
        "offset_x": round(best["offset_x"], 5),
        "offset_y": round(best["offset_y"], 5),
        "confidence": confidence,
        "quality": quality,
        "matched_region": best["matched_region"],
        "method": "offline_multiregion_visual_match",
    }



def add_center_card(master: Image.Image, card: Image.Image) -> tuple[Image.Image, dict]:
    card = ImageOps.exif_transpose(card).convert("RGBA")
    x_edges = [round(i * master.width / 3) for i in range(4)]
    y_edges = [round(i * master.height / 3) for i in range(4)]
    box = (x_edges[1], y_edges[1], x_edges[2], y_edges[2])
    size = (box[2] - box[0], box[3] - box[1])
    fitted = ImageOps.fit(card, size, Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    result = master.copy()
    result.paste(fitted, (box[0], box[1]), fitted)
    return result, {
        "included_in_master": True,
        "source_pixels": [card.width, card.height],
        "center_cell_box_px": list(box),
        "center_cell_pixels": list(size),
    }


def annotate_reports(result: dict, provenance: dict, warnings: list[str]) -> None:
    for key in ("manifest", "quality_report"):
        report_path = Path(result[key])
        data = json.loads(report_path.read_text(encoding="utf-8"))
        data["browser_alignment"] = provenance
        if key == "manifest":
            data["version"] = APP_VERSION
        if key == "quality_report":
            data["alignment_warnings"] = warnings
            if warnings:
                data["overall_status"] = "PASS_WITH_WARNINGS"
        report_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    instructions = Path(result["print_instructions"])
    if warnings:
        previous = instructions.read_text(encoding="utf-8")
        notes = "\nBROWSER ALIGNMENT NOTES\n" + "\n".join(f"- {item}" for item in warnings)
        instructions.write_text(previous + notes + "\n", encoding="utf-8")


def process_web_job(
    root: Path,
    art_path: Path,
    card_path: Path | None,
    settings: dict,
) -> dict:
    locations = initialize(root)
    zoom = float(settings.get("zoom", 1.0))
    offset_x = float(settings.get("offset_x", 0.0))
    offset_y = float(settings.get("offset_y", 0.0))
    include_card = bool(settings.get("include_card", True))
    corner_radius_mm = float(settings.get("corner_radius_mm", 3.0))
    slug = safe_slug(str(settings.get("name") or art_path.stem))
    job_dir = unique_path(locations["work"], f"web-job-{slug}")
    job_dir.mkdir(parents=True)
    package_name = f"{slug}_ALIGNED_DELIVERABLE"
    package_work = job_dir / package_name
    package_work.mkdir()
    try:
        with Image.open(art_path) as source:
            master, alignment = render_alignment(source, zoom, offset_x, offset_y)
        card_info = {"included_in_master": False}
        if include_card:
            if not card_path:
                raise ValueError("Upload the original card before including it in the print.")
            with Image.open(card_path) as card:
                master, card_info = add_center_card(master, card)
        aligned_path = job_dir / f"{slug}_aligned_master.png"
        master.save(aligned_path, format="PNG", dpi=(300, 300))
        provenance = {
            "artwork": alignment,
            "center_card": card_info,
            "reference_card_uploaded": card_path is not None,
            "corner_radius_mm": corner_radius_mm,
        }
        warnings = []
        if alignment["render_scale"] > 1.001:
            warnings.append(
                f"Original artwork was enlarged {alignment['render_scale']:.2f}x; inspect fine detail."
            )
        if include_card:
            warnings.append("The uploaded card image was printed into the center piece.")
        options = BuildOptions(
            profile="standard",
            source_mode="crop",
            corner_radius_mm=corner_radius_mm,
        )
        result = build_package(aligned_path, package_work, slug=slug, options=options)
        annotate_reports(result, provenance, warnings)
        result["warnings"] = list(result.get("warnings", [])) + warnings
        if result["warnings"]:
            result["status"] = "PASS_WITH_WARNINGS"
        zip_path = unique_path(locations["ready"], f"{package_name}.zip")
        zip_directory(package_work, zip_path)
        package_path = unique_path(locations["ready"], package_name)
        shutil.move(str(package_work), str(package_path))
        return {
            **result,
            "zip": str(zip_path),
            "zip_name": zip_path.name,
            "package_folder": str(package_path),
            "download_url": f"/downloads/{zip_path.name}",
        }
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


class AlignmentHandler(BaseHTTPRequestHandler):
    root: Path
    assets: Path

    def log_message(self, format_string: str, *args) -> None:
        print(f"[web] {self.address_string()} - {format_string % args}")

    def send_bytes(self, status: int, payload: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def send_json(self, status: int, value: dict) -> None:
        payload = json.dumps(value).encode("utf-8")
        self.send_bytes(status, payload, "application/json; charset=utf-8")

    def serve_asset(self, name: str) -> None:
        candidate = (self.assets / name).resolve()
        if self.assets.resolve() not in candidate.parents or not candidate.is_file():
            self.send_error(404)
            return
        content_type = ASSET_TYPES.get(candidate.suffix.lower())
        if not content_type:
            content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        self.send_bytes(200, candidate.read_bytes(), content_type)

    def do_GET(self) -> None:
        route = unquote(self.path.split("?", 1)[0])
        if route == "/":
            self.serve_asset("index.html")
            return
        if route == "/api/health":
            self.send_json(200, {"ok": True, "version": APP_VERSION, "offline": True})
            return
        if route.startswith("/downloads/"):
            filename = Path(route.removeprefix("/downloads/")).name
            file_path = paths(self.root)["ready"] / filename
            if not file_path.is_file() or file_path.suffix.lower() != ".zip":
                self.send_error(404)
                return
            payload = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        asset_name = route.lstrip("/")
        if asset_name in {"app.js", "styles.css"}:
            self.serve_asset(asset_name)
            return
        self.send_error(404)

    def do_POST(self) -> None:
        route = unquote(self.path.split("?", 1)[0])
        if route not in {"/api/auto-align", "/api/export"}:
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_REQUEST_BYTES:
                raise ValueError("Upload is empty or larger than 220 MB.")
            content_type = self.headers.get("Content-Type", "")
            if not content_type.startswith("multipart/form-data"):
                raise ValueError("Expected a multipart upload.")
            fields, files = parse_multipart(content_type, self.rfile.read(length))
            if "art" not in files:
                raise ValueError("Upload the 3x3 extended artwork first.")
            for filename, payload in files.values():
                if len(payload) > MAX_IMAGE_BYTES:
                    raise ValueError(f"{filename} is larger than 100 MB.")
            if route == "/api/auto-align":
                if "card" not in files:
                    raise ValueError("Upload the original card before auto aligning.")
                with Image.open(BytesIO(files["art"][1])) as source, Image.open(
                    BytesIO(files["card"][1])
                ) as card:
                    alignment = suggest_alignment(source, card)
                self.send_json(200, {"ok": True, "alignment": alignment})
                return
            settings = json.loads(fields.get("settings", "{}"))
            if not isinstance(settings, dict):
                raise ValueError("Invalid alignment settings.")
            work_dir = paths(self.root)["work"]
            upload_root = unique_path(work_dir, "web-upload")
            upload_root.mkdir(parents=True)
            try:
                art_name, art_payload = files["art"]
                art_suffix = Path(art_name).suffix.lower() or ".png"
                art_path = upload_root / f"art{art_suffix}"
                art_path.write_bytes(art_payload)
                card_path = None
                if "card" in files:
                    card_name, card_payload = files["card"]
                    card_suffix = Path(card_name).suffix.lower() or ".png"
                    card_path = upload_root / f"card{card_suffix}"
                    card_path.write_bytes(card_payload)
                result = process_web_job(self.root, art_path, card_path, settings)
            finally:
                shutil.rmtree(upload_root, ignore_errors=True)
            self.send_json(
                200,
                {
                    "ok": True,
                    "download_url": result["download_url"],
                    "filename": result["zip_name"],
                    "package_folder": result["package_folder"],
                    "status": result["status"],
                    "warnings": result["warnings"],
                },
            )
        except Exception as error:
            self.send_json(400, {"ok": False, "error": str(error)})


def serve(root: Path, port: int = 8765, open_browser: bool = True) -> int:
    initialize(root)
    handler = type("ConfiguredAlignmentHandler", (AlignmentHandler,), {})
    handler.root = root
    handler.assets = asset_root()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    except OSError:
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    url = f"http://127.0.0.1:{server.server_port}/"
    print(f"ExtendedArt Alignment Studio: {url}")
    print("Close this window or press Ctrl+C to stop.")
    if open_browser:
        threading.Timer(0.35, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nAlignment Studio stopped.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    raise SystemExit(serve(workflow_root(), args.port, not args.no_browser))
