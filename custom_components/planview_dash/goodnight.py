"""Goodnight: the lights stay on a few minutes, then everything turns off.

The dashboard's Goodnight button calls the `planview_dash.goodnight` action with the
dashboard's lights. The countdown runs here, in Home Assistant, so closing or reloading
the tablet does not stop it, and it can also be started from automations or voice.

Every open screen follows it through one timestamp sensor per dashboard (sensor.py),
an entity of the dashboard's config entry (or of the sensor platform, for dashboards
listed in YAML):

    sensor.<site>_goodnight   when the lights turn off, while counting down;
                              unknown otherwise
        planview_dash_site    the dashboard's site, so screens find a renamed sensor
        minutes               the length of the countdown, while counting down

A restart of Home Assistant cancels a countdown that is running.
"""

from __future__ import annotations

from datetime import timedelta
import logging

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import ServiceValidationError
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
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


def signal(site: str) -> str:
    """Sent when a site's countdown starts or ends; its sensor listens."""
    return f"{DOMAIN}_goodnight_{site}"


def running(hass: HomeAssistant, site: str) -> tuple | None:
    """(ends_at, minutes) while a site's countdown runs, else None."""
    return hass.data.get(DOMAIN, {}).get("goodnight_running", {}).get(site)


@callback
def async_register(hass: HomeAssistant) -> None:
    """Register the action once."""
    timers: dict[str, callable] = hass.data[DOMAIN].setdefault("goodnight", {})
    ends: dict[str, tuple] = hass.data[DOMAIN].setdefault("goodnight_running", {})

    def show(site: str, ends_at=None, minutes=None) -> None:
        if ends_at:
            ends[site] = (ends_at, minutes)
        else:
            ends.pop(site, None)
        async_dispatcher_send(hass, signal(site))

    def stop(site: str) -> None:
        cancel = timers.pop(site, None)
        if cancel:
            cancel()

    async def handle(call: ServiceCall) -> None:
        site = call.data["site"]
        # Only for a dashboard that exists: the action is open to every user, and each
        # site has a sensor and a timer of its own.
        if site not in hass.data[DOMAIN]["sites"]:
            raise ServiceValidationError(f"There is no PlanView Dash dashboard with the site \"{site}\"")
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
    data = hass.data.get(DOMAIN, {})
    cancel = data.get("goodnight", {}).pop(site, None)
    if cancel:
        cancel()
    if data.get("goodnight_running", {}).pop(site, None):
        async_dispatcher_send(hass, signal(site))
