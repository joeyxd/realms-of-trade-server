// Private pilot texture admission; source identities remain separate from variants.
export const AUTOMATIC_VARIANTS = Object.freeze({ desktop: 'full', mobile: 'full' });
export const ATLAS_MANIFEST_SHA256 = 'befcf4f9279d2a82df5a9624b528ad924d07d0fad908932a41b261b14a8b3fb2';
export const MOBILE_MEMORY_ACCEPTED = false;
const SHA = /^[0-9a-f]{64}$/;
const INPUTS = [
  ['flame', 'cd44ef0de6222e9ce7b0185099f07bf2763c33190f716c45fa06083ba08e9d86', [2048, 1024], [8, 4]],
  ['smoke', '6e6020de9e807fc9fd96bae1f8c376b4c6793a08644512e77bf6c79e44e99442', [2560, 1536], [10, 6]]
];
const CELLS = { full: 256, half: 128, quarter: 64, 'ktx2-uastc': 256 };
// Lossy GPU container: transcoded on the device, so only the transcoder-independent facts are pinned here.
const KTX2 = new Set(['ktx2-uastc']);
const extensionOf = variant => KTX2.has(variant) ? 'ktx2' : 'webp';
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
function validKtx2Row(row, input, dimensions) {
  const levels = Math.floor(Math.log2(Math.max(...dimensions))) + 1;
  let blocks = 0, width = dimensions[0], height = dimensions[1];
  for (let level = 0; level < levels; level++, width = Math.max(1, width >> 1), height = Math.max(1, height >> 1))
    blocks += Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
  return row.container === 'ktx2' && row.codec === 'uastc' && row.lossy === true && row.supercompression === 'zstd' &&
    row.transfer === 'srgb' && row.primaries === 'bt709' && row.encodedFromRgbaSha256 === input.decodedRgbaSha256 &&
    row.levelCount === levels && Array.isArray(row.levels) && row.levels.length === levels && row.gpuBlockBytes === blocks &&
    row.levels.every(l => Number.isSafeInteger(l.byteLength) && l.byteLength > 0 && Number.isSafeInteger(l.uncompressedByteLength)) &&
    row.levels.reduce((n, l) => n + l.uncompressedByteLength, 0) === blocks &&
    /^toktx v\d+\.\d+\.\d+$/.test(row.encoder?.version) && typeof row.encoder.commandLine === 'string' &&
    row.encoder.commandLine.includes('--encode uastc') && !row.encoder.commandLine.includes('--uastc_rdo');
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
          (KTX2.has(variant) ? !validKtx2Row(row, input, expected) : !SHA.test(row.decodedRgbaSha256) ||
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
