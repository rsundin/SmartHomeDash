"""PlanView Dash under a real Home Assistant: setup, panels, flows, views, diagnostics."""

from __future__ import annotations

import json
from http import HTTPStatus

from homeassistant.components import frontend
from homeassistant.config_entries import SOURCE_USER, ConfigEntryState
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component

from pytest_homeassistant_custom_component.common import MockConfigEntry

DOMAIN = "planview_dash"
SITES = "/api/planview_dash/sites"
BACKUP = "/api/planview_dash/backup"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def panels(hass: HomeAssistant) -> dict:
    return hass.data[frontend.DATA_PANELS]


# --- Setup -----------------------------------------------------------------------------

async def test_setup_from_yaml(hass: HomeAssistant, sites_in_tmp) -> None:
    """Dashboards listed in configuration.yaml get a panel each and a goodnight sensor;
    no starter site is written for them, and there is no update action."""
    config = {DOMAIN: {"dashboards": [
        {"site": "home", "title": "Home", "url_path": "my-home"},
        {"site": "cabin", "title": "Cabin", "icon": "mdi:pine-tree", "require_admin": True},
    ]}}
    assert await async_setup_component(hass, DOMAIN, config)
    await hass.async_block_till_done()

    home = panels(hass)["my-home"]
    assert home.sidebar_title == "Home"
    assert home.component_name == "custom"
    assert home.config["_panel_custom"]["name"] == "planview-dash-panel"
    assert home.config["_panel_custom"]["embed_iframe"] is True
    assert home.config["_panel_custom"]["module_url"].startswith("/planview_dash/frontend/panel.js?v=")
    assert home.config["site"] == "home"
    assert home.require_admin is False

    cabin = panels(hass)["cabin"]  # no url_path: the site id is the address
    assert cabin.sidebar_icon == "mdi:pine-tree"
    assert cabin.require_admin is True

    assert not sites_in_tmp.exists()
    assert not hass.services.has_service(DOMAIN, "update")
    assert hass.states.get("sensor.home_goodnight").state == STATE_UNKNOWN
    assert hass.states.get("sensor.cabin_goodnight").state == STATE_UNKNOWN


async def test_sites_dir_is_read_from_the_config_folder(hass: HomeAssistant, sites_in_tmp) -> None:
    """A relative sites_dir is under the config folder, not wherever Home Assistant runs from."""
    own = sites_in_tmp.parent.parent / "dashboards" / "mine"
    own.mkdir(parents=True)
    (own / "site.json").write_text(json.dumps({"name": "Mine", "floorplans": []}), encoding="utf-8")
    # Not "home": newer Home Assistant versions have a panel of their own at /home.
    config = {DOMAIN: {"sites_dir": "dashboards", "dashboards": [{"site": "mine"}]}}
    assert await async_setup_component(hass, DOMAIN, config)
    await hass.async_block_till_done()
    assert hass.data[DOMAIN]["sites_dir"] == own.parent


async def test_the_card_is_loaded_with_every_dashboard(hass: HomeAssistant, entry, hass_client_no_auth) -> None:
    """`custom:planview-dash-card` needs no resource added by hand: its module is among the
    frontend's extra modules, once however many dashboards are set up, and is served."""
    second = MockConfigEntry(domain=DOMAIN, title="Second", unique_id="second", data={
        "site": "second", "title": "Second", "url_path": "second", "layout": "apartment"})
    second.add_to_hass(hass)
    assert await hass.config_entries.async_setup(second.entry_id)
    await hass.async_block_till_done()

    urls = [u for u in hass.data[frontend.DATA_EXTRA_MODULE_URL].urls if "planview_dash" in u]
    assert len(urls) == 1
    assert urls[0].startswith("/planview_dash/frontend/card.js?v=")

    client = await hass_client_no_auth()
    for name in ("card.js", "card.html", "card-frame.js"):
        assert (await client.get(f"/planview_dash/frontend/{name}")).status == HTTPStatus.OK
    assert "text/html" in (await client.get("/planview_dash/frontend/card.html")).headers["Content-Type"]


async def test_the_old_update_options_are_ignored(hass: HomeAssistant, caplog) -> None:
    """The self-updater is gone (installs are managed by the Marketplace or HACS); its
    options in configuration.yaml still set up, with a warning."""
    config = {DOMAIN: {"github_token": "x", "repository": "someone/fork", "branch": "dev",
                       "dashboards": [{"site": "attic"}]}}
    assert await async_setup_component(hass, DOMAIN, config)
    await hass.async_block_till_done()
    assert "attic" in panels(hass)
    assert not hass.services.has_service(DOMAIN, "update")
    assert "github_token" in caplog.text


async def test_setup_from_config_entry_creates_the_starter_site(hass: HomeAssistant, entry, sites_in_tmp) -> None:
    assert entry.state is ConfigEntryState.LOADED
    panel = panels(hass)["test-home"]
    assert panel.sidebar_title == "Test Home"
    assert panel.config["site"] == "test_home"

    folder = sites_in_tmp / "test_home"
    site = json.loads((folder / "site.json").read_text(encoding="utf-8"))
    assert site["name"] == "Test Home"
    assert site["setup_pending"] is True
    assert site["floorplans"], "the starter keeps the example's drawn plans"
    # The example's entities are the example's own: none are copied.
    assert site["energy"] == {} and site["scenes"] == []
    assert all(room["lights"] == [] for plan in site["floorplans"] for room in plan["rooms"])
    # Every picture the starter refers to was copied next to it.
    for name in (site["overview"]["image"], site["overview"]["night_image"]):
        assert (folder / name).is_file()


async def test_apartment_starter_in_swedish(hass: HomeAssistant, sites_in_tmp) -> None:
    hass.config.language = "sv"
    hass.config.currency = "SEK"
    entry = MockConfigEntry(domain=DOMAIN, title="Lgh", unique_id="lgh", data={
        "site": "lgh", "title": "Lgh", "url_path": "lgh", "layout": "apartment"})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    site = json.loads((sites_in_tmp / "lgh" / "site.json").read_text(encoding="utf-8"))
    assert site["language"] == "sv" and site["currency"] == "SEK"
    assert not (site.get("overview") or {}).get("image"), "an apartment starts with floor plans only"


async def test_existing_site_is_not_overwritten(hass: HomeAssistant, sites_in_tmp) -> None:
    folder = sites_in_tmp / "kept"
    folder.mkdir(parents=True)
    (folder / "site.json").write_text('{"name": "Mine", "floorplans": []}', encoding="utf-8")
    entry = MockConfigEntry(domain=DOMAIN, title="Kept", unique_id="kept", data={
        "site": "kept", "title": "Kept", "url_path": "kept", "layout": "house"})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert json.loads((folder / "site.json").read_text(encoding="utf-8"))["name"] == "Mine"


# --- Config flow and options -----------------------------------------------------------

async def test_config_flow_creates_a_dashboard(hass: HomeAssistant, sites_in_tmp) -> None:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "user"

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"title": "Summer House", "layout": "house", "icon": "mdi:home", "require_admin": False})
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Summer House"
    assert result["data"]["site"] == "summer_house"
    assert result["data"]["url_path"] == "summer-house"

    assert panels(hass)["summer-house"].sidebar_title == "Summer House"
    assert (sites_in_tmp / "summer_house" / "site.json").is_file()


def old_entry(hass: HomeAssistant, site: str, name: str, options: dict | None = None) -> MockConfigEntry:
    """A dashboard set up under the integration's earlier name (migrate.py)."""
    entry = MockConfigEntry(domain="smarthomedash", title=name, unique_id=site, data={
        "site": site, "title": name, "icon": "mdi:home", "url_path": site.replace("_", "-"),
        "require_admin": False, "layout": "apartment"}, options=options or {})
    entry.add_to_hass(hass)
    return entry


async def test_dashboards_under_the_earlier_name_move_over(hass: HomeAssistant, sites_in_tmp) -> None:
    """Adding the integration offers to take over the old dashboards; all of them move,
    options included, the old entries go and the old site folder is renamed."""
    old_site = sites_in_tmp.parent.parent / "smarthomedash" / "sites" / "villa"
    old_site.mkdir(parents=True)
    (old_site / "site.json").write_text(json.dumps({"name": "Villa", "layout": "apartment"}))
    old_entry(hass, "villa", "Villa")
    old_entry(hass, "cabin", "Cabin", {"title": "Our cabin", "require_admin": True})
    assert await async_setup_component(hass, "http", {})

    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "take_over"
    assert result["description_placeholders"] == {"dashboards": "Villa, Cabin"}
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY and result["data"]["site"] == "villa"
    await hass.async_block_till_done()

    assert hass.config_entries.async_entries("smarthomedash") == []
    new = {e.data["site"]: e for e in hass.config_entries.async_entries(DOMAIN)}
    assert set(new) == {"villa", "cabin"}
    assert new["cabin"].title == "Our cabin" and new["cabin"].data["require_admin"] is True
    assert all(e.state is ConfigEntryState.LOADED for e in new.values())
    assert panels(hass)["villa"].sidebar_title == "Villa"
    assert panels(hass)["cabin"].require_admin is True
    assert json.loads((sites_in_tmp / "villa" / "site.json").read_text())["name"] == "Villa"
    assert not old_site.exists()

    # Afterwards the flow is the usual one again.
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["step_id"] == "user"


async def test_config_flow_refuses_bad_and_taken_addresses(hass: HomeAssistant, entry) -> None:
    async def submit(data: dict) -> dict:
        result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
        return await hass.config_entries.flow.async_configure(result["flow_id"], {"layout": "house", **data})

    bad = await submit({"title": "Other", "url_path": "Not OK/.."})
    assert bad["type"] is FlowResultType.FORM and bad["errors"] == {"url_path": "invalid_url_path"}

    taken = await submit({"title": "Other", "url_path": "test-home"})
    assert taken["errors"] == {"url_path": "url_path_taken"}

    same = await submit({"title": "Test Home", "url_path": "elsewhere"})
    assert same["type"] is FlowResultType.ABORT and same["reason"] == "already_configured"


async def test_config_flow_refuses_a_site_from_yaml(hass: HomeAssistant) -> None:
    assert await async_setup_component(hass, DOMAIN, {DOMAIN: {"dashboards": [{"site": "cabin", "url_path": "yaml-cabin"}]}})
    await hass.async_block_till_done()
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"title": "Cabin", "layout": "house"})
    assert result["errors"] == {"title": "site_in_yaml"}


async def test_default_name_does_not_collide_with_home_assistants_own_panels(hass: HomeAssistant) -> None:
    """Home Assistant has a panel at /home (and /light, /climate, /security). The form's
    default name is "Home": without an address typed, a free one is chosen."""
    assert await async_setup_component(hass, "frontend", {})
    await hass.async_block_till_done()
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    default_title = result["data_schema"]({"layout": "house"})["title"]
    path = default_title.lower()
    if path not in panels(hass):  # an older Home Assistant without that panel
        path = "light"
        hass.data[frontend.DATA_PANELS].setdefault(path, object())
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"title": path.title(), "layout": "house"})
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["site"] == path
    assert result["data"]["url_path"] == f"{path}-dash"
    assert panels(hass)[f"{path}-dash"].sidebar_title == path.title()

    # An address typed by the user is never changed: it is refused if taken.
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"title": "Second", "layout": "house", "url_path": "config"})
    assert result["errors"] == {"url_path": "url_path_taken"}


async def test_options_rename_the_sidebar_entry_in_place(hass: HomeAssistant, entry, sites_in_tmp) -> None:
    """A new name changes the registered panel (not a new one), the entry's title and
    the name in site.json."""
    before = panels(hass)["test-home"]
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "init"

    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"title": "Renamed", "icon": "mdi:home-lightbulb", "require_admin": False})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()

    assert panels(hass)["test-home"] is before, "renamed in place, so an open dashboard stays open"
    assert before.sidebar_title == "Renamed"
    assert entry.title == "Renamed"
    assert entry.state is ConfigEntryState.LOADED
    site = json.loads((sites_in_tmp / "test_home" / "site.json").read_text(encoding="utf-8"))
    assert site["name"] == "Renamed"


async def test_other_options_reload_the_dashboard(hass: HomeAssistant, entry) -> None:
    result = await hass.config_entries.options.async_init(entry.entry_id)
    await hass.config_entries.options.async_configure(
        result["flow_id"], {"title": "Test Home", "icon": "mdi:castle", "require_admin": True})
    await hass.async_block_till_done()
    panel = panels(hass)["test-home"]
    assert panel.sidebar_icon == "mdi:castle"
    assert panel.require_admin is True
    assert entry.state is ConfigEntryState.LOADED


# --- Views behind Home Assistant's login -----------------------------------------------

async def test_site_files_need_a_login(hass: HomeAssistant, entry, hass_client_no_auth) -> None:
    client = await hass_client_no_auth()
    assert (await client.get(f"{SITES}/test_home/site.json")).status == HTTPStatus.UNAUTHORIZED
    assert (await client.put(f"{SITES}/test_home/site.json", data=b"{}")).status == HTTPStatus.UNAUTHORIZED
    assert (await client.get(f"{BACKUP}/test_home/export")).status == HTTPStatus.UNAUTHORIZED
    # The dashboard code is public, like the rest of Home Assistant's frontend.
    resp = await client.get("/planview_dash/frontend/panel.js")
    assert resp.status == HTTPStatus.OK
    assert "no-cache" in resp.headers.get("Cache-Control", "")
    # The texts are fetched as JSON, one file per language (frontend/i18n/).
    for code in ("en", "sv"):
        resp = await client.get(f"/planview_dash/frontend/i18n/{code}.json")
        assert resp.status == HTTPStatus.OK
        assert "app.startFailed" in json.loads(await resp.text())
    assert (await client.get("/planview_dash/frontend/../manifest.json")).status in (HTTPStatus.NOT_FOUND, HTTPStatus.FORBIDDEN)


async def test_admin_reads_and_writes(hass: HomeAssistant, entry, hass_client, sites_in_tmp) -> None:
    client = await hass_client()
    resp = await client.get(f"{SITES}/test_home/site.json")
    assert resp.status == HTTPStatus.OK
    site = json.loads(await resp.text())
    assert site["name"] == "Test Home"

    site["scenes"] = []
    site.pop("setup_pending", None)
    resp = await client.put(f"{SITES}/test_home/site.json", data=json.dumps(site))
    assert resp.status == HTTPStatus.OK, await resp.text()
    saved = json.loads((sites_in_tmp / "test_home" / "site.json").read_text(encoding="utf-8"))
    assert "setup_pending" not in saved
    assert saved["format"] == 1, "saved in the current format"
    assert (sites_in_tmp / "test_home" / "site.json.1").is_file(), "the replaced file is kept as a restore point"

    # A file from a newer version of PlanView Dash is never saved over.
    resp = await client.put(f"{SITES}/test_home/site.json", data=json.dumps({**site, "format": 99}))
    assert resp.status == HTTPStatus.BAD_REQUEST
    assert "newer version" in await resp.text()

    # Two editors: a save based on a version that is no longer the file's is refused.
    current = await client.get(f"{SITES}/test_home/site.json")
    base = current.headers["ETag"]
    site["name"] = "First"
    resp = await client.put(f"{SITES}/test_home/site.json", data=json.dumps(site), headers={"If-Match": base})
    assert resp.status == HTTPStatus.OK, await resp.text()
    assert (await resp.json())["version"] == (await client.get(f"{SITES}/test_home/site.json")).headers["ETag"]
    site["name"] = "Second"
    resp = await client.put(f"{SITES}/test_home/site.json", data=json.dumps(site), headers={"If-Match": base})
    assert resp.status == HTTPStatus.PRECONDITION_FAILED
    assert json.loads((sites_in_tmp / "test_home" / "site.json").read_text(encoding="utf-8"))["name"] == "First"

    assert (await client.put(f"{SITES}/test_home/site.json", data=b"not json")).status == HTTPStatus.BAD_REQUEST
    assert (await client.put(f"{SITES}/test_home/new.png", data=PNG)).status == HTTPStatus.OK
    assert (await client.put(f"{SITES}/test_home/fake.png", data=b"<html>")).status >= 400
    assert (await client.get(f"{SITES}/unknown/site.json")).status == HTTPStatus.NOT_FOUND
    assert (await client.get(f"{BACKUP}/test_home/export")).status == HTTPStatus.OK


async def test_other_users_read_but_do_not_write(
    hass: HomeAssistant, entry, hass_client, hass_admin_user, sites_in_tmp
) -> None:
    hass_admin_user.groups = []  # the client's user is no longer an administrator
    assert not hass_admin_user.is_admin
    client = await hass_client()
    path = sites_in_tmp / "test_home" / "site.json"
    before = path.read_bytes()

    assert (await client.get(f"{SITES}/test_home/site.json")).status == HTTPStatus.OK
    assert (await client.put(f"{SITES}/test_home/site.json", data=b'{"floorplans": []}')).status in (
        HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN)
    assert (await client.put(f"{SITES}/test_home/new.png", data=PNG)).status in (
        HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN)
    assert (await client.get(f"{BACKUP}/test_home/export")).status in (HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN)
    assert path.read_bytes() == before
    assert not (sites_in_tmp / "test_home" / "new.png").exists()


async def test_saving_a_new_name_renames_the_sidebar_entry(hass: HomeAssistant, entry, hass_client) -> None:
    """The setup guide saves site.json; a new name there becomes the sidebar title."""
    client = await hass_client()
    site = json.loads(await (await client.get(f"{SITES}/test_home/site.json")).text())
    site["name"] = "From The Guide"
    assert (await client.put(f"{SITES}/test_home/site.json", data=json.dumps(site))).status == HTTPStatus.OK
    await hass.async_block_till_done()
    assert panels(hass)["test-home"].sidebar_title == "From The Guide"
    assert entry.title == "From The Guide"


# --- Diagnostics and unloading ---------------------------------------------------------

async def test_diagnostics_are_redacted(hass: HomeAssistant, entry) -> None:
    from custom_components.planview_dash.diagnostics import async_get_config_entry_diagnostics

    assert await async_setup_component(hass, "diagnostics", {})
    diag = await async_get_config_entry_diagnostics(hass, entry)
    text = json.dumps(diag)
    for secret in ("Test Home", "test_home", "test-home"):
        assert secret not in text
    assert diag["entry"]["data"]["title"] == "**REDACTED**"
    assert diag["site"]["folder_exists"] is True and diag["site"]["site_json"] == "ok"
    assert diag["site"]["floorplans"] > 0
    assert diag["dashboards"] == {"from_ui": 1, "from_yaml": 0}
    assert "update_action" not in diag


async def test_unload_removes_the_panel_and_keeps_the_site(hass: HomeAssistant, entry, sites_in_tmp) -> None:
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.NOT_LOADED
    assert "test-home" not in panels(hass)
    assert (sites_in_tmp / "test_home" / "site.json").is_file()

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert panels(hass)["test-home"].sidebar_title == "Test Home"

    assert await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert "test-home" not in panels(hass)
    assert (sites_in_tmp / "test_home" / "site.json").is_file(), "removing the entry keeps what was set up"


# --- Goodnight -------------------------------------------------------------------------

SENSOR = "sensor.test_home_goodnight"

async def test_goodnight_turns_the_lights_off_after_the_countdown(hass: HomeAssistant, entry) -> None:
    from datetime import timedelta
    import homeassistant.util.dt as dt_util
    from pytest_homeassistant_custom_component.common import async_fire_time_changed, async_mock_service

    off = async_mock_service(hass, "homeassistant", "turn_off")
    script = async_mock_service(hass, "script", "turn_on")
    await hass.services.async_call(DOMAIN, "goodnight", {
        "site": "test_home", "entity_id": ["light.kitchen", "switch.lamp", "light.kitchen"], "minutes": 5, "then": "script.lock_up",
    }, blocking=True)
    state = hass.states.get(SENSOR)
    assert state.attributes["minutes"] == 5
    ends = dt_util.parse_datetime(state.state)
    assert timedelta(minutes=4, seconds=50) < ends - dt_util.utcnow() <= timedelta(minutes=5)

    # Nothing happens before the time is up.
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(minutes=4))
    await hass.async_block_till_done()
    assert not off

    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(minutes=5, seconds=1))
    await hass.async_block_till_done()
    assert [c.data["entity_id"] for c in off] == [["light.kitchen", "switch.lamp"]]
    assert [c.data["entity_id"] for c in script] == ["script.lock_up"]
    assert hass.states.get(SENSOR).state == STATE_UNKNOWN


async def test_goodnight_can_be_cancelled_and_restarted(hass: HomeAssistant, entry) -> None:
    from datetime import timedelta
    import homeassistant.util.dt as dt_util
    from pytest_homeassistant_custom_component.common import async_fire_time_changed, async_mock_service

    off = async_mock_service(hass, "homeassistant", "turn_off")

    def call(**kw):
        return hass.services.async_call(DOMAIN, "goodnight", {"site": "test_home", "entity_id": ["light.kitchen"], **kw}, blocking=True)

    await call(minutes=5)
    await call(cancel=True)
    assert hass.states.get(SENSOR).state == STATE_UNKNOWN
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(minutes=6))
    await hass.async_block_till_done()
    assert not off, "a cancelled countdown turns nothing off"

    # A second start replaces the first: only one turn-off, at the later time.
    await call(minutes=1)
    await call(minutes=10)
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(minutes=2))
    await hass.async_block_till_done()
    assert not off
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(minutes=11))
    await hass.async_block_till_done()
    assert len(off) == 1


async def test_goodnight_refuses_other_entities_and_runs_for_any_user(hass: HomeAssistant, entry, hass_read_only_user) -> None:
    import pytest
    import voluptuous as vol
    from homeassistant.core import Context

    for bad in ({"entity_id": ["lock.front_door"]}, {"then": "automation.x"}, {"minutes": 500}, {"site": "../x"}):
        with pytest.raises(vol.Invalid):
            await hass.services.async_call(DOMAIN, "goodnight", {"site": "test_home", **bad}, blocking=True)
    # Only for a dashboard that exists: no state or timer for a made-up site.
    from homeassistant.exceptions import ServiceValidationError
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(DOMAIN, "goodnight", {"site": "no_such_site", "minutes": 5}, blocking=True)
    assert not [s for s in hass.states.async_all() if s.attributes.get("planview_dash_site") == "no_such_site"]
    # Not an admin action: like switching a lamp, any logged-in user may start it.
    await hass.services.async_call(DOMAIN, "goodnight", {"site": "test_home", "minutes": 5}, blocking=True,
                                   context=Context(user_id=hass_read_only_user.id))
    assert hass.states.get(SENSOR).state != STATE_UNKNOWN
    # Unloading the dashboard stops its countdown, and its sensor is unavailable.
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get(SENSOR).state == STATE_UNAVAILABLE
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get(SENSOR).state == STATE_UNKNOWN, "the countdown did not come back"


async def test_goodnight_sensor_is_a_real_entity_of_the_dashboard(hass: HomeAssistant, entry) -> None:
    """The countdown is a timestamp sensor in the entity registry, owned by the
    dashboard's config entry and removed with it, not a state written by hand."""
    from homeassistant.helpers import device_registry as dr, entity_registry as er

    state = hass.states.get(SENSOR)
    assert state.state == STATE_UNKNOWN
    assert state.attributes["device_class"] == "timestamp"
    assert state.attributes["planview_dash_site"] == "test_home"
    reg = er.async_get(hass).async_get(SENSOR)
    assert reg.config_entry_id == entry.entry_id
    assert reg.unique_id == "test_home_goodnight"
    device = dr.async_get(hass).async_get(reg.device_id)
    assert device.name == "Test Home"
    assert not [s for s in hass.states.async_all() if s.domain == DOMAIN], "no states outside an entity"

    assert await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert er.async_get(hass).async_get(SENSOR) is None
    assert hass.states.get(SENSOR) is None


async def test_goodnight_sensor_for_a_yaml_dashboard(hass: HomeAssistant) -> None:
    from homeassistant.helpers import entity_registry as er
    from pytest_homeassistant_custom_component.common import async_mock_service

    async_mock_service(hass, "homeassistant", "turn_off")
    assert await async_setup_component(hass, DOMAIN, {DOMAIN: {"dashboards": [{"site": "my-cabin", "title": "Cabin"}]}})
    await hass.async_block_till_done()
    assert er.async_get(hass).async_get("sensor.my_cabin_goodnight").unique_id == "my-cabin_goodnight"
    await hass.services.async_call(DOMAIN, "goodnight", {"site": "my-cabin", "minutes": 5}, blocking=True)
    assert hass.states.get("sensor.my_cabin_goodnight").state != STATE_UNKNOWN
    await hass.services.async_call(DOMAIN, "goodnight", {"site": "my-cabin", "cancel": True}, blocking=True)
    assert hass.states.get("sensor.my_cabin_goodnight").state == STATE_UNKNOWN
