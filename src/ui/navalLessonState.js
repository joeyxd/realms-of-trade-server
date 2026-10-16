import { NAVAL_LESSON as L } from '../data/navalLesson.js';
import { DT } from '../data/tuning.js';
import { PILOTING } from '../data/progression.js';

const COPY = {
  es: {
    ready: ['Lección costera', 'Aprende a navegar, girar, frenar y volver al puerto.'],
    outbound: ['Rumbo a la boya de salida', 'Sigue la marca dorada hasta la primera boya.'],
    maneuver: ['Maniobra en la segunda boya', 'Frena dentro del círculo y mantén la balsa quieta'],
    returning: ['Regreso al puerto', 'Regresa despacio y usa Amarrar cerca del puerto.'],
    complete: ['Lección completada', '¡Buen viaje! Recorrido, maniobra y atraque completados.'],
    aborted: ['Lección interrumpida', 'Vuelve al puerto para intentarlo de nuevo.'],
    start: 'Comenzar lección', repeat: 'Repetir lección', cancel: 'Cancelar lección',
    helm: 'Vuelve al timón para continuar.', switch: 'Ensayo con salvas',
    rules: 'Sin salvas de práctica; chocar con la costa daña el casco.',
    unlock: 'Primer recorrido: Pilotaje II · timón +{bonus} %.',
    learned: 'Pilotaje II · timón +{bonus} %.',
    saved: 'Aprendizaje guardado.', pending: 'Guardado pendiente.', local: 'Aprendido en esta partida.',
    brakeKey: 'S para frenar.', brakeTouch: 'Timón hacia abajo para frenar.',
    targets: { outbound: 'Boya de salida', maneuver: 'Boya de maniobra', returning: 'Puerto · amarrar' },
    reasons: { cancelled: 'Cancelaste la lección; vuelve al puerto para repetir.', shore: 'La balsa llegó a la costa; vuelve al puerto.',
      disabled: 'Casco inutilizado: recupera la balsa en el puerto.', timeout: 'Tiempo agotado; vuelve al puerto.',
      dock: 'Amarraste antes de completar la maniobra.' },
  },
  en: {
    ready: ['Coastal lesson', 'Learn to sail, turn, brake, and return to harbor.'],
    outbound: ['Sail to the departure buoy', 'Follow the golden marker to the first buoy.'],
    maneuver: ['Maneuver at the second buoy', 'Brake inside the circle and hold your raft still'],
    returning: ['Return to harbor', 'Return slowly and use Dock near the harbor.'],
    complete: ['Lesson complete', 'Well sailed! Route, maneuver, and docking complete.'],
    aborted: ['Lesson interrupted', 'Return to harbor to try again.'],
    start: 'Start lesson', repeat: 'Repeat lesson', cancel: 'Cancel lesson',
    helm: 'Return to the helm to continue.', switch: 'Cannon practice',
    rules: 'No practice salvos; coast collisions still damage the hull.',
    unlock: 'First route: Piloting II · helm +{bonus}%.',
    learned: 'Piloting II · helm +{bonus}%.',
    saved: 'Learning saved.', pending: 'Save pending.', local: 'Learned in this game.',
    brakeKey: 'S to brake.', brakeTouch: 'Pull the helm stick down to brake.',
    targets: { outbound: 'Departure buoy', maneuver: 'Maneuver buoy', returning: 'Harbor · dock' },
    reasons: { cancelled: 'Lesson cancelled; return to harbor to try again.', shore: 'The raft reached the coast; return to harbor.',
      disabled: 'Hull disabled: recover your raft at the harbor.', timeout: 'Time is up; return to harbor.',
      dock: 'You docked before completing the maneuver.' },
  },
};

export function lessonPresentation(lesson, language = 'es', { atHelm = true, isTouch = false } = {}) {
  const en = /^en/i.test(language), copy = en ? COPY.en : COPY.es;
  const status = Object.hasOwn(copy.targets, lesson?.status) || ['complete', 'aborted'].includes(lesson?.status)
    ? lesson.status : 'ready';
  const [stage, description] = copy[status];
  let detail = status === 'aborted' ? copy.reasons[lesson?.reason] || description : description;
  if (status === 'maneuver') {
    const seconds = (L.stableTicks * DT).toFixed(2).replace('.', en ? '.' : ',');
    detail += ` ${seconds} s.`;
  }
  if (lesson?.active && !atHelm) detail = copy.helm;
  const required = Number.isFinite(lesson?.requiredStableTicks) && lesson.requiredStableTicks > 0
    ? lesson.requiredStableTicks : L.stableTicks;
  const progress = status === 'maneuver'
    ? Math.max(0, Math.min(1, (Number.isFinite(lesson?.stableTicks) ? lesson.stableTicks : 0) / required)) : 0;
  const bonus = Math.round((PILOTING.rudderMultiplier - 1) * 100);
  const learning = lesson?.learning;
  const learningLabel = learning?.learned
    ? `${copy.learned.replace('{bonus}', bonus)} ${copy[['saved', 'pending'].includes(learning.persistence) ? learning.persistence : 'local']}`
    : copy.unlock.replace('{bonus}', bonus);
  return { stage, detail, rules: `${isTouch ? copy.brakeTouch : copy.brakeKey} ${copy.rules}`,
    learningLabel,
    button: lesson?.active ? atHelm ? copy.cancel : copy.helm : status === 'ready' ? copy.start : copy.repeat,
    switchLabel: copy.switch, targetLabel: copy.targets[status] || '', progress };
}

export function lessonCommand(lesson, epoch) {
  if (!Number.isSafeInteger(epoch) || epoch <= 0 || !lesson?.available) return null;
  if (lesson.active === true)
    return lesson.canAbort === true ? { t: 'cmd', type: 'navalPilot', op: 'lessonAbort', epoch } : null;
  return lesson.canStart === true ? { t: 'cmd', type: 'navalPilot', op: 'lessonStart', epoch } : null;
}
