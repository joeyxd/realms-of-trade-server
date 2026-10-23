// Isolated P03a appearance contract, shared by the browser and deterministic artifact generator.
import { HAIR_STYLES, BEARD_STYLES, createHair, createBeard } from './hair.mjs';
import { EYE_STYLES, BROW_STYLES, IRIS_PALETTES, createFace } from './face.mjs';

export { HAIR_STYLES, BEARD_STYLES, EYE_STYLES, BROW_STYLES, IRIS_PALETTES };
export const HAIR_PALETTES = [
  { id: 'brown', label: 'Castaño', color: '#65452F' },
  { id: 'black', label: 'Negro', color: '#302A29' },
  { id: 'copper', label: 'Cobre', color: '#A65532' },
  { id: 'sand', label: 'Arena', color: '#C3A06B' },
  { id: 'silver', label: 'Canas', color: '#B8B5AA' },
];
export const BODY_SPECS = {
  male: { neck: 1.54 }, female: { neck: 1.51 },
};
export const DEFAULT_APPEARANCE = Object.freeze({
  v: 1, hairId: 'scout', beardId: 'none', eyesId: 'neutral', browsId: 'natural',
  hairPaletteId: 'brown', beardPaletteId: 'brown', browPaletteId: 'brown', irisPaletteId: 'amber',
});
const choices = {
  hairId: [{ id: 'none', label: 'Calvo' }, ...HAIR_STYLES], beardId: BEARD_STYLES,
  eyesId: EYE_STYLES, browsId: BROW_STYLES, irisPaletteId: IRIS_PALETTES,
  hairPaletteId: HAIR_PALETTES, beardPaletteId: HAIR_PALETTES, browPaletteId: HAIR_PALETTES,
};
export const APPEARANCE_CHOICES = choices;
export function normalizeAppearance(input = {}) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const clean = { v: 1 };
  for (const [key, entries] of Object.entries(choices)) {
    clean[key] = entries.some(option => option.id === value[key]) ? value[key] : DEFAULT_APPEARANCE[key];
  }
  return clean;
}
export function assembleAppearance(kind, input) {
  if (!Object.hasOwn(BODY_SPECS, kind)) throw new TypeError(`Unknown body kind: ${kind}`);
  const descriptor = normalizeAppearance(input), R = BODY_SPECS[kind];
  const color = key => HAIR_PALETTES.find(p => p.id === descriptor[key]).color;
  const face = createFace(kind, R, { eyes: descriptor.eyesId, brows: descriptor.browsId,
    iris: descriptor.irisPaletteId, hairColor: color('browPaletteId') });
  const parts = [
    { name: 'eyes_selected', geometry: face.eyes, family: 'eyes' },
    { name: 'brows_selected', geometry: face.brows, family: 'brows' },
    { name: 'face_accents', geometry: face.accents, family: 'accents' },
  ];
  for (const [family, id, make, palette] of [
    ['hair', descriptor.hairId, createHair, 'hairPaletteId'],
    ['beard', descriptor.beardId, createBeard, 'beardPaletteId'],
  ]) {
    if (id === 'none') continue;
    const geometry = make(kind, R, id);
    const colors = geometry.attributes.color;
    // Ratios use Three's linear RGB conversion, matching the warm-brown source swatch.
    const linear = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255].map(x => {
      const s = x / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
    }); };
    const source = linear('#65452F'), target = linear(color(palette));
    for (let i = 0; i < colors.count; i++) {
      colors.setXYZ(i, colors.getX(i) * target[0] / source[0], colors.getY(i) * target[1] / source[1], colors.getZ(i) * target[2] / source[2]);
    }
    parts.push({ name: `${family}_${id}`, geometry, family });
  }
  return { descriptor, parts };
}
