"""Constants shared by the SmartHomeDash integration."""

import re

DOMAIN = "smarthomedash"
FRONTEND_URL = "/smarthomedash/frontend"
SITES_URL = "/api/smarthomedash/sites"
BACKUP_URL = "/api/smarthomedash/backup"
PANEL_ELEMENT = "smarthomedash-panel"

SITE_ID = re.compile(r"^[a-z0-9_-]+$", re.IGNORECASE)
URL_PATH = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
UPLOAD_NAME = re.compile(r"^[a-z0-9][a-z0-9_.-]*\.(jpg|jpeg|png|webp)$", re.IGNORECASE)

MAX_SITE_JSON = 2 * 1024 * 1024
MAX_UPLOAD = 25 * 1024 * 1024
MAX_IMPORT = 100 * 1024 * 1024    # a whole dashboard as .zip, and its unpacked size
MAX_IMPORT_FILES = 200
KEEP_VERSIONS = 10                # site.json.1 (newest) … site.json.10

CONF_SITE = "site"
CONF_TITLE = "title"
CONF_ICON = "icon"
CONF_URL_PATH = "url_path"
CONF_REQUIRE_ADMIN = "require_admin"
CONF_LAYOUT = "layout"

LAYOUT_HOUSE = "house"          # overview picture of the property + floor plans
LAYOUT_APARTMENT = "apartment"  # floor plans only

DEFAULT_ICON = "mdi:home-lightbulb"
DEFAULT_REPOSITORY = "rsundin/SmartHomeDash"
