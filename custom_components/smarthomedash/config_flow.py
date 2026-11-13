"""Set up a dashboard from the UI: a name, a sidebar icon and an address."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.util import slugify

from .const import (
    CONF_ICON,
    CONF_LAYOUT,
    CONF_REQUIRE_ADMIN,
    CONF_SITE,
    CONF_TITLE,
    CONF_URL_PATH,
    DEFAULT_ICON,
    DOMAIN,
    LAYOUT_APARTMENT,
    LAYOUT_HOUSE,
    URL_PATH,
)


def _taken_paths(hass) -> set[str]:
    """Sidebar addresses already in use by any panel."""
    return set(hass.data.get("frontend_panels", {}))


def _free_path(wanted: str, taken: set[str]) -> str:
    """An address made from the name, when none was typed. Home Assistant has panels
    of its own (`home`, `light`, `climate`, `security` …), so the default name "Home"
    would otherwise be refused: such a name gets `-dash` added, then a number."""
    if wanted not in taken:
        return wanted
    path, n = f"{wanted}-dash", 2
    while path in taken:
        path, n = f"{wanted}-dash-{n}", n + 1
    return path


class SmartHomeDashConfigFlow(ConfigFlow, domain=DOMAIN):
    """Create one dashboard."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            title = user_input[CONF_TITLE].strip()
            site = slugify(title) or "home"
            url_path = (user_input.get(CONF_URL_PATH) or "").strip().lower()
            if not url_path:
                url_path = _free_path(site.replace("_", "-"), _taken_paths(self.hass))
            yaml_sites = self.hass.data.get(DOMAIN, {}).get("yaml_sites", set())
            if not URL_PATH.match(url_path):
                errors[CONF_URL_PATH] = "invalid_url_path"
            elif url_path in _taken_paths(self.hass):
                errors[CONF_URL_PATH] = "url_path_taken"
            elif site in yaml_sites:
                errors[CONF_TITLE] = "site_in_yaml"
            else:
                await self.async_set_unique_id(site)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=title,
                    data={
                        CONF_SITE: site,
                        CONF_TITLE: title,
                        CONF_ICON: user_input.get(CONF_ICON) or DEFAULT_ICON,
                        CONF_URL_PATH: url_path,
                        CONF_REQUIRE_ADMIN: user_input.get(CONF_REQUIRE_ADMIN, False),
                        CONF_LAYOUT: user_input.get(CONF_LAYOUT, LAYOUT_HOUSE),
                    },
                )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_TITLE, default=(user_input or {}).get(CONF_TITLE, "Home")): selector.TextSelector(),
                    vol.Required(CONF_LAYOUT, default=LAYOUT_HOUSE): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=[LAYOUT_HOUSE, LAYOUT_APARTMENT],
                            translation_key="layout",
                            mode=selector.SelectSelectorMode.LIST,
                        )
                    ),
                    vol.Optional(CONF_ICON, default=DEFAULT_ICON): selector.IconSelector(),
                    vol.Optional(CONF_URL_PATH): selector.TextSelector(),
                    vol.Optional(CONF_REQUIRE_ADMIN, default=False): selector.BooleanSelector(),
                }
            ),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return SmartHomeDashOptionsFlow()


class SmartHomeDashOptionsFlow(OptionsFlow):
    """Change the sidebar title, icon and who can see the dashboard.

    The site folder and address stay the same, so nothing set up is lost.
    """

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        current = {**self.config_entry.data, **self.config_entry.options}
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_TITLE, default=current.get(CONF_TITLE, "Home")): selector.TextSelector(),
                    vol.Optional(CONF_ICON, default=current.get(CONF_ICON, DEFAULT_ICON)): selector.IconSelector(),
                    vol.Optional(CONF_REQUIRE_ADMIN, default=current.get(CONF_REQUIRE_ADMIN, False)): selector.BooleanSelector(),
                }
            ),
        )
