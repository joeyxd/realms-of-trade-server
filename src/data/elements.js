// Shared elemental colors for attacks and their visual effects.
const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const make = (accent, deep, bright) => Object.freeze({
  accent, deep, bright,
  c0: Object.freeze(rgb(bright)),
  c1: Object.freeze(rgb(deep)),
});

const ELEMENTS = Object.freeze({
  1: make(0xff793b, 0xc2441d, 0xffbd82),
  2: make(0x72eaff, 0x2187b8, 0xc5f8ff),
  3: make(0xffdf3b, 0xb88719, 0xfff3a0),
  4: make(0xaa70ed, 0x59388f, 0xe0c2ff),
});

// Stable frozen palettes avoid per-frame allocation for effects such as projectile trails.
export function elementVisual(elem) {
  return ELEMENTS[elem] || null;
}
