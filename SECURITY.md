# Security

## Reporting a vulnerability

Please report security problems privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue for them.

Include what you found, how to reproduce it, and the version (`custom_components/smarthomedash/manifest.json`). You will get an answer within a week.

## How SmartHomeDash handles access

- **The dashboard runs inside Home Assistant** as a sidebar panel and uses the logged-in user's session. It needs no access token and stores none.
- **Site files** (the config and pictures under `<config>/smarthomedash/sites/`) are served through an API that requires a Home Assistant login. Nothing is placed in `www/`, which Home Assistant serves to anyone.
- **Only administrators** can save a site config or upload pictures. Uploads must be jpg, png or webp (checked by content, not file name), at most 25 MB, and are written inside the site's own folder; paths that would leave it are refused.
- **Export, import and restore points** (`/api/smarthomedash/backup/`) are for administrators only. An export holds `site.json` and the pictures, nothing else from the folder, and no file reached through a link out of it. An import is checked as a whole before anything is written: only `site.json` (which must pass the same check as a save) and jpg, png or webp pictures by content; names must be plain relative paths at most three folders deep, so `..`, absolute paths, backslashes and hidden files are refused, and every path is resolved inside the site's folder before writing. The upload is at most 100 MB, every entry is unpacked with a size bound (not trusting the sizes the .zip states), at most 100 MB and 200 files in all, and encrypted entries are refused. The replaced `site.json` is kept as a restore point.
- **Any logged-in user** who can open the panel can switch the lights and thermostats shown on it, just as in the rest of Home Assistant. Use the *Only for administrators* option to hide a dashboard from other users.
- **The dashboard code** under `/smarthomedash/frontend/` is public, like all of Home Assistant's frontend code. It holds no data about any home.
- **The goodnight action** (`smarthomedash.goodnight`) can be called by any logged-in user, as switching a lamp in the dashboard can. It only turns off `light.*` and `switch.*` entities and only runs a `script.*` afterwards, at most 120 minutes later; anything else is refused.
- **The update action** (`smarthomedash.update`) exists only when a repository or token is configured in YAML, and only administrators can run it. It installs code from that repository, so only point it at a repository you trust.

## The standalone page

`index.html` in the repository root is a development page. If you serve it from Home Assistant's `www/` folder, everything in that folder is reachable without logging in, and a token pasted under *Connection* is stored in that browser's local storage. Use the sidebar panel for everyday use.
