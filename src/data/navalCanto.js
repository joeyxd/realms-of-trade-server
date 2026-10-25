// Our numbers: Joi's PT25 option 3, 60 s active then 60 s cooldown at NAVAL_STEP 1/60.
// WW's Wind's Requiem overrides direction only; room power is 0.3/0.6/0.9
// (research/wind-waker ficha 01 section 6, KW:1007-1016, 1026-1039).
// Keep the world's strength; only the direction belongs to the song.
export const NAVAL_CANTO = Object.freeze({ durationTicks: 3600, cooldownTicks: 3600 });
