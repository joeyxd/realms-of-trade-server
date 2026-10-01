// MMO HUD: portrait + bars, action bar (dash charges with radial recharge), zone banner,
// objective tracker and toasts. Plain DOM over the canvas; GSAP for the choreography.
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
          <div class="bar en thin"><div class="ghost" style="width:100%"></div><div class="fill" style="width:100%"></div><div class="num">50 / 50</div></div>
          <div class="bar xp thin"><div class="fill" style="width:0%"></div><div class="num">0 / 100 XP</div></div>
        </div>
      </div>
      <div class="hud-top-right">
        <button class="icon-btn interactive" id="hud-mute" aria-label="Silenciar">${ICONS.sound}</button>
        <button class="icon-btn interactive" id="hud-settings" aria-label="Ajustes">${ICONS.gear}</button>
      </div>
      <div id="zone-banner"><div class="zname outlined"></div><div class="zsub"></div><div class="zline"></div></div>
      <div id="toasts"></div>
      <div class="tracker frame-dark"><h3>Primeros pasos</h3><ul></ul></div>
      <div class="actionbar frame">
        ${this.slot('lmb', 'LMB', ICONS.sword, 'Pronto')}
        ${this.slot('rmb', 'RMB', ICONS.shield, 'Pronto')}
        <div class="slot dash-slot" data-slot="dash"><span class="kbd key">ESP</span>${ICONS.dash}<div class="sweep"></div><div class="charges"></div></div>
        ${this.slot('q', 'Q', ICONS.spin, 'Nv 3')}
        ${this.slot('e', 'E', ICONS.wave, 'Nv 5')}
        ${this.slot('r', 'R', ICONS.storm, 'Nv 7')}
      </div>`;
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

  completeTracker(id) {
    const li = this.trackerUl.querySelector(`[data-id="${id}"]`);
    if (!li || li.classList.contains('done')) return;
    li.classList.add('done');
    gsap.fromTo(li.querySelector('.chk'), { scale: 1.8 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)' });
  }
}
