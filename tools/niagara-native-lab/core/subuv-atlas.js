// SubUV atlas lookup: cells row-major from the top-left of a columns x rows grid (1x1 is a plain texture).
// Frame policy, per layer: 'clamp' (default, the pilot's) floors, then clamps to the last cell; 'wrap' follows the UE
// sprite vertex factory and leaves the row unbounded, so a frame past the grid reads idx mod (columns * rows) once the
// layer's texture repeats (TA_WRAP). The GLSL and the JS twin change together.
export const SUBUV_POLICIES = Object.freeze(['clamp', 'wrap']);

// SUBUV_WRAP: NiagaraSpriteVertexFactory.ush (UE 5.8) 1059-1068: SubImageA = SubImageIndex - frac(SubImageIndex) + 0.5,
// column = floor(fmod(A, X)), row = floor(A * (1 / X)), no clamp; SubImageSize.z = 1 / X (NiagaraRendererSprites.cpp:552).
// HLSL fmod truncates: a - X * trunc(a / X). The texture's V runs up here, hence 1 - (row + 1 - v) / Y.
export const SUBUV_ATLAS_UV_GLSL = `
vec2 subUVAtlasUv(float subImage, vec2 grid, vec2 uv) {
#ifdef SUBUV_WRAP
  float a = subImage - fract(subImage) + 0.5;
  float column = floor(a - grid.x * trunc(a / grid.x));
  float row = floor(a * (1.0 / grid.x));
  return vec2((column + uv.x) / grid.x, 1.0 - (row + 1.0 - uv.y) / grid.y);
#else
  float frame = clamp(floor(subImage), 0.0, grid.x * grid.y - 1.0);
  return vec2((mod(frame, grid.x) + uv.x) / grid.x,
    1.0 - (floor(frame / grid.x) + 1.0 - uv.y) / grid.y);
#endif
}`;

// JS twin of subUVAtlasUv for tests and CPU-side checks; uv in the quad's [0, 1] range. JS % truncates like HLSL fmod.
export function subUVAtlasUv(subImage, [columns, rows], [u, v], policy = SUBUV_POLICIES[0]) {
  if (!SUBUV_POLICIES.includes(policy)) throw new Error('Invalid SubUV policy');
  if (policy === 'wrap') {
    const a = subImage - (subImage - Math.floor(subImage)) + .5;
    const column = Math.floor(a % columns), row = Math.floor(a * (1 / columns));
    return [(column + u) / columns, 1 - (row + 1 - v) / rows];
  }
  const frame = Math.min(Math.max(Math.floor(subImage), 0), columns * rows - 1);
  return [(frame % columns + u) / columns, 1 - (Math.floor(frame / columns) + 1 - v) / rows];
}

export function validateGrid(grid) {
  if (!Array.isArray(grid) || grid.length !== 2 || !grid.every(n => Number.isInteger(n) && n >= 1))
    throw new Error('Invalid SubUV grid');
  return grid;
}
