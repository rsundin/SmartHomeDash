// Lamp colours. A light that reports its colour (rgb_color, which Home Assistant also
// fills in for white lights with a colour temperature) glows in that colour; one that
// does not keeps the theme's warm glow. Brightness is handled by the views through
// opacity, so a dim lamp glows faintly in its colour.
//
// SVG gradients take their colours from where they are defined, not from the shape
// that uses them, so every colour in use gets its own small set of gradients.
// Colours are rounded so a dimmer or a colour wheel does not create hundreds.

import { isOn } from './entities.js';

const STEP = 24;
const WARM = [255, 178, 74]; // matches --glow, for lamps without a colour of their own

// The colour a lit light shows, or null when it is off or reports none.
// A white light set by colour temperature glows in that temperature; a coloured one
// in its rgb colour.
export function lightColor(s) {
  if (!isOn(s)) return null;
  const a = s.attributes ?? {};
  const kelvin = Number(a.color_temp_kelvin) || (Number(a.color_temp) ? 1e6 / Number(a.color_temp) : null);
  const c = a.rgb_color;
  const rgb = Array.isArray(c) && c.length === 3 && c.every(Number.isFinite) ? c : null;
  if (kelvin && (a.color_mode === 'color_temp' || !rgb)) return kelvinToRgb(kelvin);
  return rgb;
}

// Colour of white light at a temperature in kelvin (Tanner Helland's fit of the
// black-body curve), good from 1000 to 40000 K.
export function kelvinToRgb(kelvin) {
  const t = Math.min(400, Math.max(10, kelvin / 100));
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))));
}

// One colour for several lights switched together: the average of the lit ones.
// null when none of them reports a colour (the theme's glow is used).
export function mixColor(states) {
  const lit = states.filter(isOn);
  if (!lit.some((s) => lightColor(s))) return null;
  const all = lit.map((s) => lightColor(s) ?? WARM);
  return [0, 1, 2].map((i) => Math.round(all.reduce((sum, c) => sum + c[i], 0) / all.length));
}

const round = (c) => c.map((v) => Math.min(255, Math.round(v / STEP) * STEP));
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
// The bright centre of a glow: the colour mixed well towards white.
const core = (c) => c.map((v) => Math.round(v + (255 - v) * 0.65));

// Returns tint(rgb) → { suffix, glow, core }: append suffix to a gradient id to get the
// gradients in that colour, created on first use by make(suffix, glowHex, coreHex).
// tint(null) gives the theme's own gradients (suffix '').
export function createTints(make) {
  const made = new Set();
  return (rgb) => {
    if (!rgb) return { suffix: '', glow: null, core: null };
    const c = round(rgb);
    const suffix = '-' + hex(c).slice(1);
    const g = hex(c), k = hex(core(c));
    if (!made.has(suffix)) { make(suffix, g, k); made.add(suffix); }
    return { suffix, glow: g, core: k };
  };
}
