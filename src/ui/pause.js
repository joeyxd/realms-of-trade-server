// Pause menu with settings and controls. Writes to the shared settings object and notifies.
import { gsap } from 'gsap';
import { sfx } from '../audio/sfx.js';
import { t, createLanguagePicker, onLocaleChange } from '../core/i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const GPU_TIER = { strong: 'strong', mid: 'mid', weak: 'weak' };

export class PauseMenu {
  constructor(root, settings, { onChange, onResume, onNewGame, gpu }) {
    this.root = root;
    this.s = settings;
    this.onChange = onChange;
    this.onResume = onResume;
    this.onNewGame = onNewGame;
    this.gpu = gpu || (() => null); // { name, tier } of the graphics card, for the quality hint
    this.open = false;
    this.tab = 'settings';
    this.confirmingNew = false;
    this.languagePicker = createLanguagePicker();
    this.unsubscribeLocale = onLocaleChange(() => { if (this.open) { this.render(); } });
  }

  render() {
    const focusedId = this.root.contains(document.activeElement) ? document.activeElement.id : '';
    const focusedLocale = this.root.contains(document.activeElement) ? document.activeElement.dataset?.locale : '';
    const scrollTop = this.root.querySelector('.panel')?.scrollTop || 0;
    const s = this.s;
    const range = (id, label, val, min = 0, max = 1, step = 0.05) =>
      `<div class="row"><label for="${id}">${label}</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
    const gpu = this.gpu() || { name: '', tier: 'mid' };
    const check = (id, label, val) => `<div class="row"><label for="${id}">${label}</label><input id="${id}" type="checkbox" ${val ? 'checked' : ''}></div>`;
    const settingsHtml = `
      <div class="section">
        ${range('set-master', t('pause.volume'), s.master)}
        ${range('set-sfx', t('pause.effects'), s.sfx)}
        ${range('set-music', t('pause.music'), s.music)}
        ${range('set-amb', t('pause.ambience'), s.ambience)}
        ${check('set-muted', t('pause.mute'), s.muted)}
      </div>
      <div class="section">
        <div class="row"><label for="set-quality">${t('pause.quality')}</label><select id="set-quality">
          ${['auto', 'low', 'medium', 'high', 'ultra'].map((q) => `<option value="${q}" ${s.quality === q ? 'selected' : ''}>${t('pause.' + (q === 'auto' ? 'auto' : q))}</option>`).join('')}
        </select></div>
        <div class="row-note" id="set-gpu">${t('pause.gpu', { name: esc(gpu.name || '—'), tier: t('pause.tier.' + (GPU_TIER[gpu.tier] || 'mid')) })}</div>
        ${range('set-shake', t('pause.shake'), s.shake)}
        ${check('set-reduced', t('pause.reduceMotion'), s.reducedMotion)}
        ${check('set-rotate', t('pause.rotate'), s.camRotate)}
        ${range('set-ui', t('pause.uiSize'), s.uiScale, 0.8, 1.3, 0.05)}
        ${check('set-contrast', t('pause.contrast'), s.highContrast)}
        ${check('set-landscape', t('pause.landscape'), s.landscape !== false)}
        <div class="row"><label for="set-touchsize">${t('pause.buttonSize')}</label><select id="set-touchsize">
          ${[[0.85, t('pause.small')], [1, t('pause.medium')], [1.18, t('pause.large')]].map(([v, n]) => `<option value="${v}" ${+s.touchSize === v ? 'selected' : ''}>${n}</option>`).join('')}
        </select></div>
        ${check('set-haptics', t('pause.haptics'), s.haptics !== false)}
        ${check('set-comicfx', t('pause.comicFx'), s.comicFx !== false)}
        <div class="row"><label for="set-launch">${t('pause.launch')}</label><select id="set-launch">
          ${[['indicator', t('pause.indicator')], ['quick', t('pause.quick')]].map(([v, n]) => `<option value="${v}" ${(s.launch || 'indicator') === v ? 'selected' : ''}>${n}</option>`).join('')}
        </select></div>
      </div>`;
    const controlsHtml = `
      <div class="section controls-list">
        <span><span class="kbd">W</span> <span class="kbd">A</span> <span class="kbd">S</span> <span class="kbd">D</span></span><span>${t('controls.move')}</span>
        <span class="kbd">${t('controls.key.space')}</span><span>${t('controls.dash')}</span>
        <span class="kbd">F</span><span>${t('controls.interact')}</span>
        <span class="kbd">N</span><span>${t('ui.controls.lantern')}</span>
        <span class="kbd">${t('controls.key.wheel')}</span><span>${t('controls.zoom')}</span>
        <span><span class="kbd">Z</span> <span class="kbd">X</span></span><span>${t('controls.rotate')}</span>
        <span class="kbd">ESC</span><span>${t('controls.pause')}</span>
        <span class="kbd">F3</span><span>${t('controls.performance')}</span>
        <span><span class="kbd">LMB</span> <span class="kbd">J</span></span><span>${t('controls.sword')}</span>
        <span><span class="kbd">RMB</span> <span class="kbd">K</span></span><span>${t('controls.guard')}</span>
        <span><span class="kbd">Q</span> <span class="kbd">E</span></span><span>${t('controls.abilities')}</span>
        <span><span class="kbd">Q</span> <span class="kbd">E</span> ${t('controls.key.hold')}</span><span>${t('controls.area')}</span>
        <span class="kbd">R</span><span>${t('controls.riposte')}</span>
        <span class="kbd">${t('controls.key.mouse')}</span><span>${t('controls.aim')}</span>
        <span class="kbd">F4</span><span>${t('controls.debug')}</span>
      </div>`;
    this.root.innerHTML = `
      <div class="panel frame interactive" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <h2 id="pause-title" class="outlined">${t('pause.title')}</h2>
        <div class="tabs" role="tablist">
          <button class="tab" role="tab" data-tab="settings" aria-selected="${this.tab === 'settings'}">${t('title.settings')}</button>
          <button class="tab" role="tab" data-tab="controls" aria-selected="${this.tab === 'controls'}">${t('title.controls')}</button>
        </div>
        ${this.tab === 'settings' ? settingsHtml : controlsHtml}
        <div class="actions" id="pause-actions">
          <button class="btn" id="btn-resume">${t('pause.resume')}</button>
          <button class="btn secondary" id="btn-new">${t('pause.newGame')}</button>
        </div>
      </div>`;
    this.root.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab; sfx.click(); this.render(); }));
    const panel = this.root.querySelector('.panel');
    panel.insertBefore(this.languagePicker, panel.querySelector('.tabs'));
    this.root.querySelector('#btn-resume').addEventListener('click', () => { sfx.click(); this.onResume(); });
    this.root.querySelector('#btn-new').addEventListener('click', () => this.confirmNew());
    const bind = (id, key, fn = (el) => +el.value) => {
      const el = this.root.querySelector('#' + id);
      if (!el) return;
      el.addEventListener('input', () => { s[key] = fn(el); this.onChange(key); });
      el.addEventListener('change', () => { s[key] = fn(el); this.onChange(key); });
    };
    bind('set-master', 'master'); bind('set-sfx', 'sfx'); bind('set-music', 'music'); bind('set-amb', 'ambience');
    bind('set-muted', 'muted', (el) => el.checked);
    bind('set-quality', 'quality', (el) => el.value);
    bind('set-shake', 'shake');
    bind('set-reduced', 'reducedMotion', (el) => el.checked);
    bind('set-rotate', 'camRotate', (el) => el.checked);
    bind('set-ui', 'uiScale');
    bind('set-contrast', 'highContrast', (el) => el.checked);
    bind('set-launch', 'launch', (el) => el.value);
    bind('set-landscape', 'landscape', (el) => el.checked);
    bind('set-touchsize', 'touchSize');
    bind('set-haptics', 'haptics', (el) => el.checked);
    bind('set-comicfx', 'comicFx', (el) => el.checked);
    if (this.confirmingNew) this.renderNewConfirmation();
    panel.scrollTop = scrollTop;
    if (focusedLocale) this.languagePicker.querySelector(`[data-locale="${focusedLocale}"]`)?.focus({ preventScroll: true });
    else if (focusedId) this.root.querySelector('#' + focusedId)?.focus({ preventScroll: true });
  }

  confirmNew() {
    sfx.click();
    this.confirmingNew = true;
    this.renderNewConfirmation();
  }

  renderNewConfirmation() {
    const box = this.root.querySelector('#pause-actions');
    box.innerHTML = `<div class="confirm"><span>${t('pause.confirmDelete')}</span>
      <div class="actions"><button class="btn" id="btn-new-yes">${t('pause.deleteStart')}</button><button class="btn secondary" id="btn-new-no">${t('pause.cancel')}</button></div></div>`;
    box.querySelector('#btn-new-yes').addEventListener('click', () => { sfx.click(); this.onNewGame(); });
    box.querySelector('#btn-new-no').addEventListener('click', () => { sfx.click(); this.confirmingNew = false; this.render(); this.root.querySelector('#btn-new')?.focus({ preventScroll: true }); });
  }

  show(tab = 'settings') {
    this.tab = tab;
    this.confirmingNew = false;
    this.render();
    this.root.hidden = false;
    this.open = true;
    gsap.fromTo(this.root.querySelector('.panel'), { scale: 0.85, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)' });
    const first = this.root.querySelector('#btn-resume');
    if (first) first.focus({ preventScroll: true });
  }

  hide() {
    this.open = false;
    this.root.hidden = true;
  }
}
