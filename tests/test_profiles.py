from __future__ import annotations

import sys
import tempfile
import unittest
import json
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app"))

from processor import (  # noqa: E402
    BuildOptions,
    PROFILES,
    build_package,
    calculate_page_layout,
    draw_cut_page,
    profile_for_options,
    validate_options,
)
from drop_workflow import zip_directory  # noqa: E402
from web_ui import (  # noqa: E402
    add_center_card,
    boolean_setting,
    profile_payloads,
    render_alignment,
)


class ProfileContractTests(unittest.TestCase):
    def test_profile_dimensions_and_piece_counts(self) -> None:
        expected = {
            "standard": ((2232, 3118), (744, 1039), 9),
            "vaultx": ((2339, 3331), (780, 1110), 9),
            "psa": ((948, 1596), (948, 1596), 1),
            "photo8x10": ((2400, 3000), (2400, 3000), 1),
        }
        for name, contract in expected.items():
            profile = PROFILES[name]
            self.assertEqual(profile.master_px, contract[0])
            self.assertEqual(profile.insert_px, contract[1])
            self.assertEqual(profile.piece_count, contract[2])

    def test_all_browser_profile_and_paper_combinations_validate(self) -> None:
        for profile in PROFILES:
            for paper in ("a4", "letter"):
                validate_options(BuildOptions(profile=profile, paper_format=paper))

    def test_health_metadata_matches_processor_contract(self) -> None:
        payloads = profile_payloads()
        self.assertEqual(set(payloads), set(PROFILES))
        self.assertEqual(payloads["standard"]["master_px"], [2232, 3118])
        self.assertEqual(payloads["psa"]["piece_count"], 1)
        self.assertEqual(payloads["psa"]["label_box_mm"], [5.207, 5.0, 69.85, 21.59])
        self.assertEqual(payloads["psa"]["card_box_mm"], [8.632, 36.0, 63.0, 88.0])
        self.assertEqual(payloads["photo8x10"]["card_box_mm"], [70.1, 83.0, 63.0, 88.0])
        self.assertEqual(payloads["standard"]["paper_fit"]["a4"]["page_mm"], [210.0, 297.0])
        self.assertEqual(
            payloads["standard"]["paper_fit"]["letter"]["page_mm"],
            [215.9, 279.4],
        )

    def test_page_layout_contract_distinguishes_a4_and_letter(self) -> None:
        standard_a4 = calculate_page_layout(PROFILES["standard"], "a4")
        standard_letter = calculate_page_layout(PROFILES["standard"], "letter")
        self.assertEqual(standard_a4["page_mm"], [210.0, 297.0])
        self.assertEqual(standard_letter["page_mm"], [215.9, 279.4])
        self.assertNotEqual(standard_a4["offset_mm"], standard_letter["offset_mm"])
        self.assertEqual(calculate_page_layout(PROFILES["vaultx"], "letter")["scale"], 0.948951)
        self.assertEqual(calculate_page_layout(PROFILES["photo8x10"], "a4")["scale"], 0.994094)

    def test_alignment_renderer_uses_selected_profile(self) -> None:
        source = Image.new("RGB", (640, 900), "navy")
        for name, profile in PROFILES.items():
            rendered, report = render_alignment(source, name, 1.0, 0.0, 0.0)
            self.assertEqual(rendered.size, profile.master_px)
            self.assertEqual(report["target_pixels"], list(profile.master_px))

    def test_center_card_uses_selected_physical_zone(self) -> None:
        profile = PROFILES["photo8x10"]
        master = Image.new("RGB", profile.master_px, "white")
        card = Image.new("RGB", (630, 880), "red")
        rendered, report = add_center_card(master, card, profile)
        box = report["center_cell_box_px"]
        self.assertEqual(rendered.getpixel((box[0] + 5, box[1] + 5)), (255, 0, 0))
        self.assertEqual(rendered.getpixel((5, 5)), (255, 255, 255))

    def test_expected_page_scale_warnings(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            cases = (
                ("standard", "a4", 1.0),
                ("standard", "letter", 1.0),
                ("vaultx", "letter", 0.0),
                ("photo8x10", "a4", 0.0),
            )
            for name, paper, exact_scale in cases:
                profile = PROFILES[name]
                pieces = [Image.new("RGB", (20, 30), "cyan") for _ in range(profile.piece_count)]
                report = draw_cut_page(
                    output / f"{name}-{paper}.pdf",
                    pieces,
                    profile,
                    paper,
                    gap_mm=2.0,
                    scale_mode="fit",
                    safe_margin_mm=4.0,
                    corner_radius_mm=0.0,
                    cutout_card_zone=False,
                )
                if exact_scale:
                    self.assertEqual(report["scale"], exact_scale)
                    self.assertIsNone(report["warning"])
                else:
                    self.assertLess(report["scale"], 1.0)
                    self.assertIsNotNone(report["warning"])

    def test_optional_outputs_can_be_enabled_for_selected_paper(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_path = root / "source.png"
            Image.new("RGB", (600, 750), "purple").save(source_path)
            result = build_package(
                source_path,
                root / "output",
                options=BuildOptions(
                    profile="photo8x10",
                    paper_format="letter",
                    include_pieces=True,
                    include_master=True,
                    include_full_art_pdf=True,
                ),
            )
            manifest = json.loads(Path(result["manifest"]).read_text(encoding="utf-8"))
            profile_result = manifest["profiles"]["photo8x10"]
            self.assertEqual({page["paper"] for page in profile_result["pages"]}, {"letter"})
            self.assertEqual(len(profile_result["pieces"]), 1)
            with Image.open(profile_result["pieces"][0]) as piece:
                self.assertEqual(piece.size, (2400, 3000))
            pdf_names = {path.name for path in (root / "output" / "photo8x10" / "pdf").glob("*.pdf")}
            self.assertTrue(pdf_names)
            self.assertTrue(all("letter" in name for name in pdf_names))


    def test_psa_ink_saving_package_omits_optional_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_path = root / "source.png"
            Image.new("RGB", (600, 900), "purple").save(source_path)
            result = build_package(
                source_path,
                root / "output",
                options=BuildOptions(
                    profile="psa",
                    paper_format="letter",
                    cutout_card_zone=True,
                ),
            )
            manifest = json.loads(Path(result["manifest"]).read_text(encoding="utf-8"))
            profile_result = manifest["profiles"]["psa"]
            self.assertIsNone(profile_result["master_path"])
            self.assertEqual(profile_result["pieces"], [])
            self.assertEqual([page["type"] for page in profile_result["pages"]], ["cut_ready"])
            self.assertEqual(
                {cutout["label"] for cutout in profile_result["pages"][0]["cutouts"]},
                {"PSA label", "card chamber"},
            )
            self.assertTrue(profile_result["pages"][0]["dotted_guides"])
            cutouts = {
                cutout["label"]: cutout["box_mm"]
                for cutout in profile_result["pages"][0]["cutouts"]
            }
            self.assertEqual(cutouts["PSA label"], [5.207, 5.0, 69.85, 21.59])
            self.assertEqual(cutouts["card chamber"], [8.632, 36.0, 63.0, 88.0])
            self.assertFalse((root / "output" / "psa" / "pieces").exists())
            pdf_names = {path.name for path in (root / "output" / "psa" / "pdf").glob("*.pdf")}
            self.assertEqual(pdf_names, {"source_psa_letter_cut_ready.pdf"})
            zip_path = root / "source.zip"
            zip_directory(root / "output", zip_path)
            with zipfile.ZipFile(zip_path) as archive:
                names = set(archive.namelist())
            self.assertFalse(any("pieces/" in name for name in names))
            self.assertFalse(any("full_artwork" in name for name in names))
            self.assertTrue(any(name.endswith("source_psa_letter_cut_ready.pdf") for name in names))

    def test_psa_label_cutout_supports_custom_dimensions(self) -> None:
        options = BuildOptions(psa_label_width_mm=63.5, psa_label_height_mm=19.05)
        profile = profile_for_options(PROFILES["psa"], options)
        self.assertEqual(
            [round(value, 3) for value in (
                profile.label_box[0] * profile.insert_w_mm,
                profile.label_box[1] * profile.insert_h_mm,
                (profile.label_box[2] - profile.label_box[0]) * profile.insert_w_mm,
                (profile.label_box[3] - profile.label_box[1]) * profile.insert_h_mm,
            )],
            [8.382, 5.0, 63.5, 19.05],
        )

    def test_psa_label_cutout_rejects_unsafe_dimensions(self) -> None:
        with self.assertRaisesRegex(ValueError, "width"):
            validate_options(BuildOptions(psa_label_width_mm=79.0))
        with self.assertRaisesRegex(ValueError, "height"):
            validate_options(BuildOptions(psa_label_height_mm=35.0))

    def test_boolean_settings_do_not_treat_false_text_as_true(self) -> None:
        self.assertFalse(boolean_setting({"include_pieces": "false"}, "include_pieces"))
        self.assertTrue(boolean_setting({"include_pieces": "true"}, "include_pieces"))
        with self.assertRaises(ValueError):
            boolean_setting({"include_pieces": "sometimes"}, "include_pieces")



if __name__ == "__main__":
    unittest.main()
