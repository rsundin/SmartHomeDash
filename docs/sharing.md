# Sharing your dashboard safely

Pictures of other people's dashboards are the best way to get ideas, and Show and tell in [Discussions](https://github.com/rsundin/planview-dash/discussions/categories/show-and-tell) is the place for them. A dashboard built on a picture of your own home shows more than most, though: what the house looks like, where it is, which rooms people sleep in and where the cameras are not. A few minutes before posting keeps that to yourself.

## A screenshot or recording

- **The overview picture.** A drone or 3D-map picture can be matched to a map. Leave out house numbers, number plates, street signs and distinctive views, or crop or blur them. If you would rather not show your house at all, share the floor plan only.
- **The header and cards.** The dashboard's name, the address in the browser bar and the weather card's place name can give away where you live. Crop the browser bar; rename the dashboard for the screenshot if its name is your street.
- **Cameras and doorbells.** Close the camera window, and check that no snapshot of your driveway or front door is in the picture. Camera markers on the floor plan show where cameras look, and so where they do not.
- **Locks and alarms.** The floor plan marks unlocked doors and an alarm that is off. Take the screenshot with everything locked, or crop those parts.
- **Room names.** Children's names on bedrooms, "Safe" or "Server room" tell a stranger more than "Bedroom 2". The room panel and the warnings bar show them too.
- **When you are away.** Posting "the house is empty this week" with a live view is an invitation. Share after you are home.

The [online demo](https://rsundin.github.io/planview-dash/) runs on test data: if you only want to show a feature or a problem, record it there instead.

## Files

- **Do not share an export (.zip).** It holds your `site.json` and your pictures: every entity id, room name and the picture of your home. It is meant for your own backups and for moving to a new Home Assistant.
- **`site.json` on its own** has entity ids, room and device names, and the outline of every room. If someone asks for it to help with a problem, replace the names first, or describe the part that goes wrong instead.
- **Problem reports** made with the dashboard's **?** button and Home Assistant's *Download diagnostics* for PlanView Dash hold versions, counts and sizes only, never names, entity ids or pictures. Those are safe to attach to an issue.

## Tokens and addresses

PlanView Dash runs behind Home Assistant's own login and needs no access token in the browser. If you set `github_token` for `planview_dash.update`, leave it out when you share your `configuration.yaml`. Also check that a screenshot or a pasted log shows no long-lived access token, no `?token=` in an address, and no outside address of your Home Assistant (a Nabu Casa link, a duckdns name, your public IP).
