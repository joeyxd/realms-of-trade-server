// The external asset manifest (assets/manifest.json): which real models and textures replace which procedural
// pieces. Pure (no three.js): the game, the tests and tools/import-asset.mjs all read it through normalizeManifest.
// docs/ASSETS.md is the guide; this file is the contract.
//
// {
//   "version": 1,
//   "assets": [
//     { "id": "char:corsaria", "kind": "char", "src": "models/corsaria.glb", "looks": ["Corsaria"], "height": 1.84 },
//     { "id": "prop:barrel", "kind": "prop", "src": "models/barrel.glb", "props": ["barrel"] },
//     { "id": "ship:balandra", "kind": "model", "src": "models/balandra.glb", "size": 9 },
//     { "id": "tex:planks", "kind": "tex", "src": "textures/planks.webp", "repeat": [2, 2] }
//   ]
// }
//
// Kinds
//   char   A rigged humanoid (glTF skin; Mixamo, Meshy, Blender Rigify / metarig, Unreal mannequin names all map) that
//          replaces the procedural looks named in `looks` (charlooks.js LOOKS[].name). It is re-skinned onto the
//          game's 15-bone rig (render/assets/rebind.js), so every procedural animation, afterimage, portrait, death
//          debris and ink outline works with it. A rigid model (no skin) can be a char too: all of it rides `bone`.
//   prop   A static model that replaces procedural world props of the kinds in `props` (worldgen's map.props kinds:
//          hut, crate, barrel, stall, lantern, dockPost, brazier, pillar, gatePost, sign, campfire, rack, skullPost,
//          palisade, blackFlag). Fitted to the procedural one's size by default, so collisions stay right.
//   model  Any other static model the code asks for by id (ships, buildings, trade goods, NPC stalls…):
//          assets.model(id) gives a fitted, toon-shaded clone or null (then the code draws its procedural one).
//   tex    A texture by id: assets.texture(id) (sRGB colour unless "data": true).
//
// Common fields
//   id (required, unique, "kind:name"), src (required, relative to the manifest), kind (default: id's prefix),
//   rotY (degrees about +Y, applied first; glTF faces +Z, the game's forward), scale (extra × after fitting),
//   yOffset (u, after fitting), toon: { posterize (0 = off, else colour levels), sat (× saturation), bright
//   (× value), rim (bool), flat (flat shading), comic (hatching; world default on, chars off), alphaTest },
//   shadow: true (cast), notes (free text).
// char   looks: [names] (required), height (u; default: the look's own height), bones: { ours: "their bone name" }
//        to override the automatic map (ours = hips, spine, chest, head, thighL, shinL, thighR, shinR, armL, foreL,
//        armR, foreR), weapon: "proc" (the look's procedural weapon in the right hand, default) | "none",
//        armsDown (default true: T / A poses are lowered to the rig's arms-down rest), bone (rigid chars: the bone it
//        rides, default "body").
// prop   props: [kinds] (required), fit: "proc" (default: the procedural prop's size) | "height" | "size" | "none",
//        size (u: the largest horizontal extent, with fit "size"), height (u, with fit "height").
// model  fit: "size" (default when size is given) | "height" (default when only height is) | "proc" (otherwise: the size of
//        the procedural piece the code passes, if any, else as authored) | "none", size, height.
// tex    repeat: [u, v], data (bool: linear, for normal / roughness maps), filter: "nearest" | "linear" (default).

export const KINDS = ['char', 'prop', 'model', 'tex'];
export const OUR_BONES = ['hips', 'spine', 'chest', 'head', 'thighL', 'shinL', 'thighR', 'shinR', 'armL', 'foreL', 'armR', 'foreR'];
export const PROP_KINDS = ['hut', 'crate', 'barrel', 'stall', 'lantern', 'dockPost', 'brazier', 'pillar', 'gatePost', 'sign', 'campfire', 'rack', 'skullPost', 'palisade', 'blackFlag'];
const FITS = { prop: ['proc', 'height', 'size', 'none'], model: ['proc', 'size', 'height', 'none'] };

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const strList = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s) : typeof v === 'string' && v ? [v] : []);

// Validates and fills defaults. Never throws: bad entries are dropped with a message in `errors` (the game then draws
// the procedural piece), so one broken line in the manifest cannot take the game down.
// Returns { entries: Map(id → entry), byLook: Map(look name → char id), byProp: Map(prop kind → prop id), errors: [] }.
export function normalizeManifest(json, { looks = null } = {}) {
  const out = { entries: new Map(), byLook: new Map(), byProp: new Map(), errors: [] };
  const list = json && Array.isArray(json.assets) ? json.assets : null;
  if (!list) { if (json) out.errors.push('manifest: no "assets" list'); return out; }
  for (const raw of list) {
    const err = (m) => out.errors.push(`${raw && raw.id ? raw.id : '(no id)'}: ${m}`);
    if (!raw || typeof raw !== 'object') { err('not an object'); continue; }
    if (typeof raw.id !== 'string' || !raw.id) { err('missing id'); continue; }
    if (out.entries.has(raw.id)) { err('duplicate id'); continue; }
    if (typeof raw.src !== 'string' || !raw.src) { err('missing src'); continue; }
    if (/^[a-z]+:\/\//i.test(raw.src) || raw.src.includes('..')) { err('src must be a relative path inside assets/'); continue; }
    const kind = raw.kind || raw.id.split(':')[0];
    if (!KINDS.includes(kind)) { err(`unknown kind "${kind}" (${KINDS.join(', ')})`); continue; }
    const t = raw.toon || {};
    const e = {
      id: raw.id, kind, src: raw.src,
      rotY: num(raw.rotY, 0), scale: num(raw.scale, 1), yOffset: num(raw.yOffset, 0),
      toon: {
        posterize: Math.max(0, Math.round(num(t.posterize, 0))), sat: num(t.sat, 1), bright: num(t.bright, 1),
        rim: t.rim ?? kind === 'char', flat: !!t.flat, comic: t.comic ?? kind !== 'char', alphaTest: num(t.alphaTest, 0),
      },
      shadow: raw.shadow !== false,
      notes: typeof raw.notes === 'string' ? raw.notes : '',
    };
    if (kind === 'char') {
      e.looks = strList(raw.looks);
      if (!e.looks.length) { err('char needs "looks": the procedural look names it replaces'); continue; }
      if (looks) {
        const bad = e.looks.filter((n) => !looks.includes(n));
        if (bad.length) { err(`unknown look(s) ${bad.join(', ')}`); e.looks = e.looks.filter((n) => looks.includes(n)); if (!e.looks.length) continue; }
      }
      e.height = num(raw.height, 0); // 0: the look's own height
      e.bones = {};
      if (raw.bones && typeof raw.bones === 'object') {
        for (const [k, v] of Object.entries(raw.bones)) {
          if (!OUR_BONES.includes(k)) err(`bones: "${k}" is not one of ${OUR_BONES.join(', ')}`);
          else if (typeof v === 'string' && v) e.bones[k] = v;
        }
      }
      e.weapon = raw.weapon === 'none' ? 'none' : 'proc';
      e.armsDown = raw.armsDown !== false;
      e.bone = typeof raw.bone === 'string' && raw.bone ? raw.bone : 'body';
      for (const n of e.looks) {
        if (out.byLook.has(n)) err(`look "${n}" already replaced by ${out.byLook.get(n)}`);
        else out.byLook.set(n, e.id);
      }
    } else if (kind === 'prop') {
      e.props = strList(raw.props);
      const bad = e.props.filter((k) => !PROP_KINDS.includes(k));
      if (bad.length) err(`unknown prop kind(s) ${bad.join(', ')} (${PROP_KINDS.join(', ')})`);
      e.props = e.props.filter((k) => PROP_KINDS.includes(k));
      if (!e.props.length) { err('prop needs "props": the procedural prop kinds it replaces'); continue; }
      e.fit = FITS.prop.includes(raw.fit) ? raw.fit : 'proc';
      e.size = num(raw.size, 0); e.height = num(raw.height, 0);
      for (const k of e.props) {
        if (out.byProp.has(k)) err(`prop "${k}" already replaced by ${out.byProp.get(k)}`);
        else out.byProp.set(k, e.id);
      }
    } else if (kind === 'model') {
      e.size = num(raw.size, 0); e.height = num(raw.height, 0);
      e.fit = FITS.model.includes(raw.fit) ? raw.fit : e.height > 0 && !(e.size > 0) ? 'height' : e.size > 0 ? 'size' : 'proc';
    } else {
      const r = Array.isArray(raw.repeat) ? raw.repeat : [1, 1];
      e.repeat = [num(r[0], 1), num(r[1], 1)];
      e.data = !!raw.data;
      e.filter = raw.filter === 'nearest' ? 'nearest' : 'linear';
    }
    out.entries.set(e.id, e);
  }
  return out;
}

// The scale and offset that fit a box (min / max: [x, y, z], already rotated) to an entry's rule. target: the size
// of what it replaces ({ w, h }: largest horizontal extent and height; props with fit "proc"). Returns
// { s, x, y, z }: scale, then translate so it stands centred on the origin with its base at y = 0 (+ yOffset).
export function fitBox(min, max, e, target = null) {
  const w = Math.max(max[0] - min[0], max[2] - min[2]), h = max[1] - min[1];
  let s = 1;
  const fit = e.fit || (e.kind === 'char' ? 'height' : 'none');
  if (fit === 'proc' && target) s = target.h > 0 && h > 0 ? Math.min(target.h / h, target.w > 0 && w > 0 ? (target.w / w) * 1.15 : Infinity) : 1;
  else if (fit === 'height' && e.height > 0 && h > 0) s = e.height / h;
  else if (fit === 'size' && e.size > 0 && w > 0) s = e.size / w;
  if (!Number.isFinite(s) || s <= 0) s = 1;
  s *= e.scale || 1;
  return { s, x: -((min[0] + max[0]) / 2) * s, y: -min[1] * s + (e.yOffset || 0), z: -((min[2] + max[2]) / 2) * s };
}
