// Pause menu with settings and controls. Writes to the shared settings object and notifies.
import { gsap } from 'gsap';
import { sfx } from '../audio/sfx.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const GPU_TIER = { strong: 'potente', mid: 'media', weak: 'básica' };

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
  }

  render() {
    const s = this.s;
    const range = (id, label, val, min = 0, max = 1, step = 0.05) =>
      `<div class="row"><label for="${id}">${label}</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
    const gpu = this.gpu() || { name: '', tier: 'mid' };
    const check = (id, label, val) => `<div class="row"><label for="${id}">${label}</label><input id="${id}" type="checkbox" ${val ? 'checked' : ''}></div>`;
    const settingsHtml = `
      <div class="section">
        ${range('set-master', 'Volumen general', s.master)}
        ${range('set-sfx', 'Efectos', s.sfx)}
        ${range('set-music', 'Música', s.music)}
        ${range('set-amb', 'Ambiente', s.ambience)}
        ${check('set-muted', 'Silenciar todo', s.muted)}
      </div>
      <div class="section">
        <div class="row"><label for="set-quality">Calidad gráfica</label><select id="set-quality">
          ${['auto', 'low', 'medium', 'high', 'ultra'].map((q) => `<option value="${q}" ${s.quality === q ? 'selected' : ''}>${{ auto: 'Automática', low: 'Baja', medium: 'Media', high: 'Alta', ultra: 'Ultra · cómic dramático' }[q]}</option>`).join('')}
        </select></div>
        <div class="row-note" id="set-gpu">GPU: ${esc(gpu.name || '—')} · ${GPU_TIER[gpu.tier] || GPU_TIER.mid}</div>
        <div class="row"><label for="set-tod">Hora del día</label><select id="set-tod">
          ${['cycle', 'day', 'dusk', 'night'].map((q) => `<option value="${q}" ${s.timeOfDay === q ? 'selected' : ''}>${{ cycle: 'Ciclo día y noche', day: 'Día', dusk: 'Atardecer', night: 'Noche' }[q]}</option>`).join('')}
        </select></div>
        ${range('set-shake', 'Sacudida de cámara', s.shake)}
        ${check('set-reduced', 'Reducir movimiento', s.reducedMotion)}
        ${check('set-rotate', 'Rotar cámara con Z / X', s.camRotate)}
        ${range('set-ui', 'Tamaño de la interfaz', s.uiScale, 0.8, 1.3, 0.05)}
        ${check('set-contrast', 'Alto contraste (proyectiles con patrón)', s.highContrast)}
        ${check('set-landscape', 'Forzar horizontal (móvil)', s.landscape !== false)}
        <div class="row"><label for="set-touchsize">Tamaño de los botones</label><select id="set-touchsize">
          ${[[0.85, 'Pequeño'], [1, 'Mediano'], [1.18, 'Grande']].map(([v, n]) => `<option value="${v}" ${+s.touchSize === v ? 'selected' : ''}>${n}</option>`).join('')}
        </select></div>
        ${check('set-haptics', 'Vibración (móvil)', s.haptics !== false)}
        ${check('set-comicfx', 'Efectos de cómic (impactos, onomatopeyas)', s.comicFx !== false)}
      </div>`;
    const controlsHtml = `
      <div class="section controls-list">
        <span><span class="kbd">W</span> <span class="kbd">A</span> <span class="kbd">S</span> <span class="kbd">D</span></span><span>Moverte (o flechas)</span>
        <span class="kbd">ESPACIO</span><span>Dash: invulnerable 0,22 s. Una carga en Nv 1, dos desde Nv 2</span>
        <span class="kbd">F</span><span>Hablar / interactuar. Junto a un armero: cambiar de arma (sable ↔ pistolas)</span>
        <span class="kbd">Rueda</span><span>Zoom (3 niveles)</span>
        <span><span class="kbd">Z</span> <span class="kbd">X</span></span><span>Rotar cámara 90° (actívalo en Ajustes)</span>
        <span class="kbd">ESC</span><span>Pausa</span>
        <span class="kbd">F3</span><span>Rendimiento</span>
        <span><span class="kbd">LMB</span> <span class="kbd">J</span></span><span>Sable: combo de 3. Golpea la bala justo antes del impacto para reflejarla (EXCELENTE / BUENO / POBRE). Pistolas: mantén para disparar</span>
        <span><span class="kbd">RMB</span> <span class="kbd">K</span></span><span>Guardia (mantener): bloquea de frente y gasta aguante. Súbela justo a tiempo para ATRAPAR la bala; tu siguiente ataque la devuelve</span>
        <span><span class="kbd">Q</span> <span class="kbd">E</span></span><span>Habilidades del arma, al cursor. Sable: Estocada y Hoja de viento. Pistolas: Descarga y Paso de humo</span>
        <span class="kbd">R</span><span>Con el RIPOSTE lleno. Sable: Tormenta (refleja todo cerca). Pistolas: Lluvia de plomo en el cursor</span>
        <span class="kbd">Ratón</span><span>Apuntar: miras al cursor (o con el stick derecho del mando)</span>
        <span class="kbd">F4</span><span>Panel de pruebas: ajustes de combate, enemigos, arma, hitboxes</span>
      </div>`;
    this.root.innerHTML = `
      <div class="panel frame interactive" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <h2 id="pause-title" class="outlined">Pausa</h2>
        <div class="tabs" role="tablist">
          <button class="tab" role="tab" data-tab="settings" aria-selected="${this.tab === 'settings'}">Ajustes</button>
          <button class="tab" role="tab" data-tab="controls" aria-selected="${this.tab === 'controls'}">Controles</button>
        </div>
        ${this.tab === 'settings' ? settingsHtml : controlsHtml}
        <div class="actions" id="pause-actions">
          <button class="btn" id="btn-resume">Reanudar</button>
          <button class="btn secondary" id="btn-new">Nueva partida</button>
        </div>
      </div>`;
    this.root.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab; sfx.click(); this.render(); }));
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
    bind('set-tod', 'timeOfDay', (el) => el.value);
    bind('set-shake', 'shake');
    bind('set-reduced', 'reducedMotion', (el) => el.checked);
    bind('set-rotate', 'camRotate', (el) => el.checked);
    bind('set-ui', 'uiScale');
    bind('set-contrast', 'highContrast', (el) => el.checked);
    bind('set-landscape', 'landscape', (el) => el.checked);
    bind('set-touchsize', 'touchSize');
    bind('set-haptics', 'haptics', (el) => el.checked);
    bind('set-comicfx', 'comicFx', (el) => el.checked);
  }

  confirmNew() {
    sfx.click();
    const box = this.root.querySelector('#pause-actions');
    box.innerHTML = `<div class="confirm"><span>Se borrarán tus ajustes y tu progreso guardado en este navegador.</span>
      <div class="actions"><button class="btn" id="btn-new-yes">Borrar y empezar</button><button class="btn secondary" id="btn-new-no">Cancelar</button></div></div>`;
    box.querySelector('#btn-new-yes').addEventListener('click', () => { sfx.click(); this.onNewGame(); });
    box.querySelector('#btn-new-no').addEventListener('click', () => { sfx.click(); this.render(); });
  }

  show(tab = 'settings') {
    this.tab = tab;
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
