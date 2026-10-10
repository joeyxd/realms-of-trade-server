import { loggingStatus } from '../sim/systems/progression.js';
import { LOGGING } from '../data/progression.js';
import { DT } from '../data/tuning.js';

const COPY = {
  es: {
    title: 'Tala', practice: 'Práctica', rank: 'Rango', benefit: 'Ritmo de trabajo',
    milestone: 'Hito: tala constante', reached: 'Alcanzado', pending: 'Por alcanzar',
    storage: 'Lección de carpintería: próximamente; aún no está disponible.',
    storageLocked: 'Al llegar al hito podrás ver aquí la próxima lección de carpintería. Aún no está disponible.',
    seconds: 's entre golpes',
  },
  en: {
    title: 'Logging', practice: 'Practice', rank: 'Rank', benefit: 'Work pace',
    milestone: 'Milestone: steady logging', reached: 'Reached', pending: 'In progress',
    storage: 'Carpentry lesson: coming later; it is not available yet.',
    storageLocked: 'Reach the milestone to see the upcoming carpentry lesson here. It is not available yet.',
    seconds: 's between hits',
  },
};

const language = (locale) => (typeof locale === 'function' ? locale() : locale) === 'en' ? 'en' : 'es';

export function loggingSkillHtml(progression, locale = 'es') {
  const copy = COPY[language(locale)];
  let status;
  try { status = loggingStatus(progression); }
  catch { status = loggingStatus(undefined); }

  const practice = Number.isSafeInteger(status.practice) ? Math.max(0, status.practice) : 0;
  const reached = status.rank >= 2;
  const width = Math.max(0, Math.min(100, practice / LOGGING.firstMilestoneAt * 100));
  const storageNote = status.canLearnStorage ? copy.storage : copy.storageLocked;

  return `<div class="cp-logging"><div class="mast-card">
    <div class="mc-head"><b>${copy.title}</b><span>${copy.rank} ${Number.isSafeInteger(status.rank) ? status.rank : 1}</span></div>
    <div class="st-row"><span>${copy.practice}</span><b>${practice} / ${LOGGING.firstMilestoneAt}</b></div>
    <div class="bar xp thin" role="progressbar" aria-label="${copy.practice}" aria-valuemin="0" aria-valuemax="${LOGGING.firstMilestoneAt}" aria-valuenow="${Math.min(practice, LOGGING.firstMilestoneAt)}"><div class="fill" style="width:${width.toFixed(1)}%"></div></div>
    <div class="st-row"><span>${copy.benefit}</span><b>${LOGGING.baseActionTicks * DT} → ${LOGGING.learnedActionTicks * DT} ${copy.seconds}</b></div>
    <div class="st-row"><span>${copy.milestone}</span><b>${reached ? copy.reached : copy.pending}</b></div>
    <small>${storageNote}</small>
  </div></div>`;
}
