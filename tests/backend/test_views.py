"""The HTTP views: paths, picture checks, chunked bodies, size limits, admin-only writes."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

import stubs  # noqa: F401  (installs the stand-ins first)
from stubs import Hass, Request, Stream

from custom_components.smarthomedash import views
from custom_components.smarthomedash.const import MAX_SITE_JSON, MAX_UPLOAD

JPEG = b"\xff\xd8\xff\xe0" + b"\0" * 16
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 16
WEBP = b"RIFF\x24\0\0\0WEBPVP8 " + b"\0" * 16


def run(coro):
    return asyncio.run(coro)


class SafePathTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name) / "sites"
        (self.base / "home").mkdir(parents=True)
        (self.base / "home" / "site.json").write_text("{}")
        self.outside = Path(self.tmp.name) / "secret.txt"
        self.outside.write_text("secret")

    def tearDown(self):
        self.tmp.cleanup()

    def test_plain_file_resolves_under_base(self):
        self.assertEqual(views.safe_path(self.base, "home", "site.json"), (self.base / "home" / "site.json").resolve())

    def test_base_itself_is_allowed(self):
        self.assertEqual(views.safe_path(self.base), self.base.resolve())

    def test_traversal_is_refused(self):
        for parts in (("..", "secret.txt"), ("home", "..", "..", "secret.txt"), ("home/../../secret.txt",), ("/etc/passwd",)):
            with self.subTest(parts=parts):
                self.assertIsNone(views.safe_path(self.base, *parts))

    def test_prefix_sibling_is_refused(self):
        """sites-old is not inside sites, although the name starts the same."""
        (Path(self.tmp.name) / "sites-old").mkdir()
        self.assertIsNone(views.safe_path(self.base, "../sites-old"))

    def test_symlink_out_of_base_is_refused(self):
        link = self.base / "home" / "link.txt"
        os.symlink(self.outside, link)
        self.assertIsNone(views.safe_path(self.base, "home", "link.txt"))

    def test_symlinked_directory_out_of_base_is_refused(self):
        os.symlink(Path(self.tmp.name), self.base / "home" / "up")
        self.assertIsNone(views.safe_path(self.base, "home", "up", "secret.txt"))

    def test_symlink_inside_base_is_allowed(self):
        os.symlink(self.base / "home" / "site.json", self.base / "home" / "alias.json")
        self.assertEqual(views.safe_path(self.base, "home", "alias.json"), (self.base / "home" / "site.json").resolve())

    def test_null_byte_is_refused(self):
        self.assertIsNone(views.safe_path(self.base, "home", "site.json\0.jpg"))


class IsPictureTest(unittest.TestCase):
    def test_pictures(self):
        for data in (JPEG, PNG, WEBP):
            self.assertTrue(views._is_picture(data))

    def test_not_pictures(self):
        for data in (b"", b"<svg xmlns=", b"GIF89a" + b"\0" * 10, b"RIFF\0\0\0\0WAVEfmt ", b"\xff\xd8", b"<html>", b"%PDF-1.7"):
            with self.subTest(data=data):
                self.assertFalse(views._is_picture(data))


class ReadLimitedTest(unittest.TestCase):
    def test_reads_every_chunk(self):
        data = os.urandom(3 * 1024 * 1024)
        stream = Stream(data)
        self.assertEqual(run(views.read_limited(stream, MAX_UPLOAD)), data)

    def test_stops_once_over_the_limit(self):
        stream = Stream(b"x" * (1024 * 1024))
        self.assertIsNone(run(views.read_limited(stream, 100 * 1024)))
        self.assertLess(stream.read_bytes, 1024 * 1024)

    def test_exact_limit_is_accepted(self):
        self.assertEqual(run(views.read_limited(Stream(b"x" * 1000, chunk=100), 1000)), b"x" * 1000)


class SitesViewTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "sites"
        (self.root / "home").mkdir(parents=True)
        self.config = self.root / "home" / "site.json"
        self.config.write_text('{"floorplans": []}\n')
        (Path(self.tmp.name) / "secret.txt").write_text("secret")
        self.hass = Hass()
        self.hass.config_entries = MagicMock()
        self.hass.config_entries.async_entries.return_value = []
        self.view = views.SitesView(self.hass, self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, filename, body, admin=True, site="home", **kw):
        return run(self.view.put(Request(body, admin=admin, **kw), site, filename))

    def get(self, filename, site="home"):
        return run(self.view.get(Request(), site, filename))

    # ---- reading

    def test_requires_login(self):
        self.assertTrue(views.SitesView.requires_auth)

    def test_get_file(self):
        res = self.get("site.json")
        self.assertEqual(res.status, 200)
        self.assertEqual(res.path, self.config.resolve())
        self.assertEqual(res.headers["X-Content-Type-Options"], "nosniff")

    def test_get_outside_is_not_found(self):
        self.assertEqual(self.get("../../secret.txt").status, 404)
        self.assertEqual(self.get("site.json", site="..").status, 404)
        self.assertEqual(self.get("missing.json").status, 404)

    # ---- site.json

    def test_admin_saves_config_and_keeps_backup(self):
        res = self.put("site.json", json.dumps({"floorplans": [{"id": "a"}]}).encode())
        self.assertEqual(res.status, 200, res.body)
        self.assertEqual(json.loads(self.config.read_text())["floorplans"][0]["id"], "a")
        self.assertEqual(json.loads((self.root / "home" / "site.json.1").read_text()), {"floorplans": []})

    def test_non_admin_cannot_save(self):
        res = self.put("site.json", b'{"floorplans": []}', admin=False)
        self.assertEqual(res.status, 403)
        self.assertEqual(self.config.read_text(), '{"floorplans": []}\n')

    def test_non_admin_cannot_upload(self):
        res = self.put("roof.jpg", JPEG, admin=False)
        self.assertEqual(res.status, 403)
        self.assertFalse((self.root / "home" / "roof.jpg").exists())

    def test_large_config_in_chunks(self):
        rooms = [{"id": f"r{i}", "name": "Room " * 20, "area": [[i, 0], [i + 1, 0], [i + 1, 1]]} for i in range(8000)]
        body = json.dumps({"floorplans": [{"id": "big", "rooms": rooms}]}).encode()
        self.assertGreater(len(body), 1024 * 1024)
        self.assertLess(len(body), MAX_SITE_JSON)
        res = self.put("site.json", body)
        self.assertEqual(res.status, 200, res.body)
        self.assertEqual(len(json.loads(self.config.read_text())["floorplans"][0]["rooms"]), 8000)

    def test_config_too_large(self):
        body = b'{"x": "' + b"a" * MAX_SITE_JSON + b'"}'
        self.assertEqual(self.put("site.json", body).status, 413)
        self.assertEqual(self.config.read_text(), '{"floorplans": []}\n')

    def test_config_must_be_json_object(self):
        for body in (b"not json", b"[1, 2]", b'{"floorplans": "x"}'):
            with self.subTest(body=body):
                self.assertEqual(self.put("site.json", body).status, 400)

    def test_malformed_config_is_refused_with_a_reason(self):
        good_room = {"id": "hall", "area": [[0, 0], [10, 0], [10, 10]]}
        cases = {
            "name should be text": {"name": 5},
            "warnings should be an object or false": {"warnings": "on"},
            "scenes[1] should be an object": {"scenes": [{"entity": "script.a"}, "script.b"]},
            "floorplans[0] should be an object": {"floorplans": ["house"]},
            "floorplans[0].id should be text": {"floorplans": [{"rooms": []}]},
            "floorplans[0].outline should be a list of at least three [x, y] number pairs":
                {"floorplans": [{"id": "a", "outline": [[0, 0], [1, 1]]}]},
            "floorplans[0].rooms[1].area should be a list of at least three [x, y] number pairs":
                {"floorplans": [{"id": "a", "rooms": [good_room, {"id": "b", "area": [[0, 0], [1, "2"], [3, 4]]}]}]},
            "floorplans[0].rooms[0].lights should be a list": {"floorplans": [{"id": "a", "rooms": [{"id": "b", "lights": "light.x"}]}]},
            "overview.size should be [width, height] in numbers": {"overview": {"size": [100, True]}},
            "overview.buildings[0].area should be a list of at least three [x, y] number pairs":
                {"overview": {"buildings": [{"id": "h", "area": [[0, 0, 1], [1, 0, 1], [1, 1, 1]]}]}},
            "all_lights should be an object": {"all_lights": True},
            "goodnight.minutes should be a number from 0 to 120": {"goodnight": {"minutes": 600}},
            "goodnight.then should be a script entity id": {"goodnight": {"then": "lock.front_door"}},
            "all_lights.exclude should be a list of entity ids": {"all_lights": {"exclude": "light.garden"}},
            "overview.solar.panels[0] should be a list of at least three [x, y] number pairs":
                {"overview": {"solar": {"panels": [[0, 0]]}}},
        }
        for reason, data in cases.items():
            with self.subTest(reason=reason):
                res = self.put("site.json", json.dumps(data).encode())
                self.assertEqual(res.status, 400)
                self.assertIn(reason, res.json()["message"])
                self.assertEqual(self.config.read_text(), '{"floorplans": []}\n')

    def test_examples_pass_validation(self):
        base = Path(__file__).resolve().parents[2]
        files = [*base.glob("sites/*/site.json"), *base.glob("custom_components/smarthomedash/example/*.json")]
        self.assertTrue(files)
        for path in files:
            with self.subTest(path=path.name):
                self.assertIsNone(views.validate_site(json.loads(path.read_text())))

    # ---- pictures

    def test_picture_in_chunks(self):
        data = JPEG + os.urandom(3 * 1024 * 1024)
        res = self.put("roof.jpg", data)
        self.assertEqual(res.status, 200, res.body)
        self.assertEqual((self.root / "home" / "roof.jpg").read_bytes(), data)

    def test_png_and_webp(self):
        self.assertEqual(self.put("plan.png", PNG).status, 200)
        self.assertEqual(self.put("plan.webp", WEBP).status, 200)

    def test_picture_must_be_a_picture(self):
        res = self.put("roof.jpg", b"<svg onload=alert(1)>")
        self.assertEqual(res.status, 400)
        self.assertFalse((self.root / "home" / "roof.jpg").exists())

    def test_picture_too_large_by_header(self):
        self.assertEqual(self.put("roof.jpg", JPEG, content_length=MAX_UPLOAD + 1).status, 413)

    def test_picture_too_large_by_body(self):
        """A missing or lying Content-Length is caught while reading."""
        res = self.put("roof.jpg", JPEG + b"\0" * MAX_UPLOAD, content_length=0)
        self.assertEqual(res.status, 413)
        self.assertFalse((self.root / "home" / "roof.jpg").exists())

    def test_only_config_and_pictures_can_be_written(self):
        for name in ("evil.html", "panel.js", "site.json.bak", "site.json.1", "x.svg", "sub/roof.jpg", ".hidden.jpg"):
            with self.subTest(name=name):
                self.assertIn(self.put(name, JPEG).status, (404, 405))
        self.assertEqual(sorted(p.name for p in (self.root / "home").iterdir()), ["site.json"])

    def test_writes_outside_are_refused(self):
        self.assertEqual(self.put("../../evil.jpg", JPEG).status, 404)
        self.assertEqual(self.put("roof.jpg", JPEG, site="../x").status, 404)
        self.assertFalse((Path(self.tmp.name) / "evil.jpg").exists())


class FrontendViewTest(unittest.TestCase):
    def test_public_and_contained(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "frontend"
            root.mkdir()
            (root / "panel.js").write_text("//")
            (Path(tmp) / "secret.txt").write_text("secret")
            view = views.FrontendView(Hass(), root)
            self.assertFalse(views.FrontendView.requires_auth)
            ok = run(view.get(Request(), "panel.js"))
            self.assertEqual(ok.status, 200)
            self.assertEqual(ok.headers["Cache-Control"], "no-cache")
            self.assertEqual(run(view.get(Request(), "../secret.txt")).status, 404)


class WriteAtomicTest(unittest.TestCase):
    def test_leaves_no_temp_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "a" / "site.json"
            views.write_atomic(path, b"1", True)
            views.write_atomic(path, b"2", True)
            self.assertEqual(path.read_bytes(), b"2")
            self.assertEqual(path.with_suffix(".json.1").read_bytes(), b"1")
            self.assertEqual(sorted(p.name for p in path.parent.iterdir()), ["site.json", "site.json.1"])

    def test_keeps_the_last_ten_versions(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "site.json"
            for i in range(15):
                views.write_atomic(path, str(i).encode(), True)
            self.assertEqual(path.read_bytes(), b"14")
            self.assertEqual([path.with_name(f"site.json.{n}").read_bytes() for n in range(1, 11)],
                             [str(i).encode() for i in range(13, 3, -1)])
            self.assertFalse(path.with_name("site.json.11").exists())

    def test_saving_the_same_file_adds_no_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "site.json"
            views.write_atomic(path, b"1", True)
            views.write_atomic(path, b"2", True)
            views.write_atomic(path, b"2", True)
            self.assertEqual(sorted(p.name for p in path.parent.iterdir()), ["site.json", "site.json.1"])


if __name__ == "__main__":
    unittest.main()
