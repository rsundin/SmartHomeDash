"""Moving an installation over from the integration's earlier name (before 0.8.33).

Until 0.8.32 the integration had the domain `smarthomedash`. Home Assistant keeps
config entries by domain, so dashboards added from the UI under that name are not
loaded by this integration by themselves. Two things carry them over:

- The site folder `<config>/smarthomedash/` is renamed to `<config>/planview_dash/`
  when the new one does not exist yet, so pictures and site.json stay.
- Each dashboard entry of the old domain becomes an entry of this one, with the same
  name, address, icon and settings, and the old entry is removed. The setup flow offers
  this when old entries are found; setting up the integration (from the UI or YAML)
  takes over any that are left.

Everything else is left to the user and listed in CHANGELOG.md: `smarthomedash:` in
configuration.yaml, `custom:smarthomedash-card` on other dashboards and the
`smarthomedash.*` actions in automations.
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.config_entries import SOURCE_IMPORT, ConfigEntry
from homeassistant.core import HomeAssistant, callback

from .const import CONF_SITE, DOMAIN

_LOGGER = logging.getLogger(__name__)

OLD_DOMAIN = "smarthomedash"
_RUNNING = f"{DOMAIN}_taking_over"


def move_old_folder(config_dir: str) -> bool:
    """Rename `<config>/smarthomedash` to `<config>/planview_dash`. Runs in the
    executor. Never merges or overwrites: if the new folder exists, nothing moves."""
    old, new = Path(config_dir, OLD_DOMAIN), Path(config_dir, DOMAIN)
    if not old.is_dir() or new.exists():
        return False
    old.rename(new)
    _LOGGER.info("Moved %s to %s", old, new)
    return True


def old_entries(hass: HomeAssistant) -> list[ConfigEntry]:
    """Dashboards still set up under the old domain."""
    return hass.config_entries.async_entries(OLD_DOMAIN)


def entry_data(entry: ConfigEntry) -> dict:
    """An old entry's settings, options folded in, as data for a new entry."""
    return {**entry.data, **entry.options}


@callback
def schedule_take_over(hass: HomeAssistant) -> None:
    """Start async_take_over when old entries are left and it is not running already."""
    if not old_entries(hass) or hass.data.get(_RUNNING):
        return
    hass.data[_RUNNING] = True

    async def run() -> None:
        try:
            await async_take_over(hass)
        finally:
            hass.data.pop(_RUNNING, None)

    hass.async_create_task(run())


async def async_take_over(hass: HomeAssistant) -> None:
    """Create an entry of this domain for every old one whose site has none yet, then
    remove the old entries. Not awaited from async_setup: the new entries are set up
    by Home Assistant once the integration itself is."""
    have = {e.data.get(CONF_SITE) for e in hass.config_entries.async_entries(DOMAIN)}
    for entry in old_entries(hass):
        dash = entry_data(entry)
        if dash.get(CONF_SITE) and dash[CONF_SITE] not in have:
            await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_IMPORT}, data=dash)
            have.add(dash[CONF_SITE])
        await hass.config_entries.async_remove(entry.entry_id)
        _LOGGER.info("Moved the dashboard %s over from %s", dash.get(CONF_SITE), OLD_DOMAIN)
