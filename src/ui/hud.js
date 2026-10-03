// MMO HUD: portrait + bars (HP with a damage trail, RIPOSTE meter, XP), action bar (attack, parry with its
// whiff lock, dash charges with radial recharge, riposte fill), chain counter, zone banner, objective
// tracker, toasts and the "fallen" screen. Plain DOM over the canvas; GSAP for the choreography.
import { gsap } from 'gsap';
import { SKINS } from '../render/characters.js';
import { WEAPONS, SKILLS } from '../data/weapons.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ICONS = {
  sword: '<svg viewBox="0 0 32 32"><path d="M24 3l5 0 0 5-13 13-3-2-2-3z" fill="#e3ebf5" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/><path d="M8 18l6 6-2 2-2-1-3 3-3-3 3-3-1-2z" fill="#ffc23d" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/></svg>',
  shield: '<svg viewBox="0 0 32 32"><path d="M16 3l11 4v8c0 7-5 12-11 14C10 27 5 22 5 15V7z" fill="#3bf0ff" stroke="#1a1033" stroke-width="2.2" stroke-linejoin="round"/><path d="M16 8v16M10 14h12" stroke="#1a1033" stroke-width="2" stroke-linecap="round"/></svg>',
  dash: '<svg viewBox="0 0 32 32"><path d="M6 10h11M3 16h14M6 22h11" stroke="#fff6e2" stroke-width="3" stroke-linecap="round"/><path d="M18 7l10 9-10 9z" fill="#3bf0ff" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/></svg>',
  spin: '<svg viewBox="0 0 32 32"><path d="M16 5a11 11 0 1 1-10 6" fill="none" stroke="#ffc23d" stroke-width="3.5" stroke-linecap="round"/><path d="M3 6l4 6 6-3z" fill="#ffc23d" stroke="#1a1033" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  wave: '<svg viewBox="0 0 32 32"><path d="M3 20c4-6 8-6 12 0s8 6 14 0M3 13c4-6 8-6 12 0s8 6 14 0" fill="none" stroke="#36c9ff" stroke-width="3" stroke-linecap="round"/></svg>',
  storm: '<svg viewBox="0 0 32 32"><path d="M18 3L7 18h8l-2 11 12-16h-8z" fill="#ffe14d" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/></svg>',
  pistol: '<svg viewBox="0 0 32 32"><path d="M3 9h21l3 2v3H13l-1 2h-2l-1 9H4l2-10-3-3z" fill="#c9a44c" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/><path d="M5 25l2-9" stroke="#6a3d22" stroke-width="3" stroke-linecap="round"/><path d="M27 9l3-2" stroke="#ffc23d" stroke-width="2.4" stroke-linecap="round"/></svg>',
  lunge: '<svg viewBox="0 0 32 32"><path d="M4 28L24 8l4-4-1 5-20 21z" fill="#e3ebf5" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/><path d="M14 4l-6 2M20 2l-4 5" stroke="#ffc23d" stroke-width="2.4" stroke-linecap="round"/></svg>',
  crescent: '<svg viewBox="0 0 32 32"><path d="M6 24C10 12 20 6 28 6c-6 4-10 10-11 18-3-2-7-2-11 0z" fill="#9ff6ff" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/><path d="M3 20h6M5 15h5" stroke="#3bf0ff" stroke-width="2.2" stroke-linecap="round"/></svg>',
  blast: '<svg viewBox="0 0 32 32"><path d="M4 16l10-3v6z" fill="#c9a44c" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/><path d="M16 16l12-9M16 16h13M16 16l12 9M16 16l11-4M16 16l11 4" stroke="#ffc23d" stroke-width="2.2" stroke-linecap="round"/></svg>',
  blink: '<svg viewBox="0 0 32 32"><circle cx="10" cy="19" r="6" fill="#b8bcc8" stroke="#1a1033" stroke-width="2"/><circle cx="16" cy="14" r="5" fill="#d8dce6" stroke="#1a1033" stroke-width="2"/><path d="M19 22h10M24 17l5 5-5 5" fill="none" stroke="#3bf0ff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  rain: '<svg viewBox="0 0 32 32"><ellipse cx="16" cy="26" rx="12" ry="4" fill="none" stroke="#3bf0ff" stroke-width="2.4"/><path d="M8 4v8M14 2v10M20 5v8M26 3v8M11 14v5M18 15v6M24 14v5" stroke="#ffc23d" stroke-width="2.4" stroke-linecap="round"/></svg>',
  potion: '<svg viewBox="0 0 32 32"><path d="M12 4h8v3l-1 1v4c4 1.5 7 5 7 9.5C26 26 21.5 29 16 29S6 26 6 21.5C6 17 9 13.5 13 12V8l-1-1z" fill="#cfeee8" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/><path d="M8.5 20c2 1.5 4.5 2 7.5 2s5.5-.5 7.5-2c.3 4.5-3.5 6.5-7.5 6.5S8.2 24.5 8.5 20z" fill="#e2482c"/><rect x="11.5" y="2.5" width="9" height="3.5" rx="1" fill="#8a5a2e" stroke="#1a1033" stroke-width="1.6"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2" fill="#c9a44c" stroke="#1a1033" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="#1a1033" stroke-width="2.4"/><circle cx="12" cy="15.5" r="1.8" fill="#1a1033"/></svg>',
  coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#ffcf4a" stroke="#1a1033" stroke-width="2"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="#c8962a" stroke-width="1.8"/><path d="M12 8.5v7" stroke="#c8962a" stroke-width="1.8" stroke-linecap="round"/></svg>',
  bag: '<svg viewBox="0 0 24 24"><path d="M7 8c0-3 2.2-5 5-5s5 2 5 5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 8h16l-1.5 12.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5z" fill="currentColor"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" fill="currentColor"/><path d="M9 4v14M15 6v14" stroke="#1a1033" stroke-width="1.4" opacity="0.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.4 5.1l1.6 1.2-2 3.5-1.9-.7a7.6 7.6 0 0 1-1.8 1l-.3 2h-4l-.3-2a7.6 7.6 0 0 1-1.8-1l-1.9.7-2-3.5 1.6-1.2a7.7 7.7 0 0 1 0-2.1L2 10.3l2-3.5 1.9.7a7.6 7.6 0 0 1 1.8-1L8 4.5h4l.3 2a7.6 7.6 0 0 1 1.8 1l1.9-.7 2 3.5-1.6 1.2a7.7 7.7 0 0 1 0 2.1z" fill="currentColor"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

// Portrait: the real 3D model rendered by PortraitStudio when available, else a flat silhouette.
export function drawPortrait(canvas, skinIdx, image) {
  const S = SKINS[skinIdx] || SKINS[0];
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w * 0.4, h * 0.35, 4, w / 2, h / 2, w * 0.7);
  g.addColorStop(0, '#3d6f86'); g.addColorStop(1, '#122838');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  if (image) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, w, h);
    return;
  }
  ctx.lineWidth = w * 0.035; ctx.strokeStyle = '#1a1033';
  ctx.fillStyle = hex(S.swatch[1]);
  ctx.beginPath(); ctx.ellipse(w / 2, h * 1.05, w * 0.42, h * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = hex(S.swatch[0]);
  ctx.beginPath(); ctx.ellipse(w / 2, h * 0.5, w * 0.24, h * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}

export class Hud {
  constructor(root, { onSettings, onMute, onBag, onMap }) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-player">
        <div class="portrait"><canvas width="128" height="128"></canvas><div class="lvl-badge">1</div></div>
        <div class="bars">
          <div class="pname outlined">Grumete</div>
          <div class="bar hp"><div class="ghost" style="width:100%"></div><div class="fill" style="width:100%"></div><div class="num">100 / 100</div></div>
          <div class="bar en thin"><div class="fill" style="width:0%"></div><div class="num">RIPOSTE 0 %</div></div>
          <div class="bar xp thin"><div class="fill" style="width:0%"></div><div class="num">0 / 100 XP</div></div>
          <div class="gold-row outlined"><span class="coin">${ICONS.coin}</span><b class="gold-n">0</b><span class="tier-chip" hidden></span><span class="law-chip" hidden title="Cala Calavera: fuego amigo y botín completo">☠ SIN LEY</span></div>
        </div>
      </div>
      <div class="hud-top-right">
        <div class="net-chip" hidden><i></i><span class="ms"></span><span class="pl"></span></div>
        <button class="icon-btn interactive" id="hud-bag" aria-label="Bolsa y personaje (I)" title="Bolsa y personaje (I)">${ICONS.bag}<span class="dot" hidden></span></button>
        <button class="icon-btn interactive" id="hud-map" aria-label="Mapa (M)" title="Mapa (M)">${ICONS.map}</button>
        <button class="icon-btn interactive" id="hud-mute" aria-label="Silenciar">${ICONS.sound}</button>
        <button class="icon-btn interactive" id="hud-settings" aria-label="Ajustes">${ICONS.gear}</button>
      </div>
      <div id="boss-bar" hidden>
        <div class="bname outlined"><span class="n"></span><span class="t"></span></div>
        <div class="bbar"><div class="ghost"></div><div class="fill"></div><i class="mark"></i><div class="num"></div></div>
        <div class="bstate"></div>
      </div>
      <div id="enc-info" class="outlined" hidden></div>
      <div id="zone-banner"><div class="zname outlined"></div><div class="zsub"></div><div class="zline"></div></div>
      <div id="toasts"></div>
      <div class="tracker frame-dark"><h3>Primeros pasos</h3><ul></ul></div>
      <div id="chain" class="outlined" hidden><span class="x">CADENA</span><b>x2</b></div>
      <div class="actionbar frame">
        <div class="wname"></div>
        <div class="mast" title=""><div class="mfill"></div><span class="mtxt"></span></div>
        <div class="slot lmb-slot" data-slot="lmb" title="Combo de 3 golpes: destruye proyectiles ámbar"><span class="kbd key">LMB</span><span class="ico">${ICONS.sword}</span><div class="combo"><i></i><i></i><i></i></div></div>
        <div class="slot rmb-slot" data-slot="rmb" title="Guardia (mantener): bloquea de frente. Súbela justo a tiempo para ATRAPAR la bala; el siguiente golpe la devuelve"><span class="kbd key">RMB</span>${ICONS.shield}<div class="sweep"></div><div class="catch"><i></i><i></i><i></i></div></div>
        <div class="slot dash-slot" data-slot="dash"><span class="kbd key">ESP</span>${ICONS.dash}<div class="sweep"></div><div class="charges"></div></div>
        ${this.slot('q', 'Q', ICONS.lunge)}
        ${this.slot('e', 'E', ICONS.crescent)}
        <div class="slot r-slot" data-slot="r" title="Riposte Tormenta: con el medidor lleno, refleja todo a tu alrededor"><span class="kbd key">R</span><div class="rfill"></div><span class="ico">${ICONS.storm}</span><span class="lock" hidden>${ICONS.lock}<em></em></span></div>
        <div class="slot pot-slot" data-slot="pot" title="Poción de ron-coco: cura el 40 % de tu vida"><span class="kbd key">1</span><span class="ico">${ICONS.potion}</span><div class="sweep"></div><b class="cnt">0</b></div>
      </div>
      <div id="fallen" hidden><div class="ftitle outlined">HAS CAÍDO</div><div class="fsub">Reapareces en <b>3</b>…</div></div>`;
    this.portrait = root.querySelector('.portrait canvas');
    this.lvl = root.querySelector('.lvl-badge');
    this.pname = root.querySelector('.pname');
    this.dashSlot = root.querySelector('.dash-slot');
    this.sweep = this.dashSlot.querySelector('.sweep');
    this.chargesEl = this.dashSlot.querySelector('.charges');
    this.trackerUl = root.querySelector('.tracker ul');
    this.toasts = root.querySelector('#toasts');
    this.banner = root.querySelector('#zone-banner');
    this.muteBtn = root.querySelector('#hud-mute');
    root.querySelector('#hud-settings').addEventListener('click', onSettings);
    if (onBag) root.querySelector('#hud-bag').addEventListener('click', onBag);
    if (onMap) root.querySelector('#hud-map').addEventListener('click', onMap);
    this.goldEl = root.querySelector('.gold-n'); this.tierChip = root.querySelector('.tier-chip'); this.lawChip = root.querySelector('.law-chip');
    // Red at the edges of the screen while you stand in the Cala Calavera (M4.5).
    this.lawVig = document.createElement('div');
    this.lawVig.className = 'law-vig';
    root.prepend(this.lawVig);
    this.potSlot = root.querySelector('.pot-slot');
    this.mastEl = root.querySelector('.actionbar .mast');
    this.muteBtn.addEventListener('click', onMute);
    this.lastCharges = -1;
    this.lastMax = -1;
    this.bannerTl = null;
    this.hpBar = root.querySelector('.bar.hp');
    this.hpFill = this.hpBar.querySelector('.fill'); this.hpGhost = this.hpBar.querySelector('.ghost'); this.hpNum = this.hpBar.querySelector('.num');
    this.rpBar = root.querySelector('.bar.en');
    this.rpFill = this.rpBar.querySelector('.fill'); this.rpNum = this.rpBar.querySelector('.num');
    this.xpFill = root.querySelector('.bar.xp .fill'); this.xpNum = root.querySelector('.bar.xp .num');
    this.rmbSlot = root.querySelector('.rmb-slot');
    this.rmbSweep = this.rmbSlot.querySelector('.sweep');
    this.catchPips = this.rmbSlot.querySelectorAll('.catch i');
    this.rSlot = root.querySelector('.r-slot'); this.rFill = this.rSlot.querySelector('.rfill');
    this.comboPips = root.querySelectorAll('[data-slot="lmb"] .combo i');
    this.lmbSlot = root.querySelector('.lmb-slot');
    this.qSlot = root.querySelector('[data-slot="q"]'); this.eSlot = root.querySelector('[data-slot="e"]');
    this.wname = root.querySelector('.actionbar .wname');
    this.chainEl = root.querySelector('#chain');
    this.fallen = root.querySelector('#fallen');
    this.last = {};
    this.bossEl = root.querySelector('#boss-bar');
    this.bossFill = this.bossEl.querySelector('.fill'); this.bossGhost = this.bossEl.querySelector('.ghost');
    this.bossNum = this.bossEl.querySelector('.num'); this.bossState = this.bossEl.querySelector('.bstate');
    this.encEl = root.querySelector('#enc-info');
    this.lastBoss = '';
    this.lastEnc = null;
  }

  // Boss bar (top centre): {name, title, hp, maxHp, phase (0-based), phases, marks (hp fractions of the
  // phases still to come), shield (0 off · 1 up · 2 broken), inv} or null to hide.
  setBoss(b) {
    const key = b ? [b.name, Math.ceil(b.hp), b.maxHp, b.phase, b.shield, b.inv].join('|') : '';
    if (key === this.lastBoss) return;
    const was = !!this.lastBoss;
    this.lastBoss = key;
    this.bossEl.hidden = !b;
    this.root.classList.toggle('boss-on', !!b);
    if (!b) return;
    if (!was) {
      this.bossEl.querySelector('.n').textContent = b.name;
      this.bossEl.querySelector('.t').textContent = b.title || '';
      gsap.fromTo(this.bossEl, { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'back.out(1.6)' });
    }
    const fr = Math.max(0, Math.min(1, b.hp / b.maxHp));
    this.bossFill.style.width = (fr * 100).toFixed(2) + '%';
    this.bossGhost.style.width = (fr * 100).toFixed(2) + '%';
    this.bossNum.textContent = `${Math.ceil(Math.max(0, b.hp))} / ${b.maxHp}`;
    // One notch per phase still to come (hp fractions).
    const marks = b.marks || (b.mark > 0 ? [b.mark] : []);
    let els = this.bossEl.querySelectorAll('.mark');
    while (els.length < marks.length) { els[0].after(els[0].cloneNode()); els = this.bossEl.querySelectorAll('.mark'); }
    els.forEach((m, i) => { m.hidden = i >= marks.length; if (i < marks.length) m.style.left = (marks[i] * 100).toFixed(1) + '%'; });
    this.bossEl.classList.toggle('shield', b.shield === 1);
    this.bossEl.classList.toggle('broken', b.shield === 2);
    this.bossEl.classList.toggle('inv', !!b.inv);
    this.bossState.innerHTML = `FASE ${b.phase + 1}/${b.phases}` + (b.inv ? ' · <b>INVULNERABLE</b>' : b.shield === 2 ? (b.phase >= 2 ? ' · <b class="br">¡ATURDIDO! ×1,4</b>' : ' · <b class="br">¡ESCUDO ROTO! ×1,5</b>') : b.shield === 1 ? ' · <b class="sh">ESCUDO: solo los reflejos lo atraviesan</b>' : b.phase >= 2 ? ' · <b class="br">EN LLAMAS: los reflejos duelen más</b>' : '');
  }

  // Encounter line under the boss bar / top centre ("OLEADA 2/3 · Enemigos 9"), or null.
  setEnc(html) {
    if (html === this.lastEnc) return;
    this.lastEnc = html;
    this.encEl.hidden = !html;
    if (html) this.encEl.innerHTML = html;
  }

  // Per-frame stats (only touches the DOM when a value changes).
  // guard: stamina 0..1; catchN / catchHv: bullets caught by a perfect guard (heavy ones first).
  setStats({ hp, maxHp, riposte, xp, xpNext, level, guard = 1, catchN = 0, catchHv = 0, combo, dead, deadT }) {
    const L = this.last;
    const h = Math.ceil(hp);
    if (h !== L.hp || maxHp !== L.maxHp) {
      const fr = Math.max(0, Math.min(1, h / maxHp));
      this.hpFill.style.width = (fr * 100).toFixed(1) + '%';
      this.hpGhost.style.width = (fr * 100).toFixed(1) + '%';
      this.hpNum.textContent = `${h} / ${maxHp}`;
      this.hpBar.classList.toggle('low', fr < 0.3);
      if (L.hp !== undefined && h < L.hp) { this.hpBar.classList.remove('hurt'); void this.hpBar.offsetWidth; this.hpBar.classList.add('hurt'); }
      L.hp = h; L.maxHp = maxHp;
    }
    const rp = Math.floor(riposte);
    if (rp !== L.rp) {
      this.rpFill.style.width = rp + '%';
      this.rpNum.textContent = rp >= 100 ? 'RIPOSTE LISTO · R' : `RIPOSTE ${rp} %`;
      this.rpBar.classList.toggle('full', rp >= 100);
      this.rSlot.classList.toggle('ready', rp >= 100);
      this.rFill.style.height = rp + '%';
      L.rp = rp;
    }
    const x = Math.floor(xp);
    if (x !== L.xp || xpNext !== L.xpNext) {
      this.xpFill.style.width = Math.min(100, (x / xpNext) * 100).toFixed(1) + '%';
      this.xpNum.textContent = `${x} / ${xpNext} XP`;
      L.xp = x; L.xpNext = xpNext;
    }
    if (level !== L.level) {
      if (L.level !== undefined) gsap.fromTo(this.lvl, { scale: 1.8 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.4)' });
      this.lvl.textContent = String(level);
      L.level = level;
    }
    // Guard stamina drains the RMB slot from the top; low stamina turns it red.
    const gs = Math.round(Math.max(0, Math.min(1, guard)) * 40) / 40;
    if (gs !== L.gs) {
      const pc = (1 - gs) * 100;
      this.rmbSweep.style.background = gs >= 1 ? '' : `linear-gradient(rgba(10,6,24,0.66) ${pc}%, transparent ${pc}%)`;
      this.rmbSlot.classList.toggle('low', gs < 0.34);
      L.gs = gs;
    }
    const ck = catchN * 10 + catchHv;
    if (ck !== L.ck) {
      this.catchPips.forEach((p, i) => { p.classList.toggle('on', i < catchN); p.classList.toggle('heavy', i < catchHv); });
      this.rmbSlot.classList.toggle('caught', catchN > 0);
      L.ck = ck;
    }
    if (combo !== L.combo) {
      this.comboPips.forEach((p, i) => p.classList.toggle('on', i < combo));
      L.combo = combo;
    }
    const secs = dead ? Math.max(1, Math.ceil(deadT)) : 0;
    if (secs !== L.dead) {
      this.fallen.hidden = !secs;
      if (secs) this.fallen.querySelector('b').textContent = String(secs);
      if (secs && !L.dead) gsap.fromTo(this.fallen, { opacity: 0, scale: 1.2 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'power2.out' });
      L.dead = secs;
    }
  }

  // Chain counter: pops on each chained parry, fades when the chain breaks.
  setChain(n, alive) {
    if (n !== this.last.chain) {
      if (n >= 2) {
        this.chainEl.hidden = false;
        this.chainEl.querySelector('b').textContent = 'x' + n;
        this.chainEl.dataset.n = String(n);
        gsap.fromTo(this.chainEl, { scale: 1.5 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' });
      }
      this.last.chain = n;
    }
    const show = n >= 2 && alive;
    if (!show && !this.chainEl.hidden) this.chainEl.hidden = true;
  }

  pulse(slot) {
    const el = this.root.querySelector(`[data-slot="${slot}"]`);
    if (!el) return;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  slot(id, key, icon) {
    return `<div class="slot skill-slot" data-slot="${id}"><span class="kbd key">${key}</span><span class="ico">${icon}</span><div class="sweep"></div><span class="cd"></span><span class="lock" hidden>${ICONS.lock}<em></em></span></div>`;
  }

  // ---- M4: gold, potions, mastery, locks, quests ---------------------------------------------------------
  setGold(n, tierName = '') {
    if (n !== this.last.gold) {
      if (this.last.gold !== undefined && n > this.last.gold) gsap.fromTo(this.goldEl, { scale: 1.35 }, { scale: 1, duration: 0.4, ease: 'back.out(3)' });
      this.goldEl.textContent = String(n);
      this.last.gold = n;
    }
    if (tierName !== this.last.tierName) { this.tierChip.hidden = !tierName; this.tierChip.textContent = tierName; this.last.tierName = tierName; }
  }

  // Potions you carry, and the cooldown left (s) out of max.
  setPotions(n, cd = 0, max = 2) {
    const f = max > 0 ? Math.max(0, Math.min(1, cd / max)) : 0;
    const key = n + ':' + Math.round(f * 40);
    if (key === this.last.pot) return;
    this.last.pot = key;
    this.potSlot.querySelector('.cnt').textContent = String(n);
    this.potSlot.classList.toggle('empty', n <= 0);
    const deg = Math.round((1 - f) * 360);
    this.potSlot.querySelector('.sweep').style.background = f > 0 ? `conic-gradient(transparent 0deg ${deg}deg, rgba(10,6,24,0.66) ${deg}deg 360deg)` : '';
  }

  // Locked Q / E / R (the weapon's mastery has not opened them): {q: level needed | 0, e, r}, and the kit name.
  setLocks(need, kitName = '') {
    const key = `${need.q}|${need.e}|${need.r}|${kitName}`;
    if (key === this.last.locks) return;
    this.last.locks = key;
    for (const [el, k] of [[this.qSlot, 'q'], [this.eSlot, 'e'], [this.rSlot, 'r']]) {
      const lk = el.querySelector('.lock'), n = need[k];
      el.classList.toggle('locked', !!n);
      lk.hidden = !n;
      if (n) { lk.querySelector('em').textContent = 'M' + n; lk.title = `Se desbloquea con Maestría ${n} de ${kitName}`; }
    }
  }

  // The weapon's mastery: level, progress to the next (0..1), at the top.
  setMastery(level, frac, top, title = '') {
    const key = level + ':' + Math.round(frac * 50);
    if (key === this.last.mast) return;
    const up = this.last.mastLevel !== undefined && level > this.last.mastLevel;
    this.last.mast = key; this.last.mastLevel = level;
    this.mastEl.hidden = !level;
    if (!level) return;
    this.mastEl.querySelector('.mfill').style.width = (top ? 100 : frac * 100).toFixed(1) + '%';
    this.mastEl.querySelector('.mtxt').textContent = top ? `Maestría ${level} · máxima` : `Maestría ${level}`;
    this.mastEl.title = title;
    if (up) gsap.fromTo(this.mastEl, { scale: 1.2 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.4)' });
  }

  denySlot(slot) {
    const el = slot === 'pot' ? this.potSlot : this.root.querySelector(`[data-slot="${slot}"]`);
    if (!el) return;
    el.classList.remove('denied'); void el.offsetWidth; el.classList.add('denied');
  }

  // A dot on the bag button: something new in it.
  setBagDot(on) { const d = this.root.querySelector('#hud-bag .dot'); if (d && d.hidden === !!on) d.hidden = !on; }

  // The tracker shows the beach tutorial first, then your quests: [{id, text, done, ready}].
  setQuests(title, items) {
    const key = title + '|' + items.map((it) => `${it.id}:${it.text}:${it.done ? 1 : 0}:${it.ready ? 1 : 0}`).join('|');
    if (key === this.last.quests) return;
    const was = this.last.quests;
    this.last.quests = key;
    this.root.querySelector('.tracker h3').textContent = title;
    this.trackerUl.innerHTML = items.map((it) => `<li class="${it.done ? 'done' : ''}${it.ready ? ' ready' : ''}" data-id="${esc(it.id)}"><span class="chk"></span><span class="txt">${it.text}</span></li>`).join('');
    if (was && was.split('|')[0] !== title) gsap.from(this.root.querySelector('.tracker'), { x: 40, opacity: 0, duration: 0.5, ease: 'back.out(2)' });
  }

  // The weapon decides LMB and Q / E / R: icons, tooltips and the name over the bar.
  setWeapon(kind) {
    if (kind === this.last.weapon) return;
    this.last.weapon = kind;
    const W = WEAPONS[kind] || WEAPONS.sable, pist = W.basic === 'pistol';
    const icon = { combo: ICONS.sword, pistol: ICONS.pistol, lunge: ICONS.lunge, wave: ICONS.crescent, storm: ICONS.storm, blast: ICONS.blast, blink: ICONS.blink, rain: ICONS.rain };
    const tip = (id) => `${SKILLS[id].name}: ${SKILLS[id].hint}${SKILLS[id].cd ? ` · ${SKILLS[id].cd} s` : ''}`;
    this.lmbSlot.querySelector('.ico').innerHTML = icon[W.basic];
    this.lmbSlot.title = pist ? 'Disparo (mantener): balas rectas; no refleja. Atrapa con la guardia y el siguiente disparo devuelve lo atrapado' : 'Combo de 3 golpes: golpea la bala justo antes del impacto para reflejarla (EXCELENTE / BUENO / POBRE)';
    this.lmbSlot.querySelector('.combo').hidden = pist;
    this.qSlot.querySelector('.ico').innerHTML = icon[W.q]; this.qSlot.title = tip(W.q);
    this.eSlot.querySelector('.ico').innerHTML = icon[W.e]; this.eSlot.title = tip(W.e);
    this.rSlot.querySelector('.ico').innerHTML = icon[W.r];
    this.rSlot.title = W.r === 'rain' ? 'Lluvia de plomo: con el medidor lleno, una zona de balas en el cursor' : 'Tormenta: con el medidor lleno, refleja todo a tu alrededor';
    this.wname.textContent = W.name;
    gsap.fromTo(this.wname, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' });
  }

  // Q / E cooldowns (seconds left, full length): a dark sweep that empties clockwise and the seconds.
  setCooldowns(q, qMax, e, eMax) {
    for (const [el, t, max, k] of [[this.qSlot, q, qMax, 'cq'], [this.eSlot, e, eMax, 'ce']]) {
      const f = max > 0 ? Math.max(0, Math.min(1, t / max)) : 0;
      const key = Math.round(f * 60) + ':' + Math.ceil(t);
      if (key === this.last[k]) continue;
      if (this.last[k] && f === 0) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
      this.last[k] = key;
      const deg = Math.round((1 - f) * 360);
      el.querySelector('.sweep').style.background = f > 0 ? `conic-gradient(transparent 0deg ${deg}deg, rgba(10,6,24,0.66) ${deg}deg 360deg)` : '';
      el.querySelector('.cd').textContent = f > 0 ? String(Math.ceil(t)) : '';
      el.classList.toggle('cooling', f > 0);
    }
  }

  show() {
    this.root.hidden = false;
    gsap.from(this.root.querySelector('.hud-player'), { x: -40, opacity: 0, duration: 0.6, ease: 'back.out(2)' });
    gsap.from(this.root.querySelector('.actionbar'), { y: 60, opacity: 0, duration: 0.6, ease: 'back.out(2)', delay: 0.1 });
    gsap.from(this.root.querySelector('.tracker'), { x: 40, opacity: 0, duration: 0.6, ease: 'back.out(2)', delay: 0.2 });
    gsap.from(this.root.querySelector('.hud-top-right'), { y: -30, opacity: 0, duration: 0.5, ease: 'back.out(2)', delay: 0.25 });
  }

  // Online: round trip to the server (green < 90 ms, amber < 180, red beyond) and pirates aboard; null hides it.
  setNet(n) {
    if (!this.netChip) { this.netChip = this.root.querySelector('.net-chip'); this.netKey = ''; }
    const key = n ? Math.round(n.rtt / 5) + '/' + n.players : '';
    if (key === this.netKey) return;
    this.netKey = key;
    this.netChip.hidden = !n;
    if (!n) return;
    const ms = Math.round(n.rtt);
    this.netChip.className = 'net-chip ' + (ms < 90 ? 'good' : ms < 180 ? 'ok' : 'bad');
    this.netChip.querySelector('.ms').textContent = ms + ' ms';
    this.netChip.querySelector('.pl').textContent = '· ' + n.players + (n.players === 1 ? ' pirata' : ' piratas');
    this.netChip.title = `Latencia con el servidor: ${ms} ms (ida y vuelta)`;
  }

  // Party frames under yours: the other human pirates (name, level, HP, weapon, fallen).
  setParty(list) {
    if (!this.partyEl) { this.partyEl = document.createElement('div'); this.partyEl.className = 'party'; this.root.querySelector('.hud-player').after(this.partyEl); this.partyKey = ''; }
    const key = list.map((p) => `${p.id}:${p.level}:${Math.round((p.hp / Math.max(1, p.maxHp)) * 40)}:${p.weapon}:${p.dead ? 1 : 0}`).join('|');
    if (key === this.partyKey) return;
    this.partyKey = key;
    this.partyEl.hidden = !list.length;
    this.root.style.setProperty('--party-n', Math.min(3, list.length)); // the toasts start under the crew
    this.partyEl.innerHTML = list.slice(0, 3).map((p) => {
      const f = Math.max(0, Math.min(1, p.hp / Math.max(1, p.maxHp)));
      const icon = p.weapon === 1 ? ICONS.pistol : ICONS.sword;
      const c = hex((SKINS[p.skin] || SKINS[0]).accent ?? 0x3bf0ff);
      return `<div class="pm${p.dead ? ' dead' : ''}" style="--pc:${c}"><span class="pw">${icon}</span><div class="pb"><div class="pn"><span class="lv">${p.level}</span>${esc(p.name)}</div><div class="bar hp thin"><div class="fill" style="width:${(f * 100).toFixed(0)}%"></div></div></div></div>`;
    }).join('');
  }

  setMuted(m) { this.muteBtn.innerHTML = m ? ICONS.mute : ICONS.sound; this.muteBtn.setAttribute('aria-label', m ? 'Activar sonido' : 'Silenciar'); }

  setPlayer({ name, level, skin, portrait }) {
    this.pname.textContent = name;
    this.lvl.textContent = String(level);
    drawPortrait(this.portrait, skin, portrait);
  }

  setDash(charges, max, recharge01) {
    if (charges !== this.lastCharges || max !== this.lastMax) {
      if (max !== this.lastMax) this.chargesEl.innerHTML = Array.from({ length: max }, () => '<span class="pip"></span>').join('');
      const pips = this.chargesEl.children;
      for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('empty', i >= charges);
      if (charges > this.lastCharges && this.lastCharges >= 0) {
        this.dashSlot.classList.remove('flash'); void this.dashSlot.offsetWidth; this.dashSlot.classList.add('flash');
      }
      this.lastCharges = charges; this.lastMax = max;
    }
    if (charges < max) {
      const deg = Math.round(recharge01 * 360);
      this.sweep.style.background = `conic-gradient(transparent 0deg ${deg}deg, rgba(10,6,24,0.62) ${deg}deg 360deg)`;
    } else if (this.sweep.style.background) this.sweep.style.background = '';
  }

  denyDash() {
    this.dashSlot.classList.remove('denied'); void this.dashSlot.offsetWidth; this.dashSlot.classList.add('denied');
  }

  // Inside the Cala Calavera: the chip and the red edges.
  setLawless(on) {
    if (on === this.lawOn) return;
    this.lawOn = on;
    this.lawChip.hidden = !on;
    this.lawVig.classList.toggle('on', on);
  }

  // look: '' · 'caldera' (embers) · 'lawless' (blood red); true = 'caldera' (older callers).
  showZone(name, sub, look = '', reduced = false) {
    const b = this.banner;
    if (look === true) look = 'caldera';
    b.querySelector('.zname').textContent = name;
    b.querySelector('.zsub').textContent = sub;
    b.querySelector('.zname').style.color = look === 'caldera' ? '#ffb36b' : look === 'lawless' ? '#ff5a4a' : '';
    b.classList.toggle('lawless', look === 'lawless');
    if (this.bannerTl) this.bannerTl.kill();
    const line = b.querySelector('.zline');
    const tl = (this.bannerTl = gsap.timeline());
    tl.set(b, { opacity: 1 });
    if (reduced) {
      tl.fromTo(b, { opacity: 0 }, { opacity: 1, duration: 0.3 }).set(line, { width: 180 });
    } else {
      tl.fromTo(b.querySelector('.zname'), { y: -18, scale: 0.6, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.6, ease: 'back.out(2.5)' })
        .fromTo(line, { width: 0 }, { width: 180, duration: 0.45, ease: 'power2.out' }, '-=0.25')
        .fromTo(b.querySelector('.zsub'), { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.35 }, '-=0.2');
    }
    tl.to(b, { opacity: 0, duration: 0.6, delay: 2.6 });
  }

  toast(html, ms = 3200) {
    const el = document.createElement('div');
    el.className = 'toast frame-dark';
    el.innerHTML = html;
    this.toasts.prepend(el);
    gsap.fromTo(el, { x: -30, opacity: 0, scale: 0.9 }, { x: 0, opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(2)' });
    gsap.to(el, { opacity: 0, x: -20, duration: 0.4, delay: ms / 1000, onComplete: () => el.remove() });
    while (this.toasts.children.length > 4) this.toasts.lastChild.remove();
  }

  setTracker(items) {
    this.trackerUl.innerHTML = items.map((it) => `<li class="${it.done ? 'done' : ''}" data-id="${it.id}"><span class="chk"></span><span class="txt">${it.text}</span></li>`).join('');
  }

  setTrackerText(id, text) {
    const li = this.trackerUl.querySelector(`[data-id="${id}"] .txt`);
    if (li && li.textContent !== text) li.textContent = text;
  }

  completeTracker(id) {
    const li = this.trackerUl.querySelector(`[data-id="${id}"]`);
    if (!li || li.classList.contains('done')) return;
    li.classList.add('done');
    gsap.fromTo(li.querySelector('.chk'), { scale: 1.8 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)' });
  }
}
