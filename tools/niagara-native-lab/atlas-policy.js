// Private pilot texture admission; source identities remain separate from variants.
export const AUTOMATIC_VARIANTS = Object.freeze({ desktop: 'full', mobile: 'full' });
export const ATLAS_MANIFEST_SHA256 = 'cd560a4149c8d1f6c3ade4f703bcee7f621ef99b67e0d5c90ae854c76045143e';
export const MOBILE_MEMORY_ACCEPTED = false;
const SHA = /^[0-9a-f]{64}$/;
const INPUTS = [
  ['flame', 'cd44ef0de6222e9ce7b0185099f07bf2763c33190f716c45fa06083ba08e9d86', [2048, 1024], [8, 4]],
  ['smoke', '6e6020de9e807fc9fd96bae1f8c376b4c6793a08644512e77bf6c79e44e99442', [2560, 1536], [10, 6]]
];
const CELLS = { full: 256, half: 128, quarter: 64 };
export function mipRgba8Bytes(width, height) {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid texture dimensions');
  let sum = 0;
  while (true) { sum += width * height * 4; if (width === 1 && height === 1) return sum;
    width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2)); }
}
export function selectVariant(requested, coarsePointer) {
  if (requested === 'auto') return AUTOMATIC_VARIANTS[coarsePointer ? 'mobile' : 'desktop'];
  if (requested !== 'source' && !Object.hasOwn(CELLS, requested)) throw new Error('Unknown atlas variant');
  return requested;
}
export function validateManifest(manifest) {
  if (manifest?.schema !== 'st01c-atlas-build/v1' ||
      manifest.sourceSystemSha256 !== '985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165' ||
      !SHA.test(manifest.sourceSpecSha256) || !SHA.test(manifest.toolSha256) ||
      manifest.inputs?.length !== 2 || manifest.variants?.length !== 6) throw new Error('Invalid atlas manifest');
  for (const [id, hash, dimensions, grid] of INPUTS) {
    const input = manifest.inputs.find(row => row.id === id);
    if (!input || input.sha256 !== hash || JSON.stringify(input.dimensions) !== JSON.stringify(dimensions) ||
        JSON.stringify(input.grid) !== JSON.stringify(grid) || input.srgb !== true || !SHA.test(input.decodedRgbaSha256) ||
        !Number.isSafeInteger(input.bytes) || input.bytes < 1 ||
        input.file !== `.scratch/unreal/reference11/textures/${id === 'flame' ? 'T_FlameUV_2' : 'T_Smoke_1'}.png`)
      throw new Error('Unexpected source atlas');
    for (const [variant, cellSize] of Object.entries(CELLS)) {
      const rows = manifest.variants.filter(row => row.id === variant && row.inputId === id);
      const row = rows[0], expected = grid.map(n => n * cellSize);
      if (rows.length !== 1 || row.file !== `${variant}-${id}.webp` || row.cellSize !== cellSize ||
          JSON.stringify(row.dimensions) !== JSON.stringify(expected) || JSON.stringify(row.grid) !== JSON.stringify(grid) ||
          !SHA.test(row.sha256) || !SHA.test(row.decodedRgbaSha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 1 ||
          row.mipRgba8Bytes !== mipRgba8Bytes(...expected) ||
          (variant === 'full' && row.decodedRgbaSha256 !== input.decodedRgbaSha256)) throw new Error('Invalid atlas derivative');
    }
  }
  return manifest;
}
export function texturePlan(manifest, variant, maximumSize) {
  validateManifest(manifest);
  if (!['source', ...Object.keys(CELLS)].includes(variant) || !Number.isInteger(maximumSize) || maximumSize < 1)
    throw new Error('Invalid texture selection');
  return INPUTS.map(([id]) => {
    const row = variant === 'source' ? manifest.inputs.find(r => r.id === id)
      : manifest.variants.find(r => r.id === variant && r.inputId === id);
    if (row.dimensions.some(n => n > maximumSize)) throw new Error('Selected atlas exceeds device texture limit');
    return { ...row, url: variant === 'source' ? '/'+row.file : '/.scratch/atlas-build/v1/'+row.file,
      mipRgba8Bytes: mipRgba8Bytes(...row.dimensions) };
  });
}
