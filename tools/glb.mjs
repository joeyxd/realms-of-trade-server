// Minimal .glb reader for the tools (no three.js): the JSON chunk and the binary chunk, plus helpers to read what
// tools/import-asset.mjs reports (bounds, triangle counts, skins, textures).
export function readGlb(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 20 || b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a binary glTF (.glb): bad magic');
  const version = b.readUInt32LE(4), total = b.readUInt32LE(8);
  if (version !== 2) throw new Error(`glTF version ${version} (only 2 is supported)`);
  let off = 12, json = null, bin = null;
  while (off + 8 <= Math.min(total, b.length)) {
    const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  if (!json) throw new Error('glTF: no JSON chunk');
  return { json, bin };
}

// Node world matrices are not needed for the report: the bounds use the POSITION accessors' min / max, scaled by
// the nodes' scale chain (a rough box; the game measures the real one after loading).
export function summarize({ json, bin }) {
  const J = json, acc = J.accessors || [];
  const nodes = J.nodes || [];
  const parent = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children || []).forEach((c) => { parent[c] = i; }));
  let tris = 0, verts = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const scaleOf = (i) => { let s = 1; while (i >= 0) { const n = nodes[i]; if (n.scale) s *= Math.max(...n.scale.map(Math.abs)); if (n.matrix) s *= Math.hypot(n.matrix[0], n.matrix[1], n.matrix[2]); i = parent[i]; } return s; };
  nodes.forEach((n, i) => {
    if (n.mesh === undefined) return;
    const s = n.skin !== undefined ? 1 : scaleOf(i); // skinned meshes: the joints place them (glTF ignores the node)
    for (const p of (J.meshes[n.mesh].primitives || [])) {
      const a = acc[p.attributes.POSITION];
      if (!a) continue;
      verts += a.count;
      tris += p.indices !== undefined ? acc[p.indices].count / 3 : a.count / 3;
      if (a.min && a.max) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], a.min[k] * s); max[k] = Math.max(max[k], a.max[k] * s); }
    }
  });
  const skins = (J.skins || []).map((s) => ({ joints: s.joints.map((j) => nodes[j].name || `node${j}`), parents: s.joints.map((j) => s.joints.indexOf(parent[j])) }));
  const images = (J.images || []).map((im) => ({ name: im.name || '', mime: im.mimeType || '', bytes: im.bufferView !== undefined ? J.bufferViews[im.bufferView].byteLength : 0, uri: im.uri || '' }));
  return {
    generator: J.asset && J.asset.generator || '', meshes: (J.meshes || []).length, materials: (J.materials || []).map((m) => m.name || '(unnamed)'),
    tris: Math.round(tris), verts, min, max, skins, images, animations: (J.animations || []).map((a) => a.name || '(unnamed)'),
    extensions: J.extensionsUsed || [], binBytes: bin ? bin.length : 0,
  };
}
