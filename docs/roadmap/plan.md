# Roadmap plan

The working plan behind [ROADMAP.md](../../ROADMAP.md), written for Claude Code and contributors. Each task can be picked up on its own. The findings and sources behind the plan are in [research-2026-11.md](research-2026-11.md); references like [R9] point to its source list. Where the project stands is in [status-2026-11.md](status-2026-11.md). Starting fresh? Read [kickoff.md](kickoff.md) first.

## Next up (order set 13 November 2026, owner's wishes added 14 November 2026)

Take these in order. L1, L2, H4 and L3 come before S5 because they are what the owner wants on their own wall screen now, and S5 then translates their texts along with the rest. They take precedence over "first `todo` in the file" until the owner changes the list.

1. **M1** Install docs and metadata for the Marketplace (HACS moved into Home Assistant)
2. **Q6** The lost tap after a drag (the pinch zoom test fails outside CI)
3. **Q7** Tests against a real Home Assistant
4. **Q8** Split `setup.js` and the strings, before S5 adds languages
5. **S4** A card for any dashboard
6. **L1** All lights on and all off
7. **L2** Goodnight: lights stay on a few minutes, then everything turns off
8. **H4** Cameras on the picture (moved up from 1.1)
9. **L3** LED strips drawn as lit lines and areas
10. **S5** More languages
11. **S6** A Marketplace listing
12. **A1** Accessibility and large text
13. **G1** Launch: show the project to the community
14. **F1** Summer house mode, then **F2** warm-up before arrival
15. **W2** Screen profiles and guest mode, then **W1** the house as screensaver
16. **H2**, **H1**, **H3**, **H5**, **H6**, **E1**, then the rest in file order

## How to work this plan

1. Take the first task whose status is `todo` and whose `Depends` are `done`, unless the owner names another.
2. Branch `feat/<task-id>-<short-name>` (for example `feat/q1-tests`), one task per branch and pull request.
3. Read `CLAUDE.md` first; its rules apply (English in code and docs, UI strings in `frontend/i18n/` in Swedish and English, no real-home data, no build step, no outside calls).
4. Meet every point under **Done when**. Add or extend tests (see Q1), update `docs/configuration.md` or `docs/setup.md` when behaviour or config changes, and add a `CHANGELOG.md` entry with a version bump in `manifest.json`: the next patch version for each task (0.8.10, 0.8.11 …); the owner decides when a release is big enough for 0.9.0, and 1.0.0 comes when everything runs stable.
5. In this file, set the task's status to `done (vX.Y.Z)`; in `ROADMAP.md`, move finished milestones to **Done**.
6. Keep the product principles below. If a task seems to need breaking one, stop and ask the owner.

**Product principles**
- A real picture of your own home, not a 3D model. No modelling tools.
- Set up in the Home Assistant UI in about an hour, no YAML needed.
- Fast on an old wall tablet: light mode must keep working for every feature.
- Home Assistant is the source of truth: areas, floors, names and states come from it. Nothing is invented or kept elsewhere.
- Read-only for anything that can lock someone out or let someone in, unless the owner turns control on.

**Sizes:** S is under a day, M is one to three days, L is more than three days.

---

## 0.9: Foundation (quality, speed, compatibility)

The community's top complaint is slow dashboards [R22][R23]. Work through Claude Code also needs a safety net. So this milestone comes first.

### Q1: Automated tests in the repo and in CI. Status: done (v0.8.6). Size: M
- **Why:** Until now, regression checks have lived outside the repo. Every later task depends on catching breakage.
- **What:**
  - `tests/backend/`: run the integration with stand-ins for `homeassistant` and `aiohttp`. Cover `safe_path` (traversal and symlinks), `_is_picture`, chunked uploads (a 3 MB picture and a large site.json arriving in 64 kB chunks), size limits, admin-only writes, starter sites (house and apartment, sv and en; entities stripped), and `updater.install` (GitHub-style tarball, refusing `../`).
  - `tests/browser/`: Playwright against `python3 -m http.server`, at 390×844, 844×390, 1080×810, 1280×800 and 1920×1080, with both examples. Assert no console errors and no sideways overflow. Also cover: opening a building, opening a room and switching a lamp; night mode; kiosk; pinch zoom (CDP touch events); dragging a lamp in placement mode; the setup guide steps; closing the guide with and without changes; warnings and badges; the energy flow in day mode.
  - A harness page (`tests/browser/harness.html`) that starts the panel code with the mock adapter. It exposes `window.store` to set states, and restarts in place for placement mode, like the HA panel.
  - `tests/run.sh` runs both. A new CI job **Tests** runs it (Node and Playwright Chromium in Actions) and is required on main.
- **Files:** `tests/**`, `.github/workflows/validate.yml`, `CLAUDE.md` (checks section).
- **Done when:** `tests/run.sh` passes locally and in CI; a deliberately broken `zoom.js` or `views.py` fails the run; `CLAUDE.md` tells Claude Code to run it before pushing.

### Q2: Performance budget and measurements. Status: done (v0.8.7). Size: M. Depends: Q1
- **Why:** Dashboards with very large DOMs and many listeners freeze tablets [R22]. Light mode exists, but nothing measures it.
- **What:**
  - A test site with 3 floor plans, 40 rooms, 120 lamps and 60 sensors (generated by a script in `tests/fixtures/`).
  - Measure in Chromium with 4× CPU throttling: DOM node count, time to first render, and long tasks over 30 s of state churn (the test changes about 40 states every 2 s).
  - Budgets: under 4,000 DOM nodes on the overview, first render under 2 s throttled, in steady state the three longest tasks average 100 ms or less and none is over 150 ms (changed in 0.8.13: a single maximum swung 70–105 ms between runs of the same code).
  - Fixes as needed:
    - build floor plans when first shown, not at start
    - batch store notifications per animation frame
    - pause CSS animations and timers while the page is hidden (`visibilitychange`) or the idle dim is on
    - avoid `filter`/`backdrop-filter` in light mode
- **Files:** `frontend/js/main.js`, `store.js`, `views/*.js`, `css/style.css`, `tests/browser/perf.test.js`, `tests/fixtures/perf-site.js`.
- **Done when:** a perf test asserts the budgets in CI. A short "Performance" section in `docs/setup.md` lists what light mode turns off.

### Q3: Names as Home Assistant shows them (2026.11 naming). Status: done (v0.8.8). Size: S
- **Why:** HA 2026.11 shows "device name + entity name" and is deprecating `friendly_name` [R4]. The dashboard reads `attributes.friendly_name` in about two dozen places.
- **What:**
  - One `nameOf(id)` helper in `entities.js` with this order:
    1. a name set in site.json
    2. the entity registry name (`hass.entities[id].name`), combined with the device name the way HA does when the entity has no own name
    3. `friendly_name`
    4. the entity id
  - The mock and token adapters provide the same data.
  - Replace the direct `friendly_name` reads.
- **Files:** `entities.js`, `adapters/*.js`, every `friendly_name` reader.
- **Done when:** no direct `friendly_name` reads remain outside the helper. A unit test covers the four cases. Names on the plan, the cards and the panel match HA's more-info dialog.

### Q4: Electricity prices at 15 minutes. Status: done (v0.8.10). Size: M
- **Why:** Nord Pool moved to 15-minute day-ahead prices in October 2025 [R15][R16]. `entities.js` averages them back to hours, which hides the price swings that 15-minute pricing is about.
- **What:**
  - Keep the native resolution (24, 96 or 92/100 slots on DST days).
  - Read `raw_today`/`raw_tomorrow` entries with `start`, `end` and `value`/`price` when present, and place them by time, not by index.
  - Chart: one bar per slot, with a "now" marker per slot. On narrow cards, show quarter-hour bars thinner.
  - Cheapest window: counted in slots, still configured in hours (`window_hours`).
  - "Cheap now": compare the current slot.
  - Support the core Nord Pool integration through its price action (`nordpool.get_prices_for_date`, called with `return_response`) when the entity has no price attributes.
- **Files:** `entities.js` (`pricesToday`, `pricesTomorrow`, `cheapestWindow`), `ui/cards.js`, `adapters/mock.js` (a 96-slot mode), docs.
- **Done when:** unit tests cover hourly, quarter-hourly, raw start/end lists and a DST day. The card on a 96-slot mock shows the right "now" slot and the right cheapest window across midnight.

### Q5: Config check with clear messages. Status: done (v0.8.11). Size: S
- **Why:** Entities renamed or removed in HA silently disappear from the picture today.
- **What:**
  - On load, list entity ids in site.json that HA does not know. Show them as an info warning ("3 devices in the dashboard no longer exist in Home Assistant"), unfolding the list, with a link into placement mode filtered to them.
  - Validate site.json structure on save in `views.py` (types of the top-level keys, polygons as number pairs) and return a readable 400.
- **Files:** `status.js`, `main.js`, `ui/editor.js`, `views.py`.
- **Done when:** tests cover a missing entity and a malformed site.json.

### M1: Install docs and metadata for the Marketplace. Status: done (v0.8.17). Size: S
- **Why:** Since Home Assistant 2026.11, HACS is the built-in **Marketplace** (Settings → Marketplace). A separate HACS install is blocked, and custom repositories are added with **Add from link** after a GitHub sign-in [R27][R4]. README and `docs/setup.md` still describe HACS menus that no longer exist, at the moment new users arrive.
- **What:**
  - Rewrite install steps in README and `docs/setup.md`: Marketplace → Add from link → repository URL → install, which goes straight into the setup flow.
  - Keep a short note for Home Assistant before 2026.11 (HACS custom repositories).
  - Check that `hacs.json`, `manifest.json` and the release notes give the Marketplace what it shows: minimum Home Assistant version, a clear description, brand images (`brand/` in the integration; also in home-assistant/brands under S6).
  - Mention in README that the Marketplace shows a community-code notice, and what SmartHomeDash accesses (SECURITY.md).
  - The setup guide's "Update" texts and `smarthomedash.update` docs refer to the Marketplace instead of HACS.
- **Done when:** every mention of HACS menus is replaced or marked "before 2026.11"; a fresh install following the README works on Home Assistant 2026.11 (owner checks once).

### Q6: The lost tap after a drag. Status: done (v0.8.18). Size: S
- **Why:** The browser test "pinch zoom with two fingers, and a tap still works after" passes in CI but failed 3 of 3 runs on a second machine: the tap on **Reset zoom** right after a one-finger drag never arrives. 0.8.13 added a wait and called it timing, but a lost tap may be real on slow tablets (see status-2026-11.md).
- **What:** Reproduce with CDP touch events and with Playwright `tap()`. Trace the drag flag and pointer bookkeeping in `ui/zoom.js` (`drag.on`, `pointers`, `isPrimary`, the click suppression in capture). Fix the cause rather than the timing, and add a unit-level test of the gesture state machine where possible.
- **Done when:** the test passes 20 runs in a row locally and in CI, with no added waits; any real cause found is in the CHANGELOG.

### Q7: Tests against a real Home Assistant. Status: done (v0.8.19). Size: M. Depends: Q1
- **Why:** The backend tests use stand-ins for Home Assistant. The config flow, options flow, panel registration and sidebar rename, diagnostics, the update action and the views have never run under Home Assistant itself.
- **What:**
  - Add `pytest-homeassistant-custom-component` tests in `tests/ha/` that set up the integration from YAML and from a config entry.
  - Cover: panel registered and renamed, the views with authenticated and unauthenticated clients (`hass_client`, `hass_client_no_auth`), admin-only writes with a non-admin user, the starter site, diagnostics redaction and unloading.
  - A CI job pinned to the oldest supported (`hacs.json` minimum) and the newest Home Assistant.
- **Done when:** the job runs on every pull request and is required on main; it would have caught a broken config flow import.
- **Result (0.8.19):** 17 tests, on Home Assistant 2026.10.4 and 2025.6.3. 2025.6 is the oldest version on which all pass: **Configure** fails before 2024.12 (`OptionsFlow.config_entry`), and the update action cannot be registered before 2025.6 (`supports_response` on admin services). The owner raised the `hacs.json` minimum from 2024.8.0 to 2025.6.0 with this. Open for the owner: make the job required in branch protection.

### Q8: Split the setup guide and the strings. Status: done (v0.8.20). Size: M
- **Why:** `ui/setup.js` (837 lines, with very long lines) and `i18n.js` (1,053 lines) are the largest files, and every task touches them. S5 will add five languages to `i18n.js`.
- **What:**
  - Move each setup step into `ui/setup/<step>.js` with a small shared module for `draw`, fields and undo.
  - Move strings into `frontend/i18n/sv.json` and `en.json`, loaded by `i18n.js`, with a check that both have the same keys. This is the first half of S5.
  - No behaviour change.
- **Done when:** all tests pass unchanged; no setup file is over 400 lines; `index.html` MODULES and CLAUDE.md layout are updated.

---

## 1.0: Nearly zero setup

Setup effort is the main barrier for every floor plan project [R5][R6][R11]. SmartHomeDash is already the easiest. This milestone makes it effortless and lets it reach every dashboard.

### S1: Quick start from Home Assistant floors and areas. Status: done (v0.8.12). Size: L. Depends: Q3
- **Why:** HA builds dashboards from areas automatically [R1]. A new user should get something useful before drawing anything.
- **What:**
  - In the setup guide, **Start from my Home Assistant** creates, for each HA floor, a floor plan with no picture: a tidy grid of room tiles, one per area on that floor (sized by device count), linked with `ha_area`. Areas without a floor go on one plan.
  - Lights are placed automatically (as in 0.7 auto-placement) and drawn on the tiles.
  - Later the user can upload a picture for a plan; the guide then asks to redraw the rooms on it, keeping the area links.
- **Files:** `ui/setup.js`, `areas.js`, `views/floorplan.js` (plan without picture: neutral tile style), `site.js`.
- **Done when:** a fresh install with HA floors and areas shows a working plan in under a minute with no drawing. Tested on a mock with 2 floors and 9 areas.

### S7: Report a problem and get help. Status: done (v0.8.14). Size: S. Next after 0.8.13 (placed here so it is picked before S2)
- **Why:** Problems in real homes should reach the repo with what is needed to solve them, without users having to know where to go or leaking details about their home. A bug report template exists but nothing in the dashboard points to it, and there is no place for questions or ideas that are not bugs.
- **What:**
  - **Report a problem** in the dashboard menu and the setup guide: opens a new GitHub issue with the bug template filled in with SmartHomeDash version, Home Assistant version, browser, screen size, kiosk or light mode, and the config check messages (Q5), never entity ids, names or pictures. The user sees the text before it leaves.
  - Home Assistant **Download diagnostics** for the integration (`diagnostics.py`, `async_redact_data`): version, options, site count and sizes, counts of rooms, lamps and sensors per site, missing entities as counts only.
  - Issue templates: the bug report asks for diagnostics and device (wall tablet, phone, browser); a feature request template; `config.yml` links questions to Discussions.
  - **GitHub Discussions** (Q&A, Ideas, Show and tell) for questions, wishes and screenshots, linked from README and ROADMAP ("ideas and votes are welcome").
  - Later, with S6: a thread on the Home Assistant Community forum (Dashboards / Share your projects) when the integration is in the default HACS list, pointing back to Discussions and issues.
- **Files:** `ui/` menu and `ui/setup.js`, `i18n.js`, `custom_components/smarthomedash/diagnostics.py`, `.github/ISSUE_TEMPLATE/`, `README.md`, `ROADMAP.md`, `docs/setup.md`.
- **Done when:** a tap on **Report a problem** opens a prefilled issue with no entity ids or names in it (browser test checks the URL); diagnostics download with tokens and entity ids redacted (backend test); Discussions is on and linked.

### S2: Editor comforts. Status: done (v0.8.15). Size: M
- **Why:** Precise placement and editing are a recurring wish [R6][R12]. NeonPlan's editor sets the bar [R9].
- **What:**
  - Undo and redo, kept in the setup guide and in placement mode until saved.
  - Move a room's corners by dragging, add a corner on an edge, remove one with a long press.
  - Snap corners to nearby corners and edges of other rooms (toggle).
  - Move a whole room or building.
  - Arrow keys nudge the selected item.
- **Files:** `ui/setup.js` (`draw`), `ui/editor.js`, shared helpers in `util.js`.
- **Done when:** browser tests cover undo/redo, corner drag and snap.

### S3: Export, import and restore points. Status: done (v0.8.16). Size: M
- **Why:** Backups and moving between installations come up often [R9][R18]. Only one `.bak` is kept today.
- **What:**
  - Download the dashboard (site.json and pictures) as one `.zip` from the setup guide (admins).
  - Import a `.zip` into a new or existing dashboard: validated, size-limited, magic-byte checked, with no paths outside the site folder.
  - Keep the last 10 saved versions of site.json (`site.json.1` and so on, rotated) and list them in the guide with **Restore**.
- **Files:** `views.py` (new endpoints, admin only), `ui/setup.js`, `docs/setup.md`, `SECURITY.md` (new surface).
- **Done when:** backend tests cover zip traversal, oversize and non-image entries. A round trip export/import reproduces the dashboard.

### S4: A card for any dashboard. Status: done (v0.8.21). Size: L. Depends: Q2
- **Why:** NeonPlan and the energy cards work inside existing dashboards [R9][R14]. HA 2026.6 lets custom cards suggest themselves in the card picker [R3].
- **What:**
  - `custom:smarthomedash-card` showing the overview, one floor plan or one room of a chosen dashboard, with a visual editor (dashboard, view, height).
  - Load it as a dashboard resource from the integration (registered automatically).
  - Opt in to `getEntitySuggestion` for lights in linked areas.
  - Shares the code with the panel; tapping opens the room panel inside the card.
- **Files:** `frontend/card.js` (new), `__init__.py` (resource registration), `main.js` (embeddable start), docs.
- **Done when:** the card works in a sections view on phone and desktop, and the panel is unchanged. Browser tests cover the card harness.

### S5: More languages and a translation workflow. Status: todo. Size: M
- **Why:** The leading competitor ships 19 languages [R9]. The audience is European.
- **What:**
  - Move strings from `i18n.js` into `frontend/i18n/<lang>.json`, loaded on demand.
  - English is the fallback; a test fails on keys missing in English or Swedish.
  - Add German, Norwegian (bokmål), Danish, Finnish and Dutch, marked "machine-assisted, corrections welcome".
  - The setup guide's language picker lists them. Dates and numbers follow the locale.
  - `docs/translating.md` for contributors.
- **Done when:** a key-coverage test runs in CI, and every language renders without missing keys on both examples.

### S6: A listing in the Home Assistant Marketplace. Status: todo. Size: S. Depends: M1, S5
- **Why:** Since 2026.11 the default HACS list is what the built-in Marketplace shows [R27]. Being listed means people can find SmartHomeDash without a link.
- **What:**
  - Submit the icon to home-assistant/brands and remove `ignore: brands` from the HACS check.
  - Follow the current Marketplace inclusion process (formerly hacs/default; check the docs at the time). It needs the owner to open pull requests from their account, so prepare the files and the text.
- **Done when:** the HACS check passes without ignores, and the owner has the submission text and steps.

### A1: Accessibility and large text. Status: done (v0.8.26). Size: M
- **Why:** Users ask for bigger text, keyboard navigation and graphs a screen reader can read [R39][R40]. A wall screen for the whole family includes older parents and guests.
- **What:**
  - A **Text size** setting per screen (normal, large, extra large) that scales labels, cards, the room panel and touch targets, remembered per device.
  - Keyboard: every room, lamp, building and button reachable with Tab in a sensible order, Enter and Space act, Escape closes, and focus is visible.
  - Screen readers: lamps, rooms and buildings have names and states (`aria-label`, `aria-pressed`); the price chart and the temperature graph have a text summary.
  - Contrast checked for text on the picture (labels, flow tags, badges) in day and evening.
- **Done when:** an automated accessibility check (axe-core in the browser tests) passes on both examples, a keyboard-only test opens a room and switches a lamp, and large text has no overflow at 390 px wide.

### G1: Launch: show the project to the community. Status: todo. Size: S. Depends: S6
- **Why:** At 0.8.16 the repository has no stars and one issue. Ready-made dashboards with a clear look are what people look for now [R30].
- **What:**
  - A short screen recording (GIF or WebP) for the README: lights switching on the picture at dusk, the roof lifting, a room panel. Recorded from the demo with test data.
  - Draft posts for the owner to publish: a Home Assistant Community thread (Dashboards / Share your projects) and r/homeassistant, pointing to the demo, the Marketplace and Discussions.
  - A "Show and tell" Discussion with how to share your own dashboard without private details.
- **Done when:** the recording is in the README, and the owner has the post texts.

---

## Whole-house control

Added 14 November 2026 at the owner's request. Small things a wall screen in the hall is used for every day.

### L1: All lights on and all off. Status: done (v0.8.22). Size: S
- **Why:** The lights card already has **Släck allt** (two taps), but there is no **Tänd allt**, and on a wall screen the card is a scroll away from the picture.
- **What:**
  - **Tänd allt** beside **Släck allt** in the lights card. "All" means the lights on this dashboard, including the ones picked up from linked areas (`site.index.lights`), not every light in Home Assistant. On takes one tap; off keeps its second tap, so nobody is left in the dark by mistake.
  - The same two buttons as one compact control in the header (a lamp icon that opens on and off), so they are reachable from the picture and the floor plan without scrolling. Hidden in the card for other dashboards (`body.is-embed`).
  - `"all_lights": { "exclude": ["light.garden"] }` in site.json leaves chosen lights out of both (outdoor lights on a schedule, a child's night light), and `"enabled": false` hides them. Both are set under **Buttons** in the setup guide, which the owner asked for: each whole-house action can be turned on or off there.
- **Files:** `ui/lights.js` (new), `ui/cards.js`, `main.js` (header), `ui/setup/buttons.js`, `views.py` (site.json check), `i18n/*.json`, `docs/configuration.md`.
- **Done when:** browser tests cover on in one tap, off in two, an excluded light left alone, and the header control in kiosk and light mode.

### L2: Goodnight. Status: done (v0.8.23). Size: M. Depends: L1
- **Why:** Going to bed means walking through the house with the lights still on, then everything off. One tap on the hall screen should do it.
- **What:**
  - A **Godnatt** button (beside the L1 control and in the lights card). It starts a countdown, 5 minutes by default: lights stay as they are, a small banner on every open screen says "Släcker allt om 4:12" with **Avbryt**, and when it runs out every light from L1 (minus the exclusions) turns off.
  - It runs in Home Assistant, not in the browser: the integration adds the action `smarthomedash.goodnight` (`entity_id`, `minutes`, `cancel`) that schedules the turn-off with `async_call_later`, and a state per site (`smarthomedash.goodnight_<site>`, `on` with `ends_at` while counting down), set like `sun.sun` so it works for dashboards from YAML too, which have no config entry. Every screen shows the countdown from that state. Closing or reloading the tablet does not stop it, and the action can also be used from automations, voice or an NFC tag.
  - Optional `"goodnight": { "minutes": 5, "then": "script.goodnight" }` in site.json: `then` runs a script of the user's own when the lights go off (lock up, TV off, heating down). The integration does not write scripts or automations into the user's configuration.
  - Turned on or off under **Buttons** in the setup guide, like L1 (`"goodnight": { "enabled": false }`).
  - A restart of Home Assistant during the countdown cancels it (said in the docs); a second tap on **Godnatt** restarts the countdown.
- **Files:** `__init__.py`, `services.yaml`, `strings.json` + `translations/`, a new `goodnight.py`, `ui/lights.js`, `ui/cards.js`, `main.js`, `i18n/*.json`, `docs/configuration.md`, `docs/setup.md`, `SECURITY.md` (a new action: any logged-in user can call it, like turning lights off).
- **Done when:** `tests/ha` covers the action scheduling and cancelling the turn-off and the state (with time moved forward); browser tests cover the banner, its countdown from the sensor and **Avbryt**; the backend stand-in tests still pass.

### L3: LED strips drawn as lit areas. Status: todo. Size: M. Depends: S2
- **Why:** The owner asked (14 November 2026) for LED strips to be drawn as what they are: a line or a surface that glows, not a round spot.
- **What:**
  - In placement mode a light can be placed as a **strip**: drawn as a line with two or more points (under a kitchen cabinet, along a stair) or as a surface (a cove ceiling, a backlit panel), with the same drawing and corner editing as rooms (`ui/shape.js`).
  - On the floor plan: `"lights": [{ "entity": "light.kitchen_strip", "line": [[x, y], ...], "width": 60 }]` or `"area": [[x, y], ...]`. On the overview the zone lamp gets `"type": "line"` or `"type": "area"` beside today's `point`, `wall` and `ground`.
  - It glows along its whole length in the light's own colour and brightness (`glow.js`), as a soft blurred stroke or fill; in light mode a plain coloured line or fill, no blur.
  - A tap anywhere on the strip switches it, a long press opens the room, like a lamp.
- **Files:** `views/floorplan.js`, `views/overview.js`, `glow.js`, `ui/editor.js`, `ui/shape.js`, `site.js`, `views.py` (site.json check), `css/style.css`, `docs/configuration.md`.
- **Done when:** browser tests cover drawing a strip, switching it by tapping it, its colour following the light, light mode without blur, and the performance budget with strips on the large test site.

---

## 1.1: More of the home on the picture

Competitors show people, openings, media, appliances, cameras and power where they are [R9][R21].

### H1: People in rooms. Status: todo. Size: M
- **What:**
  - `person.*` entities with a picture or initials. On the overview: who is home, as small avatars by the house; away people listed in a header chip.
  - Room level: if a person has a room sensor (`sensor.<name>_area`, Bermuda or ESPresense style; configured per person in the guide), the avatar sits in that room on the floor plan [R26].
  - Privacy: off by default, with a setting to turn it on for each dashboard.
- **Done when:** a mock with two people moving between rooms renders correctly; light mode keeps static avatars.

### H2: Doors and windows where they are. Status: todo. Size: M. Depends: S2
- **Why:** Room badges say "something is open". Showing the window on the plan and the picture says which one [R21].
- **What:**
  - Placement mode places opening sensors (and `cover.*` garage doors) like lamps. On the floor plan they draw as a short wall segment that opens (an arc or gap) when open.
  - On the overview, a placed window outline tints when open.
  - Unplaced ones keep today's room badge.
- **Done when:** tests cover placing, opening and closing, and the fallback badge.

### H3: Media and appliances. Status: todo. Size: M
- **What:**
  - `media_player` playing: a soft pulse in its room, and a "now playing" row in the room panel (title, artwork, play/pause, volume).
  - Appliances: washer, dryer and dishwasher from a power sensor or state. Running shows an icon in the room; done raises an info warning ("The washing machine is done") that clears when the door opens or after a set time.
  - Robot vacuum status in its room.
- **Done when:** mock media and appliance cycles show and clear correctly.

### H4: Cameras on the picture. Status: done (v0.8.25). Size: M. Depends: S2
- **Why:** The owner wants to place cameras on the picture and tap one to see it. The doorbell window (0.8.0) already shows a camera live or as stills through Home Assistant's camera proxy.
- **What:**
  - Placement mode lists `camera.*` entities as their own group. A camera is placed like a lamp, on a floor plan (`cameras` in the plan, `{ "entity": "camera.garden", "at": [x, y], "angle": 200, "motion": "binary_sensor.garden_motion" }`; the direction is set with ↺/↻ in 45° steps in placement mode) or on the overview picture (`overview.cameras`, in image pixels).
  - On the plan a small camera icon, and an optional field-of-view wedge pointing along `angle` (turned with ↺/↻ in placement mode). The wedge turns red while the linked motion sensor is on; without `motion`, the camera's own `motion_detected` attribute is used where it exists.
  - A tap opens the camera window: the doorbell's window moved into a shared `ui/camera.js` (live MJPEG where Home Assistant streams it, otherwise a still every two seconds; stills only in light mode). It closes on × or a tap outside, and after 2 minutes on a wall screen so a stream is not left running. Several placed cameras give arrows to step between them.
  - No camera address or password in site.json; everything goes through `/api/camera_proxy*` with the user's own login, so non-admins see only what Home Assistant lets them see. W2 guest mode can later hide cameras.
- **Files:** `ui/camera.js` (new, from `ui/wall.js`), `ui/editor.js`, `views/floorplan.js`, `views/overview.js`, `site.js`, `status.js` (missing-entity check), `adapters/mock.js` (mock snapshots), `i18n/*.json`, `docs/configuration.md`.
- **Done when:** browser tests cover placing a camera, the wedge on motion, opening and stepping in the camera window with mock snapshots, stills in light mode, and the doorbell window unchanged.

### H5: Power per room. Status: todo. Size: M. Depends: Q3
- **Why:** HA 2026.2 added a power distribution card [R2], and "energy nerd" dashboards are a popular style [R25].
- **What:**
  - An **Energy view** toggle on the floor plan tints rooms by the summed power of the power sensors in their area, with watts on each room.
  - The energy card lists the top three consumers right now.
  - Uses device-class power sensors found through areas; double counting is avoided by skipping sensors whose device also has a parent power sensor.
- **Done when:** a mock with per-room power sensors renders the tint and the top list; the toggle is remembered per screen.

### H6: Climate overlays. Status: todo. Size: S
- **What:** The floor plan tint switches between temperature (today), humidity and CO₂ where sensors exist, from a small control on the plan. Thresholds follow common comfort ranges and can be set in site.json.

### E1: Solar forecast beside the flow. Status: todo. Size: S
- **Why:** Solar forecast cards and battery planners sit next to live flow on many energy dashboards [R36][R37].
- **What:** If a forecast entity exists (Forecast.Solar or Solcast, picked in the guide's Energy step), the energy card shows today's expected production against what has come so far, with a small curve. The solar label on the picture says "6.2 kW · 18 of 24 kWh expected".
- **Done when:** mock forecast attributes for both integrations render, and the card hides the forecast when none is set.

### E2: Car charging plan. Status: todo. Size: S. Depends: E1
- **What:** With a car battery level entity, the car end of the flow shows the level. The cheapest window from the price card is offered as "Charge 01:15–04:15 for 0.42 kr/kWh on average", read-only. It uses the charger's own planned window if the charger integration exposes one.

### E3: Capacity peak (optional). Status: todo. Size: S
- **Why:** The 2027 requirement for capacity tariffs was stopped, but the 30–50 Swedish grid companies that already charge by peak keep doing so [R35].
- **What:** Off by default. The guide's Energy step sets the rule (hourly average, number of peaks per month, day or night hours). The energy card then shows this hour's average so far against the month's peaks, and a warning appears when the hour is on its way to a new peak.
- **Done when:** unit tests cover the averaging and the monthly peaks; off means nothing changes.

---

## 1.2: Wall screens as an ambient display

### W1: The house as screensaver. Status: todo. Size: M
- **Why:** Screensavers with clock, weather or photos are the most common wall-screen feature [R17][R18]. Our picture of the house, with dusk, weather, lamps and energy flow, is a better one.
- **What:**
  - After the idle time in kiosk mode, an ambient mode shows the overview full screen: big clock, outdoor temperature, the next calendar event (optional `calendar.*`), and warnings.
  - No buttons; a touch returns to the dashboard.
  - At night it hands over to the existing dim.
  - Optional photo-frame mode cycling a media source folder, with the house returning every few pictures. Photo frames are one of the features that set ready-made dashboard apps apart [R30].
- **Done when:** tests cover entering and leaving ambient mode, warnings shown in it, and light mode without animation.

### W2: Screen profiles and guest mode. Status: todo. Size: M
- **Why:** Tablets that show only their own floor work well [R21]. Floor3DX limits locks, garage doors and alarms for guests [R7]. Guest access is missing in most dashboard apps [R30], so this sets SmartHomeDash apart.
- **What:**
  - Named screen profiles in the guide (for example "Hall", "Kitchen", "Guest room"), chosen with `?screen=hall` or on the device.
  - Each profile sets the start view (overview, a floor or a room), idle behaviour and allowed actions.
  - Guest mode hides placement, setup and the update button, makes locks, alarm, garage doors and gates read-only, and can hide chosen rooms.
- **Done when:** tests cover start view, guest restrictions (a guest tap on a garage door does nothing) and the setting persisting per device.

### W3: Family strip. Status: todo. Size: S
- **What:** An optional strip on wall screens and in ambient mode: today's events from chosen `calendar.*` entities, the first items of a `todo.*` list, and waste collection dates (`sensor.*` from common integrations). Hidden when nothing is configured.

### W4: Voice from the wall. Status: todo (exploratory). Size: M
- **Why:** NeonPlan and View Assist add a voice button with room context [R9][R20].
- **What:** A microphone button sends speech to HA Assist (browser microphone with an HA pipeline, or text input as a fallback), with the screen profile's room as context. Show the answer as a toast.
- **Done when:** text input works through the conversation API in tests, and the microphone path works on a real device (owner checks).

### W5: Alarm panel. Status: todo. Size: S
- **What:** The state of an `alarm_control_panel` in the header and in ambient mode. Arming and disarming with the panel's code on screen is off by default; when on, guest profiles still cannot disarm.

### W6: Paper mode for e-ink screens. Status: todo (exploratory). Size: M
- **Why:** E-ink status boards and old Kindles are a popular low-power way to show home status [R33][R34].
- **What:** `?paper` renders a black-and-white, high-contrast, no-animation view: the overview with lit lamps marked, warnings, temperatures, today's price summary and the next event. It reloads itself every few minutes. It works in a simple browser through the token adapter. A static image endpoint for TRMNL-style devices is a possible follow-up, but it needs a renderer and is out of scope here.
- **Done when:** the view passes a test in a 600×800 viewport with JavaScript timers only for the reload, and the owner tries it on one e-ink device.

---

## 1.3: The summer house and both homes

The owner's own case: a summer house watched from the apartment, frost and leaks in winter, warm it up before arriving. Holiday-home monitoring is about frost, humidity, intrusion and history [R38].

### F1: Summer house mode. Status: todo. Size: M. Depends: W2
- **What:**
  - A **Closed house** state for a dashboard (a switch in the header for admins, or following an `input_boolean` or HA's away state).
  - While closed, the overview leads with what matters when nobody is there: lowest indoor temperature and where, heating mode (frost or comfort), humidity, leaks and smoke, doors and locks, power and connectivity (the last time Home Assistant heard from key devices), and the last time someone was there (from presence or doors).
  - Frost and damp thresholds are set in the guide, and warnings use them.
  - The lights card and scenes step back.
- **Done when:** tests on the example house cover closed and open states, the frost warning, and the "last visit" text.

### F2: Warm up before arrival. Status: todo. Size: S. Depends: F1
- **What:**
  - An **Arriving** action: choose a time, and the dashboard sets the heating to comfort early enough to reach the target, estimated from the rooms' recent heating rate in history (shown as "Start heating at 13:40 to reach 21° by 18:00").
  - It runs as a Home Assistant automation or script that the guide creates or points to. The dashboard keeps no timers of its own.
- **Done when:** the estimate is unit-tested on recorded curves, and the action is visible only to admins.

### F3: Both homes at a glance. Status: todo (exploratory). Size: L
- **What:**
  - Tiles for each dashboard on this Home Assistant (the apartment and the summer house as separate sites), with warnings across them.
  - Optionally, a second Home Assistant reached with a long-lived token stored in Home Assistant, not in the browser.
  - Read-only summary; tapping opens that dashboard.
- **Done when:** two sites on one Home Assistant show side by side with their warnings; the remote option has a security review in SECURITY.md before it ships.

---

## Later and ideas

- **Day timeline:** scrub through today on the picture (lights, doors, heating, people) using the history API, to answer "what happened while we were away".
- **Heating schedules in the room panel:** through HA schedule helpers or the Scheduler integration, edited per room.
- **A daily summary written by AI:** with Home Assistant's AI Task set up, a few sentences on the wall screen ("Quiet night, 21° inside, the heat pump ran 6 hours, cheapest power 02–05") [R32]. Off by default, local models first.
- **Camera events with AI summaries** in the camera window, from LLM Vision's timeline when installed [R31].
- **A community section** for Home Assistant's section picker (2026.11), in addition to the card [R4].
- **Sunlight through windows** following the sun's position, as a subtle effect on the overview.

## Not planned

- **A 3D editor or 3D models:** heavy, slow on tablets and a lot of setup [R6]. That is the opposite of this project.
- **card-mod style theming** of every element: one well-made look, with light mode for slow screens, is enough.
- **SVG or Inkscape workflows** [R5].
