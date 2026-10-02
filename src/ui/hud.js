// MMO HUD: portrait + bars (HP with a damage trail, RIPOSTE meter, XP), action bar (attack, parry with its
// whiff lock, dash charges with radial recharge, riposte fill), chain counter, zone banner, objective
// tracker, toasts and the "fallen" screen. Plain DOM over the canvas; GSAP for the choreography.
import { gsap } from 'gsap';
import { SKINS } from '../render/characters.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const ICONS = {
  sword: '<svg viewBox="0 0 32 32"><path d="M24 3l5 0 0 5-13 13-3-2-2-3z" fill="#e3ebf5" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/><path d="M8 18l6 6-2 2-2-1-3 3-3-3 3-3-1-2z" fill="#ffc23d" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/></svg>',
  shield: '<svg viewBox="0 0 32 32"><path d="M16 3l11 4v8c0 7-5 12-11 14C10 27 5 22 5 15V7z" fill="#3bf0ff" stroke="#1a1033" stroke-width="2.2" stroke-linejoin="round"/><path d="M16 8v16M10 14h12" stroke="#1a1033" stroke-width="2" stroke-linecap="round"/></svg>',
  dash: '<svg viewBox="0 0 32 32"><path d="M6 10h11M3 16h14M6 22h11" stroke="#fff6e2" stroke-width="3" stroke-linecap="round"/><path d="M18 7l10 9-10 9z" fill="#3bf0ff" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/></svg>',
  spin: '<svg viewBox="0 0 32 32"><path d="M16 5a11 11 0 1 1-10 6" fill="none" stroke="#ffc23d" stroke-width="3.5" stroke-linecap="round"/><path d="M3 6l4 6 6-3z" fill="#ffc23d" stroke="#1a1033" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  wave: '<svg viewBox="0 0 32 32"><path d="M3 20c4-6 8-6 12 0s8 6 14 0M3 13c4-6 8-6 12 0s8 6 14 0" fill="none" stroke="#36c9ff" stroke-width="3" stroke-linecap="round"/></svg>',
  storm: '<svg viewBox="0 0 32 32"><path d="M18 3L7 18h8l-2 11 12-16h-8z" fill="#ffe14d" stroke="#1a1033" stroke-width="2" stroke-linejoin="round"/></svg>',
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
  constructor(root, { onSettings, onMute }) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-player">
        <div class="portrait"><canvas width="128" height="128"></canvas><div class="lvl-badge">1</div></div>
        <div class="bars">
          <div class="pname outlined">Grumete</div>
          <div class="bar hp"><div class="ghost" style="width:100%"></div><div class="fill" style="width:100%"></div><div class="num">100 / 100</div></div>
          <div class="bar en thin"><div class="fill" style="width:0%"></div><div class="num">RIPOSTE 0 %</div></div>
          <div class="bar xp thin"><div class="fill" style="width:0%"></div><div class="num">0 / 100 XP</div></div>
        </div>
      </div>
      <div class="hud-top-right">
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
        <div class="slot" data-slot="lmb" title="Combo de 3 golpes: destruye proyectiles ámbar"><span class="kbd key">LMB</span>${ICONS.sword}<div class="combo"><i></i><i></i><i></i></div></div>
        <div class="slot rmb-slot" data-slot="rmb" title="Parry: refleja proyectiles ámbar; justo a tiempo, ¡PERFECTO!"><span class="kbd key">RMB</span>${ICONS.shield}<div class="sweep"></div></div>
        <div class="slot dash-slot" data-slot="dash"><span class="kbd key">ESP</span>${ICONS.dash}<div class="sweep"></div><div class="charges"></div></div>
        ${this.slot('q', 'Q', ICONS.spin, 'Pronto')}
        ${this.slot('e', 'E', ICONS.wave, 'Pronto')}
        <div class="slot r-slot" data-slot="r" title="Riposte Tormenta: con el medidor lleno, refleja todo a tu alrededor"><span class="kbd key">R</span><div class="rfill"></div>${ICONS.storm}</div>
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
    this.muteBtn.addEventListener('click', onMute);
    this.lastCharges = -1;
    this.lastMax = -1;
    this.bannerTl = null;
    this.hpBar = root.querySelector('.bar.hp');
    this.hpFill = this.hpBar.querySelector('.fill'); this.hpGhost = this.hpBar.querySelector('.ghost'); this.hpNum = this.hpBar.querySelector('.num');
    this.rpBar = root.querySelector('.bar.en');
    this.rpFill = this.rpBar.querySelector('.fill'); this.rpNum = this.rpBar.querySelector('.num');
    this.xpFill = root.querySelector('.bar.xp .fill'); this.xpNum = root.querySelector('.bar.xp .num');
    this.rmbSweep = root.querySelector('.rmb-slot .sweep');
    this.rSlot = root.querySelector('.r-slot'); this.rFill = this.rSlot.querySelector('.rfill');
    this.comboPips = root.querySelectorAll('[data-slot="lmb"] .combo i');
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
  setStats({ hp, maxHp, riposte, xp, xpNext, level, parryLock, combo, dead, deadT }) {
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
    const lock = parryLock > 0 ? Math.round((1 - parryLock / 0.35) * 360) : 360;
    if (lock !== L.lock) {
      this.rmbSweep.style.background = lock >= 360 ? '' : `conic-gradient(transparent 0deg ${lock}deg, rgba(10,6,24,0.62) ${lock}deg 360deg)`;
      L.lock = lock;
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

  slot(id, key, icon, lock) {
    return `<div class="slot locked" data-slot="${id}" title="${lock === 'Pronto' ? 'Se aprende con la Capitana Brea' : 'Se desbloquea en ' + lock}"><span class="kbd key">${key}</span>${icon}<span class="lock">${lock}</span></div>`;
  }

  show() {
    this.root.hidden = false;
    gsap.from(this.root.querySelector('.hud-player'), { x: -40, opacity: 0, duration: 0.6, ease: 'back.out(2)' });
    gsap.from(this.root.querySelector('.actionbar'), { y: 60, opacity: 0, duration: 0.6, ease: 'back.out(2)', delay: 0.1 });
    gsap.from(this.root.querySelector('.tracker'), { x: 40, opacity: 0, duration: 0.6, ease: 'back.out(2)', delay: 0.2 });
    gsap.from(this.root.querySelector('.hud-top-right'), { y: -30, opacity: 0, duration: 0.5, ease: 'back.out(2)', delay: 0.25 });
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

  showZone(name, sub, caldera = false, reduced = false) {
    const b = this.banner;
    b.querySelector('.zname').textContent = name;
    b.querySelector('.zsub').textContent = sub;
    b.querySelector('.zname').style.color = caldera ? '#ffb36b' : '';
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
