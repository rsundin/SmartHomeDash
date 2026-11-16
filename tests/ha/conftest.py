"""Tests under Home Assistant itself (roadmap Q7), with pytest-homeassistant-custom-component.

Run:  pip install -r tests/ha/requirements.txt && pytest tests/ha
The fast tests with stand-ins stay in tests/backend; these check what stand-ins cannot:
the config and options flows, panel registration, the views behind Home Assistant's
own login, diagnostics and unloading.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from pytest_homeassistant_custom_component.common import MockConfigEntry

# Home Assistant finds custom integrations by importing `custom_components`. Import the
# repository's folder first, before the test Home Assistant mounts its own config folder.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import custom_components  # noqa: E402, F401

DOMAIN = "smarthomedash"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Let Home Assistant load custom_components/ from the repository."""
    yield


@pytest.fixture(autouse=True)
def sites_in_tmp(hass: HomeAssistant, tmp_path):
    """Home Assistant's config folder for the test is a temporary one, so site folders
    never land in the repository."""
    hass.config.config_dir = str(tmp_path)
    yield tmp_path / DOMAIN / "sites"


@pytest.fixture
async def entry(hass: HomeAssistant) -> MockConfigEntry:
    """One dashboard added from the UI, set up."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Test Home",
        unique_id="test_home",
        data={
            "site": "test_home",
            "title": "Test Home",
            "icon": "mdi:home-lightbulb",
            "url_path": "test-home",
            "require_admin": False,
            "layout": "house",
        },
    )
    entry.add_to_hass(hass)
    assert await async_setup_component(hass, "http", {})
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry
