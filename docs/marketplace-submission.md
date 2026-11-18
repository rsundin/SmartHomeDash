# Getting SmartHomeDash into the Marketplace catalog

Since Home Assistant 2026.11, HACS is built in as the **Marketplace**. Anyone can already install SmartHomeDash with **Settings → Marketplace → Add from link**. Being in the **catalog** means people can find it by searching, without the link.

The catalog is still the list in [hacs/default](https://github.com/hacs/default): the Marketplace reads the same data HACS did, and submitting works as before ([HACS and the Marketplace](https://www.hacs.xyz/docs/marketplace/), [Include default repositories](https://hacs.xyz/docs/publish/include)). Checked 18 November 2026; read those two pages again before submitting in case the process has moved.

Only the repository owner may open the pull request, from a personal account. These are the steps and the text for it.

## What is already in place

| Catalog check | Where it is met |
| --- | --- |
| Brands | `custom_components/smarthomedash/brand/icon.png` (256 × 256) and `icon@2x.png` (512 × 512). The HACS action looks for `brand/icon.png` first, so no entry in home-assistant/brands is needed |
| HACS action without ignores | `.github/workflows/validate.yml`, job **HACS** (the `ignore: brands` line was removed in 0.8.32) |
| Hassfest | same workflow, job **Home Assistant (hassfest)** |
| `hacs.json` with `name` | `hacs.json` (also `homeassistant: 2025.6.0`, the minimum version the Marketplace shows) |
| Valid `manifest.json` | `custom_components/smarthomedash/manifest.json` |
| Domain not used by core | `smarthomedash` |
| A full GitHub release | releases exist; a new one is needed after the checks pass (step 2) |
| OSI licence | MIT (`LICENSE`) |
| Description, issues, topics | set on GitHub: description, issues on, topics include `hacs`, `home-assistant`, `home-assistant-integration` |
| Not archived | active |

The backend test `tests/backend/test_marketplace.py` keeps the icon, `hacs.json` and the no-ignore rule from slipping.

**About brand images:** Home Assistant shows an integration's own `brand/` images from 2026.3 on. On 2025.6 to 2026.2 SmartHomeDash appears without an icon. home-assistant/brands calls its custom-integrations folder legacy since 2026.3 and asks custom integrations to ship a `brand/` folder instead, so we do not submit there.

## Steps for the owner

1. **Merge the 0.8.32 pull request** and check that the **Validate** workflow on `main` is green, in particular the **HACS** job. Copy the link to that run (Actions → Validate → the run on `main` → the **HACS** job).
2. **Publish release `v0.8.32`** with the changelog section, as usual. It must be created *after* that green run. Copy the release link.
3. **Fork [hacs/default](https://github.com/hacs/default)** to your personal account and create a branch from `master`, for example `add-smarthomedash`. Do not work on `master`.
4. **Edit the file `integration`** (no extension; a JSON list) and add this line in alphabetical order, ignoring case. It goes between `"rstrouse/ESPSomfy-RTS-HA"` and `"rt400/Jewish-Sabbaths-Holidays"` (as of 18 November 2026):

   ```json
     "rsundin/SmartHomeDash",
   ```

   Their check sorts with `sorted(content, key=str.casefold)`; if neighbours have changed, place it where that puts it.
5. **Open the pull request** against `hacs/default` `master` with the title and body below. Fill in the three links. Do not request reviews: their template says such pull requests are closed.
6. **Mark it ready for review** when the links are in. A draft is not reviewed. Reviews can take weeks or months ([open queue](https://github.com/hacs/default/pulls?q=is%3Apr+is%3Aopen+draft%3Afalse+sort%3Acreated-asc)). Their bot runs the checks listed above; if one fails, fix it here, release again and update the links.

## Pull request text

**Title:**

```
Add rsundin/SmartHomeDash
```

**Body** (their template, filled in):

```markdown
## Checklist

- [x] I've read the [publishing documentation](https://hacs.xyz/docs/publish/start).
- [x] I've added the [HACS action](https://hacs.xyz/docs/publish/action) to my repository.
- [x] (For integrations only) I've added the [hassfest action](https://developers.home-assistant.io/blog/2020/04/16/hassfest/) to my repository.
- [x] The actions are passing without any disabled checks in my repository.
- [x] I've added a link to the action run on my repository below in the links section.
- [x] I've created a new release of the repository after the validation actions were run successfully.

## Links

Link to current release: <https://github.com/rsundin/SmartHomeDash/releases/tag/v0.8.32>
Link to successful HACS action (without the `ignore` key): <PASTE THE HACS JOB LINK FROM STEP 1>
Link to successful hassfest action (if integration): <PASTE THE HASSFEST JOB LINK FROM STEP 1>

SmartHomeDash is a picture-based dashboard: a photo or drawing of your own home with live lights, rooms, sensors and energy flow on it, set up in the Home Assistant UI. It ships as an integration (panel, config flow, a dashboard card and a goodnight action), with brand images in `custom_components/smarthomedash/brand/`.
```

## After it is merged

- Check that **SmartHomeDash** comes up when searching in **Settings → Marketplace** (after the next catalog scan).
- Update the install section of `README.md` and `docs/setup.md`: search for **SmartHomeDash** in the Marketplace first, with **Add from link** as the fallback. `tests/backend/test_docs.py` expects the *Add from link* text to stay.
- Then G1 in the plan (the launch posts) can point to the Marketplace.
