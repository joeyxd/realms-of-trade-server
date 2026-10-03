// F4 debug panel (DESIGN §16, M2 fun test): live tuning of the combat numbers (applied to the local
// prediction and to the local server at once), spawns, god mode, hitboxes. The local server accepts
// these 'dev' commands; a public server never would.
import { tuning } from '../data/tuning.js';
import { ENEMIES } from '../data/enemies.js';
import { setPath } from '../net/localServer.js';
import { MSG } from '../net/protocol.js';
import { WEAPON_KINDS } from '../data/weapons.js';

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

const SLIDERS = [
  ['Espada: EXCELENTE (s antes del impacto)', 'tuning', 'sword.excellent.tc', 0.02, 0.15, 0.005],
  ['Espada: BUENO (s)', 'tuning', 'sword.good.tc', 0.05, 0.25, 0.005],
  ['Espada: POBRE (s)', 'tuning', 'sword.poor.tc', 0.1, 0.4, 0.01],
  ['Espada: EXCELENTE daño ×', 'tuning', 'sword.excellent.dmg', 1, 5, 0.1],
  ['Coyote (s)', 'tuning', 'parry.coyote', 0, 0.12, 0.005],
  ['Guardia: PERFECTA (s)', 'tuning', 'guard.perfect', 0.04, 0.3, 0.01],
  ['Guardia: daño que pasa ×', 'tuning', 'guard.blockMult', 0, 1, 0.05],
  ['Guardia: aguante', 'tuning', 'guard.stamina', 10, 150, 5],
  ['Hitstop EXCELENTE (s)', 'tuning', 'sword.excellent.hitstop', 0, 0.25, 0.01],
  ['Hitstop golpe (s)', 'tuning', 'feel.hitstopMelee', 0, 0.15, 0.005],
  ['Cámara lenta EXCELENTE ×', 'tuning', 'sword.excellent.slowmo', 0.1, 1, 0.05],
  ['Cámara lenta: duración (s)', 'tuning', 'feel.perfectSlowmoTime', 0, 0.8, 0.05],
  ['Proyectil: armado (s)', 'tuning', 'projectiles.armTime', 0, 0.4, 0.01],
  ['Roce: margen (u)', 'tuning', 'projectiles.graze', 0, 1, 0.05],
  ['Invulnerable tras golpe (s)', 'tuning', 'combat.hurtIframes', 0, 1, 0.05],
  ['Dash: recarga (s)', 'tuning', 'dash.recharge', 0.2, 2, 0.05],
  ['Arquero: vel. flecha', 'enemies', 'archer.attacks.0.speed', 4, 14, 0.5],
  ['Arquero: enfriamiento (s)', 'enemies', 'archer.attacks.0.cd', 0.6, 5, 0.1],
  ['Arquero: aviso (s)', 'enemies', 'archer.attacks.0.windup', 0.15, 1, 0.05],
  ['Centinela: aviso tajo (s)', 'enemies', 'sentinel.attacks.0.windup', 0.3, 1.5, 0.05],
  ['Centinela: vel. púas', 'enemies', 'sentinel.attacks.1.speed', 4, 14, 0.5],
];

export class DevPanel {
  constructor(root, { client, world, hud }) {
    this.root = root;
    this.client = client;
    this.world = world;
    this.hud = hud;
    this.open = false;
    this.flags = { god: false, hitboxes: false };
    root.className = 'devpanel frame-dark interactive';
    root.hidden = true;
    root.innerHTML = `
      <h3>Depuración <span class="kbd">F4</span></h3>
      <div class="dv-row dv-btns">
        <button data-op="spawn" data-kind="archer">+ Arquero</button>
        <button data-op="spawn" data-kind="sentinel">+ Centinela</button>
        <button data-op="spawn" data-kind="dummy">+ Muñeco</button>
        <button data-op="clear">Limpiar</button>
      </div>
      <div class="dv-row dv-btns">
        <button data-op="spawn" data-kind="grunt" data-n="4">+ 4 Grumetes</button>
        <button data-op="spawn" data-kind="imp">+ Diablillo</button>
        <button data-op="spawn" data-kind="shaman">+ Chamán</button>
        <button data-op="spawn" data-kind="crab">+ Cangrejo</button>
      </div>
      <div class="dv-row dv-btns">
        <button data-op="enc" data-sub="start">Prueba: iniciar</button>
        <button data-op="enc" data-sub="wave">Oleada ✓</button>
        <button data-op="enc" data-sub="boss">Jefe</button>
        <button data-op="enc" data-sub="phase2">Fase 2</button>
        <button data-op="enc" data-sub="phase3">Fase 3</button>
        <button data-op="enc" data-sub="win">Ganar</button>
        <button data-op="enc" data-sub="reset">Reiniciar</button>
      </div>
      <div class="dv-row dv-btns">
        <button data-op="heal">Curar</button>
        <button data-op="riposte">Riposte lleno</button>
        <button data-op="lvdown">Nv −</button>
        <button data-op="lvup">Nv +</button>
        <button data-op="weapon">Arma: cambiar</button>
      </div>
      <label class="dv-check"><input type="checkbox" data-flag="god"> Modo dios (sin daño)</label>
      <label class="dv-check"><input type="checkbox" data-flag="hitboxes"> Mostrar hitboxes</label>
      <div class="dv-sliders">${SLIDERS.map(([label, rootName, path, min, max, step], i) => `
        <label class="dv-slider"><span>${label} <b data-v="${i}"></b></span>
        <input type="range" data-i="${i}" min="${min}" max="${max}" step="${step}"></label>`).join('')}
      </div>
      <p class="dv-note">Los cambios se aplican al momento (cliente y servidor local). Se pierden al recargar.</p>`;
    root.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.button(b.dataset)));
    root.querySelectorAll('input[data-flag]').forEach((el) => el.addEventListener('change', () => this.flag(el.dataset.flag, el.checked)));
    root.querySelectorAll('input[data-i]').forEach((el) => el.addEventListener('input', () => this.slide(+el.dataset.i, +el.value)));
    for (const el of root.querySelectorAll('button, input')) el.addEventListener('keydown', (e) => e.stopPropagation());
  }

  send(op, extra = {}) { this.client.send({ t: MSG.CMD, type: 'dev', op, ...extra }); }

  toggle() {
    this.open = !this.open;
    this.root.hidden = !this.open;
    if (this.open) this.refresh();
  }

  refresh() {
    this.root.querySelectorAll('input[data-i]').forEach((el) => {
      const [, rootName, path] = SLIDERS[+el.dataset.i];
      const v = get(rootName === 'enemies' ? ENEMIES : tuning, path);
      el.value = v;
      this.root.querySelector(`b[data-v="${el.dataset.i}"]`).textContent = (+v).toFixed(3).replace(/\.?0+$/, '');
    });
  }

  button(d) {
    const ps = this.client.pred.ecs, e = this.client.youLocal;
    switch (d.op) {
      case 'spawn': { const n = +d.n || 1; for (let i = 0; i < n; i++) this.send('spawn', { kind: d.kind, dist: d.kind === 'sentinel' ? 9 : 8, ang: ps.facing[e] + (i - (n - 1) / 2) * 0.45 }); break; }
      case 'clear': this.send('clear'); break;
      case 'enc': this.send('enc', { sub: d.sub }); break;
      case 'heal': this.send('heal'); break;
      case 'riposte': this.send('riposte'); break;
      case 'lvup': this.send('level', { level: (ps.level[e] || 1) + 1 }); break;
      case 'lvdown': this.send('level', { level: Math.max(1, (ps.level[e] || 1) - 1) }); break;
      case 'weapon': this.send('weapon', { weapon: ((ps.weapon[e] | 0) + 1) % WEAPON_KINDS.length }); break;
      default: break;
    }
  }

  flag(name, on) {
    this.flags[name] = on;
    if (name === 'god') this.send('god', { on });
  }

  slide(i, value) {
    const [, rootName, path] = SLIDERS[i];
    const obj = rootName === 'enemies' ? ENEMIES : tuning;
    if (setPath(obj, path, value)) this.send('tune', { root: rootName, path, value });
    this.root.querySelector(`b[data-v="${i}"]`).textContent = String(+value.toFixed(3));
  }
}
