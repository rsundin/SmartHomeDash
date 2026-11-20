"""The goodnight countdown as an entity: one timestamp sensor per dashboard.

While a countdown runs (goodnight.py), the sensor holds the time the lights turn off;
otherwise it is unknown. Every open screen follows it (frontend/js/ui/lights.js), and
automations can too. It is a real entity: in the entity registry (renamed, hidden or
disabled like any other), and removed with its dashboard.

A dashboard added from the UI owns its sensor through its config entry, under a device
named after the dashboard. A dashboard listed in configuration.yaml gets the same
sensor through the sensor platform (discovery), with a unique id but no device.
"""

from __future__ import annotations

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.util import slugify

from . import goodnight
from .const import CONF_SITE, CONF_TITLE, DOMAIN


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities) -> None:
    dash = {**entry.data, **entry.options}
    async_add_entities([GoodnightSensor(dash[CONF_SITE], dash.get(CONF_TITLE), device=True)])


async def async_setup_platform(hass: HomeAssistant, config, async_add_entities, discovery_info=None) -> None:
    """Dashboards from configuration.yaml (planview_dash: dashboards:)."""
    if not discovery_info:
        return
    async_add_entities([GoodnightSensor(discovery_info[CONF_SITE], discovery_info.get(CONF_TITLE), device=False)])


class GoodnightSensor(SensorEntity):
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_has_entity_name = True
    _attr_translation_key = "goodnight"
    _attr_icon = "mdi:weather-night"
    _attr_should_poll = False

    def __init__(self, site: str, title: str | None, device: bool) -> None:
        self._site = site
        self._attr_unique_id = f"{site}_goodnight"
        # The id it gets when first added; the user may change it, and screens then
        # find it by its planview_dash_site attribute.
        self.entity_id = f"sensor.{slugify(site)}_goodnight"
        if device:
            self._attr_device_info = DeviceInfo(
                identifiers={(DOMAIN, site)},
                name=title or "PlanView Dash",
                manufacturer="PlanView Dash",
                entry_type=DeviceEntryType.SERVICE,
            )

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(self.hass, goodnight.signal(self._site), self._changed))

    @callback
    def _changed(self) -> None:
        self.async_write_ha_state()

    @property
    def native_value(self):
        now = goodnight.running(self.hass, self._site)
        return now[0] if now else None

    @property
    def extra_state_attributes(self) -> dict:
        attrs = {"planview_dash_site": self._site}
        now = goodnight.running(self.hass, self._site)
        if now:
            attrs["minutes"] = now[1]
        return attrs
