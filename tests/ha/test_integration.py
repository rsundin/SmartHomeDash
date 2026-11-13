"""SmartHomeDash under a real Home Assistant: setup, panels, flows, views, diagnostics."""

from __future__ import annotations

import json
from http import HTTPStatus

from homeassistant.components import frontend
from homeassistant.config_entries import SOURCE_USER, ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component

from pytest_homeassistant_custom_component.common import MockConfigEntry

DOMAIN = "smarthomedash"
SITES = "/api/smarthomedash/sites"
BACKUP = "/api/smarthomedash/backup"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def panels(hass: HomeAssistant) -> dict:
    return hass.data[frontend.DATA_PANELS]


# --- Setup -----------------------------------------------------------------------------

async def test_setup_from_yaml(hass: HomeAssistant, sites_in_tmp) -> None:
    """Dashboards listed in configuration.yaml get a panel each; no starter site is
    written for them and the update action is absent without a repository or token."""
    config = {DOMAIN: {"dashboards": [
        {"site": "home", "title": "Home", "url_path": "my-home"},
        {"site": "cabin", "title": "Cabin", "icon": "mdi:pine-tree", "require_admin": True},
    ]}}
    assert await async_setup_component(hass, DOMAIN, config)
    await hass.async_block_till_done()

    home = panels(hass)["my-home"]
    assert home.sidebar_title == "Home"
    assert home.component_name == "custom"
    assert home.config["_panel_custom"]["name"] == "smarthomedash-panel"
    assert home.config["_panel_custom"]["embed_iframe"] is True
    assert home.config["_panel_custom"]["module_url"].startswith("/smarthomedash/frontend/panel.js?v=")
    assert home.config["site"] == "home"
    assert home.require_admin is False

    cabin = panels(hass)["cabin"]  # no url_path: the site id is the address
    assert cabin.sidebar_icon == "mdi:pine-tree"
    assert cabin.require_admin is True

    assert not sites_in_tmp.exists()
    assert not hass.services.has_service(DOMAIN, "update")


async def test_the_card_is_loaded_with_every_dashboard(hass: HomeAssistant, entry, hass_client_no_auth) -> None:
    """`custom:smarthomedash-card` needs no resource added by hand: its module is among the
    frontend's extra modules, once however many dashboards are set up, and is served."""
    second = MockConfigEntry(domain=DOMAIN, title="Second", unique_id="second", data={
        "site": "second", "title": "Second", "url_path": "second", "layout": "apartment"})
    second.add_to_hass(hass)
    assert await hass.config_entries.async_setup(second.entry_id)
    await hass.async_block_till_done()

    urls = [u for u in hass.data[frontend.DATA_EXTRA_MODULE_URL].urls if "smarthomedash" in u]
    assert len(urls) == 1
    assert urls[0].startswith("/smarthomedash/frontend/card.js?v=")

    client = await hass_client_no_auth()
    for name in ("card.js", "card.html", "card-frame.js"):
        assert (await client.get(f"/smarthomedash/frontend/{name}")).status == HTTPStatus.OK
    assert "text/html" in (await client.get("/smarthomedash/frontend/card.html")).headers["Content-Type"]


async def test_update_action_only_with_a_repository_or_token(hass: HomeAssistant) -> None:
    assert await async_setup_component(hass, DOMAIN, {DOMAIN: {"repository": "someone/fork"}})
    await hass.async_block_till_done()
    assert hass.services.has_service(DOMAIN, "update")


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
    resp = await client.get("/smarthomedash/frontend/panel.js")
    assert resp.status == HTTPStatus.OK
    assert "no-cache" in resp.headers.get("Cache-Control", "")
    # The texts are fetched as JSON, one file per language (frontend/i18n/).
    for code in ("en", "sv"):
        resp = await client.get(f"/smarthomedash/frontend/i18n/{code}.json")
        assert resp.status == HTTPStatus.OK
        assert "app.startFailed" in json.loads(await resp.text())
    assert (await client.get("/smarthomedash/frontend/../manifest.json")).status in (HTTPStatus.NOT_FOUND, HTTPStatus.FORBIDDEN)


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
    assert (sites_in_tmp / "test_home" / "site.json.1").is_file(), "the replaced file is kept as a restore point"

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
    from custom_components.smarthomedash.diagnostics import async_get_config_entry_diagnostics

    assert await async_setup_component(hass, "diagnostics", {})
    diag = await async_get_config_entry_diagnostics(hass, entry)
    text = json.dumps(diag)
    for secret in ("Test Home", "test_home", "test-home"):
        assert secret not in text
    assert diag["entry"]["data"]["title"] == "**REDACTED**"
    assert diag["site"]["folder_exists"] is True and diag["site"]["site_json"] == "ok"
    assert diag["site"]["floorplans"] > 0
    assert diag["dashboards"] == {"from_ui": 1, "from_yaml": 0}
    assert diag["update_action"] == {"custom_repository": False, "token_set": False}


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
