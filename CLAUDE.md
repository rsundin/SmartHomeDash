# Working on SmartHomeDash

A picture-based Home Assistant dashboard, shipped as a custom integration (Home Assistant Marketplace, added from a link; HACS custom repository before Home Assistant 2026.11).

New to the project, or a new model picking it up? Read `docs/roadmap/kickoff.md` first: setup, the code on one page, how to work, and briefs for the next tasks.

## Rules
- Repo text, code, comments and docs in English. Dashboard UI strings live in `frontend/i18n/<language>.json`, one file per language with the same keys (Swedish default, English); `frontend/js/i18n.js` fetches them and has `t(key, vars)`.
- Never commit data about a real home: photos, entity ids, room names, IPs, tokens. Real sites live in `<config>/smarthomedash/sites/` on the user's Home Assistant, not here. Examples in `custom_components/smarthomedash/example/` are fictional.
- Commit as `rsundin <37210129+rsundin@users.noreply.github.com>`.
- No build step and no runtime calls to outside services (fonts are bundled in `frontend/fonts/`).
- Security: site files only for logged-in users, writes admin-only, `safe_path` for every path, bounded body reads, picture magic-byte check, no `innerHTML` with data.

## Layout
- `custom_components/smarthomedash/`: `__init__.py` (setup, panels, starter site, optional `smarthomedash.update`), `goodnight.py` (`smarthomedash.goodnight` countdown), `config_flow.py`, `views.py` (FrontendView public/no-cache, SitesView auth), `updater.py`, `const.py`.
- `frontend/panel.js`: panel element in HA's iframe; gets `hass`, kiosk via `hass-dock-sidebar`.
- `frontend/card.js`: `custom:smarthomedash-card` for other dashboards (element, visual editor, card picker entry), added to every dashboard with `add_extra_js_url`. The picture runs in a frame, `card.html` + `card-frame.js`, which calls `main.start({ embed: { view } })`; `body.is-embed` in `style.css` hides all but the picture.
- `frontend/js/`: `main.js` startup, `site.js` config loading, `areas.js` Home Assistant areas, `glow.js` lamp colours, `status.js` sensors and warnings, `views/flow.js` energy flow, `views/` overview + floor plan, `ui/setup/` setup guide (`index.js` frame, undo and save; one module per step sharing a context object; `helpers.js`, `draw.js`, `quick.js`; `ui/setup.js` re-exports it), `ui/editor.js` placement, `ui/shape.js` shape editing (corners, snap, undo), `ui/zoom.js` pinch zoom, `ui/wall.js` doorbell camera, idle mode and light mode, `ui/lights.js` all on / all off and goodnight (header and lights card), `ui/camera.js` camera window and camera markers, `adapters/` (hass, ha token, mock test data).
- `tests/`: `run.sh`, `backend/` (unittest), `browser/` (node:test + Playwright, `harness.html`), `fixtures/` (generated test sites), `ha/` (pytest under a real Home Assistant; not part of `run.sh`).
- `index.html` + `sites/`: standalone dev page on test data (`python3 -m http.server`, `?site=example-apartment`, `#edit`, `?kiosk`). New JS files must be added to MODULES in `index.html` (a backend test checks it).
- Config format: `docs/configuration.md`. User guide: `docs/setup.md`.

## Checks before pushing
- Run `tests/run.sh` and make it pass before every push. It checks syntax (Python, frontend JS read as ES modules, JSON), runs the backend tests (`tests/backend/`: paths, size limits, admin-only writes, the site.json check, the same keys in every language file and every `t('…')` key present; standard library only, with stand-ins for Home Assistant and aiohttp) and the browser tests (`tests/browser/`, Playwright on Chromium against `python3 -m http.server`: both examples at five screen sizes, kiosk, rooms and lamps, night mode, pinch zoom, placement drag and list, undo/redo, corner drag and snap, setup guide, quick start from Home Assistant floors and areas, warnings, devices missing in Home Assistant, energy flow, entity names, electricity prices, the card for other dashboards, accessibility (axe-core, keyboard only, contrast, text size), and the performance budget in `perf.test.js` on the large site from `tests/fixtures/perf-site.js`). `tests/run.sh backend` or `tests/run.sh browser` runs one part.
- Changes to the Python side also run under Home Assistant itself: `pip install -r tests/ha/requirements.txt` (Python 3.14; `requirements-oldest.txt` needs 3.13) in a virtual environment, then `pytest tests/ha`. It covers setup from YAML and the UI, the config and options flows, panels, the views with and without a login and as a non-administrator, diagnostics and unloading. CI runs both versions (job **Home Assistant**).
- New behaviour gets a test. Browser tests that need the panel use `tests/browser/harness.html`: the panel code with test data, `window.store` to set states, and restarts in place like the HA panel. Tests of the card use `tests/browser/card-harness.html`, a stand-in Home Assistant dashboard with a `hass` object built from the test data.
- CI (hassfest, HACS, JavaScript syntax, Tests) is required on main. Home Assistant (newest, oldest) runs too and becomes required once the owner adds it to branch protection.

## Roadmap
- Planned work is in `docs/roadmap/plan.md`: milestones with task ids (Q1, S2, H3 …), status, size, dependencies and **Done when** criteria. Pick the first `todo` task whose dependencies are done unless told otherwise, follow "How to work this plan" there, and mark the task `done (vX.Y.Z)` when it ships. `ROADMAP.md` is the public summary; keep both in step.
- The research behind it, with sources, is `docs/roadmap/research-2026-11.md`; the latest status report is `docs/roadmap/status-2026-11.md`. The plan's **Next up** list sets the order until the owner changes it.

## Releasing
1. Bump `version` in `custom_components/smarthomedash/manifest.json` and add a section to `CHANGELOG.md`.
2. Merge to main, then publish a GitHub release tagged `vX.Y.Z` with the changelog section. The Marketplace offers the update from the release.
3. Python/manifest changes need a Home Assistant restart; frontend-only changes need a dashboard reload.
