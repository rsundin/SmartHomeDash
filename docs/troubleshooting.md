# Troubleshooting

Find what you see below; each entry says what causes it and what to do. Buttons are named as they read in English; in another language they follow the dashboard's language.

If nothing here fits, see [Asking for help](#asking-for-help) at the end.

- [Installing and opening the dashboard](#installing-and-opening-the-dashboard)
- [Lights](#lights)
- [Temperature and heating](#temperature-and-heating)
- [Energy flow and prices](#energy-flow-and-prices)
- [The card in other dashboards](#the-card-in-other-dashboards)
- [Setup, saving and backups](#setup-saving-and-backups)
- [Wall screens and tablets](#wall-screens-and-tablets)
- [Asking for help](#asking-for-help)

## Installing and opening the dashboard

**PlanView Dash is not found in the Marketplace search.** Use **Settings → Marketplace → Add from link** and paste `https://github.com/rsundin/planview-dash`. See [Install the integration](setup.md#1-install-the-integration).

**There is no PlanView Dash entry in the sidebar.** Installing only adds the integration; the dashboard comes when you add it: **Settings → Devices & services → Add integration → PlanView Dash**. If the entry was there and is gone after a restart, look in *Settings → System → Logs* for messages from `planview_dash`. A dashboard set to **Only for administrators** is not in the sidebar of other users.

**The dashboard says "Could not start".** The line under it says why:

- *Cannot find … site.json (404)*: the dashboard's folder, `<config>/planview_dash/sites/<site>/`, is missing or has another name. Removing the integration entry keeps the folder, but moving or renaming it by hand breaks the link. For a dashboard in `configuration.yaml`, `site` must be the folder's name exactly.
- *… is not valid JSON*: `site.json` was edited by hand and has a typing error. Fix it, or copy the newest restore point (`site.json.1` in the same folder) over it.

**The dashboard says "Nothing to show yet".** It has no pictures or floor plans. Only administrators can run the setup guide: open the dashboard once with an administrator account and tap **Start setup**. Other users see the same text until then.

**"Could not connect to Home Assistant" at the top.** The dashboard lost its connection, for example during a restart of Home Assistant. Reload the page once Home Assistant is back.

**"This dashboard was saved by a newer version of PlanView Dash".** Its `site.json` was saved by a later release than the one installed, typically after going back to an older version. The dashboard shows it but saves nothing, so the newer settings are not lost. Update PlanView Dash again to change it (see [Upgrading](setup.md#upgrading)).

**Something looks old or broken right after an update.** The browser still has the previous version. Reload the page; in the companion app, pull down to refresh, or clear the app's frontend cache in its settings. If the update changed the Python side, Home Assistant also needs a restart: the Marketplace says so, and so does the [changelog](../CHANGELOG.md).

## Lights

**A lamp does not glow.** Go through these in order:

1. **Is it placed?** Open **Place** in the header. Lights that are not on the picture yet are listed first. A light in a room linked to a Home Assistant area is shown by itself, in the middle of the room, until you move it.
2. **Is it in the right place for what you are looking at?** A lamp placed in a room glows on the floor plan. On the overview picture, an indoor lamp shows as a lit window, and only if a window is drawn for its room (**Setup → Overview picture → Draw a window**). An outdoor lamp must be placed on the overview picture itself.
3. **Does it turn on in Home Assistant?** If it does not switch there, the dashboard cannot switch it either.
4. **Is it dimmed with a broken ring?** Then it is not responding; see below.

**A window does not light up.** The window must be drawn on the overview picture and linked to the room behind it, and a light placed in that room (or picked up from its area) must be on.

**A lamp, a temperature or an energy reading says "not responding".** Home Assistant knows the device but has no reading from it (*unavailable* or *unknown*): it is offline, its battery is flat, or its integration is still starting. The dashboard shows that instead of off, 0° or 0 kW, and lamps on the floor plan are dimmed with a broken ring. It clears by itself when the device answers again. A warning above the picture lists devices that stay unavailable.

**"Couldn't turn on …" at the bottom of the screen.** Home Assistant refused what you tapped, or did not answer: the device is offline, or the connection dropped. Nothing changed. The message names the lamp, scene or thermostat; the browser console has Home Assistant's own reason.

**All on or All off leaves some lights alone.** "All" means the lights on this dashboard, not every light in Home Assistant, and lights unticked under **Setup → Buttons → All on and all off** are left out on purpose. A light that is neither placed nor in a linked room's area is not on the dashboard.

**A light has an odd name.** Names come from Home Assistant: the device's name followed by the entity's own name ("Kitchen Ceiling"), as Home Assistant shows them. Rename the entity or the device in Home Assistant, or give the lamp a name of its own in `site.json` (see [Names](configuration.md#names)).

## Temperature and heating

**Temperatures look wrong.** A room shows its temperature sensor if one is linked, otherwise the thermostat's own reading, which is often measured next to the radiator. Link a temperature sensor to the room in placement mode.

**Temperatures are in the wrong unit.** Celsius or Fahrenheit follows Home Assistant's unit system (*Settings → System → General*).

**The room panel has no mode or preset buttons.** The thermostat does not offer any. They show up when Home Assistant reports modes or presets for it.

**A heat pump or a thermostat outside any room is missing.** Tick it under **Setup → Energy and weather → Heating devices** to show it in the heating card.

## Energy flow and prices

**The energy flow points the wrong way.** Inverters and meters count power in different directions. In **Setup → Energy and weather**, the **Direction** box next to the grid and battery shows how each reads right now. Compare with your inverter's app or display: if the battery is shown charging while it powers the house, or buying while you sell, tick the box to turn it around. The picture, the sentence in the energy card and the card's rows all follow it. Solar reading a few watts below zero at night is shown as 0, and a car charger always counts as a load.

**A line, a row or the whole energy card is missing.** Rows and lines are only shown for sensors you picked; leave one empty and it is hidden. A sensor that is not responding gives "No reading from: Grid." at the end of the sentence instead.

**The numbers are a thousand times too big or too small, or a warning names a power sensor's unit.** Power is read in W, kW, MW and Home Assistant's other power units. A sensor in kWh is energy, not power, and is not read: pick the matching power sensor instead. A sensor without a unit is read as watts, with a warning.

**The electricity price card is empty.** The price sensor must list the prices for today, per hour or per quarter-hour, such as Nord Pool (the HACS integration, or Home Assistant's own, which the card asks for its prices). For other sensors, see [Electricity price](configuration.md#electricity-price).

## The card in other dashboards

**The card says "Choose a dashboard for this card".** Open the card's editor and pick the **Dashboard**. In YAML, `site:` is missing.

**The card says "Could not start" and "Cannot find …/site.json (404)".** `site:` must be the dashboard's folder name, which is not always its title or its address. The card's editor lists every PlanView Dash dashboard you have; pick it there, or copy the name from `<config>/planview_dash/sites/`.

**PlanView Dash is not in Add card, or the card says "Custom element doesn't exist".** The card comes with the integration, so there is nothing to add by hand. After installing or updating, reload the browser page once (in the companion app, pull down to refresh). It needs at least one PlanView Dash dashboard added.

**The card shows the overview instead of the floor plan or room it was set to.** That floor plan or room no longer exists (it was removed or replaced, for example by **Start from my Home Assistant**). Pick it again in the card's editor.

**The card is too small or too big.** In a sections view, drag the card's corner. In other views, set **Height** in pixels.

## Setup, saving and backups

**A picture does not upload.** Pictures must be jpg, png or webp, and at most 25 MB. The file's content is checked, not just its name, so a HEIC photo from a phone renamed to `.jpg` is refused: export it as jpg first.

**The evening picture is refused.** It must have exactly the same size in pixels as the day picture. Resize it to match.

**Saving says "site.json was not saved".** The file failed Home Assistant's check, and the message says which part, such as a room outline that is not a list of number pairs. The file on disk is unchanged. Fix that part in the setup guide, in placement mode or in the file.

**Saving asks whether to replace someone else's changes.** Someone else, or another tab, saved the dashboard since you opened the setup guide or placement mode. **Save anyway** replaces their version, which is kept as a restore point; **Cancel** saves nothing and keeps your changes on screen.

**A save went wrong and you want the earlier version back.** **Setup → Backup → Restore points** lists the last 10 saves; **Restore** makes one the current version. Pictures are not part of a restore point.

**An import says "Nothing was imported".** The message names the file in the .zip that failed, for example a file that is not a picture, or a `site.json` that fails the check above. Nothing in the dashboard changed. Export from PlanView Dash again, or remove that file from the .zip.

**A warning says devices no longer exist in Home Assistant.** An entity in `site.json` was renamed or removed in Home Assistant. Unfold the warning to see which, and where each is used. **Show in placement mode** lists only those; place one again under its new name, or remove it from the dashboard.

**The setup tools are not in the header.** **Setup** and **Place** are for administrators, and are hidden in kiosk mode.

## Wall screens and tablets

**Kiosk mode will not go away.** Hold the clock for two seconds. Kiosk mode is stored in that browser, so a device left in it starts in it again, and Home Assistant's sidebar stays hidden there until you leave it.

**The picture stutters on an older tablet.** Turn on light mode: tap **Kiosk mode** and set **Light mode on this device** to **On**, or add `?lite` to the address. See [Older tablets](setup.md#wall-screens-and-tablets).

**The screen does not go back to the start, dim at night or wake on motion.** Idle mode works only on a device in kiosk mode. Night dimming needs night hours, and waking needs motion sensors, both under **Setup → Wall screen**. A browser cannot turn the backlight off; for a dark screen use the tablet's own schedule or a kiosk browser.

**The doorbell camera does not open.** Check under **Setup → Wall screen** that both the doorbell and its camera are picked, then try **Test the doorbell** under the **Kiosk mode** button. If the test works but a real ring does not, check in Home Assistant that the doorbell entity changes when it rings.

## Asking for help

**Report a problem.** Tap **?** in the dashboard's header, or **Report a problem** at the bottom of the setup guide's steps. It shows what will be sent: PlanView Dash and Home Assistant versions, browser, screen size, kiosk and light mode, counts of floor plans, rooms and devices, and the config check messages, never entity ids, names or pictures. You can change the text, then **Open the issue on GitHub** fills in the bug report form with it. Issues are public.

**Diagnostics.** Administrators can add Home Assistant's diagnostics to the issue: *Settings → Devices & services → PlanView Dash → ⋮ → Download diagnostics*. It holds versions, the dashboard's options with its name and address hidden, and counts and sizes for its folder, including how many devices `site.json` names that Home Assistant does not know.

**Logs.** *Settings → System → Logs*, searched for `planview_dash`, shows what Home Assistant's side reported. The browser console (in a desktop browser) shows what the dashboard itself reported, such as Home Assistant's reason for a refused command.

**Questions and ideas** that are not bugs go to [Discussions](https://github.com/rsundin/planview-dash/discussions), where others can answer too.
