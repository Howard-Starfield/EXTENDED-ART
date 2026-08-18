from __future__ import annotations

import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BRANDING = ROOT / "assets" / "branding"
EXPECTED_ICO_SIZES = {
    (16, 16),
    (20, 20),
    (24, 24),
    (30, 30),
    (32, 32),
    (36, 36),
    (40, 40),
    (48, 48),
    (60, 60),
    (64, 64),
    (72, 72),
    (80, 80),
    (96, 96),
    (128, 128),
    (256, 256),
}


class IconAssetTests(unittest.TestCase):
    def test_normalized_png_is_large_transparent_and_tightly_framed(self) -> None:
        with Image.open(BRANDING / "extendedart-icon.png") as image:
            self.assertEqual(image.mode, "RGBA")
            self.assertEqual(image.size, (1024, 1024))
            alpha = image.getchannel("A")
            bbox = alpha.point(lambda value: 255 if value >= 24 else 0).getbbox()
            self.assertIsNotNone(bbox)
            assert bbox is not None
            visible_width = bbox[2] - bbox[0]
            visible_height = bbox[3] - bbox[1]
            self.assertGreaterEqual(visible_width, 900)
            self.assertGreaterEqual(visible_height, 840)
            self.assertLess(alpha.getextrema()[0], 255)

    def test_ico_contains_native_windows_sizes(self) -> None:
        with Image.open(BRANDING / "extendedart.ico") as image:
            self.assertEqual(set(image.ico.sizes()), EXPECTED_ICO_SIZES)
            for size in EXPECTED_ICO_SIZES:
                image.size = size
                frame = image.copy().convert("RGBA")
                self.assertEqual(frame.size, size)
                self.assertGreater(frame.getchannel("A").getbbox()[2], size[0] * 0.75)

    def test_build_configs_reference_the_icon(self) -> None:
        spec = (ROOT / "ExtendedArtOffline.spec").read_text(encoding="utf-8")
        installer = (ROOT / "installer" / "ExtendedArt.iss").read_text(encoding="utf-8")
        self.assertIn("icon='assets\\\\branding\\\\extendedart.ico'", spec)
        self.assertIn("SetupIconFile=..\\assets\\branding\\extendedart.ico", installer)


if __name__ == "__main__":
    unittest.main()
