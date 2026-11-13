"""The dashboard's texts (roadmap Q8): one JSON file per language in frontend/i18n/.
Every language has the same keys, every key the code asks for exists, and the
standalone page knows every module."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "custom_components" / "smarthomedash" / "frontend"
I18N = FRONTEND / "i18n"
# t('key'), t("key") and has('key'); and the fixed start of t(`prefix.${…}`).
LITERAL = re.compile(r"""(?<![\w.$])(?:t|has)\(\s*(['"])([\w.-]+)\1""")
TEMPLATE = re.compile(r"(?<![\w.$])(?:t|has)\(\s*`([\w.-]*)\$\{")
# Keys handed to t() through a variable: intro('setup.x'), exampleNote(cond ? 'a.b' : 'c.d').
INDIRECT = re.compile(r"(?<![\w.$])(?:intro|exampleNote)\(([^)]*)\)")
PLACEHOLDER = re.compile(r"\{(\w+)\}")


def languages() -> dict[str, dict[str, str]]:
    return {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted(I18N.glob("*.json"))}


def sources() -> list[Path]:
    return sorted(FRONTEND.rglob("*.js"))


class StringsTest(unittest.TestCase):
    def test_every_language_has_the_same_keys(self):
        langs = languages()
        self.assertIn("en", langs)
        self.assertIn("sv", langs)
        english = set(langs["en"])
        for code, strings in langs.items():
            self.assertEqual(sorted(english - set(strings)), [], f"{code}.json lacks keys en.json has")
            self.assertEqual(sorted(set(strings) - english), [], f"{code}.json has keys en.json lacks")

    def test_values_are_text_with_the_same_placeholders(self):
        langs = languages()
        for code, strings in langs.items():
            for key, value in strings.items():
                self.assertIsInstance(value, str, f"{code}.json {key}")
                self.assertTrue(value.strip(), f"{code}.json {key} is empty")
                self.assertEqual(
                    set(PLACEHOLDER.findall(value)), set(PLACEHOLDER.findall(langs["en"][key])),
                    f"{code}.json {key}: other {{placeholders}} than en.json")

    def test_every_key_the_code_uses_exists(self):
        english = languages()["en"]
        used: dict[str, Path] = {}
        prefixes: dict[str, Path] = {}
        for path in sources():
            text = path.read_text(encoding="utf-8")
            for m in LITERAL.finditer(text):
                used.setdefault(m.group(2), path)
            for m in TEMPLATE.finditer(text):
                prefixes.setdefault(m.group(1), path)
            for m in INDIRECT.finditer(text):
                for key in re.findall(r"'([\w-]+(?:\.[\w-]+)+)'", m.group(1)):
                    used.setdefault(key, path)
        self.assertGreater(len(used), 300, "the scan finds the code's keys")
        missing = {k: str(p.relative_to(ROOT)) for k, p in used.items() if k not in english}
        self.assertEqual(missing, {}, "keys used in the code but missing in en.json")
        for prefix, path in prefixes.items():
            self.assertTrue(any(k.startswith(prefix) for k in english),
                            f"no key starts with {prefix!r} (used in {path.relative_to(ROOT)})")

    def test_i18n_js_knows_every_language_file(self):
        text = (FRONTEND / "js" / "i18n.js").read_text(encoding="utf-8")
        listed = re.search(r"export const LANGUAGES = \[([^\]]*)\]", text)
        self.assertIsNotNone(listed)
        self.assertEqual(sorted(re.findall(r"'(\w+)'", listed.group(1))), sorted(languages()))


class StandalonePageTest(unittest.TestCase):
    """index.html loads every file with ?v=<version>; a file it does not list is fetched
    without it, and Home Assistant's /local/ would serve an old copy for a month."""

    def setUp(self):
        self.html = (ROOT / "index.html").read_text(encoding="utf-8")

    def test_every_module_is_listed(self):
        listed = set(re.findall(r"'(custom_components/smarthomedash/frontend/js/[\w/.-]+\.js)'", self.html))
        have = {str(p.relative_to(ROOT)) for p in (FRONTEND / "js").rglob("*.js")}
        have.discard("custom_components/smarthomedash/frontend/js/adapters/hass.js")  # the panel's own
        self.assertEqual(sorted(have - listed), [], "JavaScript files missing from MODULES in index.html")
        self.assertEqual(sorted(listed - have), [], "MODULES in index.html lists files that do not exist")

    def test_english_is_preloaded(self):
        # English is the fallback for every language, so every page needs it.
        self.assertRegex(self.html, r"var PRELOAD = \['en'\]")
        self.assertIn("frontend/i18n/' + code + '.json' + q", self.html)

if __name__ == "__main__":
    unittest.main()
