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
| `all_lights` | object | The **All on** and **All off** buttons in the header and the lights card. They switch every light on the dashboard, including the ones found in linked areas. `{ "exclude": ["light.garden"] }` leaves lights out (garden lights on a schedule, a night light); `{ "enabled": false }` hides the buttons. All on takes one tap, all off two |
| `goodnight` | object | The **Goodnight** button beside All on and All off: the lights stay as they are for `minutes` (default 5), then the same lights as All off turn off and the script in `then` runs, if set. `{ "minutes": 5, "then": "script.lock_up" }`; `{ "enabled": false }` hides the button. See [Goodnight](#goodnight) |
| `wall_screen` | object | Doorbell camera, idle mode and light mode for wall screens, see [Wall screens](#wall-screens) |
| `mock` | object | Test data only, for example sunrise and sunset times. `mock.prices` sets the test prices: `{ "minutes": 15, "format": "raw" }` (`minutes` 60 or 15; `format` `list`, `raw` with start and end times, or `action` for the Nord Pool action). `mock.devices` gives test entities a device, named the Home Assistant 2026.11 way: `[{ "id": "kitchen_hub", "name": "Kitchen", "entities": { "light.kitchen_ceiling": "Ceiling" } }]` shows that light as "Kitchen Ceiling" (`null` for the device's name alone). `mock.floors` and `mock.areas` replace the test floors and areas made from the plans and rooms: `[{ "floor_id": "ground", "name": "Ground floor", "level": 0 }]` and `[{ "area_id": "kitchen", "name": "Kitchen", "floor_id": "ground", "entities": ["light.kitchen_ceiling"] }]`. An entry in `mock.entities` can carry `"entity_category": "diagnostic"` or `"hidden": true`, as Home Assistant's entity registry does |

### Names

The dashboard names an entity the way Home Assistant shows it, in this order:

1. a `name` given to it in site.json (a lamp in a room, a climate device, a scene, a doorbell),
2. Home Assistant's entity registry: the entity's own name after its device's name ("Kitchen Ceiling"), or the device's name alone when the entity has none, as Home Assistant does since 2026.11,
3. the state's `friendly_name`,
4. the entity id.

Rooms, buildings and floor plans linked to Home Assistant areas and floors take their names from those.

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

Each lamp lights up when any of the zone's lights is on, brighter at higher brightness. Tapping a lamp switches the zone. A zone belongs to the Home Assistant area its lights are in: other lights in that area that are not on the dashboard yet switch with the zone by themselves (placement mode lists them as placed automatically). In the lights card, zones whose lights are in the same Home Assistant area share one switch, named after the area.

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
- `"layout": "tiles"` marks a plan from the setup guide's **Start from my Home Assistant**: no picture and no walls, each room drawn as a tile, and the lights found in a room's area set out in a row along the bottom of its tile. Uploading a picture for the plan removes it. A room with `"redraw": true` still has its tile's shape stretched over the new picture and waits to be drawn; the guide offers a **Draw** button for it.

### cameras

```json
"cameras": [{ "entity": "camera.garden", "at": [715, 480], "angle": 45, "motion": "binary_sensor.garden_motion", "name": "Garden" }]
```

On a floor plan, in plan units; the same list under `overview` places cameras on the overview picture, in image pixels. Placement mode writes it.

- A camera icon marks the spot. A tap opens the camera window: live where Home Assistant can stream the camera as MJPEG, otherwise a still renewed every two seconds, and always stills in light mode. With several cameras on the same plan, arrows step between them. The window closes after two minutes, on ×, a tap outside or Escape.
- `angle` draws a field-of-view wedge, in degrees: 0 points right, 90 down. Without it only the icon is drawn.
- The wedge and the icon turn red while `motion` is on. Without `motion`, the camera's own `motion_detected` attribute is used where the camera has one.
- Everything goes through Home Assistant's camera proxy with the viewer's own login. No camera address or password goes in site.json.

### Warnings

A row above the picture shows, most serious first: alarms (smoke, gas, carbon monoxide, water leak), a door or window open in a room while it is heating, low batteries, devices that stopped responding, and devices named in site.json that Home Assistant does not know (renamed or removed). An alarm or open window opens its room when tapped; the others unfold a list. For administrators, the list of missing devices has **Show in placement mode**, which opens placement mode with only those devices listed.

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

- One line for each real flow, from where the power comes from (solar panels, battery, grid) to where it goes (house, car charger, battery, grid), in the colour of the source. Wider and faster with more power, with the kilowatts on the line. Labels at the battery, the grid, the charger and the house say what each one does. Read from `energy.pv_power`, `grid_power`, `battery_power` and `charger_power`; the energy card says the same in one sentence.
- The split follows the balance: solar is used first, then the battery, then the grid; the house is served first, then the car, the battery and export. The house's own use is worked out from that balance when `grid_power` is set, so it always adds up.
- `energy_points` are image pixels, placed in the setup guide. Without `house` the middle of the building under the solar panels is used; without `grid` the bottom edge below the house. The battery and the charger are drawn only once placed.
- `grid_power` above zero is bought from the grid and `battery_power` above zero is the battery discharging. If your sensors count the other way, set `"grid_invert": true` or `"battery_invert": true` under `energy`, or tick **Direction** in the setup guide's Energy step, which shows how each one reads right now.
- `"energy_flow": false` and `"weather_effects": false` turn them off.
- With the header set to Auto, the day picture fades into the evening picture from 3° above the horizon to 6° below it (`sun.sun` elevation). The `weather` entity adds a light veil for cloud, fog, rain or snow.

## Goodnight

```json
"goodnight": { "minutes": 5, "then": "script.lock_up" }
```

- A tap on **Goodnight** (behind the lamp in the header, or in the lights card) starts a countdown. Every open screen of the dashboard shows "Goodnight: everything off in 4:12" with **Cancel**. Tapping Goodnight again starts the countdown over.
- The countdown runs in Home Assistant, so a tablet that sleeps or reloads does not stop it. A restart of Home Assistant does stop it.
- It is the action `smarthomedash.goodnight`, so it can also be started from an automation, a voice command or an NFC tag:

```yaml
action: smarthomedash.goodnight
data:
  site: home                 # the dashboard's folder name
  entity_id: [light.hall, light.kitchen]
  minutes: 5
  then: script.lock_up       # optional
```

  `cancel: true` stops a countdown. While one runs, the state `smarthomedash.goodnight_<site>` is `on` with the time in `ends_at`; it is what the screens show.

## Wall screens

```json
"wall_screen": {
  "doorbell": { "entity": "binary_sensor.doorbell", "camera": "camera.front_door", "name": "Front door", "seconds": 60 },
  "idle": { "back_after": 120, "dim_from": "22:00", "dim_to": "06:30", "dim": 0.85, "wake": ["binary_sensor.hallway_motion"] },
  "lite": false
}
```

**doorbell**: when `entity` rings, every open dashboard shows `camera` in a window that closes by itself after `seconds` (default 60), or when tapped outside or on ×.

- A `binary_sensor`, `input_boolean` or `switch` rings when it turns on. An `event`, `button` or `input_button` entity rings when it fires (its state, a time stamp, changes).
- The camera is shown live where Home Assistant can stream it as MJPEG, otherwise as a still picture renewed every two seconds. It goes through Home Assistant's own camera proxy; no camera address or password is needed in site.json.
- Several doorbells: a list of these objects.

**idle**: only on a device in kiosk mode.

| Field | Description |
| --- | --- |
| `back_after` | Seconds without touch before the dashboard goes back to the overview (or the first floor plan) and closes open panels. Default 120; `0` never goes back |
| `dim_from`, `dim_to` | Night hours, `"HH:MM"`. Between them the screen dims when nobody has touched it for `back_after` seconds (two minutes when `back_after` is 0). Leave out for no dimming |
| `dim` | How dark, from 0.2 to 0.97. Default 0.85. A faint clock stays on the dimmed screen |
| `wake` | Motion or presence sensors that wake the dimmed screen when they turn on |

A touch on the dimmed screen only wakes it; it does not switch what is under the finger. A doorbell ring also wakes it. A browser cannot turn the backlight off, so the screen is dimmed with a dark layer; for a fully dark screen at night use the tablet's own schedule or a kiosk browser such as Fully Kiosk Browser.

**lite**: `true` turns light mode on for every screen showing this dashboard: no blur, blending or animation, for older tablets that stutter. Lamp light is drawn without the soft wash on the facade. Each screen can also set light mode for itself under the **Kiosk mode** button: **Auto** (the default) follows `lite` and otherwise turns light mode on for devices with two cores or 2 GB of memory or less, while **On** and **Off** override both. `?lite` and `?lite=0` on the address set On and Off the same way; the device remembers it.

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

Power may be in W or kW; the unit is read from the entity. `battery_soc` is shown next to the battery row; `load_power` adds a house usage row. Prices come from an attribute: `today` matches Nordpool from HACS, and `raw_today` and `prices_today` are recognised automatically. They are kept at the resolution they come in: 24 hourly prices, 96 quarter-hour prices (92 or 100 on the days the clocks change), or a list of `{ start, end, value }` (or `price`) placed by its times.

### Electricity price

`energy.price.window_hours` (default 3) is the length of the cheapest run of hours the price card points out, from now over today and, once published, tomorrow (`tomorrow` or `raw_tomorrow` attribute; `tomorrow_attribute` if yours differs). The window is counted in the prices' own slots, so with quarter-hour prices it can start at a quarter past. The card also says when the price in the slot running now is cheap or expensive compared with the rest of the day. The chart has one bar per slot and marks the one running now.

**Home Assistant's own Nord Pool integration** keeps its prices behind the `nordpool.get_prices_for_date` action instead of in attributes. When the price entity has no price attributes, the card asks that action for today and, from 13:00, tomorrow. It finds the integration's config entry from the entity; set `config_entry` if that does not work, `area` (for example `"SE3"`) to pick an area, and `action_divisor` if your prices are not per MWh (default 1000, giving per kWh). `"action": false` turns this off.

## Placement mode

In the Home Assistant panel, administrators tap **Placera** in the header (or open `/<url_path>/edit`). On the standalone page, add `#edit` to the address. A panel lists every light, temperature sensor, thermostat, camera and switch in Home Assistant (on test data: the ones in the config plus `mock.entities`), in that order, not placed first. What matters less is folded away under **Show n more** in each group, and search still finds it: switches (most are plugs and settings, not lamps; a switch can still be placed as a lamp), a device's own diagnostic or hidden entities, and temperature sensors in no room or in a room that already shows another one.

- **Place:** pick an entity, then tap where it is. On a floor plan the room is found from the tap: a light is placed at that spot, a thermostat or sensor is linked to the room. On the overview a light becomes an outdoor lamp; tap again to add more fixtures on the same switch.
- **Cameras** go anywhere on a floor plan or the overview, not only in a room. A placed camera gets **↺** and **↻** to turn its field of view, and a **Motion sensor** list.
- **Remove placement** takes the selected entity out of every room and zone.
- **Missing in Home Assistant** lists the entities in site.json that Home Assistant does not know, with where each is used. **Remove from the dashboard** takes one out of rooms, zones, windows, sensor lists, scenes, heating devices and the screen's wake sensors. Energy, weather and doorbell entities are changed in the setup guide or in the file.
- **Draw area:** click corners to get a polygon for `area`, `outline` or a solar panel.

Changes are kept as a draft in that browser and shown immediately. In the panel, **Spara i Home Assistant** writes `site.json` (the last 10 versions are kept as `site.json.1`, the newest, to `site.json.10`, and can be restored under *Backup* in the setup guide). Home Assistant checks the file before writing it: the top-level keys must have the types in this reference, floor plans and rooms must be objects, and every `area`, `outline` and solar panel must be at least three `[x, y]` number pairs. A file that fails is not written, and the message says where, for example `floorplans[0].rooms[2].area should be a list of at least three [x, y] number pairs`. **Kopiera site.json** puts the result on the clipboard instead; **Släng utkast** goes back to the saved file.

## Pictures

```json
{ "id": "main_house", "image": { "src": "plan_main_house.jpg", "bounds": [0, -2200, 13950, 13640] }, ... }
```

- `floorplans[].image` is a realistic top-down picture of the plan, drawn under the rooms. `bounds` is `[x, y, width, height]` in plan units and defaults to the outline's bounding box, so a picture cropped exactly to the outer walls needs no bounds. The picture must have the same proportions as the bounds.
- `rooms[].photo` is a photo shown at the top of the room panel.

Paths are relative to the site folder.
