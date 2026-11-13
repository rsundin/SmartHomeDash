# Setting up a new dashboard

This guide takes a new installation from nothing to a working dashboard: a picture of your home with live lights, floor plans you can tap into, heating and energy. Everything is done in the Home Assistant UI; no files need editing.

Plan for about an hour, most of it spent on the pictures.

## What you need

- Home Assistant 2024.8 or newer, with an administrator account.
- Home Assistant's **Marketplace** (2026.11 and newer; [HACS](https://hacs.xyz) before that), or SSH or Samba access to copy files.
- **An overview picture** of the property from above. A drone photo taken at an angle works best; without a drone, [make one from a 3D map](overview-picture.md). Any size is fine; about 1200 to 2500 pixels wide keeps it sharp without being slow.
- **A floor plan picture** per building or storey: a scanned drawing, an estate agent's plan or a realistic render seen from above, cropped to the outer walls.
- Optional: an **evening picture**, the same view at dusk with every light off.

## 1. Install the integration

**From the Marketplace** (Home Assistant 2026.11 and newer)

1. **Settings → Marketplace → Add from link.** The first time, the Marketplace shows a notice that community code is not reviewed by Home Assistant, and asks you to sign in with GitHub.
2. Paste `https://github.com/rsundin/SmartHomeDash` and install **SmartHomeDash**.
3. Setup starts right away: continue with step 2 below.

New versions show up in the Marketplace like for any other integration. Restart Home Assistant after an update.

*Before Home Assistant 2026.11:* HACS → three-dot menu → *Custom repositories* → add the repository URL with category **Integration** → download **SmartHomeDash** → restart Home Assistant.

**Manually**

Copy `custom_components/smarthomedash` from this repository to `<config>/custom_components/smarthomedash`, then restart Home Assistant. From a computer with SSH access you can use `scripts/deploy.sh user@host`.

## 2. Add a dashboard

1. **Settings → Devices & services → Add integration → SmartHomeDash.**
2. Give it a name (shown in the sidebar; renaming it later in the setup guide or under the integration's **Configure** renames the sidebar entry too), choose **House** or **Apartment**, an icon and optionally an address.
3. The dashboard appears in the sidebar. Add the integration again for another home.

Each dashboard has its own folder, `<config>/smarthomedash/sites/<name>/`, holding its config and pictures. These files are only served to logged-in users. Removing the integration entry removes the panel but keeps the folder.

A new dashboard starts from an example, with no lights or sensors linked since those are your own:

- **House:** a day and evening picture of a house and a garage, with floor plans, rooms, windows and solar panels already drawn.
- **Apartment:** a floor plan only, with rooms and a balcony. The dashboard opens on the floor plan; an overview picture can be added later in the setup guide, and a house's overview picture can be removed there too.

Keep the example to try the dashboard out, place your own lights in it, or replace the pictures with your own home. If your Home Assistant has areas, the quickest start is **Start from my Home Assistant** in the setup guide (below): a working floor plan with nothing to draw.

## 3. Run the setup guide

Open the dashboard. On the first visit the setup guide opens by itself; later it is under **Inställningar** / **Setup** in the header (administrators only). Work through the steps on the left, then **Save**. **Undo** and **Redo** at the top (or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z) step through everything changed since the guide opened, until you save.

### Basics

The dashboard's name, the language on screen (Swedish or English) and the currency for prices.

**Start from my Home Assistant** is offered here, and under **Floor plans**, until the dashboard has floor plans of its own. It makes a floor plan for each floor in Home Assistant, with a tile for each area on that floor, linked to the area; a room with more devices gets a wider tile. Areas on no floor share a plan named *Other rooms* (or *Home* when Home Assistant has no floors). Lights, thermostats and temperature sensors show up in their tiles by themselves, and the area's sensors work as in a drawn room. The example pictures are replaced. **Save**, and the dashboard opens on the first floor.

Later, a tile plan can get a real picture under **Floor plans**: **Upload a picture of the plan** stretches the tiles over it, and each room gets a **Draw** button to draw it where it really is. Its area link and the lights you have placed stay.

### Overview picture

Optional for an apartment: without it the dashboard opens on the floor plan. **Remove overview picture** turns a house into floor plans only.

1. **Upload** the day picture. Replacing the example picture also clears the example's buildings, windows and solar panels, since they were drawn on that picture.
2. Optionally upload the evening picture. It must have exactly the same size as the day picture; the guide refuses one that does not match.
3. **Draw a building** for every building: click its corners in order, pick its Home Assistant area in the bar, then **Done**. Pick the floor plan it opens once you have added one, here or under **Floor plans**. A building without a floor plan, such as a shed or a workshop, opens the lights, heating and sensors of its area when tapped.
4. **Draw a panel area** for every group of solar panels, and set the peak output in kW. The panels glow green while producing, stronger as output approaches the peak.
5. **Draw a window** and pick the room behind it, to have it light up when a light in that room is on. Needs a floor plan with rooms first.

### Floor plans

1. **Upload floor plan picture.** One per building or storey.
2. **Draw a room** for every room: click the corners, pick its Home Assistant area in the bar, **Done**.
3. **Pick the room's Home Assistant area.** The room takes the area's name and its lights, thermostat and temperature sensor. The lights are set out in the middle of the room; move them to their real spots in placement mode. Rooms already named like an area can be linked all at once with **Link rooms to areas with the same name**. Without areas, type the room's name instead and place everything by hand.
4. **Pick the building on the overview picture** that opens the plan. Tapping that building lifts its roof and shows the plan. The same link can be set under **Overview picture**, where each building says which plan it opens. With a single building and a single plan they are linked by themselves.

**Edit shape** next to a room (and next to a building under **Overview picture**) opens it on the picture to adjust:
- drag a corner to move it; drag the small dot in the middle of an edge to add a corner there; press and hold a corner, or right-click it, to remove it (a shape keeps at least three);
- drag inside the shape to move all of it. A room takes its lamps and its name label along;
- click a corner or the shape, then nudge it with the arrow keys, ten times as far with Shift;
- **Snap to other shapes** (on by default, remembered on the screen) puts a corner on a nearby corner or edge of the other rooms, so walls line up. It works when drawing a new room too;
- **Undo** and **Redo** work inside the editor; **Cancel** leaves the shape as it was.

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
| Electricity price today | a price sensor with prices per hour or per quarter-hour, such as Nord Pool (the HACS integration, or Home Assistant's own) |
| Weather | any `weather.*` entity |

**Heating devices** lists thermostats that are not linked to a room yet, such as a heat pump. Ticked ones are shown in the heating card.

### Buttons

Tick the scenes and scripts to show as buttons, and give them short names.

### Wall screen

All optional, for tablets and screens on the wall (see [configuration.md](configuration.md#wall-screens) for the details):

- **Doorbell**: the doorbell entity (a binary sensor, or an event or button entity) and its camera. When it rings, the dashboard shows the camera in a window that closes by itself.
- **Idle mode**: how long without touch before a screen in kiosk mode goes back to the start, night hours when it dims, and the motion sensors that wake it.
- **Light mode** for every screen; for one screen only, add `?lite` to its address.

### Lights and heating

Opens placement mode (also available as **Placera** / **Place** in the header):

1. Pick a light, switch, thermostat or temperature sensor in the list. Unplaced ones are listed first, with their Home Assistant area; the search also finds entities by area.
2. Tap where it is. On a floor plan the room is found from the tap: a light is placed at that spot, a thermostat or sensor is linked to the room. On the overview picture a light becomes an outdoor lamp; tap again to add more fixtures switched by the same entity. Outdoor lamps in the same Home Assistant area share one switch in the lights card.
3. To move something already placed, drag the lamp to its new spot; on a floor plan it can go into another room. On the overview picture each fixture of an outdoor lamp moves on its own. Tap a lamp to see which one it is: a tag over it shows its name and entity id, and it is selected in the list.
4. Fine-tune a selected lamp with the arrow keys (Shift moves ten times as far); it is saved when you stop pressing.
5. **Undo** and **Redo** (or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z) step back through the changes in placement mode until you save or throw the draft away.
6. **Save to Home Assistant.**

New outdoor lamps are drawn as wall lamps. To make one a flood or deck light, change its `type` to `ground` in `site.json` (see [configuration.md](configuration.md)).

### Backup

The last step, for administrators in the Home Assistant panel:

- **Export**: **Download .zip** saves the dashboard as one file: `site.json` and every picture in its folder. Entity ids are in it, so keep it to yourself.
- **Import**: **Choose .zip …** reads a file exported from SmartHomeDash into this dashboard, after you confirm. It replaces the settings and adds the pictures; pictures already there with other names stay. To move a dashboard to another Home Assistant, or copy it, add a new dashboard there (step 2) and import into it. Home Assistant checks the whole file first and imports nothing if any part fails: only `site.json` and jpg, png or webp pictures (checked by content), at most 100 MB unpacked, 25 MB per picture and 200 files, and no names that lead out of the dashboard's folder.
- **Restore points**: every save keeps the version it replaced, up to the last 10 (`site.json.1` is the newest, up to `site.json.10`). Each is listed with when it was saved and how many floor plans and rooms it has; **Restore** makes it the current one, after you confirm. An import or a restore keeps the settings it replaced as a restore point too, so it can be undone the same way. Pictures are not part of a restore point.

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

**Kiosk mode** shows only the dashboard. Open it with `?kiosk` at the end of the address (`http://homeassistant.local:8123/home?kiosk`) or tap **Kiosk mode** in the header and then **Start kiosk mode**. It:

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

**Idle mode.** In kiosk mode the dashboard goes back to the overview after two minutes without touch, closing open panels. With night hours set in the setup guide's **Wall screen** step it also dims at night; a touch or a motion sensor wakes it.

**Doorbell.** With a doorbell and a camera set in the **Wall screen** step, the camera opens in a window when the doorbell rings, and closes by itself. **Test the doorbell** under the **Kiosk mode** button shows the window on that screen without ringing anything.

**Older tablets.** If the picture stutters, tap **Kiosk mode** on the tablet and set **Light mode on this device** to On, or add `?lite` to the address (`http://homeassistant.local:8123/home?kiosk&lite`): light mode drops blur, blending and animation. The tablet remembers it. Auto turns it on by itself for slow devices.

### Performance

The dashboard is measured on a large test home (3 floor plans, 40 rooms, 120 lamps, 60 sensors) in Chromium slowed down four times, like an old wall tablet. It has to start in under 2 seconds with under 4,000 elements on the overview, and while states change the three longest freezes in 30 seconds must average 100 ms or less, with none over 150 ms (a slowed-down test machine has hiccups of its own). To stay there:

- Floor plans are built the first time you open them, not at start.
- Changes from Home Assistant are drawn once per screen refresh, however many arrive at once.
- While the page is hidden (another tab, a switched-off screen) or the night dim is on, animations and the dashboard's own timers rest, and nothing is redrawn until it shows again.

**Light mode** turns off, on top of that:

- blur and all other filters, including the evening darkening of the pictures (a plain dark layer does it instead),
- blending of light with the picture (lamps, windows and solar are drawn over it),
- every animation and transition: the energy flow dots, the solar shimmer, pulsing alarms, rain and snow, the roof lift,
- the window glow, the facade wash of wall lamps and the weather veil.

In landscape at 1024 pixels or wider the dashboard fills the screen without scrolling. On a phone, pinch with two fingers to zoom into the picture or a floor plan, and drag to move around; **Reset zoom** goes back. iPad Safari has no full screen for web pages; use the companion app, or *Add to Home Screen*, for the most screen space.

## Troubleshooting

**The dashboard shows "Nothing to show yet" to some users.** Only administrators can run the setup guide. Set it up with an administrator account once.

**A picture does not upload.** Pictures must be jpg, png or webp and at most 25 MB.

**A light does not glow on the overview.** Check in placement mode that it is placed outdoors (on the overview picture), and that the entity turns on in Home Assistant.

**Temperatures look wrong.** A room shows its temperature sensor if one is linked, otherwise the thermostat's own reading. Link a temperature sensor to the room in placement mode.

**A warning says devices no longer exist in Home Assistant.** An entity in site.json was renamed or removed in Home Assistant. Unfold the warning to see which, and where each is used. **Show in placement mode** lists only those; place one again under its new name, or remove it from the dashboard.

**Saving says "site.json was not saved".** The file failed Home Assistant's check, and the message says which part, such as a room outline that is not a list of number pairs. The file on disk is unchanged. Fix that part in placement mode or in the file.

**An import says "Nothing was imported".** The message names the file in the .zip that failed, for example a file that is not a picture, or a `site.json` that fails the check above. Nothing in the dashboard changed. Export from SmartHomeDash again, or remove that file from the .zip.

**The sidebar entry is missing after a restart.** Check *Settings → System → Logs* for messages from `smarthomedash`.

**Still stuck, or something looks like a bug.** Tap **?** in the dashboard's top bar, or **Report a problem** at the bottom of the setup guide's steps. It shows what will be sent: SmartHomeDash and Home Assistant versions, browser, screen size, kiosk and light mode, counts of plans, rooms and devices, and the config check messages, never entity ids, names or pictures. You can change the text, then **Open the issue on GitHub** fills in the bug report form with it. Administrators can add *Download diagnostics* from *Settings → Devices & services → SmartHomeDash → ⋮*: versions, the dashboard's options with its name and address redacted, and counts and sizes for its site folder, including how many devices site.json names that Home Assistant does not know. Questions that are not bugs go to [Discussions](https://github.com/rsundin/SmartHomeDash/discussions).
