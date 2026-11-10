"""Starter sites and the self-updater."""

from __future__ import annotations

import io
import json
import re
import tarfile
import tempfile
import unittest
from pathlib import Path

import stubs  # noqa: F401  (installs the stand-ins first)
from stubs import ROOT, HomeAssistantError

import custom_components.smarthomedash as integration
from custom_components.smarthomedash import updater

EXAMPLE = ROOT / "custom_components" / "smarthomedash" / "example"
ENTITY = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")
PICTURE = re.compile(r"\.(jpg|jpeg|png|webp)$")


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for k, v in value.items():
            yield from strings(k)
            yield from strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from strings(v)


class StarterSiteTest(unittest.TestCase):
    CASES = [
        ("house", "sv", "site.sv.json"),
        ("house", "en", "site.json"),
        ("apartment", "sv", "apartment.sv.json"),
        ("apartment", "en-GB", "apartment.json"),
    ]

    def make(self, layout, language, title="Hemma"):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        sites = Path(tmp.name)
        integration._create_starter_site(sites, {"site": "home", "title": title, "layout": layout}, language, "SEK")
        return sites / "home", json.loads((sites / "home" / "site.json").read_text())

    def test_every_layout_and_language(self):
        for layout, language, source in self.CASES:
            with self.subTest(layout=layout, language=language):
                folder, site = self.make(layout, language)
                example = json.loads((EXAMPLE / source).read_text())
                self.assertEqual(site["name"], "Hemma")
                self.assertEqual(site["language"], "sv" if language == "sv" else "en")
                self.assertTrue(site["setup_pending"])
                self.assertEqual(site["currency"], "SEK")
                # The drawing is kept.
                self.assertEqual([p["id"] for p in site["floorplans"]], [p["id"] for p in example["floorplans"]])
                self.assertEqual("overview" in site, layout == "house")
                # Every picture it refers to was copied.
                for name in integration._pictures(site):
                    self.assertTrue((folder / name).is_file(), name)

    def test_no_entities_are_left(self):
        for layout, language, _ in self.CASES:
            with self.subTest(layout=layout, language=language):
                _, site = self.make(layout, language)
                left = [s for s in strings(site) if ENTITY.match(s) and not PICTURE.search(s)]
                self.assertEqual(left, [])
                for key in ("climates", "weather", "wall_screen", "mock"):
                    self.assertNotIn(key, site)
                self.assertEqual(site["energy"], {})
                self.assertEqual(site["scenes"], [])
                for plan in site["floorplans"]:
                    for room in plan.get("rooms", []):
                        self.assertEqual(room["lights"], [])

    def test_existing_site_is_not_touched(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "home"
            folder.mkdir()
            (folder / "site.json").write_text('{"mine": true}')
            integration._create_starter_site(Path(tmp), {"site": "home"}, "sv", "SEK")
            self.assertEqual((folder / "site.json").read_text(), '{"mine": true}')


def tarball(files: dict[str, bytes], top: str = "rsundin-SmartHomeDash-abc1234def") -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name if name.startswith("..") or name.startswith("/") else f"{top}/{name}")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


class UpdaterTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.integration = self.tmp / "custom_components" / "smarthomedash"
        self.integration.mkdir(parents=True)
        (self.integration / "manifest.json").write_text('{"version": "1"}')
        (self.integration / "views.py").write_text("old")
        (self.integration / "stale.js").write_text("old")
        self.sites = self.tmp / "sites"
        (self.sites / "home").mkdir(parents=True)
        (self.sites / "home" / "site.json").write_text('{"mine": true}')

    def install(self, files, overwrite=False):
        return updater.install(tarball(files), self.integration, self.sites, ["home"], overwrite)

    def test_installs_github_tarball(self):
        result = self.install({
            "custom_components/smarthomedash/manifest.json": b'{"version": "2"}',
            "custom_components/smarthomedash/views.py": b"old",
            "custom_components/smarthomedash/frontend/panel.js": b"//",
            "sites/home/site.json": b'{"theirs": true}',
            "sites/home/roof.jpg": b"\xff\xd8\xff",
            "sites/other/site.json": b"{}",
        })
        self.assertEqual(result.commit, "abc1234")
        self.assertTrue(result.restart_required)  # manifest.json changed
        self.assertEqual((self.integration / "manifest.json").read_text(), '{"version": "2"}')
        self.assertTrue((self.integration / "frontend" / "panel.js").is_file())
        self.assertFalse((self.integration / "stale.js").exists())  # replaced as a whole
        # A saved site.json is kept; missing files are added; other sites are left alone.
        self.assertEqual((self.sites / "home" / "site.json").read_text(), '{"mine": true}')
        self.assertEqual(result.added_site_files, ["home/roof.jpg"])
        self.assertFalse((self.sites / "other").exists())
        self.assertEqual([p.name for p in self.tmp.joinpath("custom_components").iterdir()], ["smarthomedash"])

    def test_frontend_only_needs_no_restart(self):
        result = self.install({
            "custom_components/smarthomedash/manifest.json": b'{"version": "1"}',
            "custom_components/smarthomedash/views.py": b"old",
            "custom_components/smarthomedash/frontend/panel.js": b"// new",
        })
        self.assertFalse(result.restart_required)

    def test_overwrite_site_keeps_backup(self):
        self.install({
            "custom_components/smarthomedash/manifest.json": b"{}",
            "sites/home/site.json": b'{"theirs": true}',
        }, overwrite=True)
        self.assertEqual((self.sites / "home" / "site.json").read_text(), '{"theirs": true}')
        self.assertEqual((self.sites / "home" / "site.json.bak").read_text(), '{"mine": true}')

    def test_refuses_parent_paths(self):
        archive = {
            "custom_components/smarthomedash/manifest.json": b"{}",
            "../../escaped.txt": b"x",
        }
        with self.assertRaises(tarfile.FilterError):
            self.install(archive)
        self.assertFalse((self.tmp / "escaped.txt").exists())
        self.assertEqual((self.integration / "views.py").read_text(), "old")

    def test_absolute_paths_stay_inside(self):
        """The data filter strips the leading slash; the extra top folder is refused."""
        target = self.tmp / "absolute.txt"
        with self.assertRaises((tarfile.FilterError, HomeAssistantError)):
            self.install({"custom_components/smarthomedash/manifest.json": b"{}", str(target): b"x"})
        self.assertFalse(target.exists())
        self.assertEqual((self.integration / "views.py").read_text(), "old")

    def test_refuses_archive_without_integration(self):
        with self.assertRaises(HomeAssistantError):
            self.install({"README.md": b"hi"})
        self.assertEqual((self.integration / "views.py").read_text(), "old")


if __name__ == "__main__":
    unittest.main()
