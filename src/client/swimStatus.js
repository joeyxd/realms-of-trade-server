import { catalogs, getLocale, t } from '../core/i18n.js';
import { tuning } from '../data/tuning.js';

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function swimStatusState(current = {}) {
  const maxStamina = Math.max(0, number(tuning.swim.stamina, 30));
  const graceDuration = Math.max(0, number(tuning.swim.grace, 5));
  const stamina = Math.max(0, Math.min(maxStamina, number(current.swimStamina)));
  const drowned = Math.max(0, number(current.swimDrown));
  const load = Math.max(0, Math.min(1, number(current.swimLoad)));
  const swimming = current.swim === 1 || current.swim === true || current.st === 2;
  const exhausted = swimming && stamina <= 0, dead = number(current.dead) > 0;
  return Object.freeze({
    visible: swimming && !dead,
    maxStamina,
    stamina,
    percent: maxStamina > 0 ? Math.round(stamina / maxStamina * 100) : 0,
    low: swimming && !exhausted && stamina <= maxStamina * 0.25,
    exhausted,
    drowned: exhausted ? drowned : 0,
    grace: graceDuration,
    graceRemaining: exhausted ? Math.max(0, graceDuration - drowned) : 0,
    drowning: exhausted && drowned >= graceDuration,
    brasa: swimming && Number(current.elem) === 1,
    loaded: swimming && load > 0.001,
    loadPercent: Math.round(load * 100),
  });
}

export function swimStatusCopy(state, locale = undefined) {
  if (!state?.visible) return Object.freeze({ title: '', warning: '', brasa: '', load: '', advice: '' });
  const language = typeof locale === 'function' ? locale() : locale || getLocale();
  const localized = (key, params = {}) => {
    const pair = catalogs[key];
    if (!pair) return t(key, params);
    return String(pair[String(language).toLowerCase().startsWith('en') ? 1 : 0] ?? pair[0])
      .replace(/\{([A-Za-z0-9_]+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
  };
  const copy = { title: localized('swim.title'), low: localized('swim.low'),
    exhausted: localized('swim.exhausted', { seconds: Math.ceil(state.graceRemaining) }),
    drowning: localized('swim.drowning'), brasa: localized('swim.brasa'),
    load: localized('swim.load'), advice: localized('swim.advice') };
  return Object.freeze({ title: copy.title,
    warning: state.drowning ? copy.drowning : state.exhausted ? copy.exhausted : state.low ? copy.low : '',
    brasa: state.brasa ? copy.brasa : '', load: state.loaded ? copy.load : '', advice: copy.advice });
}

export class SwimStatus {
  constructor(parent, { locale = () => document.documentElement.lang || 'es' } = {}) {
    if (!parent?.appendChild) throw new TypeError('SwimStatus needs a parent element.');
    this.locale = locale;
    this.root = parent.ownerDocument.createElement('aside');
    this.root.className = 'mn-swim-status';
    this.root.hidden = true;
    this.root.setAttribute('role', 'status');
    this.root.innerHTML = `<style>
      .mn-swim-status{position:fixed;z-index:24;left:50%;bottom:max(1rem,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(22rem,calc(100vw - 2rem));padding:.65rem .8rem;border:1px solid #9acbd6aa;border-radius:.75rem;background:#09212beF;color:#f4f3e8;font:600 13px/1.35 system-ui,sans-serif;box-shadow:0 5px 22px #00101680;pointer-events:none}
      .mn-swim-status[hidden]{display:none}.mn-swim-status header{display:flex;justify-content:space-between;gap:.7rem}.mn-swim-status progress{display:block;width:100%;height:.55rem;margin:.38rem 0 .24rem;accent-color:#58d5dc}.mn-swim-status.is-low progress{accent-color:#ffc45d}.mn-swim-status.is-exhausted progress,.mn-swim-status.is-drowning progress{accent-color:#ff7669}.mn-swim-status.is-brasa{border-color:#f78b60}.mn-swim-status .warning{color:#ffd070}.mn-swim-status .danger{color:#ff9a78}.mn-swim-status footer{display:flex;flex-wrap:wrap;gap:.15rem .7rem;opacity:.92}
      @media(max-width:600px){.mn-swim-status{bottom:max(5.2rem,env(safe-area-inset-bottom));font-size:12px}}
    </style><header><span data-title></span><b data-value></b></header><progress max="100" value="100" data-meter></progress><div class="warning" data-warning></div><footer><span class="danger" data-brasa></span><span data-load></span><span data-advice></span></footer>`;
    parent.appendChild(this.root);
  }

  update(current) {
    const state = swimStatusState(current), copy = swimStatusCopy(state, this.locale);
    this.root.hidden = !state.visible;
    if (!state.visible) return state;
    this.root.querySelector('[data-title]').textContent = copy.title;
    const seconds = Math.ceil(state.stamina);
    this.root.querySelector('[data-value]').textContent = t('swim.secondsShort', { seconds });
    const meter = this.root.querySelector('[data-meter]');
    meter.value = state.percent;
    meter.setAttribute('aria-label', copy.title);
    meter.setAttribute('aria-valuetext', t('swim.ariaValue', { seconds }));
    const warning = this.root.querySelector('[data-warning]');
    warning.textContent = copy.warning; warning.classList.toggle('danger', state.exhausted);
    this.root.classList.toggle('is-low', state.low);
    this.root.classList.toggle('is-exhausted', state.exhausted);
    this.root.classList.toggle('is-drowning', state.drowning);
    this.root.classList.toggle('is-brasa', state.brasa);
    this.root.querySelector('[data-brasa]').textContent = copy.brasa;
    this.root.querySelector('[data-load]').textContent = copy.load;
    this.root.querySelector('[data-advice]').textContent = copy.advice;
    return state;
  }

  dispose() { this.root.remove(); }
}
