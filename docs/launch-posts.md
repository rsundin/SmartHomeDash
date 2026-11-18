# Launch posts

Ready-made texts for showing PlanView Dash to the community (roadmap task G1). Only the owner can post them, from their own accounts. Written 18 November 2026 for 0.8.34; check the version, the links and the Marketplace wording before posting.

**Order:** publish the release first, so the recording in the README is on `main`. Then the Show and tell discussion (the posts link to it), then the Home Assistant Community thread, then Reddit a day or two later, linking to the forum thread for longer questions.

**The recording:** `docs/images/demo.webp` plays in the README and on the forum. Reddit does not play animated WebP; upload it as a video instead. `node scripts/record-demo.js docs/images/demo.webp demo.mp4` records both from the test data.

---

## 1. GitHub Discussions: Show and tell (pinned)

Discussions → **Show and tell** → **New discussion**. Pin it afterwards (⋯ → **Pin discussion**).

**Title:** Share your PlanView Dash

**Body:**

> Built a dashboard of your own home? Post a screenshot or a short recording here: the overview picture, a floor plan, a wall tablet in the hall, a clever use of the card on another dashboard. Ideas travel best as pictures.
>
> A few things worth a line in your post, if you like:
>
> - What the overview picture is: a drone shot, a 3D map with an AI evening version ([how](https://github.com/rsundin/planview-dash/blob/main/docs/overview-picture.md)), or a floor plan only.
> - The screen it runs on, and whether light mode (`?lite`) is on.
> - What you use it for most, and what you miss.
>
> **Before you post:** a picture of a home shows more than most screenshots. Crop or blur house numbers, street signs, number plates and camera images, take the screenshot with doors locked, and never attach an export (.zip) or your `site.json`: they hold your pictures, room names and entity ids. The checklist is in [Sharing your dashboard safely](https://github.com/rsundin/planview-dash/blob/main/docs/sharing.md).
>
> Problems go in [issues](https://github.com/rsundin/planview-dash/issues) (the **?** button in the dashboard fills one in without details about your home), questions in [Q&A](https://github.com/rsundin/planview-dash/discussions/categories/q-a), and wishes in [Ideas](https://github.com/rsundin/planview-dash/discussions/categories/ideas), where votes decide what comes next.

---

## 2. Home Assistant Community

[community.home-assistant.io](https://community.home-assistant.io/) → category **Share your Projects!** → **Dashboards & Frontend** (if that subcategory is gone, use **Share your Projects!** and the tags `dashboard`, `custom-integration`). Upload `demo.webp` (or a GIF of it) straight into the post rather than linking it, so it plays inline.

**Title:** PlanView Dash: your home as a living picture, with the roof that lifts to the floor plan

**Body:**

> Hi all! I have been building a dashboard that shows the house as a picture rather than as cards, and it is now at a point where others can use it.
>
> *[upload demo.webp here]*
>
> **What it does**
>
> - **A picture of your own home** (a drone shot, a 3D map, or just a floor plan for an apartment). Lights glow where they are, in their own colour; wall lamps wash the facade, windows light up when a room's lamps are on, and solar panels glow green while they produce.
> - **Dusk on the picture:** the day picture fades into an evening one as the sun sets, with cloud, fog, rain and snow drawn from your weather entity.
> - **Tap a building and the roof lifts** to its floor plan: rooms tinted by temperature, every lamp switchable in place, a room panel with the thermostat, a 24-hour graph, dimmers and blinds.
> - **Energy flow** from sun, battery and grid to the house and car, and the electricity price with the cheapest hours ahead (15-minute Nord Pool prices work).
> - **Wall screens:** kiosk mode, the doorbell camera when someone rings, back to the picture when idle, dimmed at night, all lights on/off, a goodnight countdown, and a light mode for old tablets.
> - **A card for any dashboard** (`custom:planview-dash-card`) if you only want the picture in an existing view.
> - **Set up in the UI**, no YAML: a quick start builds floor plans from your Home Assistant floors and areas, then you upload pictures, draw rooms and tap where each lamp is. Undo, export/import and restore points included.
> - Runs as a panel behind Home Assistant's own login, no tokens, no outside services. Swedish, English, Danish, German, Finnish, Norwegian and Dutch.
>
> **Try it without installing:** the [live demo](https://rsundin.github.io/planview-dash/) runs the example house and apartment on test data in your browser.
>
> **Install:** on Home Assistant 2026.11 or newer, **Settings → Marketplace → Add from link** with `https://github.com/rsundin/planview-dash`. On older versions, add it to HACS as a custom repository (Integration). Then add the **PlanView Dash** integration; it starts from an example you can keep or replace.
>
> **Links:** [GitHub](https://github.com/rsundin/planview-dash) · [setup guide](https://github.com/rsundin/planview-dash/blob/main/docs/setup.md) · [how to make an overview picture without a drone](https://github.com/rsundin/planview-dash/blob/main/docs/overview-picture.md) · [show yours in Show and tell](https://github.com/rsundin/planview-dash/discussions/categories/show-and-tell)
>
> It is free and MIT licensed. Feedback is very welcome, especially from people with other kinds of homes than mine: several buildings, several floors, apartments. Bugs go to GitHub issues (the **?** in the dashboard fills one in for you), ideas and votes to Discussions.

---

## 3. r/homeassistant

[reddit.com/r/homeassistant](https://www.reddit.com/r/homeassistant/) → **Create post** → **Images & Video**, upload the .mp4, flair **Personal Setup** (or **Custom Integration** if that flair exists). Put the links in the first comment if the subreddit hides links in video posts.

**Title:** I made a dashboard that shows my house as a picture: lights glow where they are, and tapping the house lifts the roof to the floor plan

**Body / first comment:**

> PlanView Dash is a free Home Assistant integration that turns a picture of your home into the dashboard. The video is the demo on test data: dusk falls, the lamps come on outdoors and inside, the roof lifts, and the living room opens with heating and dimmers.
>
> - Your own picture: a drone shot, a 3D map (there is a guide for making a day and evening picture with an AI image model), or only a floor plan for an apartment
> - Lamps in their real colour and brightness, lit windows, solar panels, energy flow, electricity prices
> - Built for wall tablets: kiosk mode, doorbell camera pop-up, idle and night dimming, a light mode for old hardware
> - Set up in the UI, starting from your Home Assistant floors and areas; no YAML
> - Also works as a card on your existing dashboards
>
> Live demo (no install): https://rsundin.github.io/planview-dash/
> GitHub: https://github.com/rsundin/planview-dash
> Install: Settings → Marketplace → Add from link (HA 2026.11+), or HACS custom repository on older versions.
>
> Happy to answer questions. Forum thread for longer discussions: *[link to the Community thread]*

---

## Afterwards

- Answer in the forum thread and on Reddit for the first day or two; questions there often become Q&A entries or issues.
- Add the forum thread's link to the README under **Help, questions and ideas** once it exists.
