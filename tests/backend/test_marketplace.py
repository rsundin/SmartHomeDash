"""Marketplace catalog (roadmap S6): the checks hacs/default runs must pass without
ignores. Keep the brand icon, hacs.json and the HACS job from slipping."""

from __future__ import annotations

import json
import re
import struct
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / "custom_components/smarthomedash/brand"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def png_size(path: Path) -> tuple[int, int]:
    head = path.read_bytes()[:24]
    assert head[:8] == PNG_MAGIC, f"{path.name} is not a PNG"
    return struct.unpack(">II", head[16:24])


class MarketplaceTest(unittest.TestCase):
    def test_brand_icons(self):
        # The HACS brands check looks for brand/icon.png; Home Assistant 2026.3+
        # shows it. home-assistant/brands wants 256 px and 512 px squares.
        self.assertEqual(png_size(BRAND / "icon.png"), (256, 256))
        self.assertEqual(png_size(BRAND / "icon@2x.png"), (512, 512))

    def test_hacs_job_has_no_ignores(self):
        workflow = (ROOT / ".github/workflows/validate.yml").read_text()
        self.assertIn("uses: hacs/action@", workflow)
        self.assertIsNone(
            re.search(r"^\s*ignore\s*:", workflow, re.M),
            "the catalog needs the HACS action to pass without ignores",
        )

    def test_hacs_json(self):
        hacs = json.loads((ROOT / "hacs.json").read_text())
        self.assertEqual(hacs.get("name"), "SmartHomeDash")
        self.assertRegex(hacs.get("homeassistant", ""), r"^\d{4}\.\d+\.\d+$")

    def test_submission_entry_matches_repository(self):
        manifest = json.loads((ROOT / "custom_components/smarthomedash/manifest.json").read_text())
        repo = manifest["documentation"].removeprefix("https://github.com/")
        doc = (ROOT / "docs/marketplace-submission.md").read_text()
        self.assertIn(f'"{repo}",', doc)
        self.assertIn(f"Add {repo}", doc)


if __name__ == "__main__":
    unittest.main()
