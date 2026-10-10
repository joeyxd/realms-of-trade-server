// Personal raft-storage lesson. Eligibility and completion are always read from confirmed authority.
import { ARTISAN } from '../data/artisan.js';
import { LOGGING, LOGGING_LESSON } from '../data/progression.js';
import { RAFT_PARTS } from '../data/raftparts.js';
import { loggingStatus } from '../sim/systems/progression.js';

const COPY = {
  es: {
    title: 'Artesana de Salty Shore', eyebrow: 'BANCO DE CARPINTERÍA', close: 'Cerrar lección',
    intro: 'Aprende una nueva receta personal para tu balsa.', spec: (learn, build, hold) => `Lección: ${learn} maderas · Construcción: ${build} maderas · Capacidad: +${hold}`,
    practiceLabel: 'Tala', projectLabel: 'Obra comunitaria', wood: 'Madera en tu mochila', woodGoodLabel: 'Madera', stoneGoodLabel: 'Piedra',
    learn: 'Aprender: Bodega', learnedSuccess: 'Receta aprendida. Ya puedes construir una bodega.',
    known: 'Ya conoces esta receta.', lessonLocked: 'Necesitas completar 60 puntos de tala primero.',
    projectIncomplete: 'La obra de carpintería aún no está completa.', projectComplete: 'Carpintería comunitaria completa', woodLocked: n => `Lleva ${n} maderas en tu mochila para recibir la lección.`,
    progress: (n, max) => `${n} / ${max} puntos`, projectProgress: (n, max) => `${n} / ${max} materiales`,
    noProject: 'No se pudo consultar la obra comunitaria.', notDurable: 'Esta obra no tiene guardado duradero en este mundo.',
    loading: 'Consultando los requisitos…', ready: 'Cumples los requisitos para aprender.',
    waiting: 'Enviando solicitud…', waitingProfile: 'Lección recibida; esperando que se actualice tu perfil…',
    recovered: 'Respuesta recuperada. Revisa tu perfil y vuelve a consultar antes de intentarlo otra vez.',
    retry: 'Reenviar la misma solicitud', community: 'Aportar a la obra', refresh: 'Consultar de nuevo',
    send: 'No se pudo enviar la solicitud. Inténtalo otra vez.',
    account_required: 'Vincula una cuenta para aprender recetas duraderas.', storage: 'El servidor no pudo confirmar el guardado. Vuelve a conectar.',
    busy: 'Ya hay una acción pendiente. Espera su respuesta.', far: 'Acércate al banco de carpintería.', bench: 'El banco no está disponible en este mundo.',
    dead: 'No puedes aprender mientras estás derrotado.', combat: 'Espera a que termine el combate.',
    lesson: 'No cumples los requisitos de esta lección.', practice: 'Necesitas llegar a 60 puntos de tala.',
    learned: 'Ya conoces esta receta.', goods: 'No llevas las maderas necesarias.',
    project: 'La obra comunitaria todavía no está completa.', materials: 'No llevas las maderas necesarias.',
    revision: 'El estado cambió. Consulta de nuevo antes de aprender.', revisionLimit: 'El perfil llegó a su límite de revisión. Vuelve a entrar.',
    duplicate: 'La solicitud ya corresponde a otra acción.', command: 'La solicitud no coincide con la lección actual.',
    land: 'Desembarca para aprender en el banco de carpintería.',
    conflict: 'El perfil o la obra cambió. Consulta los requisitos actuales.', disabled: 'La lección aún no está disponible en este mundo.',
    generic: 'No se pudo completar la lección. Consulta los requisitos e inténtalo otra vez.',
  },
  en: {
    title: 'Salty Shore Artisan', eyebrow: 'CARPENTRY WORKBENCH', close: 'Close lesson',
    intro: 'Learn a new personal recipe for your raft.', spec: (learn, build, hold) => `Lesson: ${learn} wood · Build: ${build} wood · Capacity: +${hold}`,
    practiceLabel: 'Logging', projectLabel: 'Community project', wood: 'Wood in your pack', woodGoodLabel: 'Wood', stoneGoodLabel: 'Stone',
    learn: 'Learn: Storage hold', learnedSuccess: 'Recipe learned. You can now build a storage hold.',
    known: 'You already know this recipe.', lessonLocked: 'Reach 60 logging points first.',
    projectIncomplete: 'The carpentry project is not complete yet.', projectComplete: 'Community carpentry complete', woodLocked: n => `Carry ${n} wood in your pack to receive the lesson.`,
    progress: (n, max) => `${n} / ${max} points`, projectProgress: (n, max) => `${n} / ${max} materials`,
    noProject: 'Could not load the community project.', notDurable: 'This project is not durably saved in this world.',
    loading: 'Checking requirements…', ready: 'Requirements met. You can learn the recipe.',
    waiting: 'Sending request…', waitingProfile: 'Lesson received; waiting for your profile to update…',
    recovered: 'Recovered response. Check your profile and refresh before trying again.',
    retry: 'Retry the same request', community: 'Contribute to the project', refresh: 'Check again',
    send: 'Could not send the request. Try again.',
    account_required: 'Link an account to learn durable recipes.', storage: 'The server could not confirm the save. Reconnect to continue.',
    busy: 'Another action is pending. Wait for its response.', far: 'Move closer to the carpentry bench.', bench: 'The bench is unavailable in this world.',
    dead: 'You cannot learn while defeated.', combat: 'Wait until combat ends.',
    lesson: 'You do not meet this lesson’s requirements.', practice: 'Reach 60 logging points first.',
    learned: 'You already know this recipe.', goods: 'You are missing the required wood.',
    project: 'The community project is not complete yet.', materials: 'You are missing the required wood.',
    revision: 'The state changed. Check again before learning.', revisionLimit: 'Your profile reached its revision limit. Rejoin the world.',
    duplicate: 'This request already belongs to another action.', command: 'The request does not match this lesson.',
    land: 'Disembark to learn at the carpentry bench.',
    conflict: 'Your profile or the project changed. Check current requirements.', disabled: 'This lesson is not available in this world.',
    generic: 'The lesson could not be completed. Check requirements and try again.',
  },
};

const call = (getter, fallback = null) => { try { return typeof getter === 'function' ? getter() : fallback; } catch { return fallback; } };
const langOf = locale => String(call(locale, document.documentElement?.lang || 'es')).toLowerCase().startsWith('en') ? 'en' : 'es';
const num = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const amountMap = value => Array.isArray(value)
  ? Object.fromEntries(value.filter(row => typeof row?.good === 'string').map(row => [row.good, row.amount ?? row.count]))
  : value && typeof value === 'object' ? value : {};

export function artisanProjectView(project, profile) {
  const projectId = project?.projectId ?? project?.id;
  const version = project?.version;
  const requirements = amountMap(project?.requirements), contributed = amountMap(project?.contributed);
  if (projectId !== ARTISAN.projectId || !Number.isSafeInteger(version) || version < 1
      || !Object.keys(requirements).length) return null;
  const rows = Object.entries(requirements).map(([good, required]) => {
    const target = Number.isSafeInteger(required) && required > 0 ? required : 0;
    const current = Math.min(target, num(contributed[good]));
    return { good, required: target, current, percent: target ? Math.round(current / target * 100) : 100 };
  });
  return { id: projectId, version, rows, complete: rows.length > 0 && rows.every(row => row.required > 0 && row.current >= row.required) };
}

export function artisanReadiness(profile, project, durable) {
  const progression = profile?.progression;
  let status = null;
  try { status = loggingStatus(progression); } catch { /* Corrupt profile progress stays ineligible. */ }
  const validProgression = !!status;
  const practice = validProgression ? status.practice : 0;
  const learned = validProgression && Array.isArray(progression?.knowledge) && progression.knowledge.includes(LOGGING_LESSON.id);
  const projectView = artisanProjectView(project, profile);
  const wood = num(profile?.eco?.pack?.goods?.madera);
  const loggingEligible = validProgression && (status.canLearnStorage || learned);
  const canLearn = durable === true && loggingEligible && !learned
    && projectView?.complete === true && wood >= (ARTISAN.cost?.madera || 0);
  return { practice, practiceTarget: LOGGING.firstMilestoneAt, learned, loggingEligible, project: projectView,
    wood, woodRequired: ARTISAN.cost?.madera || 0, buildCost: RAFT_PARTS[ARTISAN.part]?.cost?.madera || 0,
    hold: RAFT_PARTS[ARTISAN.part]?.hold || 0, canLearn };
}

function reasonText(why, copy) { return copy[why] || copy.generic; }

export class ArtisanPanel {
  constructor({ parent, profile, context, enabled, submit, onContext, onCommunity, getLocale }) {
    Object.assign(this, { profile, context, enabled, submitCommand: submit, onContext, onCommunity, getLocale });
    this.active = false; this.pending = null; this.project = null; this.durable = null; this.opener = null;
    this.status = ''; this.lastView = ''; this._contextNotified = false;
    this.root = document.createElement('section'); this.root.className = 'artisan-panel'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'false');
    this.root.innerHTML = `<header class="artisan-head"><div class="artisan-mark" aria-hidden="true">✦</div><div><small data-eyebrow></small><h2 data-title></h2></div><button type="button" data-close></button></header>
      <div class="artisan-body"><p data-intro></p>
      <section class="artisan-card"><div class="artisan-row"><b data-practice-label></b><span data-practice></span></div><div class="artisan-track" role="progressbar" data-practice-bar><i></i></div></section>
      <section class="artisan-card"><b data-project-label></b><div class="artisan-project" data-project></div><div class="artisan-track" role="progressbar" data-project-bar><i></i></div></section>
      <section class="artisan-card artisan-spec" data-spec></section>
      <section class="artisan-card artisan-stock"><b data-wood-label></b><span data-wood></span></section>
      <p class="artisan-status" data-status aria-live="polite"></p><button type="button" class="artisan-retry" data-retry hidden></button>
      <div class="artisan-actions"><button type="button" class="artisan-learn" data-learn></button><button type="button" class="artisan-community" data-community></button><button type="button" class="artisan-refresh" data-refresh></button></div></div>`;
    parent.appendChild(this.root); this.$ = selector => this.root.querySelector(selector);
    this.bind(); this.render();
  }

  contextNow() { return call(this.context); }
  canUse() { return this.enabled?.() === true && !!this.contextNow(); }
  locale() { return langOf(this.getLocale); }
  copy() { return COPY[this.locale()]; }
  profileNow() { return this.contextNow()?.profile || call(this.profile); }
  update() { this.render(); }
  notifyContext(active) { if (this._contextNotified === active) return; this._contextNotified = active; this.onContext?.(active); }
  open() {
    if (!this.canUse()) return false;
    this.opener = document.activeElement;
    this.active = true; this.root.hidden = false; this.notifyContext(true); this.status = this.copy().loading;
    this.refresh(); this.render(); this.$('[data-close]').focus({ preventScroll: true }); return true;
  }
  close({ restoreFocus = true } = {}) {
    if (!this.active && this.root.hidden) return;
    this.active = false; this.root.hidden = true; this.notifyContext(false);
    const opener = this.opener;
    let openerVisible = !!opener?.isConnected;
    if (openerVisible && typeof opener.getClientRects === 'function') {
      try { openerVisible = opener.getClientRects().length > 0; } catch { openerVisible = false; }
    }
    if (restoreFocus && openerVisible) opener.focus({ preventScroll: true });
    this.opener = null;
  }
  reset() { this.pending = null; this.project = null; this.durable = null; this.status = ''; this.close(); this.render(); }
  bind() {
    this.root.addEventListener('keydown', event => { if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); } });
    this.$('[data-close]').addEventListener('click', () => this.close());
    this.$('[data-refresh]').addEventListener('click', () => this.refresh());
    this.$('[data-learn]').addEventListener('click', () => this.learn());
    this.$('[data-community]').addEventListener('click', () => { this.close({ restoreFocus: false }); this.onCommunity?.(); });
    this.$('[data-retry]').addEventListener('click', () => this.retry());
  }
  makeCommand(op, ctx, project) {
    const opId = globalThis.crypto.randomUUID();
    return Object.freeze(op === 'list'
      ? { t: 'cmd', type: 'artisan', op, opId }
      : { t: 'cmd', type: 'artisan', op, opId, lesson: ARTISAN.lesson, expectedRev: ctx.profile?.eco?.tradeRev,
        expectedProjectRev: project.version });
  }
  send(command) {
    try { return this.submitCommand?.(command) === true; } catch { return false; }
  }
  refresh() {
    if (!this.active || !this.canUse() || this.pending) return false;
    const command = this.makeCommand('list', this.contextNow());
    this.pending = { command, sentAt: performance.now(), op: 'list' }; this.project = null; this.durable = null; this.status = this.copy().loading;
    if (!this.send(command)) { this.pending = null; this.status = this.copy().send; this.render(); return false; }
    this.render(); return true;
  }
  retry() {
    const pending = this.pending;
    if (!pending || !this.canUse() || performance.now() - pending.sentAt < 5000) return false;
    const ok = this.send(pending.command); if (ok) pending.sentAt = performance.now(); this.render(); return ok;
  }
  learn() {
    const ctx = this.contextNow(), state = artisanReadiness(ctx?.profile || call(this.profile), this.project, this.durable);
    if (!this.active || !this.canUse() || this.pending || !state.canLearn || !Number.isSafeInteger(ctx?.profile?.eco?.tradeRev)) return false;
    const command = this.makeCommand('learn', ctx, state.project);
    this.pending = { command, sentAt: performance.now(), op: 'learn', ackRev: null }; this.status = this.copy().waiting;
    if (!this.send(command)) { this.pending = null; this.status = this.copy().send; this.render(); return false; }
    this.render(); return true;
  }
  confirmProfile() {
    const p = this.pending, profile = this.profileNow();
    if (!p || p.op !== 'learn' || !Number.isSafeInteger(p.ackRev) || !profile
        || profile.eco?.tradeRev < p.ackRev || !profile.progression?.knowledge?.includes(ARTISAN.lesson)) return false;
    this.pending = null; this.status = this.copy().learnedSuccess; return true;
  }
  confirmHistoricalProfile(ev) {
    const profile = this.profileNow();
    const rev = Number.isSafeInteger(ev?.rev) ? ev.rev : (this.pending?.command?.expectedRev ?? -2) + 1;
    return ev?.lesson === ARTISAN.lesson && !!profile?.progression?.knowledge?.includes(ARTISAN.lesson)
      && Number.isSafeInteger(profile.eco?.tradeRev) && Number.isSafeInteger(rev) && profile.eco.tradeRev >= rev;
  }
  onResult(ev) {
    const p = this.pending;
    if (!p || ev?.type !== 'artisan' || ev.op !== p.op || ev.opId !== p.command.opId) return false;
    if (ev.ok === false) { this.pending = null; this.status = reasonText(ev.why, this.copy()); this.render(); return true; }
    if (ev.historical || ev.replay) {
      const reconciled = p.op === 'learn' && this.confirmHistoricalProfile(ev);
      this.pending = null; this.status = reconciled ? this.copy().known : this.copy().recovered;
      if (p.op === 'list') this.project = null;
      this.render(); return true;
    }
    if (p.op === 'list') {
      this.pending = null;
      const project = ev.publicCommunity || ev.project?.publicCommunity || ev.project;
      const view = artisanProjectView(project, this.profileNow());
      this.project = view ? project : null; this.durable = ev.durable === true;
      this.status = !this.project ? this.copy().noProject : !this.durable ? this.copy().notDurable : '';
    } else {
      if (ev.lesson !== ARTISAN.lesson || !Number.isSafeInteger(ev.rev) || ev.rev !== p.command.expectedRev + 1) return false;
      if (ev.durable !== true) { this.pending = null; this.status = this.copy().notDurable; this.render(); return true; }
      p.ackRev = ev.rev; this.status = this.copy().waitingProfile; this.confirmProfile();
    }
    this.render(); return true;
  }
  reason(state, copy) {
    if (state.learned) return copy.known;
    if (!state.loggingEligible) return copy.lessonLocked;
    if (!state.project?.complete || this.durable !== true) return this.durable === false ? copy.notDurable : copy.projectIncomplete;
    if (state.wood < state.woodRequired) return copy.woodLocked(state.woodRequired);
    return copy.ready;
  }
  render() {
    const c = this.copy(), ctx = this.contextNow(), profile = ctx?.profile || call(this.profile), state = artisanReadiness(profile, this.project, this.durable);
    if (this.active && (!ctx || this.enabled?.() !== true)) this.close();
    this.confirmProfile();
    this.$('[data-eyebrow]').textContent = c.eyebrow; this.$('[data-title]').textContent = c.title;
    this.$('[data-close]').textContent = '×'; this.$('[data-close]').setAttribute('aria-label', c.close);
    this.$('[data-intro]').textContent = c.intro; this.$('[data-practice-label]').textContent = c.practiceLabel;
    this.$('[data-practice]').textContent = c.progress(state.practice, state.practiceTarget);
    const practicePct = Math.max(0, Math.min(100, state.practice / state.practiceTarget * 100));
    this.$('[data-practice-bar]').setAttribute('aria-valuemin', '0'); this.$('[data-practice-bar]').setAttribute('aria-valuemax', String(state.practiceTarget));
    this.$('[data-practice-bar]').setAttribute('aria-valuenow', String(Math.min(state.practice, state.practiceTarget)));
    this.$('[data-practice-bar] i').style.width = `${practicePct}%`;
    this.$('[data-project-label]').textContent = c.projectLabel;
    const rows = state.project?.rows || [];
    this.$('[data-project]').textContent = rows.length
      ? `${state.project.complete ? `${c.projectComplete} · ` : ''}${rows.map(row => `${row.good === 'madera' ? c.woodGoodLabel : row.good === 'piedra' ? c.stoneGoodLabel : row.good}: ${c.projectProgress(row.current, row.required)}`).join(' · ')}`
      : (this.status || c.loading);
    const projectPct = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.percent, 0) / rows.length) : 0;
    this.$('[data-project-bar]').setAttribute('aria-valuemin', '0'); this.$('[data-project-bar]').setAttribute('aria-valuemax', '100');
    this.$('[data-project-bar]').setAttribute('aria-valuenow', String(projectPct)); this.$('[data-project-bar] i').style.width = `${projectPct}%`;
    this.$('[data-wood-label]').textContent = c.wood; this.$('[data-wood]').textContent = `${state.wood} / ${state.woodRequired}`;
    this.$('[data-spec]').textContent = c.spec(state.woodRequired, state.buildCost, state.hold);
    const busy = !!this.pending, ready = state.canLearn && !busy;
    this.$('[data-learn]').disabled = !ready; this.$('[data-learn]').textContent = state.learned ? c.known : c.learn;
    this.$('[data-community]').textContent = c.community; this.$('[data-refresh]').textContent = c.refresh;
    this.$('[data-refresh]').disabled = busy || !ctx;
    const retryReady = busy && performance.now() - this.pending.sentAt >= 5000;
    const retry = this.$('[data-retry]'); retry.hidden = !retryReady; retry.disabled = !retryReady || !ctx; retry.textContent = c.retry;
    this.$('[data-status]').textContent = busy ? (this.pending.ackRev === null && this.pending.op === 'learn' ? c.waiting : this.status || c.loading)
      : this.status || this.reason(state, c);
    this.root.classList.toggle('is-pending', busy);
  }
}
