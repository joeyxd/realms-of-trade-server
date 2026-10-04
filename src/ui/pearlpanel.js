import { PEARLS, PEARL } from '../data/pearls.js';
import { SKILLS } from '../data/weapons.js';
import { skillIcon } from './hud.js';
import { esc } from './itemui.js';

export function pearlHtml(p, confirmation, nearby = []) {
  const ps = p.pearls || { swallowed: null, bag: [] }, power = ps.swallowed && PEARLS[ps.swallowed.kind];
  const card = (pearl, swallowed = false) => {
    const P = PEARLS[pearl.kind], S = SKILLS[P.skill], uid = esc(pearl.uid);
    const numbers = P.skill === 'iceanchor'
      ? `Alcance ${S.range} u · radio ${S.r} u · ${S.dur} s · ralentiza ${Math.round((1 - S.slow) * 100)} % · recarga ${S.cd} s`
      : `${S.dist} u · ATK × ${S.mult} · recarga ${S.cd} s`;
    const confirming = confirmation?.uid === pearl.uid && confirmation.replaceUid === ps.swallowed?.uid;
    const actions = swallowed ? '<button class="btn secondary" data-pearl-op="spit">Escupir al suelo</button>' :
      `<button class="btn" data-pearl-op="swallow" data-pearl-uid="${uid}">${confirming ? 'Confirmar: soltar la anterior y tragar' : 'Tragar'}</button>
       <button class="btn secondary" data-pearl-op="leave" data-pearl-uid="${uid}">Dejar en el suelo</button>
       <button class="btn secondary" data-pearl-op="sell" data-pearl-uid="${uid}">Vender a Tía Perla · ${PEARL.value} oro</button>
       ${nearby.length ? `<label class="pearl-give">Entregar a <select data-pearl-target="${uid}">${nearby.map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join('')}</select><button class="btn secondary" data-pearl-op="give" data-pearl-uid="${uid}">Entregar</button></label>` : ''}`;
    return `<article class="pearl-card${swallowed ? ' swallowed' : ''}" style="--pearl:${P.color}">
      <div class="tt-head"><span class="tt-ico">${skillIcon(P.skill)}</span><div><b>${esc(P.name)}</b><small>${swallowed ? 'Tragada · poder en G' : 'Rara · sin tragar'}</small></div></div>
      <p><b>G · ${esc(S.name)}</b> — ${esc(S.hint)}. ${numbers}.</p>
      <p><b>Pasiva:</b> ${esc(P.passive)}</p><p class="pearl-curse"><b>Maldición:</b> ${esc(P.curse)}</p>
      ${confirming ? '<p class="pearl-confirm" role="alert">La perla que llevas dentro caerá al suelo y cualquiera podrá recogerla. Pulsa de nuevo para confirmar.</p><button class="btn secondary" data-pearl-op="cancel">Cancelar</button>' : ''}
      <div class="pearl-actions">${actions}</div></article>`;
  };
  return `<div class="cp-pearls"><p class="cp-hint">Una perla tragada te da un poder y una maldición. <b>Al morir caen todas tus perlas</b>, incluso fuera de la Cala. Cualquiera puede recogerlas; tras 90 s sin dueño vuelven a una playa.</p>
    <h4>Tu destino</h4>${power ? card(ps.swallowed, true) : '<p class="pearl-empty">Aún no has tragado una perla. Busca botín de élites, HELLFIRE y cofres de Marea.</p>'}
    <h4>En la bolsa · ${ps.bag.length}/${PEARL.bag}</h4>
    ${ps.bag.length ? `<div class="pearl-list">${ps.bag.map((q) => card(q)).join('')}</div>` : '<p class="pearl-empty">No llevas perlas sin tragar.</p>'}
    <p class="cp-hint">Tragar, escupir o entregar: fuera de combate. Vender: junto al puesto de Tía Perla. <b>G</b> en teclado · cruceta abajo en mando · botón del poder en móvil.</p></div>`;
}
