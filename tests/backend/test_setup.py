"""Starter sites and the move from the earlier folder name."""

from __future__ import annotations

import json
import re
import tempfile
import unittest
from pathlib import Path

import stubs  # noqa: F401  (installs the stand-ins first)
from stubs import ROOT

import custom_components.planview_dash as integration

EXAMPLE = ROOT / "custom_components" / "planview_dash" / "example"
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
        ("house", "de", "site.json"),
        ("apartment", "nb", "apartment.json"),
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
                self.assertEqual(site["language"], language.split("-")[0])
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

    def test_language_and_locale_follow_home_assistant(self):
        # A language the dashboard has is used (with the English example's names);
        # others fall back to English. A region in Home Assistant's language is kept.
        for language, code, locale in [
            ("sv", "sv", "sv-SE"), ("en", "en", "en-GB"), ("en-US", "en", "en-US"),
            ("de", "de", "de-DE"), ("de-AT", "de", "de-AT"), ("no", "nb", "nb-NO"),
            ("nn", "nb", "nb-NO"), ("da", "da", "da-DK"), ("fi", "fi", "fi-FI"),
            ("nl", "nl", "nl-NL"), ("fr", "en", "en-GB"), ("pt-BR", "en", "pt-BR"), ("", "en", "en-GB"),
        ]:
            with self.subTest(language=language):
                _, site = self.make("apartment", language)
                self.assertEqual((site["language"], site["locale"]), (code, locale))

    def test_existing_site_is_not_touched(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "home"
            folder.mkdir()
            (folder / "site.json").write_text('{"mine": true}')
            integration._create_starter_site(Path(tmp), {"site": "home"}, "sv", "SEK")
            self.assertEqual((folder / "site.json").read_text(), '{"mine": true}')


class OldFolderTest(unittest.TestCase):
    """Sites from before the rename to PlanView Dash move to the new folder (migrate.py)."""

    def test_moves_the_old_folder(self):
        from custom_components.planview_dash import migrate
        with tempfile.TemporaryDirectory() as tmp:
            old = Path(tmp, migrate.OLD_DOMAIN, "sites", "home")
            old.mkdir(parents=True)
            (old / "site.json").write_text("{}")
            self.assertTrue(migrate.move_old_folder(tmp))
            self.assertEqual(Path(tmp, "planview_dash", "sites", "home", "site.json").read_text(), "{}")
            self.assertFalse(Path(tmp, migrate.OLD_DOMAIN).exists())
            self.assertFalse(migrate.move_old_folder(tmp))

    def test_never_overwrites_a_new_folder(self):
        from custom_components.planview_dash import migrate
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, migrate.OLD_DOMAIN, "sites").mkdir(parents=True)
            Path(tmp, "planview_dash").mkdir()
            self.assertFalse(migrate.move_old_folder(tmp))
            self.assertTrue(Path(tmp, migrate.OLD_DOMAIN, "sites").is_dir())
