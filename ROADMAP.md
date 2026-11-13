# Roadmap

What is planned next, roughly in order. Plans change; ideas and votes are welcome in [Discussions](https://github.com/rsundin/SmartHomeDash/discussions), and problems in [issues](https://github.com/rsundin/SmartHomeDash/issues) (the dashboard's **?** button fills one in).

## 0.9: Foundation

- **Automated tests** in the repo and CI, covering the backend and the dashboard in a browser at five screen sizes. Done in 0.8.6.
- **Performance budget** measured on a large test home with a slowed-down CPU, so old wall tablets stay smooth. Done in 0.8.7.
- **Names as Home Assistant shows them**, following the 2026.11 naming change. Done in 0.8.8.
- **Electricity prices at 15 minutes**, as Nord Pool publishes them since October 2025, in the chart and the cheapest hours. Done in 0.8.10.
- **Clear messages** when site.json refers to devices that no longer exist, and a check of site.json before it is saved. Done in 0.8.11.
- **Install docs for the Marketplace**, which replaced HACS in Home Assistant 2026.11.
- **A steadier pinch zoom** after a drag, and **tests against a real Home Assistant** in CI.
- **A tidier codebase** for what comes next: the setup guide in one file per step, the texts in one file per language.

## 1.0: Nearly zero setup

- **Quick start from Home Assistant**: a floor plan per floor with a tile per area, working before you draw anything. Done in 0.8.12.
- **Report a problem and get help**: a *Report a problem* button that fills in a GitHub issue without details about your home, Home Assistant diagnostics, and GitHub Discussions for questions and ideas. Done in 0.8.14.
- **Editor comforts**: undo and redo, move and add corners, snap to other rooms, move a whole room, nudge with the arrow keys. Done in 0.8.15.
- **Export, import and restore points** for a whole dashboard. Done in 0.8.16.
- **A card for any dashboard** (`custom:smarthomedash-card`).
- **More languages**: German, Norwegian, Danish, Finnish, Dutch.
- **A listing in Home Assistant's Marketplace**, so SmartHomeDash can be found without a link.
- **Accessibility and large text**: text size per screen, keyboard use, screen reader names.
- **Launch**: a short recording in the README and a post on the Home Assistant forum.

## 1.1: More of the home on the picture

- **People in rooms**, from person entities and room presence sensors (off by default).
- **Doors and windows where they are**, opening on the plan and the picture.
- **Media and appliances**: what is playing, and when the washing machine is done.
- **Cameras on the picture**, with motion and a tap for the live view.
- **Power per room** as an energy view of the floor plan.
- **Humidity and CO₂** as alternatives to the temperature tint.
- **Solar forecast** beside the live flow, a **car charging plan** from the cheapest hours, and an optional **capacity peak** tracker for grid companies that charge by peak.

## 1.2: Wall screens as an ambient display

- **The house as screensaver** with clock, weather and the next event.
- **Screen profiles and guest mode** per wall screen.
- **Family strip**: calendar, to-do, waste collection.
- **Voice from the wall** through Assist (exploratory).
- **Alarm panel** state, with arming off by default.
- **Paper mode** for e-ink screens (exploratory).

## 1.3: The summer house and both homes

- **Summer house mode**: when the house is closed, the overview leads with frost, damp, leaks, locks, power and the last visit.
- **Warm up before arrival**: heating starts in time to be warm when you get there.
- **Both homes at a glance**, with warnings from each (exploratory).

## Later

- A timeline to scrub through today on the picture, heating schedules per room, sunlight through windows, a daily summary written by AI (off by default), camera events with AI summaries, a community section for Home Assistant's dashboards.

The working plan with tasks and acceptance criteria is [docs/roadmap/plan.md](docs/roadmap/plan.md), where the project stands is [docs/roadmap/status-2026-11.md](docs/roadmap/status-2026-11.md), and the research behind it is [docs/roadmap/research-2026-11.md](docs/roadmap/research-2026-11.md).

## Done

- 0.8.6 to 0.8.16: tests, performance budget, Home Assistant naming, quarter-hour prices, config check, quick start, report a problem, editor comforts, backup and restore points
- 0.8.0: wall screens: doorbell camera, idle mode with night dimming and motion wake, light mode for older tablets
- 0.7.0: energy flow, dusk and weather on the picture, blinds and curtains, cheapest electricity hours; rooms pick up their area's entities by themselves
- 0.6.0: doors, windows, locks, presence and alarms per room; warnings; floors from Home Assistant
- 0.5.2: online demo; lamps glow in their own colour and brightness
- 0.5.1: pinch zoom on phones
- 0.5.0: rooms linked to Home Assistant areas; an overview picture without a drone
- 0.4.0: first public release
