// Brings a model or texture into the game: copies it under assets/, checks it, and writes its manifest entry.
// The game picks it up on the next load (no code change). docs/ASSETS.md is the guide.
//
//   node tools/import-asset.mjs <file.glb|.png|.jpg|.webp> --id=char:corsaria --looks=Corsaria [--height=1.84]
//   node tools/import-asset.mjs barrel.glb --id=prop:barrel --props=barrel
//   node tools/import-asset.mjs balandra.glb --id=ship:dock --kind=model --size=11
//   node tools/import-asset.mjs planks.webp --id=tex:planks --repeat=2,2
//   node tools/import-asset.mjs --check            (every entry: file there, bones map, sizes; exit 1 on problems)
//   node tools/import-asset.mjs --remove=prop:barrel
// Other flags: --rotY=deg, --scale=k, --yOffset=u, --weapon=none, --posterize=n, --sat=k, --bright=k, --flat,
// --bone.<ours>=<their name> (e.g. --bone.head=Skull), --notes="…", --name=<file name under assets/> (default: the
// id with ':' → '-'), --dry (report only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb, summarize } from './glb.mjs';
import { normalizeManifest, OUR_BONES } from '../src/render/assets/manifest.js';
import { mapBones } from '../src/render/assets/bonemap.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'assets'), manPath = path.join(dir, 'manifest.json');
const args = process.argv.slice(2);
const flags = {}, files = [];
for (const a of args) {
  if (a.startsWith('--')) { const [k, ...v] = a.slice(2).split('='); flags[k] = v.length ? v.join('=') : true; }
  else files.push(a);
}
const readMan = () => (fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : { version: 1, assets: [] });
const writeMan = (m) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(manPath, JSON.stringify(m, null, 2) + '\n'); };
const MB = (n) => (n / 1048576).toFixed(2) + ' MB';
const LIMIT = 15 * 1048576; // the artifact host's per-file limit; also a sane download for a phone

function report(file, kind, bones) {
  const buf = fs.readFileSync(file), out = { ok: true, lines: [], warn: [] };
  const size = buf.length;
  out.lines.push(`${path.basename(file)} · ${MB(size)}`);
  if (size > LIMIT) out.warn.push(`larger than 15 MB: compress it (gltf-transform optimize --compress meshopt --texture-compress webp) or lower its textures`);
  if (!/\.glb$/i.test(file)) return out;
  let g;
  try { g = summarize(readGlb(buf)); } catch (e) { out.ok = false; out.warn.push(e.message); return out; }
  out.lines.push(`${g.tris} triangles · ${g.verts} vertices · ${g.meshes} meshes · materials: ${g.materials.join(', ') || '-'}${g.generator ? ' · ' + g.generator : ''}`);
  const dx = g.max[0] - g.min[0], dy = g.max[1] - g.min[1], dz = g.max[2] - g.min[2];
  if (Number.isFinite(dy)) out.lines.push(`box (authored units, rough): ${dx.toFixed(2)} × ${dy.toFixed(2)} × ${dz.toFixed(2)} (x × y × z)`);
  for (const im of g.images) out.lines.push(`texture ${im.name || '(unnamed)'} ${im.mime} ${im.bytes ? MB(im.bytes) : im.uri}`);
  if (g.extensions.length) out.lines.push('extensions: ' + g.extensions.join(', '));
  if (g.animations.length) out.lines.push(`animations (not used: the rig animates it): ${g.animations.join(', ')}`);
  const budget = kind === 'char' ? 20000 : kind === 'prop' ? 6000 : 40000;
  if (g.tris > budget) out.warn.push(`${g.tris} triangles is heavy for a ${kind} (aim ≤ ${budget}: decimate in Meshy / Blender, or gltf-transform simplify)`);
  if (kind === 'char') {
    if (!g.skins.length) out.warn.push('no skin: it will ride one bone rigidly (rig it in Meshy / Mixamo for a walking character)');
    else {
      const s = g.skins[0], r = mapBones(s.joints, s.parents, bones);
      const named = Object.fromEntries(OUR_BONES.map((k) => [k, r.map[k] >= 0 ? s.joints[r.map[k]] : '—']));
      out.lines.push('bone map: ' + OUR_BONES.map((k) => `${k}=${named[k]}`).join(' · '));
      for (const n of r.notes) out.lines.push('  note: ' + n);
      if (r.missing.length) { out.ok = false; out.warn.push(`bones not found: ${r.missing.join(', ')}. Its bones: ${s.joints.join(', ')}. Add --bone.<ours>=<theirs>`); }
    }
  }
  return out;
}

function print(o) {
  for (const l of o.lines) console.log('  ' + l);
  for (const w of o.warn) console.log('  ⚠ ' + w);
}

if (flags.check) {
  const m = readMan(), n = normalizeManifest(m);
  let bad = n.errors.length;
  for (const e of n.errors) console.log('⚠ ' + e);
  for (const e of n.entries.values()) {
    const f = path.join(dir, e.src);
    console.log(`${e.id} (${e.kind}) → ${e.src}`);
    if (!fs.existsSync(f)) { console.log('  ⚠ file missing'); bad++; continue; }
    const r = report(f, e.kind, e.bones);
    print(r);
    if (!r.ok) bad++;
  }
  console.log(bad ? `${bad} problem(s)` : `${n.entries.size} asset(s) OK`);
  process.exit(bad ? 1 : 0);
}

if (flags.remove) {
  const m = readMan(), i = m.assets.findIndex((a) => a.id === flags.remove);
  if (i < 0) { console.log('no entry ' + flags.remove); process.exit(1); }
  const [gone] = m.assets.splice(i, 1);
  writeMan(m);
  console.log(`removed ${gone.id} (the file ${gone.src} stays; delete it if nothing else uses it)`);
  process.exit(0);
}

const file = files[0];
if (!file || !flags.id) {
  console.log('usage: node tools/import-asset.mjs <file> --id=kind:name [--looks=… | --props=… | --kind=model --size=…] (see the header)');
  process.exit(1);
}
const id = String(flags.id);
const kind = flags.kind || id.split(':')[0];
const ext = path.extname(file).toLowerCase();
const isTex = kind === 'tex';
const sub = isTex ? 'textures' : 'models';
const name = (flags.name || id.replace(/[:/\\]+/g, '-')) + ext;
const entry = { id, kind, src: `${sub}/${name}` };
if (kind !== id.split(':')[0]) entry.kind = kind; else delete entry.kind;
const list = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);
const numF = (k) => (flags[k] !== undefined ? +flags[k] : undefined);
if (flags.looks) entry.looks = list(flags.looks);
if (flags.props) entry.props = list(flags.props);
for (const k of ['height', 'size', 'rotY', 'scale', 'yOffset']) if (numF(k) !== undefined) entry[k] = numF(k);
if (flags.weapon) entry.weapon = flags.weapon;
if (flags.fit) entry.fit = flags.fit;
if (flags.repeat) entry.repeat = list(flags.repeat).map(Number);
const toon = {};
for (const k of ['posterize', 'sat', 'bright']) if (numF(k) !== undefined) toon[k] = numF(k);
if (flags.flat) toon.flat = true;
if (Object.keys(toon).length) entry.toon = toon;
const bones = {};
for (const [k, v] of Object.entries(flags)) if (k.startsWith('bone.')) bones[k.slice(5)] = String(v);
if (Object.keys(bones).length) entry.bones = bones;
if (flags.notes) entry.notes = String(flags.notes);

const m = readMan();
const others = m.assets.filter((a) => a.id !== id);
const check = normalizeManifest({ assets: [...others, entry] });
const mine = check.errors.filter((e) => e.startsWith(id + ':'));
console.log(`${id} (${kind}) ← ${file}`);
const r = report(file, kind, bones);
print(r);
for (const e of mine) console.log('  ⚠ ' + e);
if (!check.entries.has(id)) { console.log('not imported: the entry is invalid'); process.exit(1); }
if (flags.dry) { console.log('(dry run: nothing written)'); process.exit(r.ok ? 0 : 1); }
fs.mkdirSync(path.join(dir, sub), { recursive: true });
fs.copyFileSync(file, path.join(dir, entry.src));
m.assets = [...others, entry];
writeMan(m);
console.log(`→ assets/${entry.src} · manifest updated (${m.assets.length} entries)${r.ok ? '' : ' · fix the warnings above'}`);
