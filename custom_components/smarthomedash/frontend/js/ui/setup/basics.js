// Setup guide, step: basics (name, language, currency).

import { t, LANGUAGES, LANGUAGE_INFO, localeFor } from '../../i18n.js';

export function basicsStep(ctx) {
  const { cfg, site, field, section, intro, exampleNote, input, select, quickStartSection } = ctx;
  function basics() {
    return [
      site.raw.setup_pending ? exampleNote(cfg.overview ? 'setup.welcome' : 'setup.welcomeApartment') : null,
      quickStartSection(),
      intro('setup.basicsIntro'),
      section(t('setup.step.basics'),
        field(t('setup.name'), input(cfg.name, (v) => { cfg.name = v; })),
        field(t('setup.language'), select(LANGUAGES.map((code) => [code, LANGUAGE_INFO[code].machine
          ? `${LANGUAGE_INFO[code].name} (${t('setup.languageMachine')})` : LANGUAGE_INFO[code].name]),
        cfg.language ?? 'sv', (v) => {
          cfg.language = v; cfg.locale = localeFor(v);
        }), t('setup.languageHelp')),
        field(t('setup.currency'), input(cfg.currency ?? 'SEK', (v) => { cfg.currency = v.toUpperCase(); }, { maxlength: 3 }))),
    ];
  }

  return basics;
}
