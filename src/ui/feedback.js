// Combat feedback: turns combat events (predicted for the local player, or from the server) into what
// you see and hear: hitstop and slow-mo (instance time), camera trauma and punch, screen flash, sparks,
// shockwaves, hit flashes and flinches, floating numbers and callouts, sounds, HUD pulses, and the
// telegraph timeline of enemy attacks. Gameplay never lives here.
import { tuning, DT } from '../data/tuning.js';
import { ENEMIES } from '../data/enemies.js';
import { sfx } from '../audio/sfx.js';
import { audio } from '../audio/engine.js';
import { SKINS } from '../render/characters.js';
import { patternSpan } from '../sim/projectiles.js';

const AMBER = [1, 0.72, 0.25], AMBER1 = [0.95, 0.3, 0.05];
const CYAN = [0.65, 1, 1], CYAN1 = [0.1, 0.75, 1];
const VIOLET = [0.85, 0.6, 1], VIOLET1 = [0.45, 0.2, 0.9];
const BONE = [1, 0.95, 0.85], BONE1 = [0.9, 0.7, 0.4];

export class Feedback {
  constructor({ world, client, hud, worldUI, loop, settings, map, ps, onTutorial }) {
    Object.assign(this, { world, client, hud, worldUI, loop, settings, map, ps, onTutorial });
    this.flash = 0;
    this.flashColor = [1, 1, 1];
    this.aoes = new Map(); // aoe id → {src, tAct, x, z, r, done}
    this.taught = new Set();
  }

  get accent() { return SKINS[this.settings.skin]?.accent ?? 0x3bf0ff; }
  me() { return this.world.views.get(this.client.youServer); }
  viewOf(id) { return this.world.views.get(id); }
  vol(x, z) { const d = Math.hypot(x - this.ps.x, z - this.ps.z); return Math.max(0, Math.min(1, 1 - (d - 6) / 30)); }
  shake(a) { this.world.rig.addTrauma(a); }
  screen(amount, rgb = [1, 1, 1]) { if (amount > this.flash) { this.flash = amount; this.flashColor = rgb; } }
  y(x, z) { return this.map.groundAt(x, z); }
  teach(key, html, ms = 5200) { if (this.taught.has(key)) return; this.taught.add(key); this.hud.toast(html, ms); }

  float(x, z, h, html, cls, o) { this.worldUI.float(x, this.y(x, z) + h, z, html, cls, o); }
  overMe(html, cls, o) { this.worldUI.float(this.ps.x, this.ps.y + 2.15, this.ps.z, html, cls, { rise: 34, spread: 6, life: 1, ...o }); }

  sparks(x, y, z, n, c0, c1, o = {}) { this.world.effects.sparks(x, y, z, n, { color: c0, color1: c1, up: 2, spread: 3.2, gravity: 7, life: 0.35, ...o }); }

  handle(ev) {
    const W = this.world, F = tuning.feel, ps = this.ps;
    const me = ev.me;
    switch (ev.type) {
      case 'time':
        if (ev.hitstop > 0) this.loop.addHitstop(ev.hitstop);
        if (ev.scale < 1 && ev.dur > 0) this.loop.slowmo(ev.scale, ev.dur);
        break;
      case 'swing': {
        if (!me) break;
        const v = this.me();
        const st = tuning.melee.stages[ev.stage - 1];
        if (v) W.combatFx.slash(v, ev.stage, this.accent, st.active, st.windup);
        sfx.swing(ev.stage);
        break;
      }
      case 'mhit': {
        const v = this.viewOf(ev.id), rec = this.client.entities.get(ev.id);
        const y = (rec ? rec.r.y : this.y(ev.x, ev.z)) + 1.1;
        this.sparks(ev.x, y, ev.z, ev.stage === 3 ? 14 : 9, BONE, BONE1, { up: 2.5 });
        W.combatFx.ring(ev.x, y - 0.9, ev.z, 0.9, 0xfff1c8, 0.22, 0.2, 0.7);
        if (v) { v.flash(0xffffff, 1); this.flinch(v, ev.x, ev.z); }
        sfx.hit(this.material(rec), false);
        this.loop.addHitstop(F.hitstopMelee);
        this.shake(ev.stage === 3 ? 0.22 : 0.12);
        W.rig.punchIn(ev.stage === 3 ? 0.4 : 0.2);
        break;
      }
      case 'damage': {
        const rec = this.client.entities.get(ev.id), v = this.viewOf(ev.id);
        const x = rec && rec.ready ? rec.r.x : ev.x, z = rec && rec.ready ? rec.r.z : ev.z;
        const h = (v ? v.height : 1.8) + 0.25;
        if (ev.immune) {
          this.float(x, z, h, ev.kind === 'shot' ? '¡BLANCO!' : '¡CLANC!', ev.kind === 'shot' ? 'perfect' : 'immune', { life: 1 });
          if (v && v.hit) v.hit(1);
          sfx.clunk();
          if (ev.kind === 'shot' && ev.by === this.client.youServer) this.onTutorial('target');
          break;
        }
        this.float(x, z, h, ev.crit ? `<small>¡CRÍTICO!</small> ${ev.dmg}` : String(ev.dmg), ev.crit ? 'crit' : 'dmg');
        if (v) { v.flash(0xffffff, 1); if (!ev.predictedHit) this.flinch(v, ps.x, ps.z, ev.heavy ? 1.4 : 1); }
        if (!ev.predictedHit) {
          sfx.hit(this.material(rec), !!ev.crit, this.vol(x, z));
          if (ev.kind !== 'melee') this.sparks(x, (rec ? rec.r.y : 0) + 1.1, z, 8, CYAN, CYAN1);
        } else if (ev.crit) sfx.hit(this.material(rec), true);
        if (rec && rec.enemy === 'dummy' && ev.by === this.client.youServer && ev.kind === 'melee') this.onTutorial('dummy', ev);
        break;
      }
      case 'kill': {
        const rec = this.client.entities.get(ev.id), v = this.viewOf(ev.id);
        if (rec) rec.dying = true;
        const x = rec && rec.ready ? rec.r.x : ev.x, z = rec && rec.ready ? rec.r.z : ev.z;
        if (v && v.built) {
          const dx = x - ps.x, dz = z - ps.z, dl = Math.hypot(dx, dz) || 1;
          W.debris.burst(v, -dx / dl, -dz / dl, 1);
          v.root.visible = false;
          v.dead = true;
        }
        const y = (rec ? rec.r.y : this.y(x, z));
        this.sparks(x, y + 1, z, 16, BONE, BONE1, { up: 3, spread: 4 });
        W.combatFx.ring(x, y + 0.08, z, 2.2, 0xfff1c8, 0.4, 0.12, 0.6);
        sfx.bones(this.vol(x, z));
        if (ev.xp && Math.hypot(x - ps.x, z - ps.z) < 25) this.float(x, z, 1.4, `+${ev.xp} XP`, 'xp', { life: 1.3, rise: 60 });
        if (ev.by === this.client.youServer) { this.shake(0.25); this.onTutorial('kill', rec); }
        break;
      }
      case 'parryUp': if (me) sfx.whiff(); break;
      case 'parry': {
        const y = ps.y + 1.1;
        if (me) {
          const v = this.me();
          W.combatFx.setGuard(v, true, true);
          this.hud.pulse('rmb');
          if (ev.perfect) {
            sfx.parry(true, ev.chain);
            W.combatFx.shockwave(ps.x, ps.y, ps.z, this.accent);
            this.overMe('¡PERFECTO!', 'perfect', { life: 1.1 });
            this.screen(0.5);
            this.shake(0.35);
            W.rig.punchIn(0.6);
            if (v) v.flash(this.accent, 0.8);
            W.lights.flash(ps.x, ps.y + 1.3, ps.z, this.accent, 7, 4.5, 0.4);
            this.sparks(ev.x, y, ev.z, 18, CYAN, CYAN1, { up: 3, spread: 4.5 });
            if (ev.heavy) this.teach('heavyBack', '<b>¡Orbe devuelto!</b> Un parry PERFECTO es lo único que devuelve los orbes pesados.');
          } else {
            sfx.parry(false, ev.chain);
            W.combatFx.ring(ps.x, ps.y + 0.1, ps.z, 1.8, this.accent, 0.3, 0.14, 0.8);
            this.sparks(ev.x, y, ev.z, 10, CYAN, CYAN1);
            W.lights.flash(ps.x, ps.y + 1.3, ps.z, this.accent, 5, 2.5, 0.25);
            this.shake(0.15);
            if (ev.coyote) this.overMe('¡JUSTO!', 'parry', { life: 0.8 });
          }
          if (ev.chain >= 2) this.overMe(`x${ev.chain}`, 'parry', { life: 0.7, rise: 20, spread: 30 });
          this.onTutorial('parry', ev);
        } else {
          sfx.parry(false, 1);
          this.sparks(ev.x, this.y(ev.x, ev.z) + 1.1, ev.z, 8, CYAN, CYAN1);
        }
        break;
      }
      case 'destroy': {
        const y = (me ? ps.y : this.y(ev.x, ev.z)) + 1.1;
        this.sparks(ev.x, y, ev.z, 10, AMBER, AMBER1, { up: 2.4, spread: 3.6 });
        W.combatFx.ring(ev.x, y - 1, ev.z, 0.7, 0xffc46a, 0.2, 0.2, 0.7);
        sfx.destroy(me ? 1 : this.vol(ev.x, ev.z));
        break;
      }
      case 'clunk':
        if (!me) break;
        sfx.clunk();
        this.sparks(ev.x, ps.y + 1.1, ev.z, 5, [0.8, 0.8, 0.8], [0.4, 0.4, 0.45], { up: 1.5 });
        this.float(ev.x, ev.z, 1.6, '✘', 'immune', { life: 0.6 });
        this.teach('clunk', '<b>Orbe pesado:</b> la espada no lo rompe. Esquívalo, o devuélvelo con un parry PERFECTO.');
        break;
      case 'block':
        if (!me) break;
        sfx.block();
        this.sparks(ev.x, ps.y + 1.1, ev.z, 12, [1, 0.6, 0.3], [0.9, 0.2, 0.05], { up: 2.5 });
        this.overMe('BLOQUEO', 'info', { life: 0.8 });
        this.shake(0.3);
        this.teach('block', '<b>Bloqueo:</b> un parry normal solo frena el orbe pesado (mitad de daño). Hace falta PERFECTO.');
        break;
      case 'phit':
        if (me) this.sparks(ev.x, ps.y + 1.1, ev.z, 5, AMBER, AMBER1, { up: 1.5 });
        break;
      case 'hurt': {
        if (!me) {
          const v = this.viewOf(ev.e);
          if (v) { v.flash(0xff4d5e, 1); v.hit(0.8); }
          break;
        }
        const v = this.me();
        if (ev.practice) {
          this.overMe('¡Te dio!', 'info', { life: 0.9 });
          sfx.hurt(false);
          if (v) { v.flash(0xffffff, 0.7); v.hit(0.6); }
          this.teach('practiceHit', '<b>¡Casi!</b> Pulsa <span class="kbd">RMB</span> un instante antes de que la bala te toque.');
          break;
        }
        if (ev.dmg <= 0) break;
        sfx.hurt(ev.kind === 'aoe' || ev.dmg >= 18);
        this.overMe(`-${ev.dmg}`, 'hurt', { life: 0.9, spread: 24 });
        if (v) { v.flash(0xff4d5e, 1); v.hit(1); }
        this.shake(Math.min(0.55, 0.22 + ev.dmg / 60));
        this.screen(0.28, [1, 0.25, 0.25]);
        if (ev.kind === 'punish') {
          sfx.punish();
          this.overMe('¡IMPARABLE!', 'ghost', { life: 1 });
          this.teach('punish', '<b>Púas violetas (✕):</b> no se pueden parrear. Atraviésalas con un dash: <b>FANTASMA</b>.');
        }
        if (ev.kind === 'aoe') this.teach('aoe', '<b>Círculos rojos:</b> estallan cuando se llenan. Sal de ellos o haz un dash a tiempo.');
        break;
      }
      case 'graze':
        if (!me) break;
        sfx.graze();
        this.overMe('ROCE', 'graze', { life: 0.7, spread: 30 });
        this.sparks(ev.x, ps.y + 1.1, ev.z, 4, CYAN, CYAN1, { up: 1 });
        break;
      case 'ghost': {
        if (!me) break;
        sfx.ghost();
        this.overMe('FANTASMA', 'ghost', { life: 0.9 });
        const v = this.me();
        if (v) W.after.capture(v, 0x9b4dff, 0.35, 0.8);
        this.sparks(ev.x, ps.y + 1.1, ev.z, 8, VIOLET, VIOLET1, { up: 1.5 });
        break;
      }
      case 'riposte': {
        if (!me) break;
        sfx.riposte();
        const R = tuning.parry.riposte.radius;
        W.combatFx.ring(ps.x, ps.y + 0.1, ps.z, R * 1.15, this.accent, 0.6, 0.25, 0.45);
        W.combatFx.ring(ps.x, ps.y + 0.12, ps.z, R, 0xffffff, 0.45, 0.08, 1);
        W.combatFx.ring(ps.x, ps.y + 0.14, ps.z, R * 0.6, this.accent, 0.35, 0.14, 0.8);
        this.overMe('¡TORMENTA!', 'perfect', { life: 1.2 });
        this.screen(0.55);
        this.shake(0.6);
        W.rig.punchIn(0.8);
        W.lights.flash(ps.x, ps.y + 1.5, ps.z, this.accent, 10, 6, 0.5);
        this.sparks(ps.x, ps.y + 1, ps.z, 30, CYAN, CYAN1, { up: 4, spread: 8, life: 0.5 });
        break;
      }
      case 'shotImpact': {
        const y = this.y(ev.x, ev.z) + 1.1;
        this.sparks(ev.x, y, ev.z, ev.hit ? 12 : 6, CYAN, CYAN1, { up: 2.5 });
        if (ev.hit) { W.combatFx.ring(ev.x, y - 1, ev.z, 1.1, this.accent, 0.25, 0.18, 0.8); sfx.shotHit(this.vol(ev.x, ev.z)); }
        break;
      }
      case 'death':
        if (!me) break;
        sfx.death();
        audio.muffle(true);
        this.shake(0.5);
        this.screen(0.4, [1, 0.2, 0.2]);
        break;
      case 'respawn':
        if (!me) break;
        sfx.respawn();
        audio.muffle(false);
        W.combatFx.ring(ev.x, this.y(ev.x, ev.z) + 0.1, ev.z, 2.6, 0xfff1c8, 0.6, 0.15, 0.9);
        this.onTutorial('respawn', ev);
        break;
      case 'level': {
        if (!me) break;
        sfx.levelUp();
        this.overMe(`¡NIVEL ${ev.level}!`, 'level', { life: 1.6, rise: 60 });
        W.combatFx.ring(ps.x, ps.y + 0.1, ps.z, 2.8, 0xffc23d, 0.7, 0.12, 1);
        W.combatFx.ring(ps.x, ps.y + 0.12, ps.z, 1.8, 0xfff1c8, 0.5, 0.08, 1);
        this.screen(0.3, [1, 0.85, 0.5]);
        const L = ev.level;
        this.hud.toast(`<b>Nivel ${L}.</b> ▲ +${tuning.stats.hp[1]} HP · ▲ +${tuning.stats.atk[1]} ATK · ▲ +${tuning.stats.def[1]} DEF${L === 2 ? ' · <b>¡Segunda carga de dash!</b>' : ''}`, 5200);
        break;
      }
      case 'windup': {
        const v = this.viewOf(ev.id), rec = this.client.entities.get(ev.id);
        if (!v || !rec) break;
        const atk = rec.def?.attacks.find((a) => a.id === ev.atk);
        // Attack timeline in projectile ticks: the projectiles leave exactly when the pose fires.
        const t = Math.max(0, (this.client.viewTick(this.loop.alpha) - ev.tick) * DT);
        const fire = atk ? (atk.kind === 'pattern' ? patternSpan(atk) : 0) + (atk.recover || 0.3) : 0.4;
        v.attack = { id: ev.atk, t, windup: ev.dur, fire };
        const x = rec.r.x, z = rec.r.z;
        sfx.windup(ev.atk, this.vol(x, z));
        const c = ev.atk === 'volley' ? 0x8dffb0 : ev.atk === 'orb' ? 0xff5a1f : ev.atk === 'spikes' ? 0x9b4dff : ev.atk === 'ball' ? 0xffc46a : 0xff3b30;
        W.lights.flash(x, rec.r.y + 1.6, z, c, ev.atk === 'orb' ? 6 : 4, ev.atk === 'orb' ? 3.5 : 2, ev.dur + 0.15);
        if (ev.atk === 'orb') this.teach('orbWarn', '<b>¡Orbe pesado!</b> Grande y lento: no lo rompes con la espada. Esquívalo o PERFECTO.');
        if (ev.atk === 'spikes') this.teach('spikeWarn', '<b>Púas violetas (✕):</b> imparables. Dash a través de ellas.');
        break;
      }
      case 'pattern': {
        const rec = this.client.entities.get(ev.src);
        sfx.fire(ev.atk, this.vol(ev.x, ev.z));
        const c0 = ev.ptype === 'heavy' ? [1, 0.55, 0.2] : ev.ptype === 'unstop' ? VIOLET : AMBER;
        const c1 = ev.ptype === 'heavy' ? [0.9, 0.2, 0.05] : ev.ptype === 'unstop' ? VIOLET1 : AMBER1;
        this.sparks(ev.x, ev.y, ev.z, ev.atk === 'ball' ? 14 : 6, c0, c1, { up: 1.2 });
        if (ev.atk === 'ball') {
          for (let i = 0; i < 5; i++) W.effects.alpha.spawn(ev.x, ev.y, ev.z, Math.sin(ev.ang) * 2 + (Math.random() - 0.5), 0.6 + Math.random() * 0.6, Math.cos(ev.ang) * 2 + (Math.random() - 0.5), { life: 1.4, size: 0.5, size1: 1.6, color: [0.75, 0.72, 0.7], alpha: 0.6, drag: 1.5, shape: 4, turb: 0.3, heat: 0.4 });
          if (Math.hypot(ev.x - this.ps.x, ev.z - this.ps.z) < 16) this.shake(0.08);
        }
        break;
      }
      case 'aoe':
        this.aoes.set(ev.id, { src: ev.src, tAct: ev.tAct, x: ev.x, z: ev.z, r: ev.r, done: false });
        W.decals.aoe(ev.id, ev.x, ev.z, ev.r, ev.tick, ev.tAct);
        break;
      case 'cancel':
        for (const [id, a] of this.aoes) if (a.src === ev.src && !a.done) { W.decals.cancel(id); a.done = true; }
        { const v = this.viewOf(ev.src); if (v) v.attack = null; }
        break;
      case 'wake': {
        const rec = this.client.entities.get(ev.id);
        if (!rec) break;
        sfx.wake(this.vol(rec.r.x, rec.r.z));
        this.float(rec.r.x, rec.r.z, 2.6, '!', 'hurt', { life: 1, rise: 30 });
        W.lights.flash(rec.r.x, rec.r.y + 2, rec.r.z, 0x6ff0ff, 6, 3, 1.2);
        this.teach('wake', '<b>¡Centinelas!</b> Lanzan orbes pesados, púas imparables y tajos de área.', 4800);
        break;
      }
      default: break;
    }
  }

  material(rec) {
    if (!rec) return 'flesh';
    if (rec.enemy === 'dummy') return 'straw';
    if (rec.enemy === 'archer' || rec.enemy === 'sentinel') return 'bone';
    return 'flesh';
  }

  flinch(v, fromX, fromZ, k = 1) {
    if (!v.hit) return;
    const p = v.root.position, f = v.root.rotation.y;
    const dx = p.x - fromX, dz = p.z - fromZ, dl = Math.hypot(dx, dz) || 1;
    // +1 when the blow comes from the front (pushes the torso back).
    const front = -(Math.sin(f) * dx + Math.cos(f) * dz) / dl > 0 ? 1 : -1;
    v.hit(k, front, dx / dl, dz / dl);
  }

  // Per frame: screen flash decay, AoE bursts on the projectile timeline, danger vignette, slow-mo chroma.
  update(dt, tick) {
    const g = this.world.pipeline.grading;
    this.flash = Math.max(0, this.flash - dt * 3.2);
    g.flash = this.flash * (this.settings.reducedMotion ? 0.5 : 1);
    g.flashColor.setRGB(this.flashColor[0], this.flashColor[1], this.flashColor[2]);
    g.chroma = (1 - this.loop.timeScale) * 0.006;
    const fr = this.ps.maxHp > 0 ? this.ps.hp / this.ps.maxHp : 1;
    const low = this.ps.dead ? 0.7 : fr < 0.3 ? ((0.3 - fr) / 0.3) * (0.45 + 0.15 * Math.sin(performance.now() / 180)) : 0;
    g.danger += (low - g.danger) * Math.min(1, dt * 6);
    for (const [id, a] of this.aoes) {
      if (a.done || tick < a.tAct) continue;
      a.done = true;
      const y = this.y(a.x, a.z);
      this.world.effects.sparks(a.x, y + 0.2, a.z, 22, { color: [1, 0.55, 0.3], color1: [0.9, 0.15, 0.05], up: 4, spread: a.r * 2.2, gravity: 9, life: 0.5 });
      this.world.combatFx.ring(a.x, y + 0.1, a.z, a.r * 1.25, 0xff6a3a, 0.4, 0.2, 0.9);
      for (let i = 0; i < 8; i++) {
        const an = Math.random() * Math.PI * 2, d = Math.random() * a.r;
        this.world.effects.alpha.spawn(a.x + Math.cos(an) * d, y + 0.2, a.z + Math.sin(an) * d, Math.cos(an) * 1.5, 1 + Math.random(), Math.sin(an) * 1.5, { life: 1.1, size: 0.6, size1: 1.8, color: [0.45, 0.4, 0.4], alpha: 0.55, drag: 2, shape: 4, turb: 0.3, heat: 0.8 });
      }
      sfx.slam(this.vol(a.x, a.z));
      if (Math.hypot(a.x - this.ps.x, a.z - this.ps.z) < 12) this.shake(0.3);
    }
    if (this.aoes.size > 30) for (const [id, a] of this.aoes) if (a.done) this.aoes.delete(id);
  }
}

export { ENEMIES };
