#!/usr/bin/env python3
"""Offline drop-folder automation for extended-art packages."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
import traceback
import zipfile
from dataclasses import fields
from datetime import datetime
from pathlib import Path

from processor import BuildOptions, build_package, safe_slug


SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"}
DEFAULT_CONFIG = {
    "profile": "standard",
    "source_mode": "crop",
    "focus_x": 0.5,
    "focus_y": 0.5,
    "gap_mm": 2.0,
    "scale_mode": "fit",
    "safe_margin_mm": 4.0,
    "corner_radius_mm": 0.0,
    "keep_unzipped_package": True,
    "poll_seconds": 2.0,
    "settle_seconds": 3.0,
}


def workflow_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def paths(root: Path) -> dict[str, Path]:
    return {
        "drop": root / "DROP_IMAGES_HERE",
        "ready": root / "READY_PRODUCTS",
        "processed": root / "PROCESSED_INPUTS",
        "failed": root / "FAILED_INPUTS",
        "work": root / ".working",
        "config": root / "config.json",
    }


def initialize(root: Path) -> dict[str, Path]:
    locations = paths(root)
    for key in ("drop", "ready", "processed", "failed", "work"):
        locations[key].mkdir(parents=True, exist_ok=True)
    if not locations["config"].exists():
        locations["config"].write_text(json.dumps(DEFAULT_CONFIG, indent=2) + "\n", encoding="utf-8")
    return locations


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid JSON in {path.name}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return value


def load_settings(root: Path, image_path: Path) -> tuple[BuildOptions, dict]:
    locations = initialize(root)
    config = dict(DEFAULT_CONFIG)
    config.update(load_json(locations["config"]))

    sidecar = image_path.with_suffix(".json")
    if sidecar.exists() and sidecar != locations["config"]:
        config.update(load_json(sidecar))

    option_names = {field.name for field in fields(BuildOptions)}
    option_values = {name: config[name] for name in option_names if name in config}
    return BuildOptions(**option_values), config


def unique_path(directory: Path, name: str) -> Path:
    candidate = directory / name
    if not candidate.exists():
        return candidate
    stem = Path(name).stem
    suffix = Path(name).suffix
    index = 2
    while True:
        candidate = directory / f"{stem}_{index}{suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def zip_directory(source_dir: Path, destination: Path) -> None:
    temp_zip = destination.with_suffix(destination.suffix + ".partial")
    if temp_zip.exists():
        temp_zip.unlink()
    with zipfile.ZipFile(temp_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for file_path in sorted(source_dir.rglob("*")):
            if file_path.is_file():
                archive.write(file_path, file_path.relative_to(source_dir).as_posix())
    with zipfile.ZipFile(temp_zip, "r") as archive:
        bad_file = archive.testzip()
        if bad_file:
            raise RuntimeError(f"ZIP integrity check failed at {bad_file}")
    temp_zip.replace(destination)


def process_image(image_path: Path, root: Path, archive_drop_input: bool = False) -> dict:
    locations = initialize(root)
    image_path = image_path.resolve()
    if image_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported image type: {image_path.suffix}")

    options, config = load_settings(root, image_path)
    slug = safe_slug(image_path.stem)
    job_token = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    working_dir = locations["work"] / f"{slug}_{job_token}"
    working_dir.mkdir(parents=True, exist_ok=False)

    package_name = f"{slug}_DELIVERABLE"
    package_work = working_dir / package_name
    package_work.mkdir()
    try:
        result = build_package(image_path, package_work, slug=slug, options=options)
        zip_path = unique_path(locations["ready"], f"{package_name}.zip")
        zip_directory(package_work, zip_path)

        package_path = None
        if bool(config.get("keep_unzipped_package", True)):
            package_path = unique_path(locations["ready"], package_name)
            shutil.move(str(package_work), str(package_path))

        archived_input = None
        if archive_drop_input:
            archived_input = unique_path(locations["processed"], image_path.name)
            shutil.move(str(image_path), str(archived_input))
            sidecar = image_path.with_suffix(".json")
            if sidecar.exists():
                archived_sidecar = unique_path(locations["processed"], sidecar.name)
                shutil.move(str(sidecar), str(archived_sidecar))

        return {
            **result,
            "input": str(image_path),
            "zip": str(zip_path),
            "package_folder": str(package_path) if package_path else None,
            "archived_input": str(archived_input) if archived_input else None,
        }
    finally:
        if working_dir.exists():
            shutil.rmtree(working_dir, ignore_errors=True)


def handle_failure(image_path: Path, root: Path, error: BaseException, archive_drop_input: bool) -> None:
    locations = initialize(root)
    error_path = unique_path(locations["failed"], f"{safe_slug(image_path.stem)}_ERROR.txt")
    error_path.write_text(
        "".join(traceback.format_exception(type(error), error, error.__traceback__)),
        encoding="utf-8",
    )
    if archive_drop_input and image_path.exists():
        failed_input = unique_path(locations["failed"], image_path.name)
        shutil.move(str(image_path), str(failed_input))


def discover_drop_images(root: Path) -> list[Path]:
    drop_dir = initialize(root)["drop"]
    return sorted(
        path for path in drop_dir.iterdir()
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS and not path.name.startswith(".")
    )


def print_result(result: dict) -> None:
    print(f"READY: {result['zip']}")
    print(f"STATUS: {result['status']}")
    for warning in result.get("warnings", []):
        print(f"WARNING: {warning}")


def run_once(root: Path) -> int:
    images = discover_drop_images(root)
    if not images:
        print(f"No images found in: {paths(root)['drop']}")
        return 0
    failures = 0
    for image_path in images:
        print(f"Processing: {image_path.name}")
        try:
            print_result(process_image(image_path, root, archive_drop_input=True))
        except Exception as error:  # keep batch processing after one bad file
            failures += 1
            print(f"FAILED: {image_path.name}: {error}")
            handle_failure(image_path, root, error, archive_drop_input=True)
    return 1 if failures else 0


def watch(root: Path) -> int:
    config = dict(DEFAULT_CONFIG)
    config.update(load_json(initialize(root)["config"]))
    poll_seconds = max(float(config.get("poll_seconds", 2.0)), 0.5)
    settle_seconds = max(float(config.get("settle_seconds", 3.0)), 1.0)
    observed: dict[Path, tuple[int, int, float]] = {}
    print("ExtendedArt Offline Workflow is running.")
    print(f"Drop images into: {paths(root)['drop']}")
    print("Press Ctrl+C to stop.\n")

    try:
        while True:
            now = time.monotonic()
            current = set(discover_drop_images(root))
            for missing in set(observed) - current:
                observed.pop(missing, None)

            for image_path in current:
                try:
                    stat = image_path.stat()
                except FileNotFoundError:
                    continue
                previous = observed.get(image_path)
                signature = (stat.st_size, stat.st_mtime_ns)
                if previous is None or previous[:2] != signature:
                    observed[image_path] = (signature[0], signature[1], now)
                    continue
                if now - previous[2] < settle_seconds:
                    continue

                print(f"Processing: {image_path.name}")
                try:
                    result = process_image(image_path, root, archive_drop_input=True)
                    print_result(result)
                except Exception as error:
                    print(f"FAILED: {image_path.name}: {error}")
                    handle_failure(image_path, root, error, archive_drop_input=True)
                observed.pop(image_path, None)
            time.sleep(poll_seconds)
    except KeyboardInterrupt:
        print("\nWorkflow stopped.")
        return 0



def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command")
    subcommands.add_parser("init", help="Create workflow folders and config")
    subcommands.add_parser("once", help="Process every image currently in the drop folder")
    subcommands.add_parser("watch", help="Watch the drop folder continuously")
    web_parser = subcommands.add_parser("web", help="Open the local browser alignment studio")
    web_parser.add_argument("--port", type=int, default=8765)
    web_parser.add_argument("--no-browser", action="store_true")
    process_parser = subcommands.add_parser("process", help="Process one or more image paths")
    process_parser.add_argument("images", nargs="+")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = workflow_root()
    command = args.command or "watch"
    initialize(root)
    if command == "init":
        print(f"Workflow ready at: {root}")
        return 0
    if command == "once":
        return run_once(root)
    if command == "watch":
        return watch(root)
    if command == "web":
        from web_ui import serve
        return serve(root, args.port, not args.no_browser)
    if command == "process":
        failures = 0
        for value in args.images:
            image_path = Path(value)
            try:
                print_result(process_image(image_path, root, archive_drop_input=False))
            except Exception as error:
                failures += 1
                print(f"FAILED: {image_path}: {error}")
                handle_failure(image_path, root, error, archive_drop_input=False)
        return 1 if failures else 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
