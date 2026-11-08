"""SmartHomeDash: a picture-based dashboard as a Home Assistant sidebar panel.

Set up from the UI (Settings → Devices & services → Add integration →
SmartHomeDash): every entry is one dashboard with its own sidebar panel and site
folder. Pictures, floor plans and entities are then configured in the panel's
setup guide.

YAML is still supported, for example to keep a site in version control:

    smarthomedash:
      github_token: !secret smarthomedash_github_token   # optional: update from a private fork
      dashboards:
        - site: home             # folder under <config>/smarthomedash/sites/
          title: Home            # sidebar title
          icon: mdi:home-lightbulb
          url_path: home         # address: http://<ha>:8123/home

What it registers:

- /smarthomedash/frontend/...  the dashboard code. Public, like every frontend file
  in Home Assistant; it holds no data about any home.
- /api/smarthomedash/sites/<site>/<file>  the site's config and pictures, for
  logged-in users only; admins can save the config and upload pictures.
- One sidebar panel per dashboard, loading the code in an iframe and handing it the
  logged-in `hass` object, so no access token is needed.
- The `smarthomedash.update` action (admins), installing the latest version from
  GitHub; see updater.py. Installations through HACS update through HACS instead.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, panel_custom, persistent_notification
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.service import async_register_admin_service
from homeassistant.helpers.typing import ConfigType

from . import updater
from .const import (
    CONF_ICON,
    CONF_LAYOUT,
    CONF_REQUIRE_ADMIN,
    CONF_SITE,
    CONF_TITLE,
    CONF_URL_PATH,
    DEFAULT_ICON,
    DEFAULT_REPOSITORY,
    DOMAIN,
    FRONTEND_URL,
    LAYOUT_APARTMENT,
    PANEL_ELEMENT,
    SITE_ID,
    URL_PATH,
)
from .views import FrontendView, SitesView, write_atomic

_LOGGER = logging.getLogger(__name__)

DASHBOARD_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_SITE): vol.All(cv.string, vol.Match(SITE_ID)),
        vol.Optional(CONF_TITLE, default="SmartHomeDash"): cv.string,
        vol.Optional(CONF_ICON, default=DEFAULT_ICON): cv.icon,
        vol.Optional(CONF_URL_PATH): vol.All(cv.string, vol.Match(URL_PATH)),
        vol.Optional(CONF_REQUIRE_ADMIN, default=False): cv.boolean,
    }
)

CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.Schema(
            {
                vol.Optional("dashboards", default=[]): vol.All(cv.ensure_list, [DASHBOARD_SCHEMA]),
                vol.Optional("sites_dir"): cv.string,
                vol.Optional("github_token"): cv.string,
                vol.Optional("repository"): vol.Match(r"^[\w.-]+/[\w.-]+$"),
                vol.Optional("branch", default="main"): cv.string,
            }
        )
    },
    extra=vol.ALLOW_EXTRA,
)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the shared parts, and the dashboards listed in YAML."""
    conf = config.get(DOMAIN, {})
    data = await _async_setup_shared(hass, conf)
    for dash in conf.get("dashboards", []):
        data["yaml_sites"].add(dash[CONF_SITE])
        await _async_add_dashboard(hass, dash)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """One dashboard set up from the UI."""
    data = await _async_setup_shared(hass, {})
    dash = {**entry.data, **entry.options}
    await hass.async_add_executor_job(_create_starter_site, data["sites_dir"], dash, hass.config.language, hass.config.currency)
    await _async_add_dashboard(hass, dash)
    entry.async_on_unload(entry.add_update_listener(_async_reload_entry))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Remove the panel. The site folder is kept, so nothing set up is lost."""
    dash = {**entry.data, **entry.options}
    url_path = dash.get(CONF_URL_PATH) or dash[CONF_SITE]
    frontend.async_remove_panel(hass, url_path)
    hass.data[DOMAIN]["sites"].discard(dash[CONF_SITE])
    return True


async def _async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def _async_setup_shared(hass: HomeAssistant, conf: dict) -> dict:
    """Views and the update action, registered once whatever the setup path."""
    if DOMAIN in hass.data:
        if conf:
            hass.data[DOMAIN]["update"].update(_update_conf(conf))
            if (conf.get("github_token") or conf.get("repository")) and not hass.services.has_service(DOMAIN, "update"):
                _register_update_action(hass)
        return hass.data[DOMAIN]

    root = Path(__file__).parent
    sites_dir = Path(conf.get("sites_dir") or hass.config.path(DOMAIN, "sites"))
    manifest = await hass.async_add_executor_job(lambda: json.loads((root / "manifest.json").read_text()))
    data = hass.data[DOMAIN] = {
        "sites_dir": sites_dir,
        "version": manifest.get("version", "0"),
        "sites": set(),
        "yaml_sites": set(),
        "update": _update_conf(conf),
    }
    hass.http.register_view(FrontendView(hass, root / "frontend"))
    hass.http.register_view(SitesView(hass, sites_dir))
    # Installations through HACS update through HACS. The update action is only for
    # setups that point at a repository themselves (a private fork, a token).
    if conf.get("github_token") or conf.get("repository"):
        _register_update_action(hass)
    return data


def _update_conf(conf: dict) -> dict:
    return {
        "repository": conf.get("repository", DEFAULT_REPOSITORY),
        "branch": conf.get("branch", "main"),
        "token": conf.get("github_token"),
    }


async def _async_add_dashboard(hass: HomeAssistant, dash: dict) -> None:
    data = hass.data[DOMAIN]
    url_path = dash.get(CONF_URL_PATH) or dash[CONF_SITE]
    data["sites"].add(dash[CONF_SITE])
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=url_path,
        webcomponent_name=PANEL_ELEMENT,
        sidebar_title=dash.get(CONF_TITLE, "SmartHomeDash"),
        sidebar_icon=dash.get(CONF_ICON, DEFAULT_ICON),
        module_url=f"{FRONTEND_URL}/panel.js?v={data['version']}",
        embed_iframe=True,
        require_admin=dash.get(CONF_REQUIRE_ADMIN, False),
        config={"site": dash[CONF_SITE]},
    )


def _create_starter_site(sites_dir: Path, dash: dict, language: str, currency: str) -> None:
    """A new dashboard starts from the example house: its pictures, buildings, rooms,
    windows and solar panels, without any entities (those are the user's own).
    The setup guide opens on first visit to replace pictures or keep them."""
    folder = sites_dir / dash[CONF_SITE]
    path = folder / "site.json"
    if path.exists():
        return
    swedish = (language or "").lower().startswith("sv")
    apartment = dash.get(CONF_LAYOUT) == LAYOUT_APARTMENT
    example = Path(__file__).parent / "example"
    stem = "apartment" if apartment else "site"
    source = example / (f"{stem}.sv.json" if swedish else f"{stem}.json")
    if source.is_file():
        starter = json.loads(source.read_text(encoding="utf-8"))
        _strip_entities(starter)
        wanted = _pictures(starter)
        folder.mkdir(parents=True, exist_ok=True)
        for name in wanted:
            if (example / name).is_file():
                (folder / name).write_bytes((example / name).read_bytes())
    else:
        starter = {"floorplans": [], "energy": {}, "scenes": []}
    starter.update({
        "name": dash.get(CONF_TITLE, "SmartHomeDash"),
        "language": "sv" if swedish else "en",
        "locale": "sv-SE" if swedish else (language or "en-GB"),
        "currency": currency or "EUR",
        "setup_pending": True,
    })
    write_atomic(path, (json.dumps(starter, ensure_ascii=False, indent=2) + "\n").encode("utf-8"), False)
    _LOGGER.info("Created a starter config at %s", path)


def _pictures(site: dict) -> set[str]:
    """File names of every picture a site config refers to."""
    names = set()
    overview = site.get("overview") or {}
    names.update(n for n in (overview.get("image"), overview.get("night_image")) if n)
    for plan in site.get("floorplans", []):
        image = plan.get("image")
        if image:
            names.add(image if isinstance(image, str) else image.get("src"))
        names.update(r["photo"] for r in plan.get("rooms", []) if r.get("photo"))
    return {n for n in names if n}


def _strip_entities(site: dict) -> None:
    """Remove every entity link from the example, keeping the drawn geometry."""
    overview = site.get("overview") or {}
    overview["zones"] = []
    for plan in site.get("floorplans", []):
        for room in plan.get("rooms", []):
            room["lights"] = []
            room.pop("climate", None)
            room.pop("temperature", None)
    for key in ("climates", "weather", "mock"):
        site.pop(key, None)
    site["energy"] = {}
    site["scenes"] = []


def _register_update_action(hass: HomeAssistant) -> None:
    async def handle_update(call: ServiceCall) -> ServiceResponse:
        data = hass.data[DOMAIN]
        upd = data["update"]
        archive = await updater.async_download(hass, upd["repository"], upd["branch"], upd["token"])
        result = await hass.async_add_executor_job(
            updater.install,
            archive,
            Path(__file__).parent,
            data["sites_dir"],
            sorted(data["sites"]),
            call.data.get("overwrite_site", False),
        )
        _LOGGER.info("Updated to %s (restart required: %s)", result.commit, result.restart_required)
        swedish = (hass.config.language or "").lower().startswith("sv")
        if swedish:
            message = f"Installerade version {result.commit}. " + (
                "Starta om Home Assistant för att slutföra uppdateringen." if result.restart_required
                else "Ladda om dashboarden för att se den.")
            title = "SmartHomeDash uppdaterad"
        else:
            message = f"Installed version {result.commit}. " + (
                "Restart Home Assistant to finish the update." if result.restart_required
                else "Reload the dashboard to see it.")
            title = "SmartHomeDash updated"
        persistent_notification.async_create(hass, message, title=title, notification_id="smarthomedash_update")
        return {
            "commit": result.commit,
            "restart_required": result.restart_required,
            "added_site_files": result.added_site_files,
        }

    async_register_admin_service(
        hass,
        DOMAIN,
        "update",
        handle_update,
        schema=vol.Schema({vol.Optional("overwrite_site", default=False): cv.boolean}),
        supports_response=SupportsResponse.OPTIONAL,
    )
