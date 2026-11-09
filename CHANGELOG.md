# Changelog

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
