"""PlanView Dash: a picture-based dashboard as a Home Assistant sidebar panel.

Set up from the UI (Settings → Devices & services → Add integration →
PlanView Dash): every entry is one dashboard with its own sidebar panel and site
folder. Pictures, floor plans and entities are then configured in the panel's
setup guide.

YAML is still supported, for example to keep a site in version control:

    planview_dash:
      dashboards:
        - site: home             # folder under <config>/planview_dash/sites/
          title: Home            # sidebar title
          icon: mdi:home-lightbulb
          url_path: home         # address: http://<ha>:8123/home

What it registers:

- /planview_dash/frontend/...  the dashboard code. Public, like every frontend file
  in Home Assistant; it holds no data about any home.
- /api/planview_dash/sites/<site>/<file>  the site's config and pictures, for
  logged-in users only; admins can save the config and upload pictures.
- /api/planview_dash/backup/<site>/...  export as .zip, import a .zip, and the
  kept versions of site.json with restore (admins only).
- One sidebar panel per dashboard, loading the code in an iframe and handing it the
  logged-in `hass` object, so no access token is needed.
- A card for other dashboards (`custom:planview-dash-card`), added as a frontend module.
- The `planview_dash.goodnight` action (any logged-in user): turns the dashboard's
  lights off after a few minutes, and a timestamp sensor per dashboard that the
  screens follow; see goodnight.py and sensor.py.

Updates come from the Marketplace (HACS before Home Assistant 2026.11), like any
other integration: the integration never replaces its own files.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, panel_custom
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_PANELS_UPDATED
from homeassistant.core import HomeAssistant, callback
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.discovery import async_load_platform
from homeassistant.helpers.typing import ConfigType

from . import goodnight, migrate
from .const import (
    CONF_ICON,
    CONF_LAYOUT,
    CONF_REQUIRE_ADMIN,
    CONF_SITE,
    CONF_TITLE,
    CONF_URL_PATH,
    DEFAULT_ICON,
    DOMAIN,
    FRONTEND_URL,
    LAYOUT_APARTMENT,
    LOCALES,
    PANEL_ELEMENT,
    SITE_FORMAT,
    SITE_ID,
    URL_PATH,
)
from .views import BackupView, FrontendView, SitesView, migrate_site, site_format, write_atomic

_LOGGER = logging.getLogger(__name__)

# The goodnight sensor (sensor.py), one per dashboard.
PLATFORMS = ["sensor"]

DASHBOARD_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_SITE): vol.All(cv.string, vol.Match(SITE_ID)),
        vol.Optional(CONF_TITLE, default="PlanView Dash"): cv.string,
        vol.Optional(CONF_ICON, default=DEFAULT_ICON): cv.icon,
        vol.Optional(CONF_URL_PATH): vol.All(cv.string, vol.Match(URL_PATH)),
        vol.Optional(CONF_REQUIRE_ADMIN, default=False): cv.boolean,
    }
)

CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.All(
            # The options of the self-updater, removed in 0.8.35: a warning, not a failed setup.
            cv.removed("github_token", raise_if_present=False),
            cv.removed("repository", raise_if_present=False),
            cv.removed("branch", raise_if_present=False),
            vol.Schema(
                {
                    vol.Optional("dashboards", default=[]): vol.All(cv.ensure_list, [DASHBOARD_SCHEMA]),
                    vol.Optional("sites_dir"): cv.string,
                }
            ),
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
        hass.async_create_task(async_load_platform(
            hass, "sensor", DOMAIN, {CONF_SITE: dash[CONF_SITE], CONF_TITLE: dash.get(CONF_TITLE)}, config))
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """One dashboard set up from the UI."""
    data = await _async_setup_shared(hass, {})
    dash = {**entry.data, **entry.options}
    await hass.async_add_executor_job(_create_starter_site, data["sites_dir"], dash, hass.config.language, hass.config.currency)
    await _async_add_dashboard(hass, dash)
    data["entries"][entry.entry_id] = dash
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_entry_updated))
    migrate.schedule_take_over(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Remove the panel. The site folder is kept, so nothing set up is lost."""
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    dash = {**entry.data, **entry.options}
    url_path = dash.get(CONF_URL_PATH) or dash[CONF_SITE]
    frontend.async_remove_panel(hass, url_path)
    hass.data[DOMAIN]["sites"].discard(dash[CONF_SITE])
    hass.data[DOMAIN]["entries"].pop(entry.entry_id, None)
    goodnight.async_stop(hass, dash[CONF_SITE])
    return True


async def _async_entry_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Options saved. A new name is changed in place, in the sidebar and in the
    site's own config; anything else reloads the dashboard."""
    old = hass.data[DOMAIN]["entries"].get(entry.entry_id)
    new = {**entry.data, **entry.options}
    if old is not None and {**old, CONF_TITLE: None} == {**new, CONF_TITLE: None}:
        if old.get(CONF_TITLE) == new.get(CONF_TITLE):
            return
        url_path = new.get(CONF_URL_PATH) or new[CONF_SITE]
        if _set_sidebar_title(hass, url_path, new[CONF_TITLE]):
            hass.data[DOMAIN]["entries"][entry.entry_id] = new
            if entry.title != new[CONF_TITLE]:
                hass.config_entries.async_update_entry(entry, title=new[CONF_TITLE])
            await hass.async_add_executor_job(
                _set_site_name, hass.data[DOMAIN]["sites_dir"], new[CONF_SITE], new[CONF_TITLE])
            return
    await hass.config_entries.async_reload(entry.entry_id)


def _set_sidebar_title(hass: HomeAssistant, url_path: str, title: str) -> bool:
    """Rename a registered panel without removing it, so an open dashboard stays
    open. False if the panel is not there to rename."""
    panels = hass.data.get(frontend.DATA_PANELS, {})
    panel = panels.get(url_path)
    if panel is None:
        return False
    panel.sidebar_title = title
    hass.bus.async_fire(EVENT_PANELS_UPDATED)
    return True


def _set_site_name(sites_dir: Path, site: str, name: str) -> None:
    """Write a name chosen in the integration's options into the site config, so
    the dashboard's heading follows the sidebar."""
    path = sites_dir / site / "site.json"
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    if not isinstance(config, dict) or config.get("name") == name:
        return
    fmt = site_format(config)
    if fmt is None or fmt > SITE_FORMAT:
        # Saved by a newer PlanView Dash: never written over by this one.
        return
    config = migrate_site(config)
    config["name"] = name
    write_atomic(path, (json.dumps(config, ensure_ascii=False, indent=2) + "\n").encode("utf-8"), True)


@callback
def async_site_renamed(hass: HomeAssistant, site: str, name: str) -> None:
    """The setup guide saved a new name for a site: the dashboard set up from the
    UI for that site takes it as its sidebar title. Dashboards from YAML keep the
    title written there."""
    name = name.strip()
    if not name:
        return
    for entry in hass.config_entries.async_entries(DOMAIN):
        dash = {**entry.data, **entry.options}
        if dash.get(CONF_SITE) != site:
            continue
        if dash.get(CONF_TITLE) != name or entry.title != name:
            hass.config_entries.async_update_entry(
                entry, title=name, options={**entry.options, CONF_TITLE: name})


async def _async_setup_shared(hass: HomeAssistant, conf: dict) -> dict:
    """Views and the goodnight action, registered once whatever the setup path."""
    if DOMAIN in hass.data:
        return hass.data[DOMAIN]

    root = Path(__file__).parent
    if not conf.get("sites_dir"):
        # Sites kept under the integration's earlier name move along (migrate.py).
        await hass.async_add_executor_job(migrate.move_old_folder, hass.config.config_dir)
    # A relative sites_dir is under Home Assistant's config folder, wherever the process runs.
    sites_dir = Path(hass.config.path(conf.get("sites_dir") or Path(DOMAIN, "sites")))
    manifest = await hass.async_add_executor_job(lambda: json.loads((root / "manifest.json").read_text()))
    data = hass.data[DOMAIN] = {
        "sites_dir": sites_dir,
        "version": manifest.get("version", "0"),
        "sites": set(),
        "yaml_sites": set(),
        "entries": {},
    }
    hass.http.register_view(FrontendView(hass, root / "frontend"))
    hass.http.register_view(SitesView(hass, sites_dir))
    hass.http.register_view(BackupView(hass, sites_dir))
    # The card for other dashboards (frontend/card.js): loaded with every dashboard, so
    # `custom:planview-dash-card` is there without adding a resource by hand.
    frontend.add_extra_js_url(hass, f"{FRONTEND_URL}/card.js?v={data['version']}")
    # Goodnight (goodnight.py): the dashboard's countdown before everything turns off.
    goodnight.async_register(hass)
    # Dashboards still set up under the earlier name become dashboards of this one.
    migrate.schedule_take_over(hass)
    return data


async def _async_add_dashboard(hass: HomeAssistant, dash: dict) -> None:
    data = hass.data[DOMAIN]
    url_path = dash.get(CONF_URL_PATH) or dash[CONF_SITE]
    data["sites"].add(dash[CONF_SITE])
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=url_path,
        webcomponent_name=PANEL_ELEMENT,
        sidebar_title=dash.get(CONF_TITLE, "PlanView Dash"),
        sidebar_icon=dash.get(CONF_ICON, DEFAULT_ICON),
        module_url=f"{FRONTEND_URL}/panel.js?v={data['version']}",
        embed_iframe=True,
        require_admin=dash.get(CONF_REQUIRE_ADMIN, False),
        config={"site": dash[CONF_SITE]},
    )


def dashboard_language(language: str | None) -> str:
    """The dashboard language for Home Assistant's language ("de", "nb", "en-GB" …):
    the same one when the dashboard has it (frontend/js/i18n.js LANGUAGES), else English."""
    base = (language or "").lower().replace("_", "-").split("-")[0]
    base = "nb" if base in ("no", "nn") else base
    return base if base in LOCALES else "en"


def _create_starter_site(sites_dir: Path, dash: dict, language: str, currency: str) -> None:
    """A new dashboard starts from the example house: its pictures, buildings, rooms,
    windows and solar panels, without any entities (those are the user's own).
    The setup guide opens on first visit to replace pictures or keep them."""
    folder = sites_dir / dash[CONF_SITE]
    path = folder / "site.json"
    if path.exists():
        return
    code = dashboard_language(language)
    swedish = code == "sv"
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
        "name": dash.get(CONF_TITLE, "PlanView Dash"),
        "language": code,
        "locale": language if language and "-" in language else LOCALES[code],
        "currency": currency or "EUR",
        "setup_pending": True,
    })
    starter = migrate_site(starter)
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
    overview.pop("cameras", None)
    for plan in site.get("floorplans", []):
        plan.pop("cameras", None)
        for room in plan.get("rooms", []):
            room["lights"] = []
            room.pop("climate", None)
            room.pop("temperature", None)
            room.pop("sensors", None)
    for key in ("climates", "weather", "wall_screen", "mock"):
        site.pop(key, None)
    site["energy"] = {}
    site["scenes"] = []

