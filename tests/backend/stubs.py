"""Stand-ins for `homeassistant`, `aiohttp` and `voluptuous`.

The integration only touches a small part of each. These stand-ins provide that
part, so the tests run with the Python standard library alone, in CI and on any
machine, without installing Home Assistant. Import this module before importing
the integration.
"""

from __future__ import annotations

import json
import sys
import types
from http import HTTPStatus
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _module(name: str, **attrs) -> types.ModuleType:
    mod = sys.modules.get(name) or types.ModuleType(name)
    for key, value in attrs.items():
        setattr(mod, key, value)
    sys.modules[name] = mod
    parent, _, child = name.rpartition(".")
    if parent:
        setattr(_module(parent), child, mod)
    return mod


class _Anything(types.ModuleType):
    """A module where every attribute is a MagicMock (voluptuous, config_validation)."""

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        value = MagicMock(name=f"{self.__name__}.{name}")
        setattr(self, name, value)
        return value


def _anything(name: str) -> types.ModuleType:
    mod = _Anything(name)
    sys.modules[name] = mod
    parent, _, child = name.rpartition(".")
    if parent:
        setattr(_module(parent), child, mod)
    return mod


# ---- aiohttp

class Response:
    def __init__(self, status: int = 200, body: bytes | str | None = None, headers: dict | None = None, text: str | None = None):
        self.status = int(status)
        self.body = body if body is not None else text
        self.headers = headers or {}

    def json(self):
        return json.loads(self.body)


class FileResponse(Response):
    def __init__(self, path, headers: dict | None = None):
        super().__init__(200, None, headers)
        self.path = Path(path)


class ClientError(Exception):
    pass


class ClientTimeout:
    def __init__(self, total=None):
        self.total = total


_module("aiohttp", ClientError=ClientError, ClientTimeout=ClientTimeout)
_module("aiohttp.web", Response=Response, FileResponse=FileResponse, StreamResponse=Response, Request=object)


# ---- homeassistant

class HomeAssistantError(Exception):
    pass


class HomeAssistantView:
    url: str = ""
    name: str = ""
    requires_auth = True

    def json(self, result, status_code: int = HTTPStatus.OK) -> Response:
        return Response(status_code, json.dumps(result))

    def json_message(self, message: str, status_code: int = HTTPStatus.OK) -> Response:
        return self.json({"message": message}, status_code)


def callback(func):
    return func


_module("homeassistant")
_module(
    "homeassistant.core",
    HomeAssistant=object,
    ServiceCall=object,
    ServiceResponse=dict,
    SupportsResponse=MagicMock(),
    callback=callback,
)
_module("homeassistant.exceptions", HomeAssistantError=HomeAssistantError)
_module("homeassistant.components")
_module("homeassistant.components.http", HomeAssistantView=HomeAssistantView)
_anything("homeassistant.components.frontend")
_anything("homeassistant.components.panel_custom")
_anything("homeassistant.components.persistent_notification")
_module("homeassistant.config_entries", ConfigEntry=object, ConfigFlow=object, OptionsFlow=object)
_module("homeassistant.const", EVENT_PANELS_UPDATED="panels_updated")
_module("homeassistant.helpers")
_anything("homeassistant.helpers.config_validation")
_anything("homeassistant.helpers.service")
_anything("homeassistant.helpers.aiohttp_client")
_module("homeassistant.helpers.typing", ConfigType=dict)
_anything("voluptuous")


# ---- helpers for the tests

class Stream:
    """A request or response body that arrives in chunks, like aiohttp's StreamReader."""

    def __init__(self, data: bytes, chunk: int = 64 * 1024):
        self.data = data
        self.chunk = chunk
        self.read_bytes = 0

    async def iter_chunked(self, n: int):
        step = min(n, self.chunk)
        for i in range(0, len(self.data), step):
            part = self.data[i:i + step]
            self.read_bytes += len(part)
            yield part


class User:
    def __init__(self, admin: bool):
        self.is_admin = admin


class Request(dict):
    """The parts of an aiohttp request the views read."""

    def __init__(self, body: bytes = b"", admin: bool = True, content_length: int | None = None, chunk: int = 64 * 1024):
        super().__init__()
        self["hass_user"] = User(admin)
        self.content = Stream(body, chunk)
        self.content_length = len(body) if content_length is None else content_length


class Hass:
    """Runs executor jobs inline; that is all the views ask of Home Assistant."""

    async def async_add_executor_job(self, func, *args):
        return func(*args)
