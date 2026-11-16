"""Install docs (roadmap M1): since Home Assistant 2026.11, HACS is the built-in
Marketplace. The user-facing docs must describe the Marketplace and mention the old
HACS menus only in the note for older Home Assistant versions."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCS = ["README.md", "docs/setup.md"]
# Menus that only exist in the HACS add-on before Home Assistant 2026.11.
OLD_MENUS = re.compile(r"custom repositor|HACS\s*→", re.I)
OLD_NOTE = "Before Home Assistant 2026.11"


class InstallDocsTest(unittest.TestCase):
    def test_old_hacs_menus_only_in_the_pre_2026_11_note(self):
        for name in DOCS:
            for no, line in enumerate((ROOT / name).read_text().splitlines(), 1):
                if OLD_MENUS.search(line):
                    self.assertIn(
                        OLD_NOTE.lower(), line.lower(),
                        f"{name}:{no} describes HACS menus outside the pre-2026.11 note",
                    )

    def test_marketplace_install_described(self):
        for name in DOCS:
            text = (ROOT / name).read_text()
            self.assertIn("Marketplace → Add from link", text, name)
            self.assertIn("https://github.com/rsundin/SmartHomeDash", text, name)


if __name__ == "__main__":
    unittest.main()
