"""HTTP views: the dashboard code (public) and the site files (logged-in users)."""

from __future__ import annotations

import io
import json
import logging
import os
import re
import tempfile
import time
import zipfile
from http import HTTPStatus
from pathlib import Path

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import (
    BACKUP_URL,
    FRONTEND_URL,
    KEEP_VERSIONS,
    MAX_IMPORT,
    MAX_IMPORT_FILES,
    MAX_SITE_JSON,
    MAX_UPLOAD,
    SITE_ID,
    SITES_URL,
    UPLOAD_NAME,
)

_LOGGER = logging.getLogger(__name__)

# Responses never let the browser guess a different file type.
_NOSNIFF = {"X-Content-Type-Options": "nosniff"}


def _is_picture(data: bytes) -> bool:
    """jpg, png or webp, judged by the file's own first bytes."""
    return (
        data.startswith(b"\xff\xd8\xff")
        or data.startswith(b"\x89PNG\r\n\x1a\n")
        or (data[:4] == b"RIFF" and data[8:12] == b"WEBP")
    )


async def read_limited(stream, limit: int) -> bytes | None:
    """The whole body of a request or response, or None if it is larger than limit.

    aiohttp's read(n) returns what has arrived so far, up to n bytes, so a large body
    has to be read chunk by chunk until the end."""
    data = bytearray()
    async for chunk in stream.iter_chunked(64 * 1024):
        data += chunk
        if len(data) > limit:
            return None
    return bytes(data)


_TOP_LEVEL = {
    "name": str, "language": str, "locale": str, "currency": str, "weather": str,
    "comfort": dict, "overview": dict, "energy": dict, "wall_screen": dict, "mock": dict,
    "floorplans": list, "climates": list, "scenes": list,
}


def _type_name(kind: type) -> str:
    return {str: "text", dict: "an object", list: "a list"}[kind]


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_point(value) -> bool:
    return isinstance(value, list) and len(value) == 2 and all(_is_number(v) for v in value)


def _polygon_problem(value, where: str) -> str | None:
    if not isinstance(value, list) or len(value) < 3 or not all(_is_point(p) for p in value):
        return f"{where} should be a list of at least three [x, y] number pairs"
    return None


def _list_of_objects(value, where: str) -> str | None:
    if not isinstance(value, list):
        return f"{where} should be a list"
    for i, item in enumerate(value):
        if not isinstance(item, dict):
            return f"{where}[{i}] should be an object"
    return None


def validate_site(data) -> str | None:
    """Return a readable reason why data is not a usable site.json, or None.

    Checks the shape the dashboard relies on: the types of the top-level keys,
    floor plans and rooms as objects, and outlines as polygons of number pairs.
    Keys it does not know are left alone, so newer configs still save.
    """
    if not isinstance(data, dict):
        return "the file should hold one JSON object"
    for key, kind in _TOP_LEVEL.items():
        if key in data and not isinstance(data[key], kind):
            return f"{key} should be {_type_name(kind)}"
    if "warnings" in data and not isinstance(data["warnings"], (bool, dict)):
        return "warnings should be an object or false"
    for key in ("climates", "scenes"):
        problem = _list_of_objects(data.get(key, []), key)
        if problem:
            return problem
    plans = data.get("floorplans", [])
    problem = _list_of_objects(plans, "floorplans")
    if problem:
        return problem
    for i, plan in enumerate(plans):
        where = f"floorplans[{i}]"
        if not isinstance(plan.get("id"), str) or not plan["id"]:
            return f"{where}.id should be text"
        if "outline" in plan:
            problem = _polygon_problem(plan["outline"], f"{where}.outline")
            if problem:
                return problem
        rooms = plan.get("rooms", [])
        problem = _list_of_objects(rooms, f"{where}.rooms")
        if problem:
            return problem
        for j, room in enumerate(rooms):
            here = f"{where}.rooms[{j}]"
            if "area" in room:
                problem = _polygon_problem(room["area"], f"{here}.area")
                if problem:
                    return problem
            if "lights" in room:
                problem = _list_of_objects(room["lights"], f"{here}.lights")
                if problem:
                    return problem
            if "sensors" in room and not isinstance(room["sensors"], list):
                return f"{here}.sensors should be a list"
    overview = data.get("overview", {})
    if "size" in overview and not _is_point(overview["size"]):
        return "overview.size should be [width, height] in numbers"
    for key in ("buildings", "zones", "windows"):
        items = overview.get(key, [])
        problem = _list_of_objects(items, f"overview.{key}")
        if problem:
            return problem
        if key == "zones":
            continue
        for i, item in enumerate(items):
            if "area" in item:
                problem = _polygon_problem(item["area"], f"overview.{key}[{i}].area")
                if problem:
                    return problem
    solar = overview.get("solar", {})
    if not isinstance(solar, dict):
        return "overview.solar should be an object"
    panels = solar.get("panels", [])
    if not isinstance(panels, list):
        return "overview.solar.panels should be a list"
    for i, panel in enumerate(panels):
        problem = _polygon_problem(panel, f"overview.solar.panels[{i}]")
        if problem:
            return problem
    return None


def safe_path(base: Path, *parts: str) -> Path | None:
    """Resolve parts under base, refusing anything that escapes it."""
    base = base.resolve()
    try:
        path = base.joinpath(*parts).resolve()
    except (OSError, ValueError):
        return None
    if path != base and base not in path.parents:
        return None
    return path


class FrontendView(HomeAssistantView):
    """Dashboard code. Revalidated on every load, so updates show at once."""

    url = FRONTEND_URL + "/{filename:.+}"
    name = "smarthomedash:frontend"
    requires_auth = False

    def __init__(self, hass: HomeAssistant, root: Path) -> None:
        self._hass = hass
        self._root = root

    async def get(self, request: web.Request, filename: str) -> web.StreamResponse:
        path = safe_path(self._root, filename)
        if path is None or not await self._hass.async_add_executor_job(path.is_file):
            return web.Response(status=HTTPStatus.NOT_FOUND)
        return web.FileResponse(path, headers={"Cache-Control": "no-cache", **_NOSNIFF})


class SitesView(HomeAssistantView):
    """Site config and pictures, for logged-in users only.

    GET  <site>/<file>       read a file
    PUT  <site>/site.json    save the config (admins); the last 10 versions are kept
                             as site.json.1 (newest) … site.json.10
    PUT  <site>/<name>.jpg   upload a picture (admins): jpg, png or webp
    """

    url = SITES_URL + "/{site}/{filename:.+}"
    name = "api:smarthomedash:sites"
    requires_auth = True

    def __init__(self, hass: HomeAssistant, root: Path) -> None:
        self._hass = hass
        self._root = root

    def _path(self, site: str, filename: str) -> Path | None:
        if not SITE_ID.match(site):
            return None
        return safe_path(self._root / site, filename)

    async def get(self, request: web.Request, site: str, filename: str) -> web.StreamResponse:
        path = self._path(site, filename)
        if path is None or not await self._hass.async_add_executor_job(path.is_file):
            return web.Response(status=HTTPStatus.NOT_FOUND)
        return web.FileResponse(path, headers={"Cache-Control": "no-store", **_NOSNIFF})

    async def put(self, request: web.Request, site: str, filename: str) -> web.Response:
        if not request["hass_user"].is_admin:
            return self.json_message("Only administrators can change the dashboard", HTTPStatus.FORBIDDEN)
        path = self._path(site, filename)
        if path is None:
            return web.Response(status=HTTPStatus.NOT_FOUND)
        if filename == "site.json":
            return await self._put_config(request, site, path)
        if UPLOAD_NAME.match(filename) and "/" not in filename:
            return await self._put_picture(request, site, path)
        return self.json_message("Only site.json and jpg, png or webp pictures can be saved", HTTPStatus.METHOD_NOT_ALLOWED)

    async def _put_config(self, request: web.Request, site: str, path: Path) -> web.Response:
        body = await read_limited(request.content, MAX_SITE_JSON)
        if body is None:
            return self.json_message("site.json is too large", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        try:
            data = json.loads(body)
        except ValueError:
            return self.json_message("Not valid JSON", HTTPStatus.BAD_REQUEST)
        problem = validate_site(data)
        if problem:
            return self.json_message(f"site.json was not saved: {problem}", HTTPStatus.BAD_REQUEST)
        text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        await self._hass.async_add_executor_job(write_atomic, path, text.encode("utf-8"), True)
        _LOGGER.info("Saved site.json for site %s", site)
        if isinstance(data.get("name"), str):
            # The sidebar title follows the name set in the setup guide.
            from . import async_site_renamed
            async_site_renamed(self._hass, site, data["name"])
        return self.json({"saved": True})

    async def _put_picture(self, request: web.Request, site: str, path: Path) -> web.Response:
        if request.content_length and request.content_length > MAX_UPLOAD:
            return self.json_message("The picture is too large (max 25 MB)", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        data = await read_limited(request.content, MAX_UPLOAD)
        if data is None:
            return self.json_message("The picture is too large (max 25 MB)", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        if not _is_picture(data):
            return self.json_message("Not a jpg, png or webp picture", HTTPStatus.BAD_REQUEST)
        await self._hass.async_add_executor_job(write_atomic, path, data, False)
        _LOGGER.info("Saved picture %s for site %s", path.name, site)
        return self.json({"saved": True, "file": path.name})


def _version(path: Path, n: int) -> Path:
    return path.with_name(f"{path.name}.{n}")


def rotate_versions(path: Path, keep: int = KEEP_VERSIONS) -> None:
    """Keep the current file as <name>.1, shifting older versions up to <name>.<keep>."""
    if not path.exists():
        return
    current = path.read_bytes()
    newest = _version(path, 1)
    if newest.exists() and newest.read_bytes() == current:
        return
    for i in range(keep, 1, -1):
        older = _version(path, i - 1)
        if older.exists():
            os.replace(older, _version(path, i))
    newest.write_bytes(current)


def write_atomic(path: Path, data: bytes, backup: bool) -> None:
    """Write via a temp file; optionally keep the previous version (rotate_versions)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if backup and path.exists() and path.read_bytes() != data:
        rotate_versions(path)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".upload-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


# ---------- export, import and restore points

_SEGMENT = re.compile(r"^[a-z0-9][a-z0-9_.-]*$", re.IGNORECASE)
_MAX_DEPTH = 3


class BackupProblem(Exception):
    """A readable reason why an import or a restore was refused."""


def _picture_name(rel: str) -> bool:
    """A relative picture path a dashboard may hold: plain names, at most three deep."""
    parts = rel.split("/")
    return (
        0 < len(parts) <= _MAX_DEPTH
        and all(_SEGMENT.match(p) for p in parts)
        and bool(UPLOAD_NAME.match(parts[-1]))
    )


def _site_files(folder: Path) -> list[Path]:
    """Files in the site folder, at most three levels deep, not following symlinked folders."""
    out = []
    for top, dirs, files in os.walk(folder, followlinks=False):
        depth = len(Path(top).relative_to(folder).parts)
        if depth >= _MAX_DEPTH - 1:
            dirs[:] = []
        dirs.sort()
        out.extend(Path(top) / f for f in sorted(files))
    return out


def export_site(folder: Path) -> bytes:
    """site.json and the pictures of one site folder, as a .zip (nothing else)."""
    config = safe_path(folder, "site.json")
    if config is None or not config.is_file():
        raise BackupProblem("this dashboard has no site.json yet")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(zipfile.ZipInfo("site.json", time.localtime()[:6]), config.read_bytes(), zipfile.ZIP_DEFLATED)
        base = folder.resolve()
        for path in _site_files(folder):
            rel = path.relative_to(folder).as_posix()
            if not _picture_name(rel) or safe_path(base, rel) is None or not path.is_file():
                continue
            data = path.read_bytes()
            if len(data) <= MAX_UPLOAD and _is_picture(data):
                # Pictures are compressed already.
                zf.writestr(zipfile.ZipInfo(rel, time.localtime(path.stat().st_mtime)[:6]), data, zipfile.ZIP_STORED)
    return buf.getvalue()


def read_import(data: bytes) -> tuple[dict, dict[str, bytes]]:
    """Check a .zip from export_site; return (site config, {relative path: picture}).

    Refuses anything that is not site.json or a jpg, png or webp picture by content,
    names that could leave the site folder, encrypted entries, and anything larger
    than the limits once unpacked (read with bounds, not trusting the headers)."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, ValueError):
        raise BackupProblem("not a .zip file") from None
    with zf:
        entries = [i for i in zf.infolist() if not i.is_dir()]
        if len(entries) > MAX_IMPORT_FILES:
            raise BackupProblem(f"too many files (at most {MAX_IMPORT_FILES})")
        names = [i.filename for i in entries]
        # A zip of the folder itself has the files one level down: take that level away.
        prefix = ""
        if "site.json" not in names:
            tops = {n.split("/", 1)[0] for n in names}
            if len(tops) == 1 and f"{next(iter(tops))}/site.json" in names:
                prefix = next(iter(tops)) + "/"
        if f"{prefix}site.json" not in names:
            raise BackupProblem("there is no site.json in the .zip")
        if len(set(names)) != len(names):
            raise BackupProblem("the .zip holds the same name twice")
        config = None
        pictures: dict[str, bytes] = {}
        total = 0
        for info in entries:
            rel = info.filename[len(prefix):] if info.filename.startswith(prefix) else info.filename
            if not info.filename.startswith(prefix) or (rel != "site.json" and not _picture_name(rel)):
                raise BackupProblem(f"{info.filename} is not site.json or a jpg, png or webp picture")
            if info.flag_bits & 0x1:
                raise BackupProblem(f"{info.filename} is encrypted")
            limit = MAX_SITE_JSON if rel == "site.json" else MAX_UPLOAD
            try:
                with zf.open(info) as f:
                    body = f.read(limit + 1)
            except (zipfile.BadZipFile, NotImplementedError, RuntimeError, OSError, EOFError, ValueError):
                raise BackupProblem(f"{info.filename} could not be read") from None
            if len(body) > limit:
                raise BackupProblem(f"{info.filename} is too large")
            total += len(body)
            if total > MAX_IMPORT:
                raise BackupProblem("the dashboard is too large once unpacked")
            if rel == "site.json":
                try:
                    config = json.loads(body)
                except ValueError:
                    raise BackupProblem("site.json is not valid JSON") from None
                problem = validate_site(config)
                if problem:
                    raise BackupProblem(f"site.json: {problem}")
            elif _is_picture(body):
                pictures[rel] = body
            else:
                raise BackupProblem(f"{info.filename} is not a jpg, png or webp picture")
    return config, pictures


def write_import(folder: Path, config: dict, pictures: dict[str, bytes]) -> None:
    """Pictures first, then site.json; the replaced site.json becomes a restore point."""
    paths = {rel: safe_path(folder, rel) for rel in pictures}
    for rel, path in paths.items():
        if path is None:
            raise BackupProblem(f"{rel} would end up outside the dashboard's folder")
    for rel, body in pictures.items():
        write_atomic(paths[rel], body, False)
    text = json.dumps(config, ensure_ascii=False, indent=2) + "\n"
    write_atomic(folder / "site.json", text.encode("utf-8"), True)


def list_versions(folder: Path) -> list[dict]:
    """The kept versions of site.json, newest first, with what helps to tell them apart."""
    out = []
    config = folder / "site.json"
    for n in range(1, KEEP_VERSIONS + 1):
        path = _version(config, n)
        if not path.is_file():
            continue
        item = {"version": n, "saved": int(path.stat().st_mtime * 1000), "bytes": path.stat().st_size}
        try:
            data = json.loads(path.read_bytes())
        except ValueError:
            data = None
        if isinstance(data, dict):
            plans = data.get("floorplans") if isinstance(data.get("floorplans"), list) else []
            item["name"] = data.get("name") if isinstance(data.get("name"), str) else None
            item["floorplans"] = len(plans)
            item["rooms"] = sum(len(p.get("rooms") or []) for p in plans if isinstance(p, dict) and isinstance(p.get("rooms"), list))
        else:
            item["broken"] = True
        out.append(item)
    return out


def restore_version(folder: Path, n: int) -> dict:
    """Make version n the current site.json; the current one becomes version 1."""
    config = folder / "site.json"
    path = _version(config, n)
    if not path.is_file():
        raise BackupProblem("that version no longer exists")
    try:
        data = json.loads(path.read_bytes())
    except ValueError:
        raise BackupProblem("that version is not valid JSON") from None
    problem = validate_site(data)
    if problem:
        raise BackupProblem(f"that version cannot be used: {problem}")
    write_atomic(config, path.read_bytes(), True)
    return data


class BackupView(HomeAssistantView):
    """Export, import and restore points of one site, for administrators only.

    GET  <site>/export     the site as a .zip (site.json and pictures)
    POST <site>/import     replace site.json and add the pictures from a .zip
    GET  <site>/versions   the kept versions of site.json
    POST <site>/restore    {"version": n}: make that version the current one
    """

    url = BACKUP_URL + "/{site}/{action}"
    name = "api:smarthomedash:backup"
    requires_auth = True

    def __init__(self, hass: HomeAssistant, root: Path) -> None:
        self._hass = hass
        self._root = root

    def _folder(self, request: web.Request, site: str) -> tuple[Path | None, web.Response | None]:
        if not request["hass_user"].is_admin:
            return None, self.json_message("Only administrators can export, import or restore", HTTPStatus.FORBIDDEN)
        folder = safe_path(self._root, site) if SITE_ID.match(site) else None
        if folder is None or folder == self._root.resolve():
            return None, web.Response(status=HTTPStatus.NOT_FOUND)
        return folder, None

    async def get(self, request: web.Request, site: str, action: str) -> web.StreamResponse:
        folder, refused = self._folder(request, site)
        if refused is not None:  # an aiohttp response can be falsy (it is a mapping)
            return refused
        if action == "versions":
            versions = await self._hass.async_add_executor_job(list_versions, folder)
            return self.json({"versions": versions, "keep": KEEP_VERSIONS})
        if action != "export":
            return web.Response(status=HTTPStatus.NOT_FOUND)
        try:
            body = await self._hass.async_add_executor_job(export_site, folder)
        except BackupProblem as e:
            return self.json_message(str(e), HTTPStatus.NOT_FOUND)
        name = f"smarthomedash-{site}-{time.strftime('%Y-%m-%d')}.zip"
        return web.Response(body=body, headers={
            "Content-Type": "application/zip",
            "Content-Disposition": f'attachment; filename="{name}"',
            "Cache-Control": "no-store",
            **_NOSNIFF,
        })

    async def post(self, request: web.Request, site: str, action: str) -> web.Response:
        folder, refused = self._folder(request, site)
        if refused is not None:  # an aiohttp response can be falsy (it is a mapping)
            return refused
        if action == "import":
            return await self._import(request, site, folder)
        if action == "restore":
            return await self._restore(request, site, folder)
        return web.Response(status=HTTPStatus.NOT_FOUND)

    async def _import(self, request: web.Request, site: str, folder: Path) -> web.Response:
        too_large = f"The .zip is too large (max {MAX_IMPORT // (1024 * 1024)} MB)"
        if request.content_length and request.content_length > MAX_IMPORT:
            return self.json_message(too_large, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        data = await read_limited(request.content, MAX_IMPORT)
        if data is None:
            return self.json_message(too_large, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        try:
            config, pictures = await self._hass.async_add_executor_job(read_import, data)
            await self._hass.async_add_executor_job(write_import, folder, config, pictures)
        except BackupProblem as e:
            return self.json_message(f"Nothing was imported: {e}", HTTPStatus.BAD_REQUEST)
        _LOGGER.info("Imported site.json and %d pictures into site %s", len(pictures), site)
        self._renamed(site, config)
        return self.json({"imported": True, "pictures": len(pictures)})

    async def _restore(self, request: web.Request, site: str, folder: Path) -> web.Response:
        body = await read_limited(request.content, 1024)
        try:
            n = json.loads(body or b"null")["version"]
        except (ValueError, TypeError, KeyError):
            n = None
        if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= KEEP_VERSIONS:
            return self.json_message(f"version should be a number from 1 to {KEEP_VERSIONS}", HTTPStatus.BAD_REQUEST)
        try:
            config = await self._hass.async_add_executor_job(restore_version, folder, n)
        except BackupProblem as e:
            return self.json_message(f"Nothing was restored: {e}", HTTPStatus.BAD_REQUEST)
        _LOGGER.info("Restored version %d of site.json for site %s", n, site)
        self._renamed(site, config)
        return self.json({"restored": n})

    def _renamed(self, site: str, config: dict) -> None:
        if isinstance(config.get("name"), str):
            from . import async_site_renamed
            async_site_renamed(self._hass, site, config["name"])
