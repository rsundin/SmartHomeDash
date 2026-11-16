"""Goodnight: the lights stay on a few minutes, then everything turns off.

The dashboard's Goodnight button calls the `smarthomedash.goodnight` action with the
dashboard's lights. The countdown runs here, in Home Assistant, so closing or reloading
the tablet does not stop it, and it can also be started from automations or voice.

Every open screen follows it through one state per site, like `sun.sun`:

    smarthomedash.goodnight_<site>   on while counting down, otherwise off
        ends_at   when the lights turn off (ISO time), while on

A restart of Home Assistant cancels a countdown that is running.
"""

from __future__ import annotations

from datetime import timedelta
import logging

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, callback
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.event import async_call_later
import homeassistant.util.dt as dt_util

from .const import DOMAIN, SITE_ID

_LOGGER = logging.getLogger(__name__)

DEFAULT_MINUTES = 5
MAX_MINUTES = 120
# Only lights and switches are turned off, and only a script runs after: the action is
# open to every logged-in user, like switching a lamp in the dashboard.
_LIGHT = r"^(light|switch)\.[a-z0-9_]+$"
_SCRIPT = r"^script\.[a-z0-9_]+$"

SCHEMA = vol.Schema(
    {
        vol.Required("site"): vol.All(cv.string, vol.Match(SITE_ID)),
        vol.Optional("entity_id", default=[]): vol.All(cv.ensure_list, vol.Length(max=500), [vol.Match(_LIGHT)]),
        vol.Optional("minutes", default=DEFAULT_MINUTES): vol.All(vol.Coerce(float), vol.Range(min=0, max=MAX_MINUTES)),
        vol.Optional("then"): vol.Match(_SCRIPT),
        vol.Optional("cancel", default=False): cv.boolean,
    }
)


def state_id(site: str) -> str:
    """The state that screens follow, one per site."""
    return f"{DOMAIN}.goodnight_{site.lower().replace('-', '_')}"


@callback
def async_register(hass: HomeAssistant) -> None:
    """Register the action once."""
    timers: dict[str, callable] = hass.data[DOMAIN].setdefault("goodnight", {})

    def show(site: str, ends_at=None, minutes=None) -> None:
        attrs = {"friendly_name": "Goodnight", "icon": "mdi:weather-night"}
        if ends_at:
            attrs.update(ends_at=ends_at.isoformat(), minutes=minutes)
        hass.states.async_set(state_id(site), "on" if ends_at else "off", attrs)

    def stop(site: str) -> None:
        cancel = timers.pop(site, None)
        if cancel:
            cancel()

    async def handle(call: ServiceCall) -> None:
        site = call.data["site"]
        stop(site)
        if call.data["cancel"]:
            show(site)
            return
        lights = list(dict.fromkeys(call.data["entity_id"]))
        then = call.data.get("then")
        minutes = call.data["minutes"]
        ends_at = dt_util.utcnow() + timedelta(minutes=minutes)

        async def finish(_now) -> None:
            timers.pop(site, None)
            show(site)
            if lights:
                await hass.services.async_call("homeassistant", "turn_off", {"entity_id": lights}, blocking=False, context=call.context)
            if then:
                await hass.services.async_call("script", "turn_on", {"entity_id": then}, blocking=False, context=call.context)
            _LOGGER.debug("Goodnight for %s: turned off %d lights", site, len(lights))

        timers[site] = async_call_later(hass, minutes * 60, finish)
        show(site, ends_at, minutes)

    hass.services.async_register(DOMAIN, "goodnight", handle, schema=SCHEMA)


@callback
def async_stop(hass: HomeAssistant, site: str) -> None:
    """Cancel a site's countdown (its dashboard is unloaded)."""
    cancel = hass.data.get(DOMAIN, {}).get("goodnight", {}).pop(site, None)
    if cancel:
        cancel()
        hass.states.async_remove(state_id(site))
