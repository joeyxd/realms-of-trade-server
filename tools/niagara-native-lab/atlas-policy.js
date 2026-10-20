// Private pilot texture admission; source identities remain separate from variants.
// Author decision 2026-10-20: KTX2 UASTC is the automatic texture on desktop and mobile.
export const AUTOMATIC_VARIANTS = Object.freeze({ desktop: 'ktx2-uastc', mobile: 'ktx2-uastc' });
export const ATLAS_MANIFEST_SHA256 = '9731837e8d1c865679ea2eaa098a042d5a27a88b76033618acdc7e9071a8d942';
export const MOBILE_MEMORY_ACCEPTED = true;
// Mobile budget: 8 MiB counting the atlases' GPU bytes plus the film LUT; render targets are the renderer's shared cost and stay outside.
export const MOBILE_BUDGET_LIMIT_BYTES = 8 * 1024 * 1024;
const SHA = /^[0-9a-f]{64}$/;
const INPUTS = [
  ['flame', 'cd44ef0de6222e9ce7b0185099f07bf2763c33190f716c45fa06083ba08e9d86', [2048, 1024], [8, 4]],
  ['smoke', '6e6020de9e807fc9fd96bae1f8c376b4c6793a08644512e77bf6c79e44e99442', [2560, 1536], [10, 6]]
];
const CELLS = { full: 256, half: 128, quarter: 64, 'ktx2-uastc': 256, 'ktx2-uastc-box': 256, 'ktx2-rgba8': 256, 'ktx2-rgba8-box': 256 };
// KTX2 containers: UASTC is transcoded on the device, raw RGBA8 is uploaded as is; the -box variants only change the
// mip filter. Only ktx2-uastc is automatic; ktx2-rgba8 and every -box variant are diagnostic for the mip/codec
// decomposition, never an automatic choice.
const KTX2 = new Map([['ktx2-uastc', { codec: 'uastc', box: false }], ['ktx2-uastc-box', { codec: 'uastc', box: true }],
  ['ktx2-rgba8', { codec: 'rgba8', box: false }], ['ktx2-rgba8-box', { codec: 'rgba8', box: true }]]);
const extensionOf = variant => KTX2.has(variant) ? 'ktx2' : 'webp';
export function mipRgba8Bytes(width, height) {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid texture dimensions');
  let sum = 0;
  while (true) { sum += width * height * 4; if (width === 1 && height === 1) return sum;
    width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2)); }
}
// Mobile memory budget of one variant: atlas GPU bytes (UASTC blocks, or RGBA8 mips for WebP, raw KTX2 and the PNG original) plus the LUT.
export function mobileBudget(manifest, variant, lutBytes) {
  validateManifest(manifest);
  if ((variant !== 'source' && !Object.hasOwn(CELLS, variant)) || !Number.isSafeInteger(lutBytes) || lutBytes < 0) throw new Error('Invalid budget request');
  const uastc = KTX2.get(variant)?.codec === 'uastc';
  // The PNG original is decoded to RGBA8 with a driver-generated chain, like the lossless WebP.
  const rows = variant === 'source' ? manifest.inputs : manifest.variants.filter(r => r.id === variant);
  const atlasGpuBytes = rows.reduce((n, r) => n + (uastc ? uastcMipBytes(...r.dimensions) : mipRgba8Bytes(...r.dimensions)), 0);
  const totalBytes = atlasGpuBytes + lutBytes;
  return { limitBytes: MOBILE_BUDGET_LIMIT_BYTES, atlasGpuBytes, lutBytes, totalBytes, within: totalBytes <= MOBILE_BUDGET_LIMIT_BYTES };
}
export function selectVariant(requested, coarsePointer) {
  if (requested === 'auto') return AUTOMATIC_VARIANTS[coarsePointer ? 'mobile' : 'desktop'];
  if (requested !== 'source' && !Object.hasOwn(CELLS, requested)) throw new Error('Unknown atlas variant');
  return requested;
}
// UASTC GPU bytes: 16 B per 4x4 block, summed over the whole mip chain down to 1x1.
function uastcMipBytes(width, height) {
  let sum = 0;
  for (;;) { sum += Math.ceil(width / 4) * Math.ceil(height / 4) * 16; if (width === 1 && height === 1) return sum;
    width = Math.max(1, width >> 1); height = Math.max(1, height >> 1); }
}
function validKtx2Row(row, input, dimensions, recipe) {
  const uastc = recipe.codec === 'uastc';
  const levels = Math.floor(Math.log2(Math.max(...dimensions))) + 1;
  let blocks = 0, width = dimensions[0], height = dimensions[1];
  for (let level = 0; level < levels; level++, width = Math.max(1, width >> 1), height = Math.max(1, height >> 1))
    blocks += uastc ? Math.ceil(width / 4) * Math.ceil(height / 4) * 16 : width * height * 4;
  const line = row.encoder?.commandLine;
  return row.container === 'ktx2' && row.codec === recipe.codec && row.lossy === uastc && row.supercompression === 'zstd' &&
    row.colorModel === (uastc ? 'UASTC' : 'RGBSDA') &&
    row.transfer === 'srgb' && row.primaries === 'bt709' && row.encodedFromRgbaSha256 === input.decodedRgbaSha256 &&
    row.levelCount === levels && Array.isArray(row.levels) && row.levels.length === levels && row.gpuBlockBytes === blocks &&
    row.levels.every(l => Number.isSafeInteger(l.byteLength) && l.byteLength > 0 && Number.isSafeInteger(l.uncompressedByteLength)) &&
    row.levels.reduce((n, l) => n + l.uncompressedByteLength, 0) === blocks &&
    /^toktx v\d+\.\d+\.\d+$/.test(row.encoder?.version) && typeof line === 'string' &&
    line.includes('--encode uastc') === uastc && !line.includes('--uastc_rdo') &&
    line.includes('--filter box') === recipe.box && line.includes('--filter ') === recipe.box;
}
export function validateManifest(manifest) {
  if (manifest?.schema !== 'st01c-atlas-build/v1' ||
      manifest.sourceSystemSha256 !== '985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165' ||
      !SHA.test(manifest.sourceSpecSha256) || !SHA.test(manifest.toolSha256) ||
      manifest.inputs?.length !== 2 || manifest.variants?.length !== INPUTS.length * Object.keys(CELLS).length) throw new Error('Invalid atlas manifest');
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
      if (rows.length !== 1 || row.file !== `${variant}-${id}.${extensionOf(variant)}` || row.cellSize !== cellSize ||
          JSON.stringify(row.dimensions) !== JSON.stringify(expected) || JSON.stringify(row.grid) !== JSON.stringify(grid) ||
          !SHA.test(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 1 ||
          row.mipRgba8Bytes !== mipRgba8Bytes(...expected) ||
          (KTX2.has(variant) ? !validKtx2Row(row, input, expected, KTX2.get(variant)) : !SHA.test(row.decodedRgbaSha256) ||
            (variant === 'full' && row.decodedRgbaSha256 !== input.decodedRgbaSha256))) throw new Error('Invalid atlas derivative');
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
      container: row.container || (variant === 'source' ? 'png' : 'webp'),
      mipRgba8Bytes: mipRgba8Bytes(...row.dimensions) };
  });
}
