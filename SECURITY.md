# Security

## Reporting a vulnerability

Please report security problems privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue for them.

Include what you found, how to reproduce it, and the version (`custom_components/smarthomedash/manifest.json`). You will get an answer within a week.

## How SmartHomeDash handles access

- **The dashboard runs inside Home Assistant** as a sidebar panel and uses the logged-in user's session. It needs no access token and stores none.
- **Site files** (the config and pictures under `<config>/smarthomedash/sites/`) are served through an API that requires a Home Assistant login. Nothing is placed in `www/`, which Home Assistant serves to anyone.
- **Only administrators** can save a site config or upload pictures. Uploads must be jpg, png or webp (checked by content, not file name), at most 25 MB, and are written inside the site's own folder; paths that would leave it are refused.
- **Any logged-in user** who can open the panel can switch the lights and thermostats shown on it, just as in the rest of Home Assistant. Use the *Only for administrators* option to hide a dashboard from other users.
- **The dashboard code** under `/smarthomedash/frontend/` is public, like all of Home Assistant's frontend code. It holds no data about any home.
- **The update action** (`smarthomedash.update`) exists only when a repository or token is configured in YAML, and only administrators can run it. It installs code from that repository, so only point it at a repository you trust.

## The standalone page

`index.html` in the repository root is a development page. If you serve it from Home Assistant's `www/` folder, everything in that folder is reachable without logging in, and a token pasted under *Connection* is stored in that browser's local storage. Use the sidebar panel for everyday use.
