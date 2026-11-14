# Changelog

## 0.8.22

All lights on and off with one button.

- **All on, beside All off.** The lights card had **All off**; it now has **All on** too. All on takes one tap, All off still asks for a second tap so nobody is left in the dark by mistake
- **In the header, also on wall screens.** A lamp button in the header opens both, so they are one tap away from the picture and the floor plan without scrolling to the lights card. It stays in kiosk mode, and the lamp lights up while any light is on. Not shown in the card for other dashboards
- **Choose what "all" means.** Under **Buttons** in the setup guide, the buttons can be turned off, and lights can be left out of them (garden lights on a schedule, a night light). In site.json: `"all_lights": { "enabled": false, "exclude": ["light.garden"] }`. "All" is every light on the dashboard, including the ones found in linked areas
- New tests: on in one tap and off in two from the header, an excluded light left alone from the lights card, the header control in kiosk mode on a phone, and turning the buttons off in the setup guide

## 0.8.21

The picture as a card in any Home Assistant dashboard.

- **New card: `custom:smarthomedash-card`.** Shows the overview, one floor plan or one room of a SmartHomeDash dashboard inside any other dashboard. It comes with the integration and is added to every dashboard by itself: find it under **Add card**, pick the dashboard and what to show. Reload the browser page once after updating
- **Only the picture.** No header, energy cards or warnings. Tapping a building opens its floor plan, tapping a room opens the room panel inside the card, and lamps and heating work as in the dashboard. A card for a floor plan or a room stays there
- **Sized by the dashboard.** In a sections view the card takes the size you drag it to (full width and six rows to start with). In other views it is 400 px high, or the **Height** you set
- **Suggested in the card picker** (Home Assistant 2026.6 and newer): picking a lamp or a thermostat that is in a room of a dashboard suggests a card for that room
- **The same code as the dashboard.** The card runs the dashboard in a frame of its own, as the sidebar panel does, so its styles and fonts cannot disturb Home Assistant's and nothing in the dashboard itself changed. Site files still come through Home Assistant's login; the card cannot change anything in the setup
- A dashboard that cannot be found now says "Cannot find …/site.json" also when the texts had not arrived yet (it could show the bare key `site.notFound`)
- New tests: the card in a stand-in Home Assistant dashboard on a phone and a desktop, the three kinds of view, lamps through Home Assistant's services, the editor, the suggestions, and under a real Home Assistant that the card's files are served and its module is added once

## 0.8.20

A tidier codebase for what comes next. Nothing looks or works differently.

- **One file per language.** The texts moved from `i18n.js` to `frontend/i18n/en.json` and `sv.json`. The dashboard fetches English and the site's own language before it draws anything, so a site in English no longer downloads the Swedish texts and the other way round. Adding a language is now one new file and one line
- **The setup guide in one module per step.** `ui/setup.js` (837 lines) became `ui/setup/`: the frame with undo, save and close, and a module each for basics, the overview picture, floor plans, energy, buttons, wall screen and lights, plus the shared helpers, drawing and the quick start
- New tests: every language file has the same keys and placeholders, every text the code asks for exists, the standalone page lists every module, the texts are fetched once with the page's version, and a start that fails still shows its message as text
## 0.8.19

Tests against a real Home Assistant, and three faults they found.

- **Adding a dashboard with the default name "Home" works again.** Home Assistant has a page of its own at `/home` (and `/light`, `/climate`, `/security`), so the name suggested by the form was refused with "address already in use". When no address is typed and the one made from the name is taken, `-dash` is added (`/home-dash`). An address you type yourself is still refused if it is taken. The YAML example in the README uses `my-home`
- **Export, versions, import and restore answer "administrators only" on every Home Assistant version.** On Home Assistant 2024.12 and older, a user who is not an administrator got an internal error (500) from these addresses instead of the refusal. Nothing was exported or written, but the check depended on a detail of the web library
- **New tests in `tests/ha/`** run the integration under Home Assistant itself (`pytest-homeassistant-custom-component`): setup from YAML and from the UI, the starter site for a house and an apartment, the config flow and its refusals, options (rename in place, reload for the rest), the views without a login, as an administrator and as another user, the sidebar following a name saved in the setup guide, diagnostics without anything that names the home, and unload, reload and removal. CI runs them on Home Assistant 2026.10.4 and on 2025.6.3
- **Home Assistant 2025.6 or newer is now required** (was 2024.8). The tests show that the older versions never worked fully: **Configure** on the integration fails before 2024.12, and setups with `github_token` or `repository` in YAML do not start before 2025.6
## 0.8.18

A tap right after flicking the zoomed picture is no longer lost.

- **The cause was real, not test timing:** with the picture zoomed in, a fast one-finger drag that lifts while still moving made the browser (Chromium: Chrome on Android, the companion app, Fully Kiosk) start a fling of its own, although the page does not scroll. While a fling runs, the browser swallows the next tap to "stop the fling", so a tap on **Reset zoom**, a lamp or a room within a moment after the flick did nothing. A drag that came to rest before lifting was never affected
- The dashboard now consumes the finger movement itself while the picture is zoomed or pinched, so the browser never starts a scroll or fling there. One finger on the picture at normal size still scrolls the page as before
- The pinch zoom test taps straight after the drag again, without the wait 0.8.13 added, and checks that movements are consumed only while zoomed or pinching. It passed 20 runs in a row; before the fix about 1 run in 25 lost the tap on the test machine
## 0.8.17

Install docs for the Marketplace, which replaced HACS in Home Assistant 2026.11.

- README and the setup guide (`docs/setup.md`) install through **Settings → Marketplace → Add from link** with the repository's address. Setup starts right away; a restart is still needed after updates. Both mention the community-code notice and the GitHub sign-in that *Add from link* asks for, and point to SECURITY.md for what SmartHomeDash can reach
- The HACS steps stay as a one-line note for Home Assistant before 2026.11
- Updating refers to the Marketplace; `smarthomedash.update` is for setups without it
- A test fails if README or the setup guide describe the old HACS menus outside that note
## 0.8.16

Backups and moving a dashboard: export, import and restore points.

- **Backup** is a new last step in the setup guide, for administrators in the Home Assistant panel
- **Download .zip** exports the dashboard as one file: site.json and every picture in its folder
- **Choose .zip …** imports such a file into this dashboard, after confirming. Home Assistant checks the whole file before writing anything: only site.json (with the same check as a save) and jpg, png or webp pictures by content, no names that lead out of the folder, and limits of 100 MB unpacked, 25 MB per picture and 200 files. A .zip of the dashboard's folder itself works too. To move a dashboard to another Home Assistant, add a new dashboard there and import into it
- **Restore points**: every save now keeps the last 10 versions of site.json (`site.json.1` the newest, to `site.json.10`) instead of a single `site.json.bak`. The guide lists them with when each was saved and how many floor plans and rooms it has, and **Restore** brings one back after confirming. An import or a restore keeps the replaced settings as a restore point, so it can be undone the same way. Saving the same file twice adds no version
- Diagnostics count the kept versions
- SECURITY.md describes the new endpoints and their checks

## 0.8.15

Editing rooms and lamps without starting over.

- **Undo** and **Redo** in the setup guide, also Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z outside text fields. Everything changed since the guide opened can be stepped back until it is saved; typing in one field counts as one step, and undoing back to the start lets the guide close without asking
- **Undo** and **Redo** in placement mode too, kept with the draft in the browser across the restarts placement mode makes, and cleared when the draft is saved to Home Assistant or thrown away
- **Edit shape** next to each room under *Floor plans* and each building under *Overview picture*: drag a corner, drag the dot on an edge to add a corner, press and hold (or right-click) a corner to remove it, drag inside to move the whole shape. A room moved as a whole takes its lamps and name label along, and lamps left outside new corners move inside. The editor has its own undo and redo, and Cancel
- **Snap to other shapes**, on by default and remembered per screen: a corner lands on a nearby corner or edge of another room or building, when editing and when drawing a new one; a moved shape snaps by its nearest corner
- Arrow keys nudge the selected corner or shape in the editor, and the selected lamp in placement mode; Shift moves ten times as far. A nudged lamp is saved when the keys rest, and can go into the next room
- Disabled buttons look disabled

## 0.8.14

Report a problem from the dashboard, without giving away anything about your home.

- **?** in the top bar, and **Report a problem** below the setup guide's steps, show the text that would go into a GitHub issue: SmartHomeDash and Home Assistant versions, how the dashboard is opened, browser, screen size, kiosk and light mode, language, counts of floor plans, rooms and devices by kind, the warnings by kind and count, and the last save Home Assistant refused. Never entity ids, room or area names, addresses or pictures. The text can be changed before **Open the issue on GitHub** opens the bug report form with it filled in. Hidden in kiosk mode
- Home Assistant **Download diagnostics** for SmartHomeDash (Settings → Devices & services → SmartHomeDash → ⋮): versions, the dashboard's options with its name, folder and address redacted, whether an update token is set (not the token), and for its site folder the number and size of pictures, whether site.json is valid, and counts of plans, rooms, lamps, thermostats, sensors, scenes and devices that Home Assistant does not know
- Issue templates: the bug report has fields for what the dashboard fills in, for the device (wall tablet, phone, computer) and for the diagnostics file; a new feature request template; questions and ideas are pointed to GitHub Discussions
- README has a *Help, questions and ideas* section, and ROADMAP points ideas and votes to Discussions

## 0.8.13

A calmer placement mode, outdoor lamps that find their area, and steadier tests.

- Placement mode lists lights first, then temperature sensors, thermostats and switches, with the ones not placed at the top of each group
- What matters less is folded away under **Show n more**, and search still finds it: switches (most are plugs and settings rather than lamps; one can still be placed as a lamp), a device's own diagnostic or hidden entities, and temperature sensors in no room or in a room that already shows one
- Lights in the same Home Assistant area as an outdoor lamp group on the overview picture switch with it by themselves, as lights in a room's area already show up in the room
- The group headings count only what is still to place: lights placed automatically no longer count as not placed
- A steadier performance test. It runs last and on its own in `tests/run.sh`: beside the other browser test files it measured the competition for the CPU (108–114 ms instead of about 95). And it checks the three longest frames during the 30 s of state changes, which must average 100 ms or less with none over 150 ms, since the same frame measured 70–105 ms between runs of the same code. Making the side cards contain their layout and paint was tried and made no measurable difference
- The pinch zoom test waits a frame between the drag and the tap on "Reset zoom". On a loaded test machine the tap right after the drag was sometimes lost (about one full run in three locally); with the wait it passed 14 runs in a row

## 0.8.12

A working dashboard before you draw anything: floor plans straight from Home Assistant's floors and areas.

- **Start from my Home Assistant** in the setup guide makes a floor plan for each floor, with a tile per area on it, linked to the area. A room with more devices gets a wider tile. Areas on no floor share one plan. It is offered on a new dashboard, under *Basics* and *Floor plans*, and replaces the example pictures
- Lights, thermostats and temperature sensors in each area show up on their tile by themselves, the lights in a row below the room's name. Nothing about them is written to site.json until you place them
- A tile plan can get a picture later: **Upload a picture of the plan** stretches the tiles over it, and each room gets a **Draw** button to draw it where it really is, keeping its area and its lights
- Test areas can be put on test floors (`floor_id` in `mock.areas`)

## 0.8.11

Clear messages when site.json and Home Assistant disagree.

- Devices named in site.json that Home Assistant does not know, because they were renamed or removed, show as a warning above the picture: "3 devices in the dashboard no longer exist in Home Assistant". It unfolds to list each one and where it is used. Until now they quietly disappeared from the picture
- For administrators the warning has **Show in placement mode**, which opens placement mode with only the missing devices listed. Place one again under its new name, or remove it from the dashboard in one go: out of rooms, zones, windows, sensor lists, scenes and heating devices
- Home Assistant checks site.json before saving it: the types of the top-level keys, floor plans and rooms as objects, and outlines and solar panels as lists of `[x, y]` number pairs. A file that fails is not written, and the message says where, such as `floorplans[0].rooms[2].area should be a list of at least three [x, y] number pairs`
- A refused save in placement mode or the setup guide shows Home Assistant's message instead of a status code and raw JSON

## 0.8.10

Electricity prices per quarter-hour, as Nord Pool sets them since October 2025.

- The price card keeps prices at the resolution they come in: per hour, or per quarter-hour (92 or 100 on the days the clocks change). Until now quarter-hour prices were averaged per hour, which hid the swings within the hour
- The chart has one bar per quarter-hour and marks the one running now. "Cheap now" compares the quarter running now
- The cheapest hours are counted in quarter-hours, so a window can start at a quarter past, and still run across midnight into tomorrow's prices
- Price lists with start and end times (`raw_today`, `raw_tomorrow`) are placed by their times, not by their order
- Home Assistant's own Nord Pool integration works too: when the price entity has no price attributes, the card asks its `nordpool.get_prices_for_date` action. See *Electricity price* in `docs/configuration.md`

## 0.8.9

Linking a floor plan to its building is easier to find in the setup guide.

- Each floor plan under *Floor plans* has a **Building on the overview picture** choice: the building that lifts its roof and opens the plan when tapped. Until now the link could only be set under *Overview picture*, in an unlabelled list further down the page
- Under *Overview picture* each building now says which plan it opens ("Opens: House"), and says to add a floor plan first when there is none
- Drawing a building when the site has exactly one floor plan that no building opens yet links the two, as uploading a plan already did the other way round

## 0.8.8

Names as Home Assistant shows them, ready for the 2026.11 naming change.

- Devices, sensors and lamps are named the way Home Assistant names them: the entity's own name after its device's name ("Kitchen Ceiling"), or the device's name alone, from Home Assistant's registry. `friendly_name`, which Home Assistant is phasing out, is only a fallback now. A name set in site.json still wins. This covers the room panel, warnings, placement mode, the setup guide and the doorbell window
- Test data can give entities a device (`mock.devices`) to try the new names. See *Names* in `docs/configuration.md`

## 0.8.7

Faster on large homes and old tablets, with a performance budget the tests check.

- Floor plans are built the first time they are opened. A large home starts with about half as many elements on the page
- Changes from Home Assistant are drawn once per screen refresh, however many arrive at once, and warnings, labels and the heating list are only redrawn when what they show changes
- While the page is hidden or the night dim is on, animations, the clock and test data rest, and nothing is redrawn until the page shows again
- Light mode also turns off the remaining filters: the evening darkening of the pictures now uses a plain dark layer, and floor plan pictures fade instead of being filtered
- A performance test on a large test home (3 floor plans, 40 rooms, 120 lamps, 60 sensors) with the CPU slowed down four times: under 4,000 elements on the overview, first render under 2 s, and no task over 100 ms during 30 s of state changes. It also checks the pause and light mode. See *Performance* in `docs/setup.md`

## 0.8.6

Nothing changes in the dashboard itself; this release adds the safety net for the work ahead.

- Automated tests in the repository: `tests/run.sh` runs backend tests (safe paths and symlinks, picture checks, chunked uploads, size limits, admin-only writes, starter sites, the updater) and browser tests in Chromium (both examples at five screen sizes, kiosk mode, rooms and lamps, night mode, pinch zoom, dragging a lamp in placement mode, the setup guide, warnings and badges, the energy flow)
- A new **Tests** check runs them on every push and pull request
- The JavaScript syntax check reads the dashboard's files as modules, so it no longer lets some syntax errors through

## 0.8.5

- Renaming a dashboard in the setup guide renames its entry in Home Assistant's sidebar too, at once and without a restart. Renaming it under *Settings → Devices & services → SmartHomeDash → Configure* also changes the name in the dashboard's heading. Dashboards set up in YAML keep the sidebar title written there

## 0.8.4

- Setup guide, Energy: a new **Direction** section shows how the dashboard reads the battery and the grid right now ("Battery charging 1.2 kW"), with a box to turn each one around. Inverters disagree on which way is positive, and since 0.8.2 the labels on the picture make a wrong sign easy to see. The boxes set `battery_invert` and `grid_invert`

## 0.8.3

- The **Kiosk mode** button opens a small wall screen sheet: start kiosk mode, light mode on this device, and **Test the doorbell**, which shows the camera window on that screen without ringing anything
- Light mode on this device is Auto, On or Off. Auto follows the setup guide's "light mode on every screen" and otherwise turns light mode on for older tablets with two cores or 2 GB of memory or less. `?lite` and `?lite=0` still work

## 0.8.2

- Clearer energy flow on the overview picture: one line for each real flow, from where the power comes from to where it goes, in the colour of the source (yellow sun, blue grid, green battery). Lines are wider with more power and carry their kilowatts, and solar charging the battery runs straight from the roof to the battery instead of through the house
- Labels at the battery, the grid, the car charger and the house say what each one is doing, such as "Selling 2.4 kW" or "Battery charging 2.0 kW · 64 %"
- The energy card says the same in one sentence: "The sun gives 6.2 kW: 1.8 kW to the house, 2.0 kW to the battery and 2.4 kW sold to the grid."

## 0.8.1

- Placement mode: tap a lamp on a floor plan or the overview picture to select it. A tag over the lamp shows its name and entity id, also while you drag it and after the page reloads with the lamp in its new spot, so lamps with the same name are easy to tell apart

## 0.8.0

Wall screens.

- Doorbell camera: when the doorbell rings, every open dashboard shows the camera in a window that closes by itself after a minute, or at a tap. Live where Home Assistant can stream the camera, otherwise a new still every two seconds. A doorbell can be a binary sensor or an event or button entity
- Idle mode in kiosk mode: back to the overview after two minutes without touch, open panels closed. At night, between hours you choose, the screen dims with a faint clock; a touch or a motion sensor wakes it, and a touch on the dimmed screen never switches anything
- Light mode for older tablets: no blur, blending or animation. Add `?lite` to one screen's address (`?lite=0` turns it off), or turn it on for every screen in the setup guide
- The setup guide has a new **Wall screen** step for all of this; see `wall_screen` in docs/configuration.md
- The examples ring their doorbell with `?ring` on test data

## 0.7.1

- Placement mode: drag a lamp to move it, with the mouse or a finger, also while zoomed in. On a floor plan a lamp can be dropped in another room; on the overview picture each fixture of an outdoor lamp moves on its own
- Lamps set by colour temperature glow in that temperature, from candle-warm to daylight, on the floor plans and the overview picture

## 0.7.0

- Energy flow on the overview picture: dots running from the solar panels, the grid and the battery to the house, and from the house to the grid, the battery and the car charger, faster with more power. Place the house, grid, battery and charger in the setup guide
- Dusk: with the header on Auto, the day picture fades into the evening picture as the sun goes down instead of switching at sunset
- Weather on the picture: a light veil for cloud and fog, falling rain and snow
- Blinds and curtains: up, stop, down and position in the room panel; windows glow less while they are closed; garage doors and gates count as doors
- Electricity price: "cheap now" or "expensive now", and the cheapest hours ahead (today or tomorrow) marked in the chart
- Rooms named like a Home Assistant area count as linked to it, and lights, thermostats and temperature sensors in a linked room's area show up in the room by themselves until placed
- The setup guide asks for the Home Assistant area while you draw a room or a building. Buildings can be linked to an area too: one without a floor plan, such as a shed, opens its area's lights, heating and sensors when tapped, and gets a badge when a door there is open
- The examples have a car charger, blinds and curtains in their test data

## 0.6.1

- Fixed: leaving placement mode in the Home Assistant panel left its list on screen
- Closing the setup guide with unsaved changes offers **Close without saving** and **Save** instead of needing a second tap
- A new dashboard's setup guide no longer opens by itself on every visit once it has been closed in that browser

## 0.6.0

- Doors, windows, locks, presence and alarms per room: found in the room's Home Assistant area, or listed under `sensors`. Open doors and windows, unlocked locks and alarms get an icon on the floor plan and a badge on the building in the overview picture; rooms with motion or presence get a faint outline; the room panel lists every sensor
- Warnings above the picture: smoke, gas, carbon monoxide and water leaks, a door or window open while the room is heating, low batteries and devices not responding. Configurable with `warnings` in site.json
- Floor plans can be linked to Home Assistant floors: named after the floor and listed in floor order. **Link rooms and floors with the same name** in the setup guide links both at once
- The examples show a few sensors in their test data

## 0.5.2

- Lamps glow in their own colour and brightness on the overview picture and the floor plans, windows in the colour of the room's lamps; lamps that report no colour keep the warm glow
- Online demo on GitHub Pages: the example house and apartment on test data
- ROADMAP.md with what comes next

## 0.5.1

- Pinch with two fingers to zoom the overview picture and floor plans on phones and tablets, drag to move around, **Reset zoom** to go back; a trackpad pinch works on computers. Taps on lamps, rooms and buildings still work while zoomed, and a pinch or drag never switches a lamp
- Fixed: pictures larger than about 64 kB were saved cut off when uploaded in the setup guide, and a large `site.json` could not be saved; `smarthomedash.update` downloads were affected the same way
- Placement mode on phones: the list is a sheet at the bottom instead of covering the picture
- Setup guide on phones: the steps are one row that scrolls sideways, so each step's content starts at the top

## 0.5.0

- Rooms link to Home Assistant areas: pick an area for a room in the setup guide and it takes the area's name, lights, thermostat and temperature sensor; rooms named like an area can be linked in one go
- Room names follow their area when it is renamed in Home Assistant
- Placement mode shows the area of unplaced entities and searches by area
- Outdoor lamps in the same area share one switch in the lights card
- No drone? A guide in the setup guide and in docs/overview-picture.md makes the day and evening pictures from a 3D map screenshot and an AI image model, with prompts to copy

## 0.4.0

First public version.

- Sidebar panel behind the Home Assistant login; no access tokens
- Set up from the UI: add a dashboard, choose house or apartment, then a setup guide for pictures, buildings, solar panels, windows, floor plans and rooms, energy and weather sensors, and buttons
- Placement mode: tap where each light, switch, thermostat and temperature sensor is
- Overview picture with live lamp light, lit windows and solar panels glowing while they produce; separate evening picture
- Lift the roof to open a building's floor plan; rooms tinted by temperature, lamps switchable in place
- Room panel with thermostat target, mode and presets, 24-hour temperature graph and dimmers
- Cards for weather, power, energy, hourly electricity price, lights, scenes and scripts, and heating
- Example house and apartment as starting points
- Wall screen layout, evening dimming, Swedish and English
