# Kickoff: start coding here

A brief for a coding model (or a person) taking over SmartHomeDash development. Read this first, then `CLAUDE.md`, then the task in [plan.md](plan.md). It is written so you can start the first task within minutes, without exploring the whole codebase.

Status at the time of writing: version **0.8.16**, 13 November 2026. See [status-2026-11.md](status-2026-11.md).

## 1. The product in ten lines

- A Home Assistant custom integration that adds a sidebar panel: **your home as a picture**. A real photo or render of the house, plus floor plans.
- Lamps glow on the picture in their real colour, windows light up, solar panels glow, and energy flows as lines between sun, grid, battery, car and house.
- Tap a building and the roof lifts to its floor plan. Rooms are tinted by temperature and show their lamps, doors, windows and presence.
- A room panel has the thermostat, dimmers, blinds and sensors. Cards show weather, power, energy, price per quarter-hour, lights and heating.
- Everything is set up in the UI: draw rooms on the picture, link them to Home Assistant areas, and lamps place themselves.
- It is built for wall tablets (kiosk, idle, night dim, doorbell camera, light mode) and phones (pinch zoom).
- Written for its owner's summer house and apartment in Sweden, and published for everyone (MIT).
- UI in Swedish (default) and English. Everything else (code, comments, docs, commits) is in English.

## 2. Ground rules (short form of CLAUDE.md)

- **No real-home data in the repo:** no photos, entity ids, room names, IPs or tokens. The examples are fictional.
- **No build step, no runtime calls to outside services.** Plain ES modules, bundled fonts.
- **Security:** site files are served to logged-in users only; writes are admin-only; `safe_path` for every path; bounded body reads (`views.read_limited`); picture magic-byte check; no `innerHTML` with data (use `el()`/`sv()` from `util.js`).
- **UI strings** go in `frontend/js/i18n.js` (until Q8 moves them) with both `sv` and `en`.
- **New frontend module:** add it to `MODULES` in `index.html`, or the standalone page and the demo miss it.
- **Light mode must keep working** for every feature: no blur, blending or animation when `body.is-lite`.
- **Commits** as `rsundin <37210129+rsundin@users.noreply.github.com>`, with the attribution lines your harness asks for.
- **Product principles** (plan.md): a picture, not a 3D model; set up in the UI; fast on an old tablet; Home Assistant is the source of truth; read-only for anything that can lock someone out or let someone in.

## 3. Get running (about 5 minutes)

```bash
# Python 3.12+, Node 20+ (CI uses 22)
npm install --no-save --no-package-lock playwright@1.63.0
npx playwright install --with-deps chromium     # or: npx playwright install chromium

tests/run.sh            # everything: syntax, 68 backend tests, ~54 browser tests, perf budget (~3 min)
tests/run.sh backend    # backend only (~1 s)
tests/run.sh browser    # browser only

# One browser test by name while you work:
node --test --test-name-pattern="pinch" tests/browser/dashboard.test.js

# The dashboard on test data, no Home Assistant needed:
python3 -m http.server 8000     # then http://localhost:8000/
#   ?site=example-apartment   ?kiosk   ?lite   ?ring (doorbell)   #edit (placement mode)
```

**Known issue:** "pinch zoom with two fingers, and a tap still works after" may fail on your machine although it passes in CI. That is task Q6. Do not add waits to hide it.

## 4. The code in one page

```
custom_components/smarthomedash/
  __init__.py      setup (YAML and config entries), panel registration, starter site, update action
  config_flow.py   add a dashboard from the UI; options (title, icon, admin-only)
  views.py         FrontendView (public code, no-cache) and SitesView (auth): site.json, pictures,
                   backup zip, restore points; safe_path, read_limited, write_atomic, site.json check
  diagnostics.py   redacted diagnostics
  updater.py       install from a GitHub tarball (for setups without the Marketplace)
  example/         fictional house and apartment: pictures, site*.json, apartment*.json (en + sv)
  frontend/
    panel.js       <smarthomedash-panel>: runs in HA's iframe, gets `hass`, calls main.start()
    css/style.css  one stylesheet; tokens on :root; light mode under body.is-lite
    js/main.js     start(opts): loads the site, connects the adapter, builds header, stage, cards
    js/store.js    entity states; store.watch(ids, fn) batched per animation frame
    js/site.js     loads site.json and pictures, builds site.index (rooms, lights, names …)
    js/adapters/   hass.js (panel, live `hass`), ha.js (token over websocket), mock.js (test data)
    js/areas.js    HA areas/floors/registry; automatic placement of entities into rooms
    js/entities.js helpers: isOn, kw, climate, prices (quarter-hours), names (nameOf)
    js/status.js   doors, windows, locks, presence, alarms per room; warnings
    js/power.js    power readings and the split into flows
    js/glow.js     lamp colours (rgb and colour temperature)
    js/views/      overview.js (picture), floorplan.js, flow.js (energy lines)
    js/ui/         setup.js (guide), editor.js (placement), shape.js (corner editing), panel.js
                   (room panel), cards.js, wall.js (kiosk, idle, doorbell, light mode), zoom.js,
                   backup.js, report.js, settings.js
    js/i18n.js     strings sv/en, t(key, vars)
index.html, sites/   standalone page and example sites (symlinks into example/)
tests/backend/       unittest with stand-ins for HA (stubs.py)
tests/browser/       node:test + Playwright; lib.js (server, sizes, harness), harness.html
tests/fixtures/      perf-site.js (large generated home)
docs/                setup.md (user guide), configuration.md (site.json reference), roadmap/
```

**How a page starts:** `panel.js` (or `index.html`) → `main.start(opts)`. This loads site.json (`site.js`) and connects the adapter, which fills the `store`. It then reads the areas and runs automatic placement and sensor assignment (`areas.js`, `status.js`). Then it builds the overview, floor plans (lazily), cards and warnings. Views subscribe with `store.watch(ids, fn)`.

**Testing patterns:** `tests/browser/harness.html` starts the panel code with the mock adapter. It exposes `window.store`, so a test can set states with `store.update({...})`, and it restarts in place like the HA panel. Use `harness(env, '?site=example-house', { width, height, touch })` from `lib.js`. Touch gestures go through CDP `Input.dispatchTouchEvent` (see the pinch test). Every page collects console errors, and `check(page)` fails on any.

## 5. How to work

1. Pick the next task from **Next up** in plan.md (unless the owner names another).
2. Branch `feat/<id>-<short-name>` from an up-to-date `main`.
3. Before changing code: read the task's **Done when**, run the tests it touches, and read only the files it names.
4. Work in small commits. Run focused tests while working and `tests/run.sh` before pushing.
5. Every task needs:
   - tests that would have failed without the change
   - docs (`docs/setup.md` for users, `docs/configuration.md` for site.json keys)
   - a `CHANGELOG.md` section with a patch bump in `manifest.json` (0.8.17, 0.8.18 …)
   - `version.json` bumped
   - the task marked `done (vX.Y.Z)` in plan.md, and ROADMAP.md updated
6. Open a pull request with what changed, why, and how it was tested. Wait for CI to be green. The owner merges and publishes the GitHub release, unless they ask you to merge.
7. **Stop and ask the owner** when:
   - a task needs breaking a product principle
   - a task needs a new dependency or a build step
   - a task changes the site.json format incompatibly
   - a task needs raising the minimum Home Assistant version
   - a task needs something only the owner can do (accounts, releases, Marketplace or brands pull requests)
   - a test fails and you cannot tell whether the test or the code is wrong

## 6. First batch: the four tasks to start with

Do them in this order, one pull request each. Briefs below add what you need beyond plan.md.

### M1: Install docs for the Marketplace (S)
- **Where HACS is mentioned** (grep `-i hacs`, outside `docs/roadmap` and the changelog):
  - `README.md:24` (install) and `:80` (updating)
  - `docs/setup.md:10, 17–21, 93`
  - `CLAUDE.md:3, 31`
  - `__init__.py:29, 211` (comments)
  - `mock.js:46` (a comment; keep "HACS" there, since the Nord Pool HACS integration is still called that)
- **New install text:** Settings → Marketplace → *Add from link* → `https://github.com/rsundin/SmartHomeDash` → install. Setup starts right away; a restart is still needed after updates. The first visit shows a community-code notice, and *Add from link* asks for a GitHub sign-in.
- **Keep** a one-line note for Home Assistant before 2026.11 (HACS custom repositories). `hacs.json` stays: the Marketplace still reads it. Check its `homeassistant` minimum (2024.8.0) against what the code really needs (registry names on `hass.entities` and floors need 2024.4+). Do not raise it without asking.
- **Tests:** none needed for docs. Add a check in `tests/run.sh` (or a backend test) that fails if `README.md` or `docs/setup.md` mention "Custom repositories" outside the pre-2026.11 note.

### Q6: The lost tap after a drag (S)
- **Reproduce:** `node --test --test-name-pattern="pinch" tests/browser/dashboard.test.js`. The pinch works and the drag pans, but `page.locator('.zoom-reset').tap()` never resets the zoom.
- **Code:** `frontend/js/ui/zoom.js`:
  - pointer bookkeeping in `pointers`, with `isPrimary` clearing it on pointerdown (line ~59)
  - `drag.on`, which mirrors `gesture.busy` from `util.js` and is used by `press()` to ignore lamp taps after gestures
  - the capture-phase `click` handler that swallows the click after a drag (line ~97)
  - `end()` resetting `drag.on` with `setTimeout(0)` after the last finger (line ~91)
- **Hypotheses to check, in order:**
  1. What `document.elementFromPoint` returns at the tap point while zoomed. Is the button still on top, or does the zoom layer or a lamp hit area cover it?
  2. Whether the tap's pointerdown arrives with `isPrimary` true. CDP `touchEnd` with an empty list may not release the drag's pointer.
  3. Whether `drag.on` is still true when the tap's click arrives. If so, the capture handler swallows it.
  4. Whether the button's own `onclick` runs but `set(1,0,0,true)` is undone by a following pointer event.
- **Log the gesture state** to the console in the test, rather than guessing. Fix the cause, keep the test strict (no extra waits), and run it 20 times in a row (`for i in $(seq 20); do …; done`). If the cause is real on devices, say so in the CHANGELOG.

### Q7: Tests against a real Home Assistant (M)
- **Package:** `pytest-homeassistant-custom-component`, which pins a Home Assistant version per release. Put the requirements in `tests/ha/requirements.txt`, with one pinned version for the newest Home Assistant. Use the Python version that Home Assistant release needs (check its docs; recent ones need 3.13).
- **Tests in `tests/ha/`**, using the plugin's fixtures (`hass`, `hass_client`, `hass_client_no_auth`, `hass_admin_user`, `hass_read_only_user`):
  - setup from YAML and from a config entry (`MockConfigEntry`)
  - the panel registered with the right `url_path` and renamed by options
  - SitesView: 401 without auth, GET for any user, PUT only for admins
  - the starter site created
  - diagnostics redacted
  - unload and reload
- **CI:** a new job **Home Assistant** in `.github/workflows/validate.yml`, running `pytest tests/ha`. Make it required only after it has been green twice; tell the owner, since branch protection is theirs.
- **Do not** replace `tests/backend`. Those tests stay fast and dependency-free.
- **Oldest version:** if testing the oldest supported Home Assistant (2024.8) is hard, report what the oldest working pin is and ask the owner before changing `hacs.json`.

### Q8: Split the setup guide and the strings (M)
- **`ui/setup.js` (837 lines)** has these sections, each in a function:
  - undo and redo (lines 65–96)
  - helpers (151)
  - basics (199), quick start (214), overview (251, with energyPoints and noDroneGuide)
  - plans (405, with room shaping and area pickers)
  - energy (595), buttons (672), wall (695), lights (755), backup (773)
  - drawing (778–)
- **Target:** `ui/setup/index.js` (createSetup, render, history, close), one module per step that takes a shared context object (`{ cfg, site, store, areas, changed, render, status, t, … }`), and `ui/setup/draw.js`. `ui/setup.js` can remain as a re-export, so imports elsewhere do not change.
- **Strings:** move `STRINGS.en` and `STRINGS.sv` from `i18n.js` to `frontend/i18n/en.json` and `sv.json`. `i18n.js` loads the site's language and English with `fetch` (relative to `import.meta.url`), before `start()` renders. In panel mode, the frontend files are served by `FrontendView`, so JSON works there.
- **Tests:** `index.html` must preload the JSON for the standalone page and the demo (check `pages.yml` copies `frontend/i18n/`). Add a test that `en.json` and `sv.json` have the same keys and that every `t('…')` key used in the code exists.
- **No behaviour change:** all existing tests pass unchanged; update the CLAUDE.md layout and `index.html` MODULES.

## 7. Second batch, notes ahead of time

- **S4 (card):** `start()` assumes it owns the whole document:
  - `window.__shdRun` keeps one run per window
  - it uses `document.querySelectorAll`, `document.body` classes and global keyboard listeners
  - the room panel and setup are appended to `document.body`
  - fonts are declared with `@font-face` in `style.css`, which does not apply inside a shadow root

  A card in HA's main document needs a per-instance root (shadow DOM with the stylesheet adopted), no globals, and fonts declared on the document once. Plan that refactor first and keep the panel path working. Register the card's module with `frontend.add_extra_js_url` and announce it in `window.customCards`.
- **S5 (languages):** after Q8, each language is one JSON file. Mark machine-assisted translations in the file. The key-coverage test from Q8 covers them.
- **A1:** add `@axe-core/playwright` to the browser tests' install line in CI and in `tests/run.sh`'s comment; check both examples.
- **F1 (summer house mode)** depends on W2's screen profiles, so build W2 before F1 if the owner wants F1 early.

## 8. A prompt to start a session

> You are taking over development of SmartHomeDash in this repository. Read `docs/roadmap/kickoff.md`, then `CLAUDE.md`, then the **Next up** list in `docs/roadmap/plan.md`. Set up the tests as in section 3 of the kickoff and run `tests/run.sh` once to see the baseline. Then work through the first batch (M1, Q6, Q7, Q8) in order, one branch and pull request per task, following "How to work" in the kickoff. After each pull request, report in one short paragraph what changed, how it was tested and anything the owner must do. Stop and ask when the kickoff says so.
