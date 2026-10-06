// Talking to people (M4): the server says what they have for you (talk event: quests to take, quests to hand
// in, the stall; Doña Sepia's «Tatuar», M4.7) and this card offers it. Accepting or handing in is a `cmd`; the answer comes back as quest
// events and a new profile.
import { gsap } from 'gsap';
import { QUESTS, NPC_TALK } from '../data/quests.js';
import { sfx } from '../audio/sfx.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reward = (R = {}) => [R.xp && `${R.xp} XP`, R.gold && `${R.gold} oro`, R.potions && `${R.potions} ${R.potions > 1 ? 'pociones' : 'poción'}`, R.item && 'un objeto'].filter(Boolean).join(' · ');

export class Dialog {
  constructor(root, { send, onShop, onTattoo, onMarket }) {
    Object.assign(this, { root, send, onShop, onTattoo, onMarket });
    this.isOpen = false;
    this.ev = null;
    this.focus = null; // a quest being read before accepting
    root.addEventListener('click', (e) => this.onClick(e));
  }

  // ev: {npc, ent, offer: [ids], ready: [ids], shop}; line: what they said this time.
  show(ev, line) {
    const fresh = !this.isOpen || !this.ev || this.ev.npc !== ev.npc;
    this.ev = ev; this.line = line; this.focus = null;
    this.render();
    this.root.hidden = false;
    this.isOpen = true;
    if (fresh) gsap.fromTo(this.root.querySelector('.dlg'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'back.out(2)' });
  }
  hide() { this.isOpen = false; this.ev = null; this.root.hidden = true; }

  render() {
    const ev = this.ev, T = NPC_TALK[ev.npc] || { name: '?', quests: {} };
    let text = this.line || '', opts = '';
    if (this.focus) {
      const Q = QUESTS[this.focus], say = T.quests && T.quests[this.focus];
      text = `${say && say.offer ? esc(say.offer) : ''}<span class="dlg-q"><b>${esc(Q.name)}</b>${esc(Q.text)}${reward(Q.reward) ? `<small>Recompensa: ${reward(Q.reward)}</small>` : ''}</span>`;
      opts = `<button class="btn" data-accept="${this.focus}">Aceptar</button><button class="btn secondary" data-back>Ahora no</button>`;
    } else {
      const ready = ev.ready.map((id) => {
        const say = T.quests && T.quests[id];
        if (say && say.ready) text = esc(say.ready);
        return `<button class="btn" data-turnin="${id}">Entregar: ${esc(QUESTS[id].name)}</button>`;
      }).join('');
      const offer = ev.offer.map((id) => `<button class="btn" data-read="${id}">Misión: ${esc(QUESTS[id].name)}</button>`).join('');
      const shop = ev.shop ? '<button class="btn" data-shop>Comerciar</button>' : '';
      const ink = T.tattoo ? '<button class="btn" data-tattoo>Tatuar</button>' : '';
      const market = T.market ? '<button class="btn" data-market>Comerciar mercancías</button>' : '';
      opts = `${ready}${offer}${shop}${ink}${market}<button class="btn secondary" data-bye>Adiós</button>`;
    }
    this.root.innerHTML = `<div class="dlg frame interactive" role="dialog" aria-label="${esc(T.name)}">
      <div class="dlg-who outlined">${esc(T.name)}</div><p class="dlg-line">${text}</p><div class="dlg-opts">${opts}</div></div>`;
  }

  onClick(e) {
    const t = e.target, ev = this.ev;
    if (!ev) return;
    const pick = (attr) => { const el = t.closest(`[${attr}]`); return el ? el.getAttribute(attr) : null; };
    let id;
    if ((id = pick('data-read'))) { this.focus = id; this.render(); sfx.click(); }
    else if ((id = pick('data-accept'))) { this.send({ type: 'quest', op: 'accept', id }); ev.offer = ev.offer.filter((q) => q !== id); this.focus = null; this.render(); }
    else if ((id = pick('data-turnin'))) { this.send({ type: 'quest', op: 'turnin', id }); ev.ready = ev.ready.filter((q) => q !== id); this.render(); }
    else if (t.closest('[data-back]')) { this.focus = null; this.render(); sfx.click(); }
    else if (t.closest('[data-shop]')) { this.hide(); this.onShop(); }
    else if (t.closest('[data-tattoo]')) { this.hide(); if (this.onTattoo) this.onTattoo(); }
    else if (t.closest('[data-market]')) { const town = NPC_TALK[ev.npc]?.market; this.hide(); if (town) this.onMarket?.(town); }
    else if (t.closest('[data-bye]')) { this.hide(); sfx.click(); }
  }
}
