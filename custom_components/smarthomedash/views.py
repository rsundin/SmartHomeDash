"""HTTP views: the dashboard code (public) and the site files (logged-in users)."""

from __future__ import annotations

import json
import logging
import os
import tempfile
from http import HTTPStatus
from pathlib import Path

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import FRONTEND_URL, MAX_SITE_JSON, MAX_UPLOAD, SITE_ID, SITES_URL, UPLOAD_NAME

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
    PUT  <site>/site.json    save the config (admins), previous kept as site.json.bak
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


def write_atomic(path: Path, data: bytes, backup: bool) -> None:
    """Write via a temp file; optionally keep the previous version as <name>.bak."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if backup and path.exists():
        path.with_suffix(path.suffix + ".bak").write_bytes(path.read_bytes())
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".upload-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
