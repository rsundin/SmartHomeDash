// UI text. Swedish is the default; a site can pick another language in site.json:
//   "language": "en"
// Each language is one file, frontend/i18n/<code>.json: a flat object of key → text,
// with {name} for values filled in by t(). To add a language, copy en.json, translate
// the values, and add it to LANGUAGES (docs/translating.md). Missing keys fall back to
// English. Keys starting with "_" are notes about the file, never shown.
//
// The files are fetched, not imported: start() in main.js loads English and the site's
// language before anything is drawn (loadLanguage), so t() itself stays synchronous.

export const LANGUAGES = ['sv', 'en', 'da', 'de', 'fi', 'nb', 'nl'];

// Per language: its own name (the setup guide's picker), the number and date format a
// site gets when it names no "locale", and whether the text is machine-assisted.
export const LANGUAGE_INFO = {
  sv: { name: 'Svenska', locale: 'sv-SE' },
  en: { name: 'English', locale: 'en-GB' },
  da: { name: 'Dansk', locale: 'da-DK', machine: true },
  de: { name: 'Deutsch', locale: 'de-DE', machine: true },
  fi: { name: 'Suomi', locale: 'fi-FI', machine: true },
  nb: { name: 'Norsk bokmål', locale: 'nb-NO', machine: true },
  nl: { name: 'Nederlands', locale: 'nl-NL', machine: true },
};

// The dashboard language for a browser or Home Assistant language tag ("de-AT", "no",
// "nn", "en-US" …): the same language if there is a file for it, otherwise English.
export function matchLanguage(tag) {
  const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
  const code = base === 'no' || base === 'nn' ? 'nb' : base;
  return LANGUAGES.includes(code) ? code : 'en';
}

// The locale a site uses for numbers and dates: its own "locale", else its language's.
export const localeFor = (code) => LANGUAGE_INFO[code]?.locale ?? 'en-GB';

const STRINGS = {};   // code → { key: text }, filled by loadLanguage
const loading = {};   // code → promise, so each file is fetched once
// Shown if starting fails before any language file has arrived.
const FALLBACK = { 'app.startFailed': 'Could not start' };

let lang = 'sv';

const known = (code) => (LANGUAGES.includes(code) ? code : 'en');

function url(code) {
  const u = new URL(`../i18n/${code}.json`, import.meta.url);
  // The same address index.html preloads; the version keeps a cached file from outliving an update.
  const v = globalThis.PVD_VERSION;
  return v ? `${u.href}?v=${encodeURIComponent(v)}` : u.href;
}

// Fetch one language (English for a code that is not known). Resolves when t() can use it.
export function loadLanguage(code) {
  const c = known(code);
  loading[c] ??= fetch(url(c))
    .then((r) => { if (!r.ok) throw new Error(`i18n/${c}.json: ${r.status}`); return r.json(); })
    .then((strings) => { STRINGS[c] = strings; })
    .catch((e) => { delete loading[c]; throw e; });
  return loading[c];
}

// English and the current language, for code that must show text although starting
// failed (main.js showFatal). Never rejects.
export const languageReady = () => Promise.allSettled([loadLanguage('en'), loadLanguage(lang)]);

export function setLanguage(code) {
  lang = known(code);
  document.documentElement.lang = lang;
}

export const has = (key) => key in (STRINGS[lang] ?? {}) || key in (STRINGS.en ?? {});

export function t(key, vars) {
  let s = STRINGS[lang]?.[key] ?? STRINGS.en?.[key] ?? FALLBACK[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
  return s;
}
