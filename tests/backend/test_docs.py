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
            self.assertIn("https://github.com/rsundin/planview-dash", text, name)


class LaunchDocsTest(unittest.TestCase):
    """Roadmap G1: the recording in the README, and the docs it links to."""

    def test_readme_pictures_and_docs_exist(self):
        text = (ROOT / "README.md").read_text()
        refs = re.findall(r'src="(docs/[^"]+)"|\]\(((?:docs/)?[\w./-]+\.md)(?:#[\w-]*)?\)', text)
        paths = {a or b for a, b in refs}
        self.assertIn("docs/images/demo.webp", paths)
        self.assertIn("docs/sharing.md", paths)
        for p in sorted(paths):
            self.assertTrue((ROOT / p).is_file(), f"README.md refers to {p}, which does not exist")

    def test_recording_is_an_animated_webp_of_reasonable_size(self):
        data = (ROOT / "docs/images/demo.webp").read_bytes()
        self.assertEqual((data[:4], data[8:12]), (b"RIFF", b"WEBP"))
        self.assertIn(b"ANIM", data[:64], "not an animated WebP")
        # The README loads it on every visit; keep it light.
        self.assertLess(len(data), 3_000_000)


def _slug(heading: str) -> str:
    """GitHub's anchor for a heading: lower case, punctuation dropped, spaces to -."""
    text = re.sub(r"[`*_]|\[([^\]]*)\]\([^)]*\)", lambda m: m.group(1) or "", heading)
    return re.sub(r"[^\w\- ]", "", text.strip().lower()).replace(" ", "-")


def _anchors(path: Path) -> set[str]:
    out, in_code = set(), False
    for line in path.read_text().splitlines():
        if line.startswith("```"):
            in_code = not in_code
        elif not in_code and (m := re.match(r"#+\s+(.*)", line)):
            out.add(_slug(m.group(1)))
    return out


class UserDocsTest(unittest.TestCase):
    """Roadmap V4: docs for people who are not the owner. Every link between the user
    docs leads to a file and heading that exist, and Troubleshooting is easy to find."""

    PAGES = ["README.md", "docs/setup.md", "docs/troubleshooting.md", "docs/configuration.md"]

    def test_links_between_docs_lead_somewhere(self):
        link = re.compile(r"\]\(([^)\s]+)\)")
        for name in self.PAGES:
            page = ROOT / name
            text = re.sub(r"```.*?```", "", page.read_text(), flags=re.S)
            for target in link.findall(text):
                if re.match(r"[a-z]+:", target):
                    continue  # https:, mailto:
                file, _, anchor = target.partition("#")
                dest = (page.parent / file).resolve() if file else page
                self.assertTrue(dest.is_file(), f"{name} links to {target}, which does not exist")
                if anchor and dest.suffix == ".md":
                    self.assertIn(anchor, _anchors(dest), f"{name} links to {target}: no such heading")

    def test_troubleshooting_is_linked(self):
        self.assertIn("(docs/troubleshooting.md)", (ROOT / "README.md").read_text())
        self.assertIn("(troubleshooting.md)", (ROOT / "docs/setup.md").read_text())
        report = (ROOT / "custom_components/planview_dash/frontend/js/ui/report.js").read_text()
        url = re.search(r"TROUBLESHOOTING_URL = `\$\{REPO_URL\}/blob/main/([^`]+)`", report)
        self.assertIsNotNone(url, "the ? sheet links to Troubleshooting")
        self.assertTrue((ROOT / url.group(1)).is_file())

    def test_readme_states_the_promise(self):
        text = (ROOT / "README.md").read_text()
        for words in ("## What stays the same", "Breaking changes wait for 2.0", "## Upgrading"):
            self.assertIn(words, text)
        self.assertIn('"homeassistant": "2025.6', (ROOT / "hacs.json").read_text())
        self.assertIn("2025.6", text)


if __name__ == "__main__":
    unittest.main()
