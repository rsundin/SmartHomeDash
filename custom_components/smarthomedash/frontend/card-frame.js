// Inside a SmartHomeDash card's frame (card.html). The card element lives in Home
// Assistant's own document, where the dashboard's page-wide CSS, fonts and listeners
// must not go; this frame gives the dashboard a document of its own, as the sidebar
// panel has. The card hands over `hass` and its config through window.shdCard.

const BASE = new URL('.', import.meta.url).href;
const VERSION = new URLSearchParams(location.search).get('v') || '';
const API = '/api/smarthomedash/sites';

window.SHD_PANEL = true; // main.js must not start the standalone page by itself
window.SHD_VERSION = VERSION;

let hass = null;
let config = null;
let adapter = null;
let started = ''; // the site and view the dashboard was started with

function addHead() {
  if (document.getElementById('shd-css')) return;
  const css = document.createElement('link');
  css.id = 'shd-css';
  css.rel = 'stylesheet';
  css.href = `${BASE}css/style.css${VERSION ? `?v=${encodeURIComponent(VERSION)}` : ''}`;
  document.head.append(css);
}

async function boot() {
  addHead();
  const [{ start, showFatal }, { createHassAdapter }, { setLanguage }] = await Promise.all([
    import(`${BASE}js/main.js`),
    import(`${BASE}js/adapters/hass.js`),
    import(`${BASE}js/i18n.js`),
  ]);
  // Until site.json says which language the dashboard uses: the user's own, for errors.
  setLanguage(String(hass.language || '').toLowerCase().startsWith('sv') ? 'sv' : 'en');
  const siteId = config.site;
  const root = document.getElementById('app');
  adapter = createHassAdapter(hass);
  try {
    await start({
      root,
      siteId,
      adapter,
      embed: { view: config.view || 'overview' },
      // Site files come through Home Assistant's login, like in the panel. Read-only:
      // the setup guide and placement mode stay in the panel.
      loader: { get: (path) => hass.fetchWithAuth(`${API}/${siteId}/${path}`) },
      reload: () => boot(),
    });
  } catch (e) {
    showFatal(root, e);
  }
}

window.shdCard = {
  // Called by the card on every new `hass` object and when its config changes.
  update(nextHass, nextConfig) {
    hass = nextHass;
    config = nextConfig;
    if (!hass || !config?.site) return;
    const key = JSON.stringify([config.site, config.view || 'overview']);
    if (key !== started) {
      started = key;
      adapter = null;
      boot();
    } else {
      adapter?.setHass(hass);
    }
  },
};

// Tell the card the frame can take `hass` now.
window.frameElement?.dispatchEvent(new CustomEvent('shd-card-ready'));
