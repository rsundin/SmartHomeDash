# Setting up a new dashboard

This guide takes a new installation from nothing to a working dashboard: a picture of your home with live lights, floor plans you can tap into, heating and energy. Everything is done in the Home Assistant UI; no files need editing.

Plan for about an hour, most of it spent on the pictures.

## What you need

- Home Assistant 2024.8 or newer, with an administrator account.
- [HACS](https://hacs.xyz), or SSH or Samba access to copy files.
- **An overview picture** of the property from above. A drone photo taken at an angle works best; without a drone, [make one from a 3D map](overview-picture.md). Any size is fine; about 1200 to 2500 pixels wide keeps it sharp without being slow.
- **A floor plan picture** per building or storey: a scanned drawing, an estate agent's plan or a realistic render seen from above, cropped to the outer walls.
- Optional: an **evening picture**, the same view at dusk with every light off.

## 1. Install the integration

**With HACS**

1. HACS → three-dot menu → **Custom repositories**.
2. Add the repository URL, category **Integration**.
3. Find **SmartHomeDash** in HACS, choose **Download**.
4. Restart Home Assistant.

**Manually**

Copy `custom_components/smarthomedash` from this repository to `<config>/custom_components/smarthomedash`, then restart Home Assistant. From a computer with SSH access you can use `scripts/deploy.sh user@host`.

## 2. Add a dashboard

1. **Settings → Devices & services → Add integration → SmartHomeDash.**
2. Give it a name (shown in the sidebar), choose **House** or **Apartment**, an icon and optionally an address.
3. The dashboard appears in the sidebar. Add the integration again for another home.

Each dashboard has its own folder, `<config>/smarthomedash/sites/<name>/`, holding its config and pictures. These files are only served to logged-in users. Removing the integration entry removes the panel but keeps the folder.

A new dashboard starts from an example, with no lights or sensors linked since those are your own:

- **House:** a day and evening picture of a house and a garage, with floor plans, rooms, windows and solar panels already drawn.
- **Apartment:** a floor plan only, with rooms and a balcony. The dashboard opens on the floor plan; an overview picture can be added later in the setup guide, and a house's overview picture can be removed there too.

Keep the example to try the dashboard out, place your own lights in it, or replace the pictures with your own home.

## 3. Run the setup guide

Open the dashboard. On the first visit the setup guide opens by itself; later it is under **Inställningar** / **Setup** in the header (administrators only). Work through the steps on the left, then **Save**.

### Basics

The dashboard's name, the language on screen (Swedish or English) and the currency for prices.

### Overview picture

Optional for an apartment: without it the dashboard opens on the floor plan. **Remove overview picture** turns a house into floor plans only.

1. **Upload** the day picture. Replacing the example picture also clears the example's buildings, windows and solar panels, since they were drawn on that picture.
2. Optionally upload the evening picture. It must have exactly the same size as the day picture; the guide refuses one that does not match.
3. **Draw a building** for every building that has a floor plan: click its corners in order, then **Done**. Name it and pick its floor plan once you have added one.
4. **Draw a panel area** for every group of solar panels, and set the peak output in kW. The panels glow green while producing, stronger as output approaches the peak.
5. **Draw a window** and pick the room behind it, to have it light up when a light in that room is on. Needs a floor plan with rooms first.

### Floor plans

1. **Upload floor plan picture.** One per building or storey.
2. **Draw a room** for every room: click the corners, **Done**.
3. **Pick the room's Home Assistant area.** The room takes the area's name and its lights, thermostat and temperature sensor. The lights are set out in the middle of the room; move them to their real spots in placement mode. Rooms already named like an area can be linked all at once with **Link rooms to areas with the same name**. Without areas, type the room's name instead and place everything by hand.
4. Back under **Overview picture**, link each building to its floor plan.

Rooms do not need to be exact. A room is used to find which room you tap in, to tint it by temperature and to light up windows.

A room linked to an area also shows the area's door, window, lock, presence and alarm sensors on its own: an icon on the floor plan when a door or window is open, a faint outline while someone is there, and a warning above the picture when a smoke or leak sensor goes off or a window is open while the room is heating. Each floor plan can be linked to a Home Assistant floor too; the plans are then named after the floors and listed in floor order.

### Energy and weather

Pick the sensors you have; leave the rest empty and their rows or cards are hidden.

| Row | Typical sensor |
| --- | --- |
| House usage, From the grid, Solar, Battery, Car charger | power sensors in W or kW |
| Battery level | battery state of charge in % |
| Used today, Solar today | energy sensors in kWh that reset daily |
| Cost today, Battery savings today | sensors in your currency |
| Electricity price today | a price sensor with hourly prices, such as Nordpool |
| Weather | any `weather.*` entity |

**Heating devices** lists thermostats that are not linked to a room yet, such as a heat pump. Ticked ones are shown in the heating card.

### Buttons

Tick the scenes and scripts to show as buttons, and give them short names.

### Lights and heating

Opens placement mode (also available as **Placera** / **Place** in the header):

1. Pick a light, switch, thermostat or temperature sensor in the list. Unplaced ones are listed first, with their Home Assistant area; the search also finds entities by area.
2. Tap where it is. On a floor plan the room is found from the tap: a light is placed at that spot, a thermostat or sensor is linked to the room. On the overview picture a light becomes an outdoor lamp; tap again to add more fixtures switched by the same entity. Outdoor lamps in the same Home Assistant area share one switch in the lights card.
3. **Save to Home Assistant.**

New outdoor lamps are drawn as wall lamps. To make one a flood or deck light, change its `type` to `ground` in `site.json` (see [configuration.md](configuration.md)).

## Tips for the pictures

**Overview from a drone photo.** Fly high enough to have the whole property in view, camera tilted down about 45°. Daylight with soft shadows works best.

**No drone?** Make the day and evening pictures from a 3D map and an AI image model: see [An overview picture without a drone](overview-picture.md). The setup guide has the same steps and prompts under **Overview picture**.

**Evening picture with an image model.** Give the day picture to an image model with a prompt like:

```
Edit this exact image. Keep the camera angle, framing, image size and every building,
tree and rock exactly where they are. Change the time of day to blue hour shortly after
sunset: deep blue sky glow, cool ambient light, soft shadows. All lights are OFF: no
outdoor lamps, no lit windows. Photorealistic. No people, no text.
```

Check that the result has the same pixel size; resize it if needed. Lamps lit in the picture would stay lit when switched off, so they must be off.

**Realistic floor plan.** A plain drawing works. For a more lifelike look, give the drawing to an image model:

```
Photorealistic top-down architectural render of this exact floor plan, seen straight from
above with the roof removed. Match the walls, rooms and doors exactly. Furniture placed
sensibly in each room. Soft light. Crop exactly to the outer walls. No text or labels.
```

## Evening

After sunset (or with the header button set to night) the pictures are dimmed, the evening picture replaces the day picture if there is one, and lamp light on the overview and on the floor plans stands out.

## Wall screens and tablets

**Kiosk mode** shows only the dashboard. Open it with `?kiosk` at the end of the address (`http://homeassistant.local:8123/home?kiosk`) or tap **Kiosk mode** in the header. It:

- hides Home Assistant's sidebar on that device (the same setting as Home Assistant's own *hide sidebar*, stored in that browser only),
- hides the dashboard's buttons, keeping the views and the clock,
- goes full screen on the first touch, where the browser allows it.

Hold the clock for two seconds to leave kiosk mode; the sidebar comes back. A device left in kiosk mode starts in it again.

**A dedicated tablet or wall screen**

1. Create a Home Assistant user for the screen (*Settings → People → Add person*, allow login, not an administrator). Then the screen has its own login, and the setup tools are not shown on it.
2. Log in as that user on the tablet and open the dashboard with `?kiosk`.
3. Make the dashboard the start page: in the companion app under *Settings → Companion app*, or in the browser as its home page.
4. Lock the tablet to the app: **iPad** with *Guided Access* (Settings → Accessibility); **Android** with *screen pinning*, or a kiosk browser such as Fully Kiosk Browser pointed at the `?kiosk` address.
5. Keep it powered and set auto-lock to *Never*. The dashboard keeps the screen awake while it is visible, where the browser allows it.

In landscape at 1024 pixels or wider the dashboard fills the screen without scrolling. On a phone, pinch with two fingers to zoom into the picture or a floor plan, and drag to move around; **Reset zoom** goes back. iPad Safari has no full screen for web pages; use the companion app, or *Add to Home Screen*, for the most screen space.

## Troubleshooting

**The dashboard shows "Nothing to show yet" to some users.** Only administrators can run the setup guide. Set it up with an administrator account once.

**A picture does not upload.** Pictures must be jpg, png or webp and at most 25 MB.

**A light does not glow on the overview.** Check in placement mode that it is placed outdoors (on the overview picture), and that the entity turns on in Home Assistant.

**Temperatures look wrong.** A room shows its temperature sensor if one is linked, otherwise the thermostat's own reading. Link a temperature sensor to the room in placement mode.

**The sidebar entry is missing after a restart.** Check *Settings → System → Logs* for messages from `smarthomedash`.
