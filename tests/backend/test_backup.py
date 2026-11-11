"""Export, import and restore points (roadmap S3): admin only, zip traversal, oversize,
non-picture entries, and a round trip that reproduces the dashboard."""

from __future__ import annotations

import asyncio
import io
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import stubs  # noqa: F401  (installs the stand-ins first)
from stubs import Hass, Request

from custom_components.smarthomedash import views
from custom_components.smarthomedash.const import KEEP_VERSIONS, MAX_IMPORT, MAX_UPLOAD

JPEG = b"\xff\xd8\xff\xe0" + b"\0" * 16
PNG = b"\x89PNG\r\n\x1a\n" + b"\1" * 16
SITE = {"name": "Testhuset", "floorplans": [{"id": "ground", "image": "ground.png", "rooms": [{"id": "hall", "area": [[0, 0], [1, 0], [1, 1]]}]}],
        "overview": {"image": "pics/overview.jpg", "size": [100, 50]}}


def run(coro):
    return asyncio.run(coro)


def make_zip(entries: dict[str, bytes], compression=zipfile.ZIP_DEFLATED) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


class BackupViewTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "sites"
        self.home = self.root / "home"
        (self.home / "pics").mkdir(parents=True)
        (self.home / "site.json").write_text(json.dumps(SITE))
        (self.home / "ground.png").write_bytes(PNG)
        (self.home / "pics" / "overview.jpg").write_bytes(JPEG)
        (self.home / "notes.txt").write_text("not exported")
        (self.home / "fake.jpg").write_bytes(b"<html>not a picture")
        (Path(self.tmp.name) / "secret.jpg").write_bytes(JPEG)
        self.hass = Hass()
        self.view = views.BackupView(self.hass, self.root)
        self.renamed = patch("custom_components.smarthomedash.async_site_renamed").start()
        self.addCleanup(patch.stopall)

    def tearDown(self):
        self.tmp.cleanup()

    def get(self, action, admin=True, site="home"):
        return run(self.view.get(Request(admin=admin), site, action))

    def post(self, action, body=b"", admin=True, site="home", **kw):
        return run(self.view.post(Request(body, admin=admin, **kw), site, action))

    def import_zip(self, entries, site="home", **kw):
        return self.post("import", make_zip(entries), site=site, **kw)

    def files(self, folder):
        return sorted(p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file())

    # ---- access

    def test_requires_login_and_admin(self):
        self.assertTrue(views.BackupView.requires_auth)
        self.assertEqual(self.get("export", admin=False).status, 403)
        self.assertEqual(self.get("versions", admin=False).status, 403)
        self.assertEqual(self.import_zip({"site.json": b"{}"}, admin=False).status, 403)
        self.assertEqual(self.post("restore", b'{"version": 1}', admin=False).status, 403)
        self.assertEqual(json.loads((self.home / "site.json").read_text()), SITE)

    def test_bad_site_or_action_is_not_found(self):
        for site in ("..", "../x", "a/b", ""):
            with self.subTest(site=site):
                self.assertEqual(self.get("export", site=site).status, 404)
        self.assertEqual(self.get("site.json").status, 404)
        self.assertEqual(self.post("export").status, 404)

    # ---- export

    def test_export_holds_config_and_pictures_only(self):
        os.symlink(Path(self.tmp.name) / "secret.jpg", self.home / "link.jpg")
        res = self.get("export")
        self.assertEqual(res.status, 200)
        self.assertEqual(res.headers["Content-Type"], "application/zip")
        self.assertIn('attachment; filename="smarthomedash-home-', res.headers["Content-Disposition"])
        with zipfile.ZipFile(io.BytesIO(res.body)) as zf:
            self.assertEqual(sorted(zf.namelist()), ["ground.png", "pics/overview.jpg", "site.json"])
            self.assertEqual(json.loads(zf.read("site.json")), SITE)

    def test_export_leaves_out_versions(self):
        (self.home / "site.json.1").write_text("{}")
        with zipfile.ZipFile(io.BytesIO(self.get("export").body)) as zf:
            self.assertNotIn("site.json.1", zf.namelist())

    def test_export_without_config(self):
        (self.root / "empty").mkdir()
        self.assertEqual(self.get("export", site="empty").status, 404)

    # ---- round trip

    def test_round_trip_reproduces_the_dashboard(self):
        exported = self.get("export").body
        (self.root / "new").mkdir()
        res = self.post("import", exported, site="new")
        self.assertEqual(res.status, 200, res.body)
        self.assertEqual(res.json(), {"imported": True, "pictures": 2})
        new = self.root / "new"
        self.assertEqual(self.files(new), ["ground.png", "pics/overview.jpg", "site.json"])
        self.assertEqual(json.loads((new / "site.json").read_text()), SITE)
        self.assertEqual((new / "ground.png").read_bytes(), PNG)
        self.assertEqual((new / "pics" / "overview.jpg").read_bytes(), JPEG)
        self.renamed.assert_called_once_with(self.hass, "new", "Testhuset")
        # And exporting the copy gives the same files back.
        with zipfile.ZipFile(io.BytesIO(exported)) as a, zipfile.ZipFile(io.BytesIO(self.get("export", site="new").body)) as b:
            self.assertEqual(sorted(a.namelist()), sorted(b.namelist()))
            for n in a.namelist():
                read = json.loads if n == "site.json" else bytes
                self.assertEqual(read(a.read(n)), read(b.read(n)), n)

    def test_import_keeps_the_replaced_config_as_restore_point(self):
        other = {"name": "Annat", "floorplans": []}
        self.assertEqual(self.import_zip({"site.json": json.dumps(other).encode()}).status, 200)
        self.assertEqual(json.loads((self.home / "site.json").read_text()), other)
        self.assertEqual(json.loads((self.home / "site.json.1").read_text()), SITE)

    def test_zip_of_the_folder_itself(self):
        res = self.import_zip({"home/site.json": json.dumps(SITE).encode(), "home/extra.jpg": JPEG})
        self.assertEqual(res.status, 200, res.body)
        self.assertEqual((self.home / "extra.jpg").read_bytes(), JPEG)

    # ---- refused imports: nothing is written

    def assert_refused(self, body, status=400):
        before = {p: p.read_bytes() for p in self.home.rglob("*") if p.is_file()}
        res = self.post("import", body)
        self.assertEqual(res.status, status, res.body)
        self.assertEqual({p: p.read_bytes() for p in self.home.rglob("*") if p.is_file()}, before)
        self.assertFalse((Path(self.tmp.name) / "evil.jpg").exists())
        return res.json()["message"]

    def test_zip_traversal_is_refused(self):
        good = json.dumps(SITE).encode()
        for name in ("../evil.jpg", "../../evil.jpg", "/evil.jpg", "pics/../../evil.jpg", "..\\evil.jpg",
                     "./evil.jpg", "C:/evil.jpg", ".hidden.jpg", "a/b/c/d.jpg"):
            with self.subTest(name=name):
                self.assert_refused(make_zip({"site.json": good, name: JPEG}))

    def test_symlink_in_the_folder_does_not_lead_out(self):
        os.symlink(Path(self.tmp.name), self.home / "up")
        message = self.assert_refused(make_zip({"site.json": json.dumps(SITE).encode(), "up/evil.jpg": JPEG}))
        self.assertIn("outside", message)

    def test_non_picture_entries_are_refused(self):
        good = json.dumps(SITE).encode()
        for name, data in (("evil.html", b"<html>"), ("panel.js", b"//"), ("x.svg", b"<svg>"), ("fake.jpg", b"<script>"),
                           ("site.json.1", good), ("gif.png", b"GIF89a" + b"\0" * 10)):
            with self.subTest(name=name):
                self.assert_refused(make_zip({"site.json": good, name: data}))

    def test_bad_config_is_refused(self):
        self.assertIn("no site.json", self.assert_refused(make_zip({"roof.jpg": JPEG})))
        self.assertIn("not valid JSON", self.assert_refused(make_zip({"site.json": b"nope"})))
        self.assertIn("floorplans", self.assert_refused(make_zip({"site.json": b'{"floorplans": "x"}'})))

    def test_not_a_zip(self):
        self.assertIn("not a .zip", self.assert_refused(b"PK\3\4 but not really"))
        self.assertIn("not a .zip", self.assert_refused(JPEG))

    def test_duplicate_names_are_refused(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("site.json", json.dumps(SITE))
            with self.assertWarns(UserWarning):
                zf.writestr("site.json", b"{}")
        self.assert_refused(buf.getvalue())

    def test_oversize_body(self):
        self.assertEqual(self.post("import", b"x", content_length=MAX_IMPORT + 1).status, 413)
        self.assert_refused(b"x" * (MAX_IMPORT + 1), status=413)

    def test_oversize_entry_is_caught_while_unpacking(self):
        """A zip bomb: small packed, too large unpacked, whatever the header says."""
        body = make_zip({"site.json": json.dumps(SITE).encode(), "big.jpg": JPEG + b"\0" * MAX_UPLOAD})
        self.assertLess(len(body), 1024 * 1024)
        self.assertIn("too large", self.assert_refused(body))

    def test_oversize_total_unpacked(self):
        entries = {"site.json": json.dumps(SITE).encode()}
        each = MAX_UPLOAD - 100
        for i in range(MAX_IMPORT // each + 1):
            entries[f"p{i}.jpg"] = JPEG + bytes([i]) * (each - len(JPEG))
        self.assertIn("too large", self.assert_refused(make_zip(entries)))

    def test_too_many_files(self):
        entries = {"site.json": json.dumps(SITE).encode(), **{f"p{i}.jpg": JPEG for i in range(300)}}
        self.assertIn("too many", self.assert_refused(make_zip(entries)))

    def test_encrypted_entry_is_refused(self):
        body = bytearray(make_zip({"site.json": json.dumps(SITE).encode(), "roof.jpg": JPEG}, zipfile.ZIP_STORED))
        # Set the encryption flag on every entry, in local and central headers.
        for sig, off in ((b"PK\3\4", 6), (b"PK\1\2", 8)):
            i = body.find(sig)
            while i >= 0:
                body[i + off] |= 1
                i = body.find(sig, i + 4)
        self.assertIn("encrypted", self.assert_refused(bytes(body)))

    # ---- restore points

    def save(self, data):
        views.write_atomic(self.home / "site.json", json.dumps(data).encode(), True)

    def test_versions_are_listed_newest_first(self):
        for i in range(3):
            self.save({"name": f"v{i}", "floorplans": [{"id": "a", "rooms": [{"id": "r"}] * i}]})
        res = self.get("versions")
        self.assertEqual(res.status, 200)
        data = res.json()
        self.assertEqual(data["keep"], KEEP_VERSIONS)
        self.assertEqual([v["version"] for v in data["versions"]], [1, 2, 3])
        self.assertEqual([v["name"] for v in data["versions"]], ["v1", "v0", "Testhuset"])
        self.assertEqual(data["versions"][0]["rooms"], 1)
        self.assertIsInstance(data["versions"][0]["saved"], int)

    def test_restore_makes_the_version_current_and_keeps_the_current_one(self):
        self.save({"name": "Ny", "floorplans": []})
        res = self.post("restore", b'{"version": 1}')
        self.assertEqual(res.status, 200, res.body)
        self.assertEqual(json.loads((self.home / "site.json").read_text()), SITE)
        self.assertEqual(json.loads((self.home / "site.json.1").read_text())["name"], "Ny")
        self.renamed.assert_called_once_with(self.hass, "home", "Testhuset")

    def test_restore_refuses_bad_requests(self):
        for body in (b"", b"nope", b'{"version": 0}', b'{"version": 11}', b'{"version": "1"}', b'{"version": true}', b"[1]"):
            with self.subTest(body=body):
                self.assertEqual(self.post("restore", body).status, 400)
        self.assertEqual(self.post("restore", b'{"version": 5}').status, 400)  # does not exist
        (self.home / "site.json.2").write_text('{"floorplans": "broken"}')
        self.assertEqual(self.post("restore", b'{"version": 2}').status, 400)
        self.assertEqual(json.loads((self.home / "site.json").read_text()), SITE)


if __name__ == "__main__":
    unittest.main()
