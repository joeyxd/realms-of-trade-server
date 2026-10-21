// SubUV atlas lookup: cells row-major from the top-left of a columns x rows grid (1x1 is a plain texture).
// Frame policy: floor, then clamp to the last cell. Wrap vs clamp past the grid is not decided here.
export const SUBUV_ATLAS_UV_GLSL = `
vec2 subUVAtlasUv(float subImage, vec2 grid, vec2 uv) {
  float frame = clamp(floor(subImage), 0.0, grid.x * grid.y - 1.0);
  return vec2((mod(frame, grid.x) + uv.x) / grid.x,
    1.0 - (floor(frame / grid.x) + 1.0 - uv.y) / grid.y);
}`;

// JS twin of subUVAtlasUv for tests and CPU-side checks; uv in the quad's [0, 1] range.
export function subUVAtlasUv(subImage, [columns, rows], [u, v]) {
  const frame = Math.min(Math.max(Math.floor(subImage), 0), columns * rows - 1);
  return [(frame % columns + u) / columns, 1 - (Math.floor(frame / columns) + 1 - v) / rows];
}

export function validateGrid(grid) {
  if (!Array.isArray(grid) || grid.length !== 2 || !grid.every(n => Number.isInteger(n) && n >= 1))
    throw new Error('Invalid SubUV grid');
  return grid;
}
