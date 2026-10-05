// Shared game time. Render preferences do not change this clock or gameplay bonuses.
export const CLOCK = { daySec: 960, startHour: 8, nightStart: 20, nightEnd: 6, dawnHour: 6 };
export const hourOfDay = (hours) => ((hours % 24) + 24) % 24;
export const nightAt = (hours) => { const h = hourOfDay(hours); return h >= CLOCK.nightStart || h < CLOCK.nightEnd; };
export const phaseAt = (hours) => hourOfDay(hours - CLOCK.dawnHour) / 24;
