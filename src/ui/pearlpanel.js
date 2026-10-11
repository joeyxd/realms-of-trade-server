import { PEARLS, PEARL } from '../data/pearls.js';
import { SKILLS } from '../data/weapons.js';
import { tuning } from '../data/tuning.js';
import { skillIcon } from './hud.js';
import { esc } from './itemui.js';
import { dataText, rich, text as ltext, formatNumber } from '../core/i18n.js';

export function pearlHtml(p, _confirmation, nearby = []) {
  const ps = p.pearls || { swallowed: null, bag: [] }, power = ps.swallowed && PEARLS[ps.swallowed.kind];
  const card = (pearl, swallowed = false) => {
    const P = PEARLS[pearl.kind] || { name: 'Perla negra', skill: '', color: '#aa70ed', passive: '', curse: '' }, S = SKILLS[P.skill] || {}, uid = esc(pearl.uid);
    const n = (v) => Number.isFinite(v) ? formatNumber(v, { maximumFractionDigits: 2 }) : '—';
    const numbers = P.skill === 'inkcloud'
      ? rich('adventure.pearl_stats_ink', { range: n(S.range), radius: n(S.r), duration: n(S.dur), cooldown: n(S.cd) })
      : P.skill === 'iceanchor'
        ? rich('adventure.pearl_stats_ice', { range: n(S.range), radius: n(S.r), duration: n(S.dur), slow: Number.isFinite(S.slow) ? Math.round((1 - S.slow) * 100) : '—', cooldown: n(S.cd) })
        : P.skill === 'mastbolt'
          ? rich('adventure.pearl_stats_storm', { charge: n(S.charge), targets: Number.isFinite(S.jumps) ? 2 + S.jumps : '—', cooldown: n(S.cd), range: n(S.range), jump: n(S.chainR) })
          : rich('adventure.pearl_stats_generic', { distance: n(S.dist), multiplier: n(S.mult), cooldown: n(S.cd) });
    const actions = swallowed ? `<p class="cp-hint"><b>${ltext('adventure.pearl_stays_hint')}</b> ${ltext('adventure.pearl_cannot_replace_hint')}</p>` :
      `<button class="btn" data-pearl-op="swallow" data-pearl-uid="${uid}"${ps.swallowed ? ' disabled title="Ya tienes una perla tragada" data-l10n-title="adventure.pearl_has_swallowed_title"' : ''}>${ltext(ps.swallowed ? 'adventure.pearl_swallow_locked' : 'adventure.pearl_swallow_action')}</button>
       <button class="btn secondary" data-pearl-op="leave" data-pearl-uid="${uid}">${ltext('adventure.pearl_drop_action')}</button>
       ${nearby.length ? `<label class="pearl-give">${ltext('adventure.pearl_give_label')} <select data-pearl-target="${uid}">${nearby.map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join('')}</select><button class="btn secondary" data-pearl-op="give" data-pearl-uid="${uid}">${ltext('adventure.pearl_give_action')}</button></label>` : ''}`;
    return `<article class="pearl-card${swallowed ? ' swallowed' : ''}" style="--pearl:${P.color}">
      <div class="tt-head"><span class="tt-ico">${skillIcon(P.skill)}</span><div><b>${dataText(P.name)}</b><small>${ltext(swallowed ? 'adventure.pearl_title_swallowed' : 'adventure.pearl_title_bag')}</small></div></div>
      <p><b>G · ${dataText(S.name || P.name)}</b>${S.hint ? ` — ${dataText(S.hint)}` : ''}. ${numbers}.</p>
      <p><b>${ltext('adventure.pearl_passive')}</b> ${dataText(P.passive)}</p><p class="pearl-curse"><b>${ltext('adventure.pearl_curse')}</b> ${dataText(P.curse)}</p>
      <div class="pearl-actions">${actions}</div></article>`;
  };
  return `<div class="cp-pearls"><p class="cp-hint">${rich('adventure.pearl_intro_full', { loss: Math.round(tuning.combat.deathXpLoss * 100) })}</p>
    <h4>${ltext('adventure.pearl_fate')}</h4>${power ? card(ps.swallowed, true) : `<p class="pearl-empty">${ltext('adventure.pearl_empty_swallowed')}</p>`}
    <h4>${ltext('adventure.pearl_bag_count', { current: ps.bag.length, max: PEARL.bag })}</h4>
    ${ps.bag.length ? `<div class="pearl-list">${ps.bag.map((q) => card(q)).join('')}</div>` : `<p class="pearl-empty">${ltext('adventure.pearl_empty_bag')}</p>`}
    <p class="cp-hint">${rich('adventure.pearl_rules')}</p></div>`;
}
