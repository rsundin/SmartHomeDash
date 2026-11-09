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
      "lights": [{ "entity": "light.living_room_ceiling", "name": "Ceiling light", "at": [11650, 8600] }]
    }
  ]
}
```

- Millimetres can be read straight off a dimensioned floor plan. Pick any origin, an outer corner works well.
- `outline` is the outer walls. Without it the rooms are used.
- Lamps that report their colour (`rgb_color`, also given for white lights with a colour temperature) glow in that colour on the floor plan and the overview picture; others glow in the theme's warm light.
- `ha_area` links the room to a Home Assistant area by its area id. The room then shows the area's name as it is in Home Assistant, and the setup guide can add the area's lights, thermostat and temperature sensor. Without it, `name` is used. (`area` is the room's outline on the floor plan, not a Home Assistant area.)
- `label` moves the room name when the middle of the room is a poor spot, such as in an L-shaped room.
- `temperature` is a temperature sensor; `climate` is the thermostat that gets controlled. With both, the sensor value is shown.
- `lights[].at` is where the lamp is. Tap to switch, hold to open the room.
- A light can be a `light.*` or a `switch.*` entity. Only `light.*` entities get a dimmer.

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
