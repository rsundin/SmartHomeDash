// Setup guide: everything a new site needs, without editing site.json by hand.
//
//   Basics      name, language, currency
//   Overview    day and evening picture, buildings, solar panels, windows
//   Floor plans a picture per floor plan, rooms drawn on it
//   Energy      power, energy, price and weather entities
//   Buttons     scenes and scripts shown as buttons
//   Wall screen doorbell camera, idle mode, light mode
//   Lights      hands over to placement mode
//   Backup      export and import as .zip, restore points (ui/backup.js; panel only)
//
// Works on a copy of the config; "Save" writes it to Home Assistant and restarts
// the dashboard, "Close" throws the changes away. Pictures are uploaded at once.
// Undo and Redo (also Ctrl/Cmd+Z, Shift+Z) step through the changes until saved.
//
// This file holds the guide's frame: the dialog, the step list, undo and redo, save and
// close. Each step is a module beside it that gets one shared context object (see `ctx`
// below); helpers.js, draw.js and quick.js add what several steps use.

import { el, createHistory, undoKey } from '../../util.js';
import { t } from '../../i18n.js';
import { noteProblem } from '../report.js';
import { backupStep } from '../backup.js';
import { noAreas } from '../../areas.js';
import { createHelpers } from './helpers.js';
import { createDrawing } from './draw.js';
import { createQuickStart } from './quick.js';
import { basicsStep } from './basics.js';
import { overviewStep } from './overview.js';
import { plansStep } from './plans.js';
import { energyStep } from './energy.js';
import { buttonsStep } from './buttons.js';
import { wallStep } from './wall.js';
import { lightsStep } from './lights.js';

const STEPS = ['basics', 'overview', 'plans', 'energy', 'buttons', 'wall', 'lights', 'backup'];

export function createSetup({ site, store, saveSite, uploadFile, reload, openPlacement, openReport = null, backup = null, onClose = () => {} }) {
  const cfg = structuredClone(site.raw);
  cfg.floorplans ??= [];
  cfg.energy ??= {};
  cfg.scenes ??= [];
  const previews = new Map(); // path -> object URL for pictures uploaded in this session
  const picture = (path) => previews.get(path) ?? site.asset(path);
  const areas = site.areas ?? noAreas();
  let step = STEPS[0];
  let dirty = false;

  const nav = el('nav', { class: 'setup-nav', 'aria-label': t('setup.title') });
  const body = el('div', { class: 'setup-body' });
  const status = el('p', { class: 'small setup-status', role: 'status' });
  const saveBtn = el('button', { class: 'chip chip-primary', type: 'button', onclick: save }, t('setup.save'));
  const undoBtn = el('button', { class: 'chip setup-undo', type: 'button', disabled: true, onclick: () => undo() }, t('history.undo'));
  const redoBtn = el('button', { class: 'chip setup-redo', type: 'button', disabled: true, onclick: () => redo() }, t('history.redo'));
  const root = el('div', { class: 'setup', role: 'dialog', 'aria-label': t('setup.title') },
    el('header', { class: 'setup-head' },
      el('div', {}, el('p', { class: 'eyebrow' }, t('setup.eyebrow')), el('h2', { class: 'panel-title' }, t('setup.title'))),
      el('div', { class: 'row' }, status, undoBtn, redoBtn, saveBtn,
        el('button', { class: 'chip', type: 'button', onclick: close }, t('setup.close')))),
    el('div', { class: 'setup-main' }, nav, body));

  // ---------- undo and redo
  // A snapshot of the config is taken after each change. Typing in one field is one
  // step, not one per letter: `key` names the field, and the same key in a row merges.
  const history = createHistory({ limit: 50 });
  let last = JSON.stringify(cfg);
  const saved = last;
  let lastKey = null;
  function commit(key = null) {
    const now = JSON.stringify(cfg);
    if (now === last) return;
    if (!key || key !== lastKey) history.push(last);
    else history.redo = [];
    last = now;
    lastKey = key;
    showHistory();
  }
  function showHistory() {
    undoBtn.disabled = !history.undo.length;
    redoBtn.disabled = !history.redo.length;
    dirty = last !== saved;
  }
  function restore(json, message) {
    for (const k of Object.keys(cfg)) delete cfg[k];
    Object.assign(cfg, JSON.parse(json));
    last = json;
    lastKey = null;
    showHistory();
    render();
    status.textContent = message;
  }
  function undo() { const s = history.back(JSON.stringify(cfg)); if (s) restore(s, t('history.undone')); }
  function redo() { const s = history.forward(JSON.stringify(cfg)); if (s) restore(s, t('history.redone')); }
  const onKey = (e) => {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (root.querySelector('.draw')) return; // drawing and shape editing have their own
    const u = undoKey(e);
    if (!u) return;
    e.preventDefault();
    if (u === 'undo') undo(); else redo();
  };
  document.addEventListener('keydown', onKey);

  // Changes are recorded once the handler that made them has finished.
  const changed = (key = null) => {
    dirty = true;
    status.textContent = t('setup.unsaved');
    queueMicrotask(() => commit(key));
  };

  async function save() {
    delete cfg.setup_pending;
    saveBtn.disabled = true;
    status.textContent = t('editor.saving');
    try {
      await saveSite(cfg);
      dirty = false;
      status.textContent = t('editor.saved');
      setTimeout(reload, 500);
    } catch (e) {
      noteProblem(e.message);
      status.textContent = t('editor.saveFailed', { msg: e.message });
      saveBtn.disabled = false;
    }
  }
  // With unsaved changes, Close asks what to do with clear buttons instead of closing.
  function close() {
    if (!dirty) { root.remove(); document.removeEventListener('keydown', onKey); onClose(); return; }
    status.replaceChildren(
      el('span', {}, t('setup.closeConfirm')), ' ',
      el('button', { class: 'chip chip-danger', type: 'button', onclick: () => { root.remove(); document.removeEventListener('keydown', onKey); onClose(); } }, t('setup.discard')), ' ',
      el('button', { class: 'chip chip-primary', type: 'button', onclick: save }, t('setup.save')));
  }

  function render() {
    // Without an overview picture (an apartment) that step is optional and comes after the plans.
    const steps = (cfg.overview ? STEPS : ['basics', 'plans', 'overview', 'energy', 'buttons', 'wall', 'lights', 'backup'])
      .filter((s) => s !== 'backup' || backup);
    nav.replaceChildren(...steps.map((s, i) => el('button', {
      type: 'button', class: `setup-step${s === step ? ' is-active' : ''}`, 'aria-current': String(s === step),
      onclick: () => { step = s; render(); },
    }, el('span', { class: 'setup-num' }, String(i + 1)), t(s === 'overview' && !cfg.overview ? 'setup.step.overviewOptional' : `setup.step.${s}`))),
    openReport ? el('button', { class: 'chip setup-report', type: 'button', onclick: openReport }, t('report.button')) : null);
    body.replaceChildren(...views[step]());
    body.scrollTop = 0;
  }

  // ---------- what the steps share
  // One context object for every module under ui/setup/. `step` and `dirty` are read and
  // set through it, so a step can move the guide on or mark the config as saved.
  const ctx = {
    cfg, site, store, areas, status, changed, render, picture, previews, root,
    saveSite, uploadFile, reload, openPlacement, backup,
    get step() { return step; },
    set step(s) { step = s; },
    get dirty() { return dirty; },
    set dirty(v) { dirty = v; },
  };
  Object.assign(ctx, createHelpers(ctx));
  Object.assign(ctx, createDrawing(ctx));
  Object.assign(ctx, createQuickStart(ctx));
  const views = {
    basics: basicsStep(ctx),
    overview: overviewStep(ctx),
    plans: plansStep(ctx),
    energy: energyStep(ctx),
    buttons: buttonsStep(ctx),
    wall: wallStep(ctx),
    lights: lightsStep(ctx),
    // export, import, restore points (ui/backup.js; panel only)
    backup: () => backupStep({ backup, locale: site.locale, status, reload, unsaved: () => dirty }),
  };

  render();
  return { el: root };
}
