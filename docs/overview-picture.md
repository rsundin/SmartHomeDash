# An overview picture without a drone

The overview picture is the heart of the dashboard: lamps glow on it, windows light up and solar panels shine green. A drone photo is ideal, but most people do not have one. This guide makes a day picture and a matching evening picture from a 3D map and an AI image model, in about 15 minutes.

You need a computer, a free map service with 3D view and an image model that can edit an uploaded picture, such as ChatGPT, Gemini or similar.

## 1. Find your home in 3D

Use any map with a tilted 3D view, for example:

- **Google Earth** (earth.google.com): search the address, then hold Shift and drag to tilt.
- **Google Maps**: satellite view with *Globe view* on; hold Ctrl and drag to tilt (two fingers on a trackpad or phone).
- **Apple Maps**: satellite view, then the 3D button.

Then set up the view:

- **Tilt about 45°**, like a drone looking down at the house.
- **Turn** so the side with most outdoor lamps and windows faces you, usually the entrance.
- **Zoom** until the whole property fills the screen with a little margin around it.
- **Hide labels**, icons and roads where the map allows it (Google Maps: *Layers → More → Labels off*; Google Earth: *Map style → Clean*).

No 3D view where you live? Use the plain satellite view from straight above and use the *top-down* variant of the prompt below. A phone photo of the facade helps the model a lot, see step 3.

## 2. Take a screenshot

Take a screenshot (Windows: Win+Shift+S, Mac: Cmd+Shift+4) and crop it to the property in **landscape**, about 3:2. At least 1200 pixels wide gives a sharp result.

## 3. Make the day picture

Open your image model, upload the screenshot and give it this prompt:

```
Turn this screenshot from a 3D map into a photorealistic drone photograph of the same
property. Keep the exact camera angle, framing and aspect ratio. Keep every building,
roof shape, window, door, solar panel, driveway, tree and fence where it is and in its
real proportions; do not add or remove buildings.
Clean up map artefacts: melted or blurry geometry, smeared trees, flat textures, labels,
icons, cars and people.
Light: bright overcast midday, soft even daylight, gentle shadows, natural colours.
Make building outlines, roof edges, windows and solar panels crisp and clearly visible.
All lights are OFF: no lit windows, no outdoor lamps.
No text, no watermark, no people, no vehicles.
```

**Top-down variant** for a satellite view from straight above: replace the first two sentences with

```
Turn this satellite image into a photorealistic drone photograph of the same property,
seen from the south at a 45° angle. Keep the layout, sizes and positions of every
building exactly as in the satellite image.
```

and name the side you want to see instead of *the south*.

**With facade photos:** upload one or more phone photos of the house as extra pictures and add: *Use the other pictures as reference for the facades: colours, windows, doors and materials.*

Check the result before going on:

- Same buildings in the same places, no invented extensions or extra windows.
- Roof edges and solar panels clearly visible.
- No lamps or windows lit.

If something is off, ask for a correction in the same chat, for example: *Keep everything else exactly the same. The garage has two windows on this side, not three.*

## 4. Make the evening picture

Upload the **day picture you just made**, not the screenshot, so both match exactly. Use this prompt:

```
Edit this exact image. Keep the camera angle, framing, image size and every building,
roof, window, solar panel, tree and path exactly where they are; change nothing but the
light. Change the time of day to blue hour shortly after sunset: deep blue sky glow,
cool ambient light, soft shadows, buildings still clearly readable.
All lights are OFF: no lit windows, no outdoor lamps, no glow anywhere.
Photorealistic. No text, no people.
```

The two pictures must have **exactly the same size** in pixels; the setup guide refuses an evening picture that does not match. If the model changed the size, scale the evening picture to the day picture's size in any image editor (Preview on Mac, Photos on Windows).

## 5. Upload them

In the dashboard: **Setup → Overview picture**, upload the day picture, then the evening picture. Draw the buildings, solar panels and windows on it, and place your outdoor lamps in placement mode.

## Why the lights must be off

The dashboard draws the light itself: a lamp glows when it is on in Home Assistant and goes dark when it is off. A lamp that is lit in the picture would look lit even when it is switched off.

## Good to know

- Map imagery belongs to the map provider. Use the result for your own dashboard; do not publish it.
- The prompts are in English because image models follow English most consistently. You can write in your own language too.
- Image models change often. If a prompt stops giving good results, keep the requirements (same angle and layout, crisp edges, every light off, same size for both pictures) and reword the rest.
