// Animated title screen: letters drop in with a bounce over the already-rendered island.
// JUGAR is enabled only after the renderer has compiled every shader. Your name and look are picked here;
// the mode pill says whether you sail online (the Node server: how many pirates are aboard) or solo.
import { gsap } from 'gsap';
import { GAME } from '../data/meta.js';
import { SKINS } from '../render/characters.js';
import { sfx } from '../audio/sfx.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class TitleScreen {
  constructor(root, settings, { onPlay, onSettings, onControls, onMode }) {
    this.root = root;
    this.settings = settings;
    const words = GAME.title.split(' ');
    root.innerHTML = `
      <div class="title-card">
        <div class="title-head">
          <h1 class="title-logo" aria-label="${GAME.title}">
            ${words.map((w, i) => `<span class="word ${i === words.length - 1 ? 'black' : ''}">${[...w].map((c) => `<span class="ch">${c}</span>`).join('')}</span>`).join('')}
          </h1>
          <div class="title-sub outlined">${GAME.subtitle}</div>
          <div class="rope" aria-hidden="true"></div>
        </div>
        <div aria-hidden="true"></div>
        <div class="title-actions">
          <div class="title-net" hidden><span class="net-pill"><i></i><span class="txt"></span></span><button id="btn-mode" class="link-btn interactive" hidden></button></div>
          <button id="btn-play" class="btn interactive" disabled><span class="loading">PREPARANDO LA ISLA…</span></button>
          <div class="title-who">
          <label class="name-field frame-dark interactive"><span class="label outlined">Nombre</span><input id="title-name" maxlength="16" autocomplete="off" spellcheck="false" enterkeyhint="go"></label>
          <div class="skin-picker frame-dark interactive" role="group" aria-label="Aspecto">
            <span class="label outlined">Aspecto</span>
            ${SKINS.slice(0, 5).map((s, i) => `<button class="skin-dot" data-skin="${i}" aria-label="${s.name}" aria-pressed="false" style="background:linear-gradient(180deg, ${hex(s.swatch[0])} 55%, ${hex(s.swatch[1])} 55%)"></button>`).join('')}
            <span class="skin-name"></span>
          </div>
          </div>
          <div class="title-row">
            <button id="btn-settings" class="btn secondary interactive">Ajustes</button>
            <button id="btn-controls" class="btn secondary interactive">Controles</button>
          </div>
          <div class="title-hint">${document.body.classList.contains('touch') ? 'Joystick a la izquierda para moverte · DASH para esquivar' : 'WASD para moverte · ESPACIO para hacer dash · rueda para zoom'}</div>
        </div>
      </div>
      <div class="title-foot"><span>${GAME.slice}</span><span>v${GAME.version}</span></div>`;
    this.play = root.querySelector('#btn-play');
    this.play.addEventListener('click', () => { if (!this.play.disabled) { sfx.click(); onPlay(); } });
    root.querySelector('#btn-settings').addEventListener('click', () => { sfx.click(); onSettings(); });
    root.querySelector('#btn-controls').addEventListener('click', () => { sfx.click(); onControls(); });
    this.net = root.querySelector('.title-net');
    this.pill = this.net.querySelector('.net-pill');
    this.modeBtn = root.querySelector('#btn-mode');
    this.modeBtn.addEventListener('click', () => { sfx.click(); if (onMode) onMode(this.modeBtn.dataset.to); });
    this.msg = null;
    // Name: what other pirates see over your head (the server keeps it printable and unique).
    this.name = root.querySelector('#title-name');
    this.name.value = settings.name || '';
    this.name.addEventListener('input', () => { settings.name = this.name.value.slice(0, 16); if (this.onName) this.onName(); });
    this.name.addEventListener('change', () => { if (!this.name.value.trim()) { this.name.value = settings.name = 'Grumete'; if (this.onName) this.onName(); } });
    this.name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { this.name.blur(); if (!this.play.disabled) this.play.click(); } });
    this.skinName = root.querySelector('.skin-name');
    root.querySelectorAll('.skin-dot').forEach((b) => {
      b.addEventListener('click', () => { this.selectSkin(+b.dataset.skin); sfx.hover(); });
    });
    root.querySelectorAll('button').forEach((b) => b.addEventListener('pointerenter', () => sfx.hover()));
    this.selectSkin(settings.skin || 0);
  }

  // Replace the color swatches with portraits of the real models. render(i) → canvas.
  setPortraits(render) {
    this.root.querySelectorAll('.skin-dot').forEach((b) => {
      const c = render(+b.dataset.skin);
      if (!c) return;
      b.style.background = `url(${c.toDataURL()}) center / cover, radial-gradient(circle at 40% 35%, #3d6f86, #122838)`;
      b.classList.add('has-portrait');
    });
  }

  selectSkin(i) {
    this.settings.skin = i;
    this.root.querySelectorAll('.skin-dot').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.skin === i)));
    this.skinName.textContent = SKINS[i].name;
    if (this.onSkin) this.onSkin(i);
  }

  // Mode pill. online: {players, max} from the server; solo: {server} when a game server could be joined.
  setNet({ mode, players = 0, max = 4, server = null, full = false }) {
    this.net.hidden = false;
    const on = mode === 'online';
    this.pill.classList.toggle('online', on);
    this.pill.classList.toggle('full', on && (full || players >= max));
    this.pill.querySelector('.txt').textContent = on
      ? `EN LÍNEA · ${players}/${max} ${players === 1 ? 'pirata' : 'piratas'} a bordo`
      : 'SOLO · tu propia isla';
    this.modeBtn.hidden = !on && !server;
    this.modeBtn.dataset.to = on ? 'solo' : 'online';
    this.modeBtn.textContent = on ? 'Jugar solo' : `Jugar en línea · ${server ? server.players + '/' + server.max : ''}`;
  }

  // A line under JUGAR (the instance is full, the server is gone…); null clears it.
  message(html) {
    if (!this.msg) { this.msg = document.createElement('div'); this.msg.className = 'title-msg'; this.play.after(this.msg); }
    this.msg.hidden = !html;
    this.msg.innerHTML = html || '';
  }

  // While the server answers the hello.
  boarding(on) {
    this.play.disabled = on;
    this.play.textContent = on ? 'SUBIENDO A BORDO…' : 'JUGAR';
    if (on && this.pulse) this.pulse.pause(); else if (this.pulse) this.pulse.resume();
  }

  show(reduced) {
    this.root.hidden = false;
    const chars = this.root.querySelectorAll('.ch');
    const tl = (this.tl = gsap.timeline());
    if (reduced) {
      tl.from(this.root.querySelector('.title-card'), { opacity: 0, duration: 0.5 });
      return;
    }
    tl.from(chars, {
      y: () => -260 - Math.random() * 120, rotation: () => (Math.random() - 0.5) * 50, opacity: 0,
      duration: 0.9, ease: 'bounce.out', stagger: 0.055,
    });
    tl.to(chars, { scaleY: 0.82, scaleX: 1.12, duration: 0.08, stagger: 0.055, yoyo: true, repeat: 1, ease: 'power1.inOut' }, 0.62);
    tl.from(['.title-sub', '.rope'].map((s) => this.root.querySelector(s)), { opacity: 0, y: 14, duration: 0.45, stagger: 0.1, ease: 'back.out(2)' }, '-=0.3');
    // JUGAR has its own ready/pulse tween; sharing its transform leaves the entry offset cached by the pulse.
    tl.from(this.root.querySelectorAll('.title-actions > :not(#btn-play)'), { opacity: 0, y: 20, scale: 0.92, duration: 0.45, stagger: 0.08, ease: 'back.out(2.2)' }, '-=0.2');
    tl.from(this.root.querySelector('.title-foot'), { opacity: 0, duration: 0.4 }, '-=0.2');
  }

  ready() {
    this.play.disabled = false;
    this.play.textContent = 'JUGAR';
    gsap.fromTo(this.play, { scale: 0.85 }, { scale: 1, duration: 0.55, ease: 'elastic.out(1, 0.45)' });
    this.pulse = gsap.to(this.play, { scale: 1.05, duration: 0.8, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 0.6 });
    this.play.focus({ preventScroll: true });
  }

  hide() {
    if (this.pulse) this.pulse.kill();
    if (this.tl) this.tl.progress(1).kill();
    return new Promise((resolve) => {
      gsap.to(this.root.querySelector('.title-card'), { opacity: 0, y: -30, scale: 0.96, duration: 0.45, ease: 'power2.in' });
      gsap.to(this.root.querySelector('.title-foot'), { opacity: 0, duration: 0.3 });
      gsap.to(this.root, { opacity: 0, duration: 0.5, delay: 0.15, onComplete: () => { this.root.hidden = true; resolve(); } });
    });
  }
}
