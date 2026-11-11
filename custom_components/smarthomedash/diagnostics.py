"""Download diagnostics: Settings → Devices & services → SmartHomeDash → ⋮.

The file is meant to be attached to a public GitHub issue, so it holds counts and
sizes only: no entity ids, room or area names, pictures, addresses or tokens. The
dashboard's title, site folder and address are redacted from the entry too, since
they often name the home or the family.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import __version__ as HA_VERSION
from homeassistant.core import HomeAssistant

from .const import CONF_SITE, DOMAIN, KEEP_VERSIONS, MAX_SITE_JSON

TO_REDACT = {"title", "site", "url_path", "github_token", "token", "name"}
ENTITY = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")
PICTURE = re.compile(r"\.(jpg|jpeg|png|webp)$", re.IGNORECASE)


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: ConfigEntry) -> dict[str, Any]:
    data = hass.data.get(DOMAIN, {})
    dash = {**entry.data, **entry.options}
    sites_dir = data.get("sites_dir")
    site = await hass.async_add_executor_job(_site_summary, sites_dir, dash.get(CONF_SITE)) if sites_dir else {}
    known = site.pop("_entities", set())
    site["missing_entities"] = sum(1 for e in known if hass.states.get(e) is None)
    update = data.get("update", {})
    return {
        "smarthomedash": data.get("version"),
        "home_assistant": HA_VERSION,
        "language": hass.config.language,
        "entry": {
            "data": async_redact_data(dict(entry.data), TO_REDACT),
            "options": async_redact_data(dict(entry.options), TO_REDACT),
        },
        "dashboards": {
            "from_ui": len(data.get("entries", {})),
            "from_yaml": len(data.get("yaml_sites", ())),
        },
        "update_action": {
            "custom_repository": update.get("repository") not in (None, "rsundin/SmartHomeDash"),
            "token_set": bool(update.get("token")),
        },
        "site": site,
    }


def _site_summary(sites_dir: Path, site_id: str | None) -> dict[str, Any]:
    """Sizes and counts for one site folder. Never names or ids."""
    folder = Path(sites_dir) / site_id if site_id else None
    if folder is None or not folder.is_dir():
        return {"folder_exists": False}
    files = [p for p in folder.iterdir() if p.is_file()]
    pictures = [p for p in files if PICTURE.search(p.name)]
    out: dict[str, Any] = {
        "folder_exists": True,
        "pictures": len(pictures),
        "pictures_bytes": sum(p.stat().st_size for p in pictures),
        "backup": (folder / "site.json.1").is_file() or (folder / "site.json.bak").is_file(),
        "versions": sum((folder / f"site.json.{n}").is_file() for n in range(1, KEEP_VERSIONS + 1)),
    }
    path = folder / "site.json"
    if not path.is_file():
        out["site_json"] = "missing"
        return out
    size = path.stat().st_size
    out["site_json_bytes"] = size
    if size > MAX_SITE_JSON:
        out["site_json"] = "too large"
        return out
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        out["site_json"] = "not valid JSON"
        return out
    if not isinstance(config, dict):
        out["site_json"] = "not an object"
        return out
    out["site_json"] = "ok"
    out.update(_counts(config))
    out["_entities"] = set(_entity_ids(config))
    return out


def _list(value) -> list:
    return value if isinstance(value, list) else []


def _dict(value) -> dict:
    return value if isinstance(value, dict) else {}


def _counts(config: dict) -> dict[str, Any]:
    plans = [p for p in _list(config.get("floorplans")) if isinstance(p, dict)]
    rooms = [r for p in plans for r in _list(p.get("rooms")) if isinstance(r, dict)]
    overview = _dict(config.get("overview"))
    zones = [z for z in _list(overview.get("zones")) if isinstance(z, dict)]
    windows = [w for w in _list(overview.get("windows")) if isinstance(w, dict)]
    buildings = [b for b in _list(overview.get("buildings")) if isinstance(b, dict)]
    wall = _dict(config.get("wall_screen"))
    return {
        "language": config.get("language"),
        "setup_pending": bool(config.get("setup_pending")),
        "overview_picture": bool(overview.get("image")),
        "night_picture": bool(overview.get("night_image")),
        "buildings": len(buildings),
        "outdoor_zones": len(zones),
        "floorplans": len(plans),
        "floorplans_with_picture": sum(1 for p in plans if p.get("image")),
        "rooms": len(rooms),
        "rooms_linked_to_area": sum(1 for r in rooms if r.get("ha_area")),
        "lamps": sum(len(_list(r.get("lights"))) for r in rooms)
        + sum(len(_list(z.get("lights"))) for z in zones)
        + sum(len(_list(w.get("lights"))) for w in windows),
        "thermostats": sum(1 for r in rooms if r.get("climate")) + len(_list(config.get("climates"))),
        "temperature_sensors": sum(1 for r in rooms if r.get("temperature")),
        "sensors": sum(len(_list(r.get("sensors"))) for r in rooms) + sum(len(_list(b.get("sensors"))) for b in buildings),
        "scenes": len(_list(config.get("scenes"))),
        "energy_keys": len(_dict(config.get("energy"))),
        "doorbells": len(_list(wall.get("doorbell"))) if isinstance(wall.get("doorbell"), list) else int(bool(wall.get("doorbell"))),
        "lite": wall.get("lite"),
        "warnings_off": config.get("warnings") is False,
    }


def _entity_ids(value):
    """Every string in the config that looks like an entity id (not a picture name)."""
    if isinstance(value, str):
        if ENTITY.match(value) and not PICTURE.search(value):
            yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _entity_ids(v)
    elif isinstance(value, list):
        for v in value:
            yield from _entity_ids(v)
