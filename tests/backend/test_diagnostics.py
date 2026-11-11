"""Download diagnostics: counts and sizes only, nothing that names the home."""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import stubs  # noqa: F401  (installs the stand-ins first)
from stubs import ROOT

from custom_components.smarthomedash import diagnostics

SITE = ROOT / "sites" / "example-house"
ENTITY = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")


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


class States:
    def __init__(self, known):
        self.known = set(known)

    def get(self, entity_id):
        return object() if entity_id in self.known else None


class DiagnosticsTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.sites = Path(tmp.name)
        shutil.copytree(SITE, self.sites / "sundins-hus")
        self.config = json.loads((SITE / "site.json").read_text(encoding="utf-8"))
        self.ids = sorted({s for s in strings(self.config) if ENTITY.match(s) and not diagnostics.PICTURE.search(s)})

    def run_diag(self, known, data=None, options=None):
        hass = stubs.Hass()
        hass.data = {"smarthomedash": {
            "sites_dir": self.sites, "version": "0.8.14", "entries": {"a": {}}, "yaml_sites": set(),
            "update": {"repository": "rsundin/SmartHomeDash", "branch": "main", "token": "ghp_secret_token"},
        }}
        hass.states = States(known)
        hass.config = SimpleNamespace(language="sv")
        entry = SimpleNamespace(
            data=data or {"site": "sundins-hus", "title": "Sundins hus", "layout": "house"},
            options=options or {"title": "Sundins hus", "url_path": "sundin", "require_admin": False},
        )
        return asyncio.run(diagnostics.async_get_config_entry_diagnostics(hass, entry))

    def test_counts_without_names_ids_or_tokens(self):
        known = self.ids[2:]  # two devices are gone from Home Assistant
        out = self.run_diag(known)
        text = json.dumps(out, ensure_ascii=False)
        self.assertEqual(out["smarthomedash"], "0.8.14")
        self.assertEqual(out["home_assistant"], "2026.11.0")
        site = out["site"]
        self.assertEqual(site["site_json"], "ok")
        self.assertEqual(site["floorplans"], len(self.config["floorplans"]))
        self.assertEqual(site["rooms"], sum(len(p.get("rooms", [])) for p in self.config["floorplans"]))
        self.assertGreater(site["lamps"], 0)
        self.assertGreater(site["pictures"], 0)
        self.assertEqual(site["missing_entities"], 2)
        self.assertTrue(out["update_action"]["token_set"])
        # Redacted or left out: the title, folder and address, the token, every entity id and name.
        self.assertEqual(out["entry"]["data"]["title"], "**REDACTED**")
        self.assertEqual(out["entry"]["data"]["site"], "**REDACTED**")
        self.assertEqual(out["entry"]["options"]["url_path"], "**REDACTED**")
        self.assertEqual(out["entry"]["data"]["layout"], "house")
        for private in ["Sundins hus", "sundins-hus", "sundin", "ghp_secret_token", *self.ids]:
            self.assertNotIn(private, text)
        names = {s for p in self.config["floorplans"] for r in p.get("rooms", []) for s in [r.get("name")] if s}
        for name in names:
            self.assertNotIn(f'"{name}"', text)
        json.dumps(out)  # Home Assistant writes it as JSON

    def test_missing_or_broken_site(self):
        (self.sites / "sundins-hus" / "site.json").write_text("{ not json", encoding="utf-8")
        self.assertEqual(self.run_diag([])["site"]["site_json"], "not valid JSON")
        out = self.run_diag([], data={"site": "nowhere", "title": "x"})
        self.assertEqual(out["site"], {"folder_exists": False, "missing_entities": 0})


if __name__ == "__main__":
    unittest.main()
