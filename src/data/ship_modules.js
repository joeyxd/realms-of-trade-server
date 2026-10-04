// Naval slice hook (no gameplay yet). Schema for modular ships; see DESIGN.md §13.
// Inspired by the v0 server's weapon table (pistol / rapid / spread / heavy cannon).
export const SHIP_SLOTS = ['hull', 'cannon', 'hold', 'mast', 'cabin'];

export const shipModules = {
  hull: [
    { id: 'hull_balandra', name: 'Balandra', hp: 400, speed: 9, turn: 1.6, slots: { cannon: 2, hold: 1, mast: 1, cabin: 1 } },
  ],
  cannon: [
    { id: 'cannon_bronce', name: 'Cañón de bronce', cooldown: 0.5, projectiles: 1, spread: 0, damage: 1.0, crew: 1 },
    { id: 'cannon_metralla', name: 'Metralla', cooldown: 0.8, projectiles: 3, spread: 0.2, damage: 0.7, crew: 1 },
    { id: 'cannon_pesado', name: 'Cañón pesado', cooldown: 1.0, projectiles: 1, spread: 0, damage: 2.0, crew: 2 },
  ],
  hold: [{ id: 'hold_pequena', name: 'Bodega pequeña', capacity: 20 }],
  mast: [{ id: 'mast_cangreja', name: 'Vela cangreja', speedMult: 1.0, crew: 1 }],
  cabin: [{ id: 'cabin_litera', name: 'Literas', crewSlots: 3 }],
};
