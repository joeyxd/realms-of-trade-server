// M4.7 P2: the Q / E slots, loadouts per weapon, Doña Sepia and the tattoos' meta (learning, forms, tinta and ranks),
// profiles that survive garbage and a save. Their casts are in tattoos2.test.mjs (P3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tuning } from '../src/data/tuning.js';
import { WEAPONS, WEAPON_KINDS, WEAPON, MASTERY } from '../src/data/weapons.js';
import { SKILL_IDS, ARTS, TATTOOS, TATTOO, DEFAULT_LOADOUT, SLOTS, SLOT_COLS, skillIndex, skillId, castKind } from '../src/data/tattoos.js';
import { DROPS } from '../src/data/loot.js';
import { ECS, PLAYER_FIELDS } from '../src/sim/ecs.js';
import { BTN } from '../src/sim/systems/movement.js';
import { skillOf, setWeapon } from '../src/sim/systems/skills.js';
import { kitUnlocked, refreshStats } from '../src/sim/systems/stats.js';
import { gainXp } from '../src/sim/systems/combat.js';
import { newProfile, sanitizeProfile, PROFILE_VERSION } from '../src/sim/systems/inventory.js';
import { LocalServer } from '../src/net/localServer.js';
import { trustSaves } from '../src/net/saves.js';
import { hmacSaves } from '../server/saves.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { toWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { map, A, arena, clientAndServer } from './helpers.mjs';

const run = (step, n, c = {}) => { const evs = []; for (let i = 0; i < n; i++) evs.push(...step(c)); return evs; };
const dmgTo = (evs, id) => evs.filter((ev) => ev.type === 'damage' && ev.id === id);

// A LocalServer with no bots or enemies. join(id, weapon, save) → entity (calm: no damage taken lately);
// cmd(id, msg) sends a player / dev command; denial(id, msg) → the `why` of its skillDenied ('' when none).
function server(saves) {
  const sent = new Map();
  const s = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, saves, send: (id, m) => { if (!sent.has(id)) sent.set(id, []); sent.get(id).push(JSON.parse(JSON.stringify(m))); } });
  const w = s.world, ecs = w.ecs;
  let seq = 0;
  const join = (id = 1, weapon = 0, save = '') => {
    s.connect(id);
    s.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'P' + id, skin: 0, weapon, save });
    const e = s.clients.get(id).entity;
    ecs.regenT[e] = 99;
    return e;
  };
  const put = (e, x, z) => { ecs.x[e] = x; ecs.z[e] = z; ecs.y[e] = map.groundAt(x, z); };
  const nextTo = (e, id, d = 1.5) => { const n = w.npcs.get(id); put(e, ecs.x[n] + d, ecs.z[n]); };
  const events = (id, type) => (sent.get(id) || []).filter((m) => m.t === MSG.EVENT && m.ev.type === type).map((m) => m.ev);
  const cmd = (id, o) => { s.receive(id, { t: MSG.CMD, ...o }); s.flushEvents(); };
  const dev = (id, o) => cmd(id, { type: 'dev', ...o });
  const denial = (id, o) => { const n = events(id, 'skillDenied').length; cmd(id, o); const all = events(id, 'skillDenied'); return all.length > n ? all.at(-1).why : ''; };
  // One command of the player straight into the world, then a server step.
  const act = (e, o = {}) => {
    w.applyCommand(e, { seq: ++seq, mx: 0, mz: 0, ax: ecs.x[e] + 5, az: ecs.z[e], btn: 0, prs: 0, pt: w.tick, ...o });
    s.step();
  };
  const run2 = (n) => { for (let i = 0; i < n; i++) s.step(); };
  const profileMsgs = (id) => (sent.get(id) || []).filter((m) => m.t === MSG.PROFILE).map((m) => m.p);
  return { s, w, ecs, sent, join, put, nextTo, events, cmd, dev, denial, act, run: run2, profileMsgs };
}

test('tattoo data: a fixed skill order, the arts of each weapon, three tattoos with a base and two ranked forms', () => {
  assert.deepEqual(SKILL_IDS, ['lunge', 'wave', 'blast', 'blink', 'tromba', 'leap', 'wheel']);
  SKILL_IDS.forEach((id, i) => { assert.equal(skillIndex(id), i); assert.equal(skillId(i), id); });
  assert.deepEqual([...Object.keys(ARTS), ...Object.keys(TATTOOS)], SKILL_IDS, 'every id is an art or a tattoo');
  assert.deepEqual(Object.entries(ARTS).map(([id, a]) => [id, a.weapon, a.mastery]),
    [['lunge', 'sable', 1], ['wave', 'sable', 2], ['blast', 'pistolas', 1], ['blink', 'pistolas', 2]]);
  for (const k of WEAPON_KINDS) {
    assert.deepEqual(DEFAULT_LOADOUT[k], [WEAPONS[k].q, WEAPONS[k].e], `${k}: the M4.6 kit`);
    assert.ok(DEFAULT_LOADOUT[k].every((id) => ARTS[id].weapon === k));
    // Today's mastery gates are the arts' (q 1, e 2).
    assert.equal(ARTS[DEFAULT_LOADOUT[k][0]].mastery, MASTERY.unlock.q);
    assert.equal(ARTS[DEFAULT_LOADOUT[k][1]].mastery, MASTERY.unlock.e);
  }
  assert.deepEqual(SKILL_IDS.map(castKind), ['dir', 'dir', 'dir', 'self', 'ground', 'ground', 'charge']);
  assert.deepEqual(Object.values(TATTOOS).map((t) => t.name), ['Tromba', 'Abordaje', 'Timón']);
  for (const t of Object.values(TATTOOS)) {
    assert.equal(t.forms.length, 3);
    assert.equal(t.forms[0].rank, undefined, 'the base asks for nothing');
    assert.deepEqual([t.forms[1].rank, t.forms[2].rank], [2, 4]);
    for (const x of [t, ...t.forms]) assert.ok(x.hint.length > 0 && x.hint.length <= 60, x.hint);
  }
  assert.deepEqual(Object.values(TATTOOS).map((t) => t.forms.map((f) => f.name)),
    [['Tromba', 'Ojo de tormenta', 'Gemelas'], ['Abordaje', 'Parpadeo', 'Ancla de abordaje'], ['Timón', 'Remolino', 'Timón de guerra']]);
  assert.equal(TATTOO.xp.length, TATTOO.maxRank - 1);
  assert.equal(PROFILE_VERSION, 1, 'saves keep their version: sanitizeProfile fills what is missing');
});

test('the slot columns exist, are predicted (PLAYER_FIELDS) and a new entity holds the cutlass kit; elem is one of them', () => {
  const ecs = new ECS(8);
  assert.deepEqual(SLOTS, ['q', 'e']);
  for (const slot of SLOTS) {
    for (const col of Object.values(SLOT_COLS[slot])) {
      assert.ok(ecs[col] instanceof Float64Array, col);
      assert.ok(PLAYER_FIELDS.includes(col), `${col} is predicted`);
    }
  }
  assert.ok(ecs.elem instanceof Float64Array && PLAYER_FIELDS.includes('elem'));
  const e = ecs.create(1, 0);
  assert.deepEqual([ecs.skQ[e], ecs.skE[e], ecs.fmQ[e], ecs.fmE[e], ecs.rkQ[e], ecs.rkE[e], ecs.elem[e]], [0, 1, 0, 0, 1, 1, 0]);
  assert.equal(new Set(PLAYER_FIELDS).size, PLAYER_FIELDS.length, 'no column twice');
});

test('default loadouts are the M4.6 kit for both weapons, with and without a profile', () => {
  // No profile (tests, bots, tools): the weapon's arts, form 0, rank 1.
  const { w, e, step } = arena();
  const ecs = w.ecs;
  const kit = (slot) => skillOf(ecs, e, slot);
  assert.deepEqual([kit('q'), kit('e'), kit('basic'), kit('r')], ['lunge', 'wave', 'combo', 'storm']);
  assert.deepEqual([ecs.fmQ[e], ecs.fmE[e], ecs.rkQ[e], ecs.rkE[e]], [0, 0, 1, 1]);
  setWeapon(w, e, WEAPON.PISTOLAS);
  assert.deepEqual([kit('q'), kit('e'), kit('basic'), kit('r')], ['blast', 'blink', 'pistol', 'rain']);
  assert.deepEqual([skillId(ecs.skQ[e]), skillId(ecs.skE[e])], ['blast', 'blink']);
  assert.deepEqual([skillOf(arena({ weapon: WEAPON.PISTOLAS }).w.ecs, 1, 'q')], ['blast'], 'a pirate spawned with the pistols');
  setWeapon(w, e, WEAPON.SABLE);
  assert.equal(kit('q'), 'lunge');
  assert.ok(step({ prs: BTN.Q }).some((ev) => ev.type === 'cast' && ev.skill === 'lunge'), 'Q still casts the Estocada');
  // With a profile.
  assert.deepEqual(newProfile().sk, { has: {}, lo: [['lunge', 'wave'], ['blast', 'blink']], free: 1 });
  const S = server();
  const a = S.join(1, WEAPON.SABLE), b = S.join(2, WEAPON.PISTOLAS);
  assert.deepEqual([skillOf(S.ecs, a, 'q'), skillOf(S.ecs, a, 'e')], ['lunge', 'wave']);
  assert.deepEqual([skillOf(S.ecs, b, 'q'), skillOf(S.ecs, b, 'e')], ['blast', 'blink']);
  assert.deepEqual([S.ecs.rkQ[b], S.ecs.fmQ[b]], [1, 0]);
});

test('each weapon keeps its own loadout across the rack; a profile-less pirate just gets the weapon\'s arts', () => {
  const S = server();
  const e = S.join(1, WEAPON.PISTOLAS), { ecs, w } = S, rack = map.racks[0];
  S.put(e, rack.x + 1.5, rack.z);
  S.dev(1, { op: 'tattoo', id: 'leap', rank: 3, form: 1 });
  S.dev(1, { op: 'loadout', slot: 'q', id: 'leap' }); // the pistols' Q
  assert.deepEqual(w.profiles.get(e).sk.lo, [['lunge', 'wave'], ['leap', 'blink']]);
  assert.deepEqual([ecs.skQ[e], ecs.rkQ[e], ecs.fmQ[e]], [skillIndex('leap'), 3, 1]);
  S.act(e, { w: WEAPON.SABLE + 1 });
  assert.equal(ecs.weapon[e], WEAPON.SABLE);
  assert.deepEqual([skillOf(ecs, e, 'q'), skillOf(ecs, e, 'e'), ecs.rkQ[e], ecs.fmQ[e]], ['lunge', 'wave', 1, 0], 'the cutlass has its own');
  S.dev(1, { op: 'loadout', slot: 'e', id: 'wheel' }); // bypass: not learned, still shown (rank 1, base form)
  assert.deepEqual([skillOf(ecs, e, 'e'), ecs.rkE[e]], ['wheel', 1]);
  S.act(e, { w: WEAPON.PISTOLAS + 1 });
  assert.equal(ecs.weapon[e], WEAPON.PISTOLAS);
  assert.deepEqual([skillOf(ecs, e, 'q'), skillOf(ecs, e, 'e'), ecs.rkQ[e], ecs.fmQ[e]], ['leap', 'blink', 3, 1], 'and it is back');
  assert.deepEqual(w.profiles.get(e).sk.lo, [['lunge', 'wheel'], ['leap', 'blink']]);
});

test('loadout: a learned tattoo goes into Q then E, the same id in the other slot swaps them, the slot cools down', () => {
  const S = server();
  const e = S.join(1), { ecs, w, cmd, dev, events } = S, p = w.profiles.get(e);
  dev(1, { op: 'tattoos' });
  assert.deepEqual(Object.keys(p.sk.has), ['tromba', 'leap', 'wheel']);
  assert.deepEqual(p.sk.has.leap, [1, 0, 0]);
  cmd(1, { type: 'loadout', slot: 'q', id: 'tromba' });
  assert.deepEqual(p.sk.lo[0], ['tromba', 'wave']);
  assert.deepEqual([ecs.skQ[e], ecs.skE[e]], [skillIndex('tromba'), skillIndex('wave')]);
  assert.equal(ecs.cdQ[e], TATTOO.swapCd, 'the changed slot cools down');
  assert.equal(ecs.cdE[e], 0, 'the other does not');
  let ev = events(1, 'loadout').at(-1);
  assert.deepEqual([ev.to, ev.e, ev.weapon, ev.lo], [e, e, 0, ['tromba', 'wave']]);
  cmd(1, { type: 'loadout', slot: 'e', id: 'leap' });
  assert.deepEqual(p.sk.lo[0], ['tromba', 'leap']);
  assert.equal(ecs.cdE[e], TATTOO.swapCd);
  // The same id into the other slot: they swap (no denial).
  ecs.cdQ[e] = ecs.cdE[e] = 0;
  cmd(1, { type: 'loadout', slot: 'e', id: 'tromba' });
  assert.deepEqual(p.sk.lo[0], ['leap', 'tromba']);
  assert.deepEqual([ecs.skQ[e], ecs.skE[e]], [skillIndex('leap'), skillIndex('tromba')]);
  assert.deepEqual([ecs.cdQ[e], ecs.cdE[e]], [TATTOO.swapCd, TATTOO.swapCd], 'both slots changed');
  assert.equal(events(1, 'skillDenied').length, 0);
  // Asking for what is already there changes nothing (no cooldown) but is answered.
  ecs.cdQ[e] = ecs.cdE[e] = 0;
  const n = events(1, 'loadout').length;
  cmd(1, { type: 'loadout', slot: 'q', id: 'leap' });
  assert.deepEqual([ecs.cdQ[e], ecs.cdE[e]], [0, 0]);
  assert.equal(events(1, 'loadout').length, n + 1);
  // An art of the weapon goes back; a cooldown above the minimum is kept, a pressed buffer is dropped.
  ecs.cdQ[e] = 7; ecs.qBuf[e] = 0.1;
  cmd(1, { type: 'loadout', slot: 'q', id: 'lunge' });
  assert.deepEqual(p.sk.lo[0], ['lunge', 'tromba']);
  assert.equal(ecs.cdQ[e], 7, 'max(cooldown, swapCd)');
  assert.equal(ecs.qBuf[e], 0);
  // The other weapon's loadout was never touched, and the change reaches the owner's profile (and so the save).
  assert.deepEqual(p.sk.lo[1], ['blast', 'blink']);
  S.run(DROPS.profileEvery + 2);
  assert.deepEqual(S.profileMsgs(1).at(-1).sk.lo[0], ['lunge', 'tromba']);
});

test('loadout: every refusal says why and changes nothing (no cooldown either)', () => {
  const S = server();
  const e = S.join(1), { ecs, w, dev, denial } = S, p = w.profiles.get(e);
  dev(1, { op: 'tattoo', id: 'tromba', rank: 1 }); // learned; leap and wheel are not
  const ask = (slot, id) => denial(1, { type: 'loadout', slot, id });
  assert.equal(ask('q', 'nope'), 'unknown');
  assert.equal(ask('q', '__proto__'), 'unknown');
  assert.equal(ask('q', 'constructor'), 'unknown');
  assert.equal(ask('q', ''), 'unknown');
  assert.equal(ask('r', 'tromba'), 'unknown', 'only Q and E are slots');
  assert.equal(ask('toString', 'tromba'), 'unknown');
  assert.equal(ask('q', 'blast'), 'weapon', 'an art of the pistols with the cutlass');
  assert.equal(ask('e', 'blink'), 'weapon');
  assert.equal(ask('q', 'leap'), 'unknown', 'a tattoo you have not learned');
  assert.equal(ask('q', 'tromba'), '', 'the learned one is fine');
  dev(1, { op: 'loadout', slot: 'q', id: 'lunge' });
  ecs.cdQ[e] = ecs.cdE[e] = 0;
  const after = JSON.stringify(p.sk);
  // Inside the lawless Cala nothing changes.
  S.put(e, map.cala.x, map.cala.z);
  assert.ok(w.lawless(e));
  assert.equal(ask('q', 'tromba'), 'lawless');
  S.put(e, A.x, A.z);
  // Damage taken lately, or a cast in progress: 'combat'.
  ecs.regenT[e] = 0;
  assert.equal(ask('q', 'tromba'), 'combat');
  ecs.regenT[e] = TATTOO.calm - 0.01;
  assert.equal(ask('q', 'tromba'), 'combat');
  ecs.regenT[e] = 99; ecs.castK[e] = 1;
  assert.equal(ask('q', 'tromba'), 'combat', 'casting');
  ecs.castK[e] = 0; ecs.dead[e] = 1;
  assert.equal(ask('q', 'tromba'), 'combat', 'dead');
  ecs.dead[e] = 0;
  assert.equal(JSON.stringify(p.sk), after, 'nothing changed');
  assert.deepEqual([ecs.cdQ[e], ecs.cdE[e]], [0, 0], 'no cooldown spent');
  assert.equal(S.events(1, 'loadout').filter((ev) => ev.lo.includes('tromba') && JSON.stringify(ev.lo) !== JSON.stringify(['tromba', 'wave'])).length, 0);
  ecs.regenT[e] = TATTOO.calm; // exactly calm is enough
  assert.equal(ask('q', 'tromba'), '');
  // Anything the server did not understand is just as harmless.
  for (const msg of [{ type: 'loadout' }, { type: 'loadout', slot: 5, id: {} }, { type: 'form' }, { type: 'learn' }, { type: 'learn', id: 7 }, { type: 'form', id: 'tromba', form: 'x' }]) {
    assert.doesNotThrow(() => S.cmd(1, msg));
  }
});

test('Doña Sepia: she stands in the village clear of everything, talking to her works, learning needs you close by', () => {
  const S = server();
  const e = S.join(1), { ecs, w } = S, n = w.npcs.get('tattoo');
  assert.ok(n, 'she is spawned (map npc "tattoo")');
  const def = map.npcs.find((q) => q.id === 'tattoo');
  assert.deepEqual([def.name, def.title], ['Doña Sepia', 'Tatuadora']);
  assert.equal(ecs.names[n], 'Doña Sepia');
  assert.equal(map.zoneAt(def.x, def.z), 'aldea');
  assert.ok(map.groundAt(def.x, def.z) > 0.5, 'on dry ground');
  for (const o of map.npcs) if (o !== def) assert.ok(Math.hypot(o.x - def.x, o.z - def.z) >= 4, `clear of ${o.id}`);
  for (const pr of map.props) if (pr.kind !== 'flower') assert.ok(Math.hypot(pr.x - def.x, pr.z - def.z) - (pr.r || 0) >= 4, `clear of a ${pr.kind}`);
  for (const k of map.racks) assert.ok(Math.hypot(k.x - def.x, k.z - def.z) >= 4, 'clear of the racks');
  assert.ok(map.pathInfo(def.x, def.z).d >= 4, 'clear of the path');
  for (const i of map.queryColliders(def.x, def.z, 8)) { const c = map.colliders[i]; assert.ok(Math.hypot(c.x - def.x, c.z - def.z) - c.r >= 3, 'nothing solid beside her'); }
  const at = toWorld(-102, 3);
  assert.ok(Math.hypot(def.x - at.x, def.z - at.z) < 1e-9);
  // Talking to her (the quest system knows no quest of hers: an empty offer, no shop).
  S.nextTo(e, 'tattoo', 2);
  assert.doesNotThrow(() => S.cmd(1, { type: 'talk', npc: n }));
  const talk = S.events(1, 'talk').at(-1);
  assert.deepEqual([talk.npc, talk.offer, talk.ready, talk.shop], ['tattoo', [], [], 0]);
});

test('learn: the first tattoo is free, the next ones cost 150 gold, and only close to Doña Sepia', () => {
  const S = server();
  const e = S.join(1), { ecs, w, denial, put, nextTo, events } = S, p = w.profiles.get(e);
  const learn = (id) => denial(1, { type: 'learn', id });
  put(e, A.x, A.z);
  assert.equal(learn('tromba'), 'far');
  nextTo(e, 'tattoo', TATTOO.learnR + 0.3);
  assert.equal(learn('tromba'), 'far', 'just out of reach');
  assert.equal(learn('blast'), 'unknown', 'an art is not learned');
  assert.equal(learn('nope'), 'unknown');
  assert.equal(p.sk.free, 1);
  nextTo(e, 'tattoo', TATTOO.learnR - 0.3);
  p.gold = 40;
  assert.equal(learn('tromba'), '', 'free: no gold needed');
  assert.deepEqual(p.sk.has.tromba, [1, 0, 0]);
  assert.equal(p.sk.free, 0);
  assert.equal(p.gold, 40, 'nothing was paid');
  let ev = events(1, 'learned').at(-1);
  assert.deepEqual([ev.to, ev.e, ev.id, ev.cost], [e, e, 'tromba', 0]);
  assert.equal(learn('tromba'), 'unknown', 'already yours');
  assert.equal(learn('leap'), 'gold', 'the second one costs');
  assert.ok(!p.sk.has.leap && p.gold === 40, 'refused: nothing taken');
  p.gold = TATTOO.price - 1;
  assert.equal(learn('leap'), 'gold', 'one coin short');
  p.gold = TATTOO.price + 25;
  assert.equal(learn('leap'), '');
  assert.equal(p.gold, 25);
  ev = events(1, 'learned').at(-1);
  assert.deepEqual([ev.id, ev.cost], ['leap', TATTOO.price]);
  assert.deepEqual(p.sk.has.leap, [1, 0, 0]);
  // A learned tattoo can be equipped now; the one she has not taught cannot.
  ecs.regenT[e] = 99;
  assert.equal(denial(1, { type: 'loadout', slot: 'q', id: 'leap' }), '');
  assert.equal(denial(1, { type: 'loadout', slot: 'e', id: 'wheel' }), 'unknown');
  put(e, A.x, A.z);
  assert.equal(learn('wheel'), 'far');
});

test('form: the rank opens the forms (II → A, IV → B), switching follows the calm rules and cools the equipped slot', () => {
  const S = server();
  const e = S.join(1), { ecs, w, dev, cmd, denial, put, events } = S, has = w.profiles.get(e).sk.has;
  const form = (id, f) => denial(1, { type: 'form', id, form: f });
  dev(1, { op: 'tattoo', id: 'wheel', rank: 1 });
  assert.equal(form('wheel', 1), 'rank');
  assert.equal(form('wheel', 2), 'rank');
  assert.equal(form('wheel', 0), '', 'the base is always there');
  for (const bad of [3, -1, 1.5, '1', null, undefined, NaN]) assert.equal(form('wheel', bad), 'unknown', String(bad));
  assert.equal(form('leap', 0), 'unknown', 'not learned');
  assert.equal(form('lunge', 0), 'unknown', 'an art has no forms');
  dev(1, { op: 'tattoo', id: 'wheel', rank: 2 });
  assert.equal(form('wheel', 2), 'rank');
  dev(1, { op: 'loadout', slot: 'e', id: 'wheel' });
  ecs.cdQ[e] = ecs.cdE[e] = 0;
  assert.equal(form('wheel', 1), '');
  assert.equal(has.wheel[2], 1);
  assert.equal(ecs.fmE[e], 1, 'the slot follows');
  assert.equal(ecs.cdE[e], TATTOO.swapCd, 'an equipped tattoo that changes form cools down');
  assert.equal(ecs.cdQ[e], 0);
  let ev = events(1, 'form').at(-1);
  assert.deepEqual([ev.to, ev.e, ev.id, ev.form], [e, e, 'wheel', 1]);
  // Forms are free to switch back and forth; one that is not equipped costs no cooldown.
  ecs.cdE[e] = 0;
  assert.equal(form('wheel', 0), '');
  assert.equal(ecs.fmE[e], 0);
  dev(1, { op: 'tattoo', id: 'leap', rank: 4 });
  ecs.cdQ[e] = ecs.cdE[e] = 0;
  assert.equal(form('leap', 2), '');
  assert.equal(has.leap[2], 2);
  assert.deepEqual([ecs.cdQ[e], ecs.cdE[e]], [0, 0]);
  // Same rules as the loadout: calm, outside the Cala, not casting.
  ecs.regenT[e] = 0;
  assert.equal(form('leap', 1), 'combat');
  ecs.regenT[e] = 99; ecs.castK[e] = 2;
  assert.equal(form('leap', 1), 'combat');
  ecs.castK[e] = 0;
  put(e, map.cala.x, map.cala.z);
  assert.equal(form('leap', 1), 'lawless');
  put(e, A.x, A.z);
  assert.equal(has.leap[2], 2, 'refusals change nothing');
  cmd(1, { type: 'form', id: 'leap', form: 1 });
  assert.equal(ecs.fmQ[e], 0, 'leap is not in a slot: no column moves');
  assert.equal(has.leap[2], 1);
  ev = events(1, 'form').at(-1);
  assert.deepEqual([ev.id, ev.form], ['leap', 1]);
});

test('tinta: the XP you earn inks the tattoos in your slots, ranks up through 120 / 360 / 900 / 2000, max rank keeps none', () => {
  const S = server();
  const e = S.join(1), { ecs, w, dev, events, denial } = S, has = w.profiles.get(e).sk.has;
  const gain = (n) => { gainXp(w, e, n); S.s.flushEvents(); };
  dev(1, { op: 'tattoos', rank: 1 });
  dev(1, { op: 'loadout', slot: 'q', id: 'tromba' });
  gain(100);
  assert.deepEqual(has.tromba, [1, 100, 0]);
  assert.deepEqual([has.leap[1], has.wheel[1]], [0, 0], 'only what is in a slot');
  assert.equal(events(1, 'tattooRank').length, 0);
  gain(30);
  assert.deepEqual(has.tromba, [2, 10, 0], 'II, the leftover kept');
  assert.equal(ecs.rkQ[e], 2, 'the slot shows the new rank');
  let ev = events(1, 'tattooRank').at(-1);
  assert.deepEqual([ev.to, ev.e, ev.id, ev.rank], [e, e, 'tromba', 2]);
  assert.equal(denial(1, { type: 'form', id: 'tromba', form: 1 }), '', 'rank II opened form A');
  // An art in the other slot is not inked (it has no rank).
  assert.ok(has.lunge === undefined && has.wave === undefined);
  // Several ranks in one go, and max rank holds no XP.
  gain(1e5);
  assert.deepEqual(has.tromba, [5, 0, 1], 'the form chosen stays');
  assert.deepEqual(events(1, 'tattooRank').map((x) => x.rank), [2, 3, 4, 5]);
  assert.equal(ecs.rkQ[e], 5);
  gain(500);
  assert.deepEqual(has.tromba, [5, 0, 1]);
  assert.equal(events(1, 'tattooRank').length, 4, 'no more ranks');
  // The gear's XP bonus counts (gainXp multiplies before the mastery and the tinta hear of it).
  dev(1, { op: 'tattoo', id: 'wheel', rank: 1 });
  dev(1, { op: 'loadout', slot: 'e', id: 'wheel' });
  ecs.xpMul[e] = 1.5;
  gain(10);
  assert.equal(has.wheel[1], 15 * 2 /* catch-up: I below V - 1 */);
});

test('tinta catch-up: a tattoo below (your best − 1) learns twice as fast; only the weapon in hand\'s slots are inked', () => {
  const S = server();
  const e = S.join(1), { w, dev } = S, has = w.profiles.get(e).sk.has;
  dev(1, { op: 'tattoo', id: 'leap', rank: 5 });
  dev(1, { op: 'tattoo', id: 'wheel', rank: 1 });
  dev(1, { op: 'tattoo', id: 'tromba', rank: 3 });
  dev(1, { op: 'loadout', slot: 'q', id: 'wheel' });
  dev(1, { op: 'loadout', slot: 'e', id: 'tromba' });
  gainXp(w, e, 10); // best is V: wheel (I) and tromba (III) are both below IV
  assert.equal(has.wheel[1], 20, 'I < 4: ×2');
  assert.equal(has.tromba[1], 20, 'III < 4: ×2');
  dev(1, { op: 'tattoo', id: 'tromba', rank: 4 });
  gainXp(w, e, 10);
  assert.equal(has.wheel[1], 40);
  assert.equal(has.tromba[1], 10, 'IV is not below IV: ×1');
  assert.equal(has.leap[1], 0, 'at max rank, and not equipped');
  // With the best at III, a rank-I tattoo is one rank short of it (1 < 2): ×2; a rank-II one is not.
  const S2 = server();
  const e2 = S2.join(1), has2 = S2.w.profiles.get(e2).sk.has;
  S2.dev(1, { op: 'tattoo', id: 'leap', rank: 3 });
  S2.dev(1, { op: 'tattoo', id: 'wheel', rank: 2 });
  S2.dev(1, { op: 'tattoo', id: 'tromba', rank: 1 });
  S2.dev(1, { op: 'loadout', slot: 'q', id: 'wheel' });
  S2.dev(1, { op: 'loadout', slot: 'e', id: 'tromba' });
  gainXp(S2.w, e2, 10);
  assert.equal(has2.wheel[1], 10, 'II is not below II: ×1');
  assert.equal(has2.tromba[1], 20, 'I < 2: ×2');
  // The rank-up with catch-up carries what is left over.
  gainXp(S2.w, e2, 50); // tromba: 20 + 100 = 120 → II, 0 left
  assert.deepEqual(has2.tromba, [2, 0, 0]);
  // The pistols' slots are not the cutlass'.
  S2.dev(1, { op: 'loadout', slot: 'q', id: 'lunge' });
  S2.dev(1, { op: 'loadout', slot: 'e', id: 'wave' });
  const wheelXp = has2.wheel[1];
  gainXp(S2.w, e2, 10);
  assert.equal(has2.wheel[1], wheelXp, 'out of the slots: nothing');
});

test('Q / E with a tattoo: it casts from either slot (the Timón spends its cooldown at the throw), is never locked', () => {
  const S = server();
  const e = S.join(1), { ecs, dev, act, events } = S;
  dev(1, { op: 'tattoos', rank: 3 });
  dev(1, { op: 'loadout', slot: 'q', id: 'tromba' });
  dev(1, { op: 'loadout', slot: 'e', id: 'wheel' });
  assert.deepEqual([ecs.cdQ[e], ecs.cdE[e]], [0, 0], 'the dev op costs no cooldown');
  act(e, { prs: BTN.Q });
  assert.ok(events(1, 'cast').some((ev) => ev.skill === 'tromba' && ev.e === e), 'the Tromba from Q');
  assert.ok(ecs.cdQ[e] > 0 && ecs.cdE[e] === 0);
  for (let i = 0; i < 30; i++) act(e);
  act(e, { prs: BTN.E, btn: BTN.E });
  assert.equal(ecs.chg[e], 1, 'E held: the Timón charges');
  assert.equal(ecs.cdE[e], 0, 'no cooldown while charging');
  act(e); // let go: thrown
  assert.ok(events(1, 'wheel').some((ev) => ev.e === e) && ecs.cdE[e] > 0 && ecs.whPh[e] > 0);
  assert.equal(events(1, 'locked').length, 0, 'a tattoo is never locked');
  // A press on a slot that is cooling down does not hold the guard back.
  act(e, { prs: BTN.Q | BTN.GUARD, btn: BTN.GUARD });
  assert.ok(ecs.guardT[e] >= 0, 'the guard is up');
  // An art next to it still works: the cutlass' Q Estocada in the other slot.
  for (let i = 0; i < 300; i++) act(e);
  dev(1, { op: 'loadout', slot: 'e', id: 'lunge' });
  dev(1, { op: 'mastery', level: 3 });
  ecs.cdE[e] = 0;
  act(e, { prs: BTN.E });
  assert.ok(events(1, 'cast').some((ev) => ev.skill === 'lunge' && ev.e === e), 'the lunge from E');
});

test('mastery opens the arts of a slot, wherever they are; a tattoo is never locked', () => {
  const S = server();
  const e = S.join(1), { ecs, dev, act, events } = S;
  const open = () => ['q', 'e', 'r'].map((s) => kitUnlocked(ecs, e, s));
  assert.deepEqual(open(), [true, false, false], 'a fresh pirate: Estocada yes, Hoja de viento no, R no (as in M4.6)');
  dev(1, { op: 'loadout', slot: 'q', id: 'wave' }); // Hoja de viento in Q: needs mastery 2
  dev(1, { op: 'loadout', slot: 'e', id: 'lunge' }); // Estocada in E: needs 1
  assert.deepEqual(open(), [false, true, false]);
  act(e, { prs: BTN.Q });
  assert.ok(events(1, 'locked').some((ev) => ev.slot === 'q' && ev.e === e), 'Q says it is locked');
  assert.equal(ecs.cdQ[e], 0);
  dev(1, { op: 'tattoo', id: 'leap', rank: 1 });
  dev(1, { op: 'loadout', slot: 'q', id: 'leap' });
  assert.deepEqual(open(), [true, true, false], 'a tattoo needs no mastery');
  dev(1, { op: 'loadout', slot: 'q', id: 'wave' });
  dev(1, { op: 'mastery', level: 2 });
  assert.deepEqual(open(), [true, true, false], 'mastery 2 opens Hoja de viento');
  dev(1, { op: 'mastery', level: 3 });
  assert.deepEqual(open(), [true, true, true]);
  // The pistols judge their own arts against their own mastery.
  const P = server();
  const p = P.join(1, WEAPON.PISTOLAS);
  assert.deepEqual(['q', 'e', 'r'].map((s) => kitUnlocked(P.ecs, p, s)), [true, false, false]);
});

test('sanitize: garbage, unknown ids, arts of the wrong weapon and duplicates fall back to sane tattoos and loadouts', () => {
  const clean = (sk) => sanitizeProfile({ ...JSON.parse(JSON.stringify(newProfile())), sk }).sk;
  const fresh = newProfile().sk;
  for (const junk of [undefined, null, 'x', 42, true, [], [1, 2], { has: 5, lo: 'no' }, { has: [], lo: {} }]) {
    const sk = clean(junk);
    assert.deepEqual(sk.lo, fresh.lo, `loadouts of ${JSON.stringify(junk)}`);
    assert.deepEqual(sk.has, {});
    assert.equal(sk.free, 1, 'the first tattoo is still free');
  }
  // Tattoos: known ids only, rank 1–5, xp finite and ≥ 0, a form the rank allows.
  const sk = clean({
    has: {
      tromba: 'x', bogus: [3, 0, 0], constructor: [1, 0, 0], __proto__: [1, 0, 0], lunge: [1, 0, 0],
      leap: [9, -5, 7], wheel: [NaN, Infinity, 'a'],
    },
  });
  assert.deepEqual(Object.keys(sk.has).sort(), ['leap', 'wheel']);
  assert.deepEqual(sk.has.leap, [5, 0, 2], 'rank capped at V (no xp left), form B is allowed at IV+');
  assert.deepEqual(sk.has.wheel, [1, 0, 0], 'non-finite numbers: rank I, no xp, base form');
  assert.equal(sk.free, 0, 'having learned something spends the free one');
  const num = clean({ has: { tromba: [2, 77.5, 1], leap: [-4, -1, -1], wheel: [3.9, 1e12, 2.7] } }).has;
  assert.deepEqual(num.tromba, [2, 77.5, 1]);
  assert.deepEqual(num.leap, [1, 0, 0], 'below I: I, xp ≥ 0, form ≥ 0');
  assert.equal(num.wheel[0], 3);
  assert.ok(num.wheel[1] <= 1e6 && num.wheel[2] === 0, 'form B (needs IV) is refused at III');
  assert.deepEqual(clean({ has: { wheel: [2, 5, 2] } }).has.wheel, [2, 5, 0]);
  assert.deepEqual(clean({ has: { wheel: [4, 5, 2] } }).has.wheel, [4, 5, 2]);
  assert.equal(clean({ has: { wheel: [1, 0, 0] }, free: 1 }).free, 1);
  assert.equal(clean({ free: 0 }).free, 0);
  assert.equal(clean({ free: 'a' }).free, 1);
  // Loadouts: a slot holds an art of that weapon or a learned tattoo, none twice; else the default for the slot.
  const lo = clean({
    has: { leap: [1, 0, 0], wheel: [2, 0, 0] },
    lo: [
      ['blast', 'tromba'],      // cutlass: a pistol art, a tattoo not learned
      ['leap', 'leap'],         // pistols: the same twice
    ],
  }).lo;
  assert.deepEqual(lo[0], ['lunge', 'wave']);
  assert.deepEqual(lo[1], ['leap', 'blink']);
  assert.deepEqual(clean({ lo: [['wave', 'wave'], ['blink', 'blast']] }).lo, [['wave', 'lunge'], ['blink', 'blast']], 'a duplicate becomes the other art; swapped arts are fine');
  assert.deepEqual(clean({ lo: [['wave', 'lunge']] }).lo, [['wave', 'lunge'], ['blast', 'blink']], 'a missing weapon row: its default');
  assert.deepEqual(clean({ lo: [[5, null], ['__proto__', 'constructor']] }).lo, fresh.lo);
  assert.deepEqual(clean({ has: { wheel: [1, 0, 0] }, lo: [['wheel', 'wave'], ['blink', 'wheel']] }).lo, [['wheel', 'wave'], ['blink', 'wheel']], 'a learned tattoo in either slot, either weapon');
  // Whatever it makes is a fixed point, and a populated profile survives the trip untouched.
  const again = sanitizeProfile(JSON.parse(JSON.stringify({ ...newProfile(), sk })));
  assert.deepEqual(again.sk, sk);
  const p = newProfile();
  p.sk = { has: { tromba: [3, 40.25, 1], leap: [5, 0, 2] }, lo: [['tromba', 'wave'], ['leap', 'blink']], free: 0 };
  assert.deepEqual(sanitizeProfile(JSON.parse(JSON.stringify(p))), p);
  assert.deepEqual(sanitizeProfile(JSON.parse(JSON.stringify(newProfile()))), newProfile());
});

test('a save and a load keep the tattoos: the profile, the signed blob and the slots of the pirate who joins with it', () => {
  const S = server();
  const e = S.join(1), { ecs, w, dev, denial } = S, p = w.profiles.get(e);
  dev(1, { op: 'tattoos', rank: 1 });
  dev(1, { op: 'tattoo', id: 'leap', rank: 4, form: 2 });
  dev(1, { op: 'tattoo', id: 'wheel', rank: 2, form: 1 });
  p.sk.free = 0;
  assert.equal(denial(1, { type: 'loadout', slot: 'q', id: 'leap' }), '');
  assert.equal(denial(1, { type: 'loadout', slot: 'e', id: 'wheel' }), '');
  gainXp(w, e, 150);
  const want = JSON.parse(JSON.stringify(p.sk));
  assert.deepEqual(want.lo, [['leap', 'wheel'], ['blast', 'blink']]);
  for (const saves of [trustSaves, hmacSaves('k')]) {
    const blob = saves.store(p);
    assert.deepEqual(saves.load(blob).sk, want, saves.kind);
    // A new server, a new pirate: the loadout is already in the slots (no press needed).
    const T = server(saves);
    const e2 = T.join(1, 0, blob), p2 = T.w.profiles.get(e2);
    assert.deepEqual(p2.sk, want);
    assert.deepEqual([skillId(T.ecs.skQ[e2]), skillId(T.ecs.skE[e2])], ['leap', 'wheel']);
    assert.deepEqual([T.ecs.rkQ[e2], T.ecs.fmQ[e2], T.ecs.rkE[e2], T.ecs.fmE[e2]], [want.has.leap[0], 2, want.has.wheel[0], 1]);
  }
  assert.deepEqual([ecs.rkQ[e], ecs.fmQ[e]], [4, 2]);
  // An old save (no `sk`) loads with the defaults and the free tattoo.
  const old = JSON.parse(JSON.stringify(newProfile()));
  delete old.sk;
  const q = sanitizeProfile(old);
  assert.deepEqual(q.sk, newProfile().sk);
});

test('elem: a blow carries the attacker\'s element onto its damage event (melee, Estocada, Hoja, bullets, Tormenta, strike)', () => {
  const { w, e, step } = arena();
  const ecs = w.ecs;
  // A fresh dummy in front of the pirate and cooldowns cleared, for each blow.
  let d = 0;
  const fresh = () => {
    if (d) w.despawn(d);
    ecs.cdQ[e] = ecs.cdE[e] = 0;
    d = w.debugSpawn('dummy', ecs.x[e] + 2, ecs.z[e], 0);
    run(step, 40);
  };
  const blow = (prs, n = 40) => dmgTo([...step({ prs }), ...run(step, n)], d);
  // No element: the field is not there at all.
  fresh();
  let hits = blow(BTN.ATTACK);
  assert.ok(hits.length >= 1 && hits.every((ev) => !('elem' in ev)), 'melee, elem 0');
  ecs.elem[e] = 3;
  fresh();
  hits = blow(BTN.ATTACK);
  assert.ok(hits.length >= 1 && hits.every((ev) => ev.kind === 'melee' && ev.elem === 3), 'melee');
  fresh();
  hits = blow(BTN.Q);
  assert.ok(hits.length >= 1 && hits.every((ev) => ev.kind === 'skill' && ev.elem === 3), 'Estocada');
  fresh();
  hits = blow(BTN.E);
  assert.ok(hits.length >= 1 && hits.every((ev) => ev.kind === 'skill' && ev.elem === 3), 'Hoja de viento');
  fresh();
  ecs.riposte[e] = tuning.parry.riposte.max;
  hits = blow(BTN.R, 6);
  assert.ok(hits.length >= 1 && hits.every((ev) => ev.kind === 'wave' && ev.elem === 3), 'Tormenta');
  // A direct strike, with and without.
  w.events.length = 0;
  w.strike(d, 5, { by: e, kind: 'skill', x: ecs.x[e], z: ecs.z[e], elem: 2 });
  assert.equal(w.events.find((ev) => ev.type === 'damage').elem, 2);
  w.events.length = 0;
  w.strike(d, 5, { by: e, kind: 'skill', x: ecs.x[e], z: ecs.z[e], elem: 0 });
  assert.ok(!('elem' in w.events.find((ev) => ev.type === 'damage')));
  // Pistol bullets (the blast's pellets too): the owner's element when they land.
  const P = arena({ weapon: WEAPON.PISTOLAS });
  const d2 = P.w.debugSpawn('dummy', P.w.ecs.x[P.e] + 5, P.w.ecs.z[P.e], 0);
  run(P.step, 4);
  P.w.ecs.elem[P.e] = 4;
  const evs = [...P.step({ prs: BTN.ATTACK }), ...run(P.step, 30)];
  assert.ok(dmgTo(evs, d2).length >= 1 && dmgTo(evs, d2).every((ev) => ev.kind === 'bullet' && ev.elem === 4), 'bullets');
  // Stats refreshes and a fresh spawn set it to 0 (M4.8 will set it from the pearl).
  refreshStats(P.w, P.e);
  assert.equal(P.w.ecs.elem[P.e], 0);
  assert.equal(arena().w.ecs.elem[1], 0);
});

test('prediction: a client that swaps weapons at a rack predicts the slots, forms and ranks exactly as the server does', () => {
  const rack = map.racks[0];
  const { server, client, deliver, se, ecs } = clientAndServer(() => [rack.x + 1.5, rack.z]);
  const me = client.youLocal, pe = client.pred.ecs;
  const cols = ['skQ', 'skE', 'fmQ', 'fmE', 'rkQ', 'rkE', 'elem', 'cdQ', 'cdE', 'qBuf', 'eBuf', 'castK'];
  const send = (m) => { server.receive(1, { t: MSG.CMD, ...m }); deliver(); };
  // One command on both sides; compare what the client predicted with what the server made of the same command
  // (before any snapshot can overwrite the prediction). settle() lets server-side changes reach the client first.
  let n = 0;
  const tick = (o = {}, compare = true) => {
    client.tickInput({ mx: 0, mz: 0, ax: ecs.x[se] + 5, az: ecs.z[se], btn: 0, prs: 0, ...o });
    const predicted = cols.map((k) => pe[k][me]);
    server.step();
    if (compare) cols.forEach((k, i) => assert.equal(predicted[i], ecs[k][se], `command ${++n}: ${k}`));
    deliver();
  };
  const settle = () => { for (let i = 0; i < DROPS.profileEvery + 4; i++) tick({}, false); };
  ecs.regenT[se] = 99;
  send({ type: 'dev', op: 'tattoo', id: 'leap', rank: 3, form: 1 });
  send({ type: 'dev', op: 'tattoo', id: 'wheel', rank: 5, form: 2 });
  send({ type: 'loadout', slot: 'q', id: 'leap' }); // the cutlass' Q
  settle();
  assert.equal(skillId(ecs.skQ[se]), 'leap');
  assert.deepEqual([skillId(pe.skQ[me]), pe.rkQ[me], pe.fmQ[me]], ['leap', 3, 1], 'the client has it too');
  for (let i = 0; i < 5; i++) tick();
  tick({ w: WEAPON.PISTOLAS + 1 });
  assert.equal(ecs.weapon[se], WEAPON.PISTOLAS);
  assert.deepEqual([skillId(pe.skQ[me]), skillId(pe.skE[me])], ['blast', 'blink'], 'the pistols\' own arts');
  send({ type: 'dev', op: 'loadout', slot: 'e', id: 'wheel' });
  settle();
  for (let i = 0; i < 3; i++) tick();
  tick({ w: WEAPON.SABLE + 1 });
  assert.deepEqual([skillId(pe.skQ[me]), pe.rkQ[me], pe.fmQ[me]], ['leap', 3, 1], 'back to the cutlass: its loadout');
  tick({ w: WEAPON.PISTOLAS + 1 });
  assert.deepEqual([skillId(pe.skQ[me]), skillId(pe.skE[me]), pe.rkE[me], pe.fmE[me]], ['blast', 'wheel', 5, 2], 'and the pistols again');
  for (let i = 0; i < 5; i++) tick({ prs: i === 0 ? BTN.Q : 0 }); // a press on an art: predicted like before
  // The columns travel in the `you` snapshot.
  const you = server.world.playerState(se);
  for (const k of cols) assert.equal(you[PLAYER_FIELDS.indexOf(k)], ecs[k][se], k);
});
