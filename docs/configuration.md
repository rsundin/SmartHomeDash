# Configuration reference: site.json

Most of this is written by the setup guide and placement mode; see [setup.md](setup.md). This page is for checking or fine-tuning the result by hand.

Each site has a folder with a `site.json` and any images: `<config>/smarthomedash/sites/<id>/` in Home Assistant, `sites/<id>/` in this repository. The id is what `configuration.yaml` (or `?site=<id>` on the standalone page) refers to. Entity ids and coordinates live only here, never in the code.

Everything except `name` and at least one floor plan is optional. A card whose entity is missing is not shown.

## Top level

| Field | Type | Description |
| --- | --- | --- |
| `name` | text | Shown in the header |
| `language` | text | Dashboard language: `sv` (default) or `en` |
| `locale` | text | Number and time format, default `sv-SE` |
| `currency` | text | For price and cost, default `SEK` |
| `comfort` | `{ low, high }` | Temperature range for rooms without a thermostat, default 19–23 °C |
| `overview` | object | The overview image, see below. Leave out to open straight into the floor plan |
| `floorplans` | list | One or more floor plans, for example one per storey or building |
| `energy` | object | Entities for power, energy and price |
| `weather` | entity | A `weather.*` entity |
| `climates` | list | Climate devices that are not a room, such as a heat pump: `{ "entity": "climate.heat_pump", "name": "Heat pump" }`. Shown in the heating card |
| `scenes` | list | Buttons for scenes or scripts: `{ "entity": "script.we_are_here", "name": "We're here" }` |
| `wall_screen` | object | Doorbell camera and idle mode for wall screens, see below |
| `mock` | object | Test data only, for example sunrise and sunset times |

## overview

```json
"overview": {
  "image": "overview.jpg",
  "size": [1264, 842],
  "buildings": [ ... ],
  "zones": [ ... ],
  "windows": [ ... ],
  "solar": { ... }
}
```

`size` is the image width and height in pixels. All overview coordinates are in image pixels. After sunset (`sun.sun`) the page switches to night; the header button switches between auto, day and night.

`night_image` (optional) is a dusk render of the same scene, used at night instead of darkening the day photo. Requirements:

- Exactly the same size and framing as `image`, so every coordinate still lines up.
- **Every light off**, windows dark. The dashboard adds the light itself, so a lamp that is lit in the picture would stay lit when it is switched off.
- Blue hour rather than full dark, so the buildings stay readable.

### buildings

```json
{ "id": "main_house", "name": "Main house", "floorplan": "main_house", "area": [[455,405], [505,370], ...] }
```

`area` is the outline of the building. Tapping it lifts the roof and opens the floor plan named in `floorplan`.

`ha_area` links the building to a Home Assistant area: it takes the area's name, and a building without `floorplan` (a shed, a workshop) opens the lights, heating and sensors of its area when tapped, and gets a badge when a door or window there is open.

### zones: outdoor lights

```json
{ "id": "facade", "name": "Facade", "lights": ["light.facade"], "lamps": [
  { "at": [521, 438], "type": "wall", "size": 34 },
  { "at": [455, 530], "type": "ground", "size": 34 }
] }
```

Each lamp lights up when any of the zone's lights is on, brighter at higher brightness. Tapping a lamp switches the zone. In the lights card, zones whose lights are in the same Home Assistant area share one switch, named after the area.

| `type` | Looks like |
| --- | --- |
| `wall` | A fixture on a facade: light washes the wall and pools on the ground below |
| `ground` | A deck or flood light: a flat pool of light |
| `point` | A round glow (default) |

`size` is in image pixels. The shorthand `"glow": [[x, y, size], ...]` gives round lamps.

### windows

```json
{ "room": "living_room", "area": [[758,526], [772,521], [772,538], [759,545]] }
```

A window glows warm when any light in that room of the floor plan is on. Use `"lights": [...]` instead of `room` to tie it to specific lights.

### solar

```json
"solar": {
  "peak_kw": 6,
  "label": [700, 312],
  "panels": [ [[651,339], [719,305], ...], ... ]
}
```

Each panel outline glows green while the panels produce, stronger as production approaches `peak_kw`, with a light sweep across the surface. A label shows the current output. It reads `energy.pv_power` unless `entity` is set here.

## floorplans

```json
{
  "id": "main_house",
  "name": "Main house",
  "unit": "mm",
  "outline": [[0,0], [9950,0], ...],
  "rooms": [
    {
      "id": "living_room",
      "name": "Living room",
      "ha_area": "living_room",
      "area": [[9950,1000], ...],
      "label": [11650, 6600],
      "climate": "climate.living_room",
      "temperature": "sensor.living_room_temperature",
      "lights": [{ "entity": "light.living_room_ceiling", "name": "Ceiling light", "at": [11650, 8600] }],
      "sensors": ["binary_sensor.living_room_window", "binary_sensor.living_room_motion"]
    }
  ]
}
```

- Millimetres can be read straight off a dimensioned floor plan. Pick any origin, an outer corner works well.
- `outline` is the outer walls. Without it the rooms are used.
- Lamps glow in their own light on the floor plan and the overview picture: a white light set by colour temperature (`color_temp_kelvin`) in that temperature, from candle-warm to daylight, a coloured one in its `rgb_color`. Lamps that report neither glow in the theme's warm light.
- `ha_area` links the room to a Home Assistant area by its area id. The room then shows the area's name as it is in Home Assistant, and the setup guide can add the area's lights, thermostat and temperature sensor. Without it, `name` is used. (`area` is the room's outline on the floor plan, not a Home Assistant area.)
- `label` moves the room name when the middle of the room is a poor spot, such as in an L-shaped room.
- `temperature` is a temperature sensor; `climate` is the thermostat that gets controlled. With both, the sensor value is shown.
- `lights[].at` is where the lamp is. Tap to switch, hold to open the room.
- A light can be a `light.*` or a `switch.*` entity. Only `light.*` entities get a dimmer.
- `sensors` lists doors, windows, locks, presence and alarm sensors for the room. A room with `ha_area` also gets every such sensor in its area automatically, so the list is only needed without areas. Recognised by their device class: `door`, `window`, `opening` and `garage_door` (shown open or closed), `motion`, `occupancy` and `presence` (a faint outline on the room while someone is there), `smoke`, `gas`, `carbon_monoxide`, `moisture` and `safety` (alarms), `battery`; and every `lock.*`. Open doors and windows, unlocked locks and alarms get an icon on the floor plan and a badge on the building in the overview picture; the room panel lists them all. Locks are shown, not controlled.
- A room without `ha_area` whose name matches an area exactly (ignoring case and accents) is treated as linked to it.
- Lights, a thermostat and a temperature sensor in a linked room's area that are not in site.json show up in the room by themselves, the lights in a ring around its middle. Placement mode lists them as placed automatically; tapping one onto the plan saves its spot. Nothing is written to site.json until then.
- Covers (`cover.*`) in a room are blinds and curtains: the room panel has up, stop and down and a position slider, and the room's windows on the overview picture glow less while they are closed. Garage doors and gates (`device_class` `garage`, `gate`, `door`) count as doors instead.
- A floor plan's `ha_floor` links it to a Home Assistant floor by its floor id: the plan then shows the floor's name, and linked plans are listed in floor order.

### Warnings

A row above the picture shows, most serious first: alarms (smoke, gas, carbon monoxide, water leak), a door or window open in a room while it is heating, low batteries and devices that stopped responding. An alarm or open window opens its room when tapped; the others unfold a list.

```json
"warnings": { "battery": 20 }
```

`battery` is the level in percent counted as low (default 15). `"warnings": false` turns the row off.

## Energy flow and weather on the picture

```json
"overview": {
  "energy_points": { "house": [800, 405], "grid": [905, 840], "battery": [296, 440], "charger": [1000, 372] },
  "energy_flow": true,
  "weather_effects": true
}
```

- Dots run between the solar panels, the grid, the battery, the car charger and the house, faster with more power, from `energy.pv_power`, `grid_power`, `battery_power` and `charger_power`.
- `energy_points` are image pixels, placed in the setup guide. Without `house` the middle of the building under the solar panels is used; without `grid` the bottom edge below the house. The battery and the charger are drawn only once placed.
- `grid_power` above zero is bought from the grid and `battery_power` above zero is the battery discharging. If your sensors count the other way, set `"grid_invert": true` or `"battery_invert": true` under `energy`.
- `"energy_flow": false` and `"weather_effects": false` turn them off.
- With the header set to Auto, the day picture fades into the evening picture from 3° above the horizon to 6° below it (`sun.sun` elevation). The `weather` entity adds a light veil for cloud, fog, rain or snow.

## energy

```json
"energy": {
  "grid_power": "sensor.grid_power",
  "pv_power": "sensor.solar_power",
  "battery_power": "sensor.battery_power",
  "battery_soc": "sensor.battery_state_of_charge",
  "load_power": "sensor.house_consumption",
  "charger_power": "sensor.charger_power",
  "energy_today": "sensor.energy_today",
  "pv_energy_today": "sensor.solar_energy_today",
  "cost_today": "sensor.energy_cost_today",
  "savings_today": "sensor.battery_savings_today",
  "price": { "entity": "sensor.nordpool_kwh_se3_sek", "today_attribute": "today" }
}
```

Power may be in W or kW; the unit is read from the entity. `battery_soc` is shown next to the battery row; `load_power` adds a house usage row. Hourly prices come from an attribute: `today` matches Nordpool from HACS, and `raw_today` and `prices_today` are recognised automatically. Quarter-hour prices are averaged per hour.

### Electricity price

`energy.price.window_hours` (default 3) is the length of the cheapest run of hours the price card points out, from now over today and, once published, tomorrow (`tomorrow` or `raw_tomorrow` attribute; `tomorrow_attribute` if yours differs). The card also says when the price right now is cheap or expensive compared with the rest of the day.

## wall_screen

```json
"wall_screen": {
  "doorbell": { "entity": "binary_sensor.doorbell", "camera": "camera.front_door", "seconds": 30 },
  "idle": { "minutes": 2, "night": ["22:00", "06:30"], "dim": 0.15, "wake": ["binary_sensor.hall_motion"] }
}
```

Set in the setup guide under **Wall screen**.

### doorbell

When the doorbell rings, every open dashboard shows the camera in a window that closes by itself after `seconds` (default 30), or when tapped.

- `entity` rings when a `binary_sensor.*` turns on, or when an `event.*`, `button.*` or `input_button.*` entity gets a new time. A list of entities works too.
- `camera` is a `camera.*` entity. The window shows its live picture through Home Assistant (`/api/camera_proxy_stream`), or a fresh still every second if the stream does not work or the device is in light mode. Without `camera` the window only says that someone is at the door.
- A ring that happened more than a minute ago (seen after a lost connection) is not shown.
- **Test the doorbell** on the wall screen sheet (the **Kiosk mode** button) shows the window on that device without ringing anything.

### idle

Idle mode runs only in kiosk mode.

| Field | Default | Description |
| --- | --- | --- |
| `minutes` | 2 | Minutes without a touch before the dashboard goes back to the overview (or the first floor plan), closing the room panel and resetting the zoom. `0`, or `"idle": false`, turns idle mode off |
| `night` | none | `["22:00", "06:30"]`: between these times the idle screen is dimmed. May run past midnight. Without it the screen is never dimmed |
| `dim` | 0.15 | Brightness of the dimmed screen, 0 to 1. A web page cannot turn the backlight down, so this is a dark layer with the time on it |
| `wake` | none | Motion or presence sensors. One turning on (or off again) brightens the screen and starts the idle time over |

A tap on the dimmed screen, the doorbell, or the night ending brightens it again. The tap that wakes the screen does not switch anything under it.

### Light mode

Light mode is set per device, not in site.json: **Kiosk mode** in the header opens the wall screen sheet with **Light mode on this device**: Auto, On or Off. It drops blur, blending and animation (the lamps glow without additive blending, the energy flow stands still, no rain or snow), and dims the evening picture with a plain dark layer instead of a filter, so older tablets keep up. Auto turns it on for devices that report two processor cores or 2 GB of memory or less. `?lite` (or `?lite=0`) at the end of the address sets it on that device too.

## Placement mode

In the Home Assistant panel, administrators tap **Placera** in the header (or open `/<url_path>/edit`). On the standalone page, add `#edit` to the address. A panel lists every light, switch, thermostat and temperature sensor in Home Assistant (on test data: the ones in the config plus `mock.entities`).

- **Place:** pick an entity, then tap where it is. On a floor plan the room is found from the tap: a light is placed at that spot, a thermostat or sensor is linked to the room. On the overview a light becomes an outdoor lamp; tap again to add more fixtures on the same switch.
- **Remove placement** takes the selected entity out of every room and zone.
- **Draw area:** click corners to get a polygon for `area`, `outline` or a solar panel.

Changes are kept as a draft in that browser and shown immediately. In the panel, **Spara i Home Assistant** writes `site.json` (the previous version is kept as `site.json.bak`). **Kopiera site.json** puts the result on the clipboard instead; **Släng utkast** goes back to the saved file.

## Pictures

```json
{ "id": "main_house", "image": { "src": "plan_main_house.jpg", "bounds": [0, -2200, 13950, 13640] }, ... }
```

- `floorplans[].image` is a realistic top-down picture of the plan, drawn under the rooms. `bounds` is `[x, y, width, height]` in plan units and defaults to the outline's bounding box, so a picture cropped exactly to the outer walls needs no bounds. The picture must have the same proportions as the bounds.
- `rooms[].photo` is a photo shown at the top of the room panel.

Paths are relative to the site folder.
