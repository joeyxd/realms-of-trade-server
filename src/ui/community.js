// Community projects use private server receipts; the panel never edits a profile locally.
import { GOODS } from '../data/goods.js';
import { t, formatNumber, messageKey, onLocaleChange, translateData } from '../core/i18n.js';

const fmt = (value) => formatNumber(Math.max(0, Number.isFinite(value) ? value : 0));
const REASONS = {
  schema: 'La solicitud no es válida. Revisa el material y la cantidad.',
  amount: 'Elige una cantidad entre 1 y 500.',
  materials: 'No llevas ese material en la mochila.',
  pack: 'La mochila no está disponible.',
  account_required: 'Vincula una cuenta para participar en obras duraderas.',
  storage: 'El guardado comunitario no está disponible ahora.',
  busy: 'Ya hay una acción pendiente. Espera su respuesta.',
  duplicate: 'La solicitud ya corresponde a otra acción.',
  far: 'Acércate al banco de materiales para aportar.',
  combat: 'Espera a que termine el combate para aportar.',
  dead: 'No puedes aportar mientras estás derrotado.',
  revision: 'La obra cambió. Revisa su avance e inténtalo otra vez.',
  conflict: 'La obra o tu mochila cambió. Consulta el estado actual e inténtalo otra vez.',
  scope: 'Este aporte ya no coincide con el mundo actual. Consulta el avance de nuevo.',
  command: 'La solicitud no es válida. Consulta la obra y vuelve a intentarlo.',
  material: 'La obra no necesita ese material.',
  goods: 'Ya no llevas suficiente material. Revisa tu mochila.',
  complete: 'Esta obra ya está completa.',
  project: 'La obra ya no está disponible.',
  land: 'Desembarca para participar en la obra.',
  disabled: 'La obra comunitaria aún no está disponible en este mundo.',
  world_format: 'No se pudo leer el avance guardado de esta obra.',
};

function call(getter, fallback = null) { try { return typeof getter === 'function' ? getter() : fallback; } catch { return fallback; } }

export function communityReason(why) {
  return REASONS[why] ? t(`systems.community.reason.${why}`) : t('systems.community.unknown');
}

function amountMap(value) {
  const entries = Array.isArray(value) ? value.map((row) => [row?.good, row?.amount ?? row?.count]) : Object.entries(value || {});
  const out = {};
  for (const [good, amount] of entries) if (typeof good === 'string' && Number.isSafeInteger(amount) && amount >= 0) out[good] = amount;
  return out;
}

export function communityRows(project, profile) {
  const requirements = amountMap(project?.requirements), contributed = amountMap(project?.contributed);
  const goods = profile?.eco?.pack?.goods || {};
  return Object.entries(requirements).map(([good, required]) => {
    const current = Math.min(required, contributed[good] || 0);
    return { good, name: translateData(GOODS[good]?.name || good), required, current, remaining: required - current,
      owned: Number.isSafeInteger(goods[good]) && goods[good] > 0 ? goods[good] : 0,
      percent: required > 0 ? Math.round(current / required * 100) : 100 };
  });
}

function projectMarkup(project) {
  return `<div class="community-rows" data-project-rows></div>`;
}

export class CommunityPanel {
  constructor({ parent, profile, context, enabled, submit, onContext }) {
    Object.assign(this, { parent, profile, context, enabled, submitCommand: submit, onContext });
    this.active = false; this.pending = null; this.project = null; this.durable = null;
    this.status = ''; this.loadId = null; this.loadSentAt = 0; this.lastView = null; this.qty = 1; this.good = '';
    this.root = document.createElement('section'); this.root.className = 'community-panel'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'false'); this.root.setAttribute('aria-label', t('systems.community.title'));
    this.root.innerHTML = `<header class="community-head"><div class="community-mark" aria-hidden="true">✦</div><div><small>${t('systems.community.kicker')}</small><h2>${t('systems.community.title')}</h2></div><button type="button" data-close aria-label="${t('systems.community.close')}">×</button></header>
      <div class="community-body"><p class="community-intro">${t('systems.community.intro')}</p>
      <section class="community-project" aria-live="polite"><div class="community-project-name" data-project-name>${t('systems.community.loadingProject')}</div><div data-project-list>${projectMarkup()}</div></section>
      <section class="community-give"><label for="community-good">${t('systems.community.materialLabel')}</label><select id="community-good" data-good></select><div class="community-owned" data-owned></div>
      <label for="community-qty">${t('systems.community.quantityLabel')}</label><input id="community-qty" data-qty type="number" inputmode="numeric" min="1" max="500" step="1" value="1">
      <button type="button" class="community-contribute" data-contribute>${t('systems.community.contribute')}</button></section>
      <p class="community-status" data-status aria-live="polite"></p><button type="button" class="community-retry" data-retry hidden>${t('systems.community.retry')}</button>
      <button type="button" class="community-refresh" data-refresh>${t('systems.community.refresh')}</button></div>`;
    parent.appendChild(this.root); this.$ = (selector) => this.root.querySelector(selector); this.bind(); this.update();
    this.unsubscribeLocale = onLocaleChange(() => { this.lastView = null; this.renderLabels(); this.update(); });
  }

  renderLabels() {
    this.root.setAttribute('aria-label', t('systems.community.title'));
    this.$('.community-head small').textContent = t('systems.community.kicker');
    this.$('.community-head h2').textContent = t('systems.community.title');
    this.$('[data-close]').setAttribute('aria-label', t('systems.community.close'));
    this.$('.community-intro').textContent = t('systems.community.intro');
    this.$('label[for="community-good"]').textContent = t('systems.community.materialLabel');
    this.$('label[for="community-qty"]').textContent = t('systems.community.quantityLabel');
  }

  bind() {
    this.root.addEventListener('keydown', (event) => {
      if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
      else if (event.code === 'Enter' && event.target.matches('[data-qty]')) { event.preventDefault(); event.stopPropagation(); this.contribute(); }
    });
    this.$('[data-close]').addEventListener('click', () => this.close());
    this.$('[data-refresh]').addEventListener('click', () => this.list());
    this.$('[data-contribute]').addEventListener('click', () => this.contribute());
    this.$('[data-retry]').addEventListener('click', () => this.retry());
    this.$('[data-good]').addEventListener('change', (event) => { this.good = event.currentTarget.value; this.update(); });
    this.$('[data-qty]').addEventListener('input', (event) => { this.qty = event.currentTarget.value === '' ? 0 : Number(event.currentTarget.value); this.update(); });
  }

  contextNow() { return call(this.context); }
  canUse() { return this.enabled?.() === true && !!this.contextNow(); }
  open() {
    if (!this.canUse()) return false;
    this.active = true; this.root.hidden = false; this.notifyContext(true); this.list(); this.update(); this.$('[data-close]').focus({ preventScroll: true }); return true;
  }
  close() { if (!this.active && this.root.hidden) return; this.active = false; this.root.hidden = true; this.notifyContext(false); }
  notifyContext(active) { if (this._contextNotified === active) return; this._contextNotified = active; this.onContext?.(active); }

  list() {
    if (!this.active || !this.canUse() || this.pending || (this.loadId && performance.now() - this.loadSentAt < 5000)) return false;
    const opId = globalThis.crypto.randomUUID(); this.loadId = opId; this.loadSentAt = performance.now(); this.project = null; this.durable = null; this.status = t('systems.community.loadingSaved');
    let sent = false; try { sent = this.submitCommand?.({ t: 'cmd', type: 'community', op: 'list', opId }) === true; } catch {}
    if (!sent) { this.loadId = null; this.status = t('systems.community.noConnection'); this.update(); return false; }
    this.update(); return true;
  }

  update() {
    const ctx = this.contextNow();
    if (this.active && (!ctx || this.enabled?.() !== true)) this.close();
    const profile = ctx?.profile || call(this.profile), rows = communityRows(this.project, profile);
    const held = profile?.eco?.pack?.goods || {};
    const choices = rows.filter((row) => row.remaining > 0 && row.owned > 0);
    if (!choices.some((row) => row.good === this.good)) this.good = choices[0]?.good || '';
    const input = this.$('[data-qty]'), select = this.$('[data-good]');
    const p = this.pending, retryReady = p && performance.now() - p.sentAt >= 5000;
    const loadReady = this.loadId && performance.now() - this.loadSentAt >= 5000;
    const selected = choices.find((row) => row.good === this.good);
    const view = JSON.stringify([this.active, this.project, this.durable, this.status, p?.command.opId, p?.sentAt, this.loadId, loadReady, retryReady, this.good, this.qty, choices, !!ctx, held]);
    if (view === this.lastView) return;
    this.lastView = view;
    if (document.activeElement !== input && input.value !== String(this.qty)) input.value = String(this.qty);
    input.max = String(Math.min(500, selected?.owned || 500));
    const prior = select.value;
    select.replaceChildren(...choices.map((row) => { const option = document.createElement('option'); option.value = row.good; option.textContent = row.name; return option; }));
    if (choices.some((row) => row.good === (prior || this.good))) select.value = prior || this.good;
    select.disabled = !ctx || !!this.pending || !choices.length;
    input.disabled = !ctx || !!this.pending || !choices.length;
    this.$('[data-owned]').textContent = selected ? t('systems.community.backpack', { owned: fmt(selected.owned), remaining: fmt(selected.remaining) }) : t('systems.community.noUsefulMaterials');
    this.$('[data-project-name]').textContent = this.project?.name || (this.project ? t('systems.community.projectName') : this.status ? t('systems.community.title') : t('systems.community.loadingProject'));
    const list = this.$('[data-project-rows]');
    if (!this.project) list.innerHTML = `<p class="community-empty">${this.durable === false ? t('systems.community.empty') : t('systems.community.waitingRequirements')}</p>`;
    else if (!rows.length) list.innerHTML = `<p class="community-empty">${t('systems.community.noMaterials')}</p>`;
    else list.innerHTML = rows.map((row) => `<div class="community-row"><div><span>${row.name}</span><b>${fmt(row.current)} / ${fmt(row.required)}</b></div><div class="community-track" role="progressbar" aria-label="${row.name}" aria-valuemin="0" aria-valuemax="${row.required}" aria-valuenow="${row.current}"><i style="width:${row.percent}%"></i></div><small>${t('systems.community.rowBackpack', { owned: fmt(row.owned), remaining: fmt(row.remaining) })}</small></div>`).join('');
    const canContribute = !!selected && Number.isSafeInteger(this.qty) && this.qty >= 1 && this.qty <= 500 && this.qty <= selected.owned;
    this.$('[data-contribute]').disabled = !ctx || !!p || !!this.loadId || !canContribute;
    this.$('[data-contribute]').textContent = p?.command.op === 'contribute' ? t('systems.community.waiting') : t('systems.community.contribute');
    this.$('[data-refresh]').disabled = !!p || !ctx || (!!this.loadId && !loadReady);
    this.$('[data-refresh]').textContent = this.loadId ? (loadReady ? t('systems.community.refreshAgain') : t('systems.community.loading')) : t('systems.community.refresh');
    this.$('[data-retry]').hidden = !retryReady || p?.command.op !== 'contribute';
    this.$('[data-retry]').disabled = !retryReady || !ctx;
    this.$('[data-status]').textContent = p?.command.op === 'contribute' ? t('systems.community.validating') : this.translateStatus(this.status);
    this.root.classList.toggle('is-pending', !!p);
  }

  translateStatus(value) {
    const data = this.statusTextData;
    if (data && value === data.value) return t(data.key, { accepted: fmt(data.accepted), good: translateData(data.good) });
    const reason = Object.keys(REASONS).find((key) => REASONS[key] === value);
    if (reason) return communityReason(reason);
    const key = messageKey(value);
    return key ? t(key) : value;
  }

  contribute() {
    const ctx = this.contextNow(), rows = communityRows(this.project, ctx?.profile || call(this.profile));
    const selected = rows.find((row) => row.good === this.good);
    if (this.pending || this.loadId || !this.active || !ctx || !selected || !Number.isSafeInteger(this.qty) || this.qty < 1 || this.qty > 500 || this.qty > selected.owned || !this.project?.id || !Number.isSafeInteger(this.project.version)) return false;
    const command = Object.freeze({ t: 'cmd', type: 'community', op: 'contribute', opId: globalThis.crypto.randomUUID(), projectId: this.project.id,
      good: this.good, amount: this.qty, expectedRev: this.project.version });
    this.pending = { command, sentAt: performance.now() }; this.status = '';
    let sent = false; try { sent = this.submitCommand?.(command) === true; } catch {}
    if (!sent) { this.pending = null; this.status = t('systems.community.sendFailed'); this.update(); return false; }
    this.update(); return true;
  }

  retry() {
    const pending = this.pending;
    if (!pending || pending.command.op !== 'contribute' || performance.now() - pending.sentAt < 5000 || !this.canUse()) return false;
    let sent = false; try { sent = this.submitCommand?.(pending.command) === true; } catch {}
    if (sent) pending.sentAt = performance.now();
    this.update(); return sent;
  }

  onResult(ev) {
    if (!ev || ev.type !== 'community') return;
    if (ev.op === 'list' && ev.opId === this.loadId) {
      this.loadId = null;
      if (ev.ok === false) { this.status = communityReason(ev.why); this.update(); return; }
      if (ev.historical || ev.replay) { this.status = 'La respuesta recuperada no sustituye el estado actual. Consulta de nuevo.'; this.update(); return; }
      this.project = ev.project || null; this.durable = ev.durable === true; this.status = this.durable ? 'Avance duradero del mundo compartido.' : 'Esta obra no tiene guardado duradero.';
      this.update(); return;
    }
    const pending = this.pending;
    if (!pending || ev.op !== 'contribute' || ev.opId !== pending.command.opId) return;
    this.pending = null;
    if (ev.ok === false) { this.status = communityReason(ev.why); this.update(); return; }
    if (ev.historical || ev.replay) {
      this.status = 'El aporte quedó registrado; consulto el avance actual antes de mostrarlo.';
      this.update(); this.list(); return;
    }
    const accepted = Number.isSafeInteger(ev.accepted) && ev.accepted >= 0 ? ev.accepted : null;
    if (ev.project) this.project = ev.project;
    this.durable = ev.durable === true;
    this.statusTextData = accepted > 0 ? { value: '', key: 'systems.community.confirmed', accepted, good: GOODS[pending.command.good]?.name || pending.command.good } : null;
    this.status = accepted === null ? 'Respuesta incompleta del servidor; consulta el avance actual.' : accepted > 0
      ? (this.statusTextData.value = t(this.statusTextData.key, { accepted: fmt(accepted), good: translateData(this.statusTextData.good) }))
      : 'La obra ya no necesita más de ese material.';
    this.update();
    if (accepted === null || !ev.project) this.list();
  }

  dispose() { this.unsubscribeLocale?.(); this.close(); this.root.remove(); }
}
