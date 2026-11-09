# Working on SmartHomeDash

A picture-based Home Assistant dashboard, shipped as a custom integration (HACS custom repository).

## Rules
- Repo text, code, comments and docs in English. Dashboard UI strings live in `frontend/js/i18n.js` (Swedish default, English).
- Never commit data about a real home: photos, entity ids, room names, IPs, tokens. Real sites live in `<config>/smarthomedash/sites/` on the user's Home Assistant, not here. Examples in `custom_components/smarthomedash/example/` are fictional.
- Commit as `rsundin <37210129+rsundin@users.noreply.github.com>`.
- No build step and no runtime calls to outside services (fonts are bundled in `frontend/fonts/`).
- Security: site files only for logged-in users, writes admin-only, `safe_path` for every path, bounded body reads, picture magic-byte check, no `innerHTML` with data.

## Layout
- `custom_components/smarthomedash/`: `__init__.py` (setup, panels, starter site, optional `smarthomedash.update`), `config_flow.py`, `views.py` (FrontendView public/no-cache, SitesView auth), `updater.py`, `const.py`.
- `frontend/panel.js`: panel element in HA's iframe; gets `hass`, kiosk via `hass-dock-sidebar`.
- `frontend/js/`: `main.js` startup, `site.js` config loading, `areas.js` Home Assistant areas, `glow.js` lamp colours, `status.js` sensors and warnings, `views/flow.js` energy flow, `views/` overview + floor plan, `ui/setup.js` setup guide, `ui/editor.js` placement, `ui/zoom.js` pinch zoom, `ui/wall.js` wall screens (doorbell camera, idle mode, light mode), `adapters/` (hass, ha token, mock test data).
- `index.html` + `sites/`: standalone dev page on test data (`python3 -m http.server`, `?site=example-apartment`, `#edit`, `?kiosk`). New JS files must be added to MODULES in `index.html`.
- Config format: `docs/configuration.md`. User guide: `docs/setup.md`.

## Checks before pushing
- `python3 -m py_compile custom_components/smarthomedash/*.py`, `node --check` on frontend JS, JSON files parse.
- Load the standalone page for both examples and kiosk; no console errors.
- CI (hassfest, HACS, JavaScript syntax) is required on main.

## Releasing
1. Bump `version` in `custom_components/smarthomedash/manifest.json` and add a section to `CHANGELOG.md`.
2. Merge to main, then publish a GitHub release tagged `vX.Y.Z` with the changelog section. HACS offers the update from the release.
3. Python/manifest changes need a Home Assistant restart; frontend-only changes need a dashboard reload.
