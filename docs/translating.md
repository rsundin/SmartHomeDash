# Translating SmartHomeDash

The dashboard speaks Swedish and English, written by hand, and Danish, German, Finnish, Norwegian (bokmål) and Dutch, translated with machine help. Corrections to any of them are welcome, and so are new languages. You need a text editor and a GitHub account; no build step, no tools.

## Where the texts are

Every text on screen is in one file per language: `custom_components/smarthomedash/frontend/i18n/<code>.json`. Each file is a flat list of key and text:

```json
{
  "cards.allOff": "All off",
  "warn.smoke": "Smoke in {room}"
}
```

- Keep the keys as they are; translate only the text on the right.
- `{room}`, `{n}`, `{name}` and the like are filled in by the dashboard. Keep each one exactly as in `en.json`, in the place where it fits your language. If your grammar would need to inflect a name (Finnish cases, for example), write the sentence so the name stands on its own: `"Savua: {room}"`.
- Keep `→`, `·`, `…` and `site.json` as they are. The names of buttons that a text refers to ("tap **All off**") should match how you translated those buttons.
- `en.json` is the reference. A key missing in another file falls back to English, so the dashboard still works while a translation is incomplete; the tests ask for every key, though.
- Room, lamp and device names are never translated: the dashboard shows them as they are written in Home Assistant or the setup guide.

Home Assistant shows a few texts of its own: the form for adding a dashboard, its settings, and the names of the actions. They are in `custom_components/smarthomedash/translations/<code>.json`, with the same structure as `en.json` there; the same five languages are machine-assisted. Home Assistant reads them when it starts.

A machine-assisted file starts with a note, `"_translation": "Machine-assisted translation …"`. Keys that start with `_` are notes about the file and are never shown. When a native speaker has read the whole file and fixed it, remove the note and set `machine` to false for it in `i18n.js` (below), so the setup guide no longer marks it.

## Correcting a translation

1. Open the file on GitHub, for example [de.json](../custom_components/smarthomedash/frontend/i18n/de.json), and press the pencil to edit.
2. Change the texts you want to fix. Search `en.json` for the same key to see what the English says.
3. Propose the change. GitHub opens a pull request; describe what you changed.

To see a text where it is used, run the standalone page: `python3 -m http.server` in the repository, then open `http://localhost:8000/?site=example-house`. Change `"language"` in `sites/example-house/site.json` to your language and reload. `#edit` opens placement mode; the setup guide needs Home Assistant or the test page `tests/browser/harness.html?site=example-house`.

## Adding a language

1. Copy `en.json` to `<code>.json`, where `<code>` is the two-letter language code (ISO 639-1; `nb` for Norwegian bokmål). Translate every text. Add the `_translation` note if a machine helped.
2. In `custom_components/smarthomedash/frontend/js/i18n.js`, add the code to `LANGUAGES` and a line to `LANGUAGE_INFO` with the language's own name, the locale used for numbers and dates (for example `pt-PT`) and `machine: true` if it is machine-assisted.
3. Add the code to `LANGUAGES` in `custom_components/smarthomedash/frontend/card.js` (the card keeps its own copy) and to `LOCALES` in `custom_components/smarthomedash/const.py` (a new dashboard picks its language from Home Assistant's).
4. Copy `custom_components/smarthomedash/translations/en.json` to `<code>.json` there and translate the texts (keep the structure and the keys).
5. Run `tests/run.sh backend`. It fails if a key is missing or extra, a `{placeholder}` differs from English, a text is empty, or one of the lists above leaves the language out. `tests/run.sh browser` then opens both examples and the setup guide in every language.

## Numbers and dates

They follow the site's `locale` in site.json. A site without one uses its language's locale from `LANGUAGE_INFO` (German writes `2,7 kW`, English `2.7 kW`). Picking a language in the setup guide sets the locale too; set `locale` by hand in site.json for another format, for example `de-CH`.
