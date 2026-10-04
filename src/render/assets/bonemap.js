// Which bone of an imported humanoid skeleton is which of the game's rig (charkit.js BONES). Pure: works on names
// and parent indices, so the game (rebind.js), the tests and tools/import-asset.mjs share it.
//
// Handles the common conventions without configuration: Mixamo ("mixamorig:LeftUpLeg"), Meshy's auto-rig (same
// names, or "Spine01" / "neck"), Blender metarig / Rigify ("thigh.L", "upper_arm.L", "DEF-forearm.L"), Unreal
// ("thigh_l", "calf_l", "upperarm_l", "lowerarm_l", "spine_03", "neck_01"), 3ds Max biped ("Bip01 L Thigh",
// "Bip01 L Calf", "Bip01 L UpperArm"). Anything else: the manifest's "bones" names them.
//
// Our left is +X (a character faces +Z): the same as glTF / Mixamo "Left".

// Name → { side: 'L' | 'R' | '', base } with prefixes, separators and the side marker removed.
export function parseBoneName(name) {
  let s = String(name || '');
  s = s.replace(/^.*[:|]/, ''); // namespaces: "mixamorig:Hips", "Armature|Hips"
  // Rig prefixes, repeated ("J_Bip_L_UpperArm" in VRM): mixamorig, DEF- / ORG- / MCH- (Rigify), Bip01 (Max), CC_Base_.
  const PRE = /^(mixamorig\d*_?|def[-_.]|org[-_.]|mch[-_.]|bip0*1[\s_]*|bip[\s_]+|b[-_.]|bone[-_.]|jnt[-_.]|j[-_.]|cc_base_|rig[-_.])/i;
  for (let k = 0; k < 4 && PRE.test(s); k++) s = s.replace(PRE, '');
  let side = '';
  const low = s.toLowerCase();
  if (/left/.test(low)) { side = 'L'; s = s.replace(/left/i, ''); }
  else if (/right/.test(low)) { side = 'R'; s = s.replace(/right/i, ''); }
  else {
    const tok = s.split(/[\s_.\-]+/).filter(Boolean);
    const i = tok.findIndex((t) => /^[lr]$/i.test(t));
    if (i >= 0) { side = tok[i].toUpperCase(); tok.splice(i, 1); s = tok.join(''); }
    else if (tok.length > 1 && /^[cm]$/i.test(tok[0])) s = tok.slice(1).join(''); // VRM "C_Hips": centre
    else {
      // "LThigh", "RForeArm", "Thigh_L" without separators: a leading capital L / R before a capital.
      const m = s.match(/^([LR])(?=[A-Z])/);
      if (m) { side = m[1]; s = s.slice(1); }
    }
  }
  const base = s.toLowerCase().replace(/[\s_.\-]+/g, '');
  return { side, base };
}

// Base-name patterns per role (tested in order: the first role whose pattern matches wins).
const ROLES = [
  ['end', /(end|top|nub|tip)$/],
  ['twist', /(twist|roll|helper|ik|pole|target|ctrl|bend)/],
  ['finger', /(thumb|index|middle|ring|pinky|little|finger|digit|metacarpal)/],
  ['toe', /(toe|ball)/],
  ['hips', /^(hips?|pelvis|roothips|hip)$/],
  ['neck', /^neck\d*$/],
  ['head', /^head$/],
  ['clavicle', /^(shoulder|clavicle|collar|collarbone)$/],
  ['forearm', /^(forearm|lowerarm|loarm|elbow|forarm)$/],
  ['arm', /^(arm|upperarm|uparm)$/],
  ['hand', /^(hand|wrist)$/],
  ['thigh', /^(upleg|upperleg|thigh|uleg)$/],
  ['shin', /^(leg|lowerleg|calf|shin|knee|loleg)$/],
  ['foot', /^(foot|ankle)$/],
  ['spine', /^(spine\d*|chest|upperchest|abdomen|torso|waist|stomach|ribcage|back)$/],
];
export function boneRole(name) {
  const { side, base } = parseBoneName(name);
  for (const [role, re] of ROLES) if (re.test(base)) return { role, side, base };
  return { role: '', side, base };
}

// names: bone names; parents: index of each bone's parent bone (−1 for a root). overrides: { ours: their name }.
// Returns { map: { ours: index }, foot: { L, R }, hand: { L, R } (the bones past the shins / forearms, for their
// directions), missing: [ours…], notes: [...] }. Required: hips, a spine, head, both thighs, shins, arms, forearms.
export function mapBones(names, parents, overrides = {}) {
  const n = names.length, info = names.map(boneRole);
  const map = {}, notes = [];
  const children = Array.from({ length: n }, () => []);
  parents.forEach((p, i) => { if (p >= 0) children[p].push(i); });
  const depth = (i) => { let d = 0; while (parents[i] >= 0) { i = parents[i]; d++; } return d; };
  const find = (role, side = '') => {
    let best = -1;
    for (let i = 0; i < n; i++) if (info[i].role === role && info[i].side === side && (best < 0 || depth(i) < depth(best))) best = i;
    return best;
  };
  const byName = (nm) => { const i = names.indexOf(nm); return i >= 0 ? i : names.findIndex((x) => x.toLowerCase() === String(nm).toLowerCase()); };

  map.hips = find('hips');
  map.head = find('head');
  for (const s of ['L', 'R']) {
    map['thigh' + s] = find('thigh', s);
    map['shin' + s] = find('shin', s);
    map['arm' + s] = find('arm', s);
    map['fore' + s] = find('forearm', s);
  }
  // Unreal / Rigify sometimes call the upper arm "arm" and Mixamo calls the shin "leg": the roles above cover it. A
  // skeleton with "upperarm" + "lowerarm" but no "forearm": lowerarm is in the forearm pattern. One with only
  // "arm" twice per side (arm, arm.001): the child of the first is the forearm.
  for (const s of ['L', 'R']) {
    if (map['arm' + s] >= 0 && !(map['fore' + s] >= 0)) {
      const c = children[map['arm' + s]].find((k) => info[k].role !== 'twist' && info[k].role !== 'end');
      if (c !== undefined) { map['fore' + s] = c; notes.push(`fore${s}: first child of the upper arm`); }
    }
    if (map['thigh' + s] >= 0 && !(map['shin' + s] >= 0)) {
      const c = children[map['thigh' + s]].find((k) => info[k].role !== 'twist' && info[k].role !== 'end');
      if (c !== undefined) { map['shin' + s] = c; notes.push(`shin${s}: first child of the thigh`); }
    }
  }
  // Spine chain: the bones between the hips and the head (ancestors of the neck / head below the hips).
  const chain = [];
  if (map.head >= 0) {
    let i = parents[map.head];
    while (i >= 0 && i !== map.hips) { chain.unshift(i); i = parents[i]; }
    if (i !== map.hips) chain.length = 0; // the head does not hang from the hips: fall back to names
  }
  const spines = chain.filter((i) => info[i].role === 'spine');
  if (spines.length) {
    map.spine = spines[0];
    map.chest = spines.length > 1 ? spines[spines.length - 1] : -1;
  } else {
    let first = -1, last = -1;
    for (let i = 0; i < n; i++) if (info[i].role === 'spine') { if (first < 0 || depth(i) < depth(first)) first = i; if (last < 0 || depth(i) > depth(last)) last = i; }
    map.spine = first; map.chest = last !== first ? last : -1;
  }
  if (!(map.chest >= 0)) notes.push('chest: no second spine bone (the chest rides the spine)');

  for (const [k, v] of Object.entries(overrides || {})) {
    const i = byName(v);
    if (i >= 0) map[k] = i; else notes.push(`bones.${k}: no bone named "${v}"`);
  }
  const missing = ['hips', 'spine', 'head', 'thighL', 'shinL', 'thighR', 'shinR', 'armL', 'foreL', 'armR', 'foreR'].filter((k) => !(map[k] >= 0));
  if (!(map.chest >= 0)) map.chest = -1;
  // What lies past the shins and forearms (feet, hands): their direction is what straightens the limb.
  const next = (i) => (i >= 0 ? children[i].find((k) => info[k].role !== 'twist' && info[k].role !== 'end') ?? children[i][0] ?? -1 : -1);
  const foot = { L: find('foot', 'L'), R: find('foot', 'R') }, hand = { L: find('hand', 'L'), R: find('hand', 'R') };
  for (const s of ['L', 'R']) {
    if (!(foot[s] >= 0)) foot[s] = next(map['shin' + s]);
    if (!(hand[s] >= 0)) hand[s] = next(map['fore' + s]);
  }
  return { map, foot, hand, missing, notes };
}

// For each of their bones, the one of ours its vertices follow: the nearest mapped ancestor (itself included), with
// the special cases that make the rig read right: the neck turns with the head, clavicles ride the chest, hands and
// fingers the forearm, feet and toes the shin. Unmapped roots above the hips ride the body. ourIndex: our bone
// name → our bone index (charkit B). Returns an Int16Array (their index → our index).
export function followMap(names, parents, map, ourIndex) {
  const n = names.length, info = names.map(boneRole), own = new Int16Array(n).fill(-1);
  for (const [k, i] of Object.entries(map)) if (i >= 0 && ourIndex[k] !== undefined) own[i] = ourIndex[k];
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    if (own[i] >= 0) { out[i] = own[i]; continue; }
    if (info[i].role === 'neck' && map.head >= 0) { out[i] = ourIndex.head; continue; }
    let j = parents[i];
    while (j >= 0 && own[j] < 0) j = parents[j];
    out[i] = j >= 0 ? own[j] : ourIndex.body;
  }
  // A neck above the chest: its children (the head's ancestors) are handled; its own vertices turn with the head.
  return out;
}
