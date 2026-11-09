# Changelog

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
