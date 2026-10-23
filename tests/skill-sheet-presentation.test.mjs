import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { setLocale } from '../src/core/i18n.js';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'gsap') return { url: 'data:text/javascript,export const gsap={fromTo(){}}', shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { CharacterScreen } = await import('../src/ui/characterScreen.js');
const { skillListHtml, skillCenterHtml, skillRightHtml, skillSheetState, HERO_ART } = await import('../src/ui/skillSheet.js');

const count = (html, re) => (html.match(re) || []).length;
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

function fixture() {
  const profile = {
    eq: {}, bag: [], gold: 80, mast: [[3, 10], [1, 0]],
    sk: { has: { tromba: [2, 12, 0] }, lo: [['lunge', 'wave'], ['blast', 'blink']], free: 0 },
    eco: { pack: { cap: 50, goods: {} } }, tools: {}, pearls: { swallowed: null, bag: [] },
  };
  const screen = Object.create(CharacterScreen.prototype);
  Object.assign(screen, { tab: 'skills', learn: false, skTree: 'combat', skNode: null, ttSel: null, parts: {},
    profile: () => profile, stats: () => ({ weapon: 0, level: 5, potions: 2, gold: 80 }),
    weapon: () => 0, slots: () => ({ q: 'lunge', e: 'wave' }), isOpen: true, root: { hidden: false, querySelector: () => null } });
  return { profile, screen };
}
const parts = (screen, profile, lang) => { setLocale(lang); return screen.treeParts(profile, lang); };

test('kind() is tree on the Habilidades tab and wide in the Dona Sepia learn flow', () => {
  const { screen } = fixture();
  assert.equal(screen.kind(), 'tree');
  screen.learn = true;
  assert.equal(screen.kind(), 'wide');
  screen.learn = false; screen.tab = 'stats'; screen.statsAll = false;
  assert.equal(screen.kind(), 'sheet');
  screen.tab = 'gear';
  assert.equal(screen.kind(), 'sheet');
  screen.tab = 'pearl';
  assert.equal(screen.kind(), 'wide');
});

test('the tree shell has the sheet grid areas and no figure canvas, and the figure never draws', (t) => {
  t.after(() => setLocale('es'));
  setLocale('es');
  const { screen } = fixture();
  const html = screen.shellHtml(screen.t(), 'tree');
  assert.match(html, /class="cp ch-screen is-tree ch-on-skills interactive"/);
  for (const part of ['left', 'center', 'right', 'quick']) assert.match(html, new RegExp(`data-part="${part}"`));
  assert.doesNotMatch(html, /ch-model|<canvas|data-view/);
  let drawn = 0;
  screen.figure = () => { drawn++; };
  screen.figureAnimated = () => true;
  screen.reducedMotion = () => false;
  screen.drawFigure(true);
  assert.equal(drawn, 0);
  assert.equal(screen.shouldAnimateFigure(), false);
});

test('combat renders five trees and fifteen node cells; closed tiers carry the lock', (t) => {
  t.after(() => setLocale('es'));
  const { profile, screen } = fixture();
  const html = parts(screen, profile, 'es');
  assert.equal(count(html.left, /data-tree=/g), 5);
  assert.equal(count(html.center, /data-node=/g), 15);
  assert.doesNotMatch(html.left, /exploration|Exploraci/);
  // Mastery 3 + 1 gives combat rank 3: tiers I and II are open, III to V closed.
  assert.equal(count(html.center, /class="sk-tier is-closed"/g), 3);
  assert.match(html.center, /class="sk-tier is-closed"[^>]*><b>III<\/b>[\s\S]*?<i class="sk-lock"><svg/);
  assert.match(html.center, /class="sk-tier"[^>]*><b>II<\/b>/);
  assert.equal(count(html.center, /sk-cell is-locked/g) >= 9, true, 'the nodes of closed tiers look locked');
  // Lunge (saber 3 >= 1) is ranked; the pistol art Blast needs the pistols in hand, so it is locked.
  assert.match(html.center, /class="sk-cell is-ranked[^"]*"[^>]*data-node="lunge"/);
  assert.match(html.center, /class="sk-cell is-locked[^"]*"[^>]*data-node="blast"/);
  // Another tree: six nodes and nine empty placeholders.
  screen.skTree = 'sailing';
  const sailing = parts(screen, profile, 'es');
  assert.equal(count(sailing.center, /data-node=/g), 6);
  assert.equal(count(sailing.center, /sk-cell is-empty/g), 9);
  assert.equal(count(sailing.left, /data-tree=/g), 5);
  assert.match(sailing.left, /class="sk-tree is-selected"[^>]*data-tree="sailing"/);
});

test('ES and EN names, the Subir button and the tree texts appear in each language', (t) => {
  t.after(() => setLocale('es'));
  const { profile, screen } = fixture();
  screen.skNode = 'lunge';
  const es = parts(screen, profile, 'es');
  assert.match(es.center, /Estocada/);
  assert.doesNotMatch(es.center, /Lunge/);
  assert.match(text(es.right), /Estocada/);
  assert.match(text(es.right), /Activa/);
  assert.match(text(es.right), /Siguiente rango/);
  assert.match(text(es.right), /Requiere rango 1 de Combate/);
  assert.match(text(es.right), /Sable en mano/);
  assert.match(es.right, /<button class="btn sk-raise" type="button" disabled title="Disponible pronto">Subir<\/button>/);
  const en = parts(screen, profile, 'en');
  assert.match(en.center, /Lunge/);
  assert.doesNotMatch(en.center, /Estocada/);
  assert.match(text(en.right), /Active/);
  assert.match(text(en.right), /Next rank/);
  assert.match(text(en.right), /Needs Combat rank 1/);
  assert.match(text(en.right), /Saber in hand/);
  assert.match(en.right, /<button class="btn sk-raise" type="button" disabled title="Coming soon">Raise<\/button>/);
  // The disabled button carries no action attribute.
  assert.doesNotMatch(en.right.match(/<button class="btn sk-raise"[^>]*>/)[0], /data-/);
});

test('a known tattoo node and a usable art keep Poner en Q / E and the forms reachable', (t) => {
  t.after(() => setLocale('es'));
  const { profile, screen } = fixture();
  screen.skNode = 'tromba';
  const tattoo = parts(screen, profile, 'es');
  assert.match(tattoo.right, /data-put="q"/);
  assert.match(tattoo.right, /data-put="e"/);
  assert.match(tattoo.right, /data-form="0"/);
  assert.equal(screen.ttSel, 'tromba');
  screen.skNode = 'lunge';
  assert.match(parts(screen, profile, 'es').right, /data-put="q"/);
  assert.equal(screen.ttSel, 'lunge');
  // An art of the other weapon, an unlearned tattoo and a passive offer no loadout buttons.
  for (const node of ['blast', 'leap', 'temple', 'storm']) {
    screen.skNode = node;
    assert.doesNotMatch(parts(screen, profile, 'es').right, /data-put=|data-learn=/, node);
  }
});

test('draft nodes say the effect is to be defined and summaries name how a tree trains', (t) => {
  t.after(() => setLocale('es'));
  const { profile, screen } = fixture();
  screen.skTree = 'survival'; screen.skNode = 'swimmer';
  assert.match(text(parts(screen, profile, 'es').right), /Efecto por definir/);
  assert.match(text(parts(screen, profile, 'en').right), /Effect to be defined/);
  screen.skNode = null;
  const summary = text(parts(screen, profile, 'es').right);
  assert.match(summary, /Se entrena con tala/);
  assert.match(parts(screen, profile, 'es').right, /cp-logging/);
  assert.match(text(parts(screen, profile, 'en').right), /Trained by logging/);
  screen.skTree = 'combat';
  assert.doesNotMatch(text(parts(screen, profile, 'es').right), /Se entrena con/);
  assert.match(text(parts(screen, profile, 'es').right), /Práctica de combate: suma de la maestría de tus armas/);
  for (const tree of ['sailing', 'crafting', 'trade']) {
    screen.skTree = tree;
    assert.match(text(parts(screen, profile, 'es').right), /Se entrena con/, tree);
  }
});

test('active node ranks show the current to next table', (t) => {
  t.after(() => setLocale('es'));
  const { profile, screen } = fixture();
  screen.skNode = 'lunge';
  const right = text(parts(screen, profile, 'es').right);
  assert.match(right, /Daño/);
  assert.match(right, /\+0 % → \+\d+(,\d)? %/);
  screen.skNode = 'temple';
  assert.match(text(parts(screen, profile, 'en').right), /Parry margin/);
});

test('the render is deterministic and the hero boxes paint the shipped art with its mobile variant', (t) => {
  t.after(() => setLocale('es'));
  const { profile, screen } = fixture();
  screen.skNode = 'wave';
  assert.deepEqual(parts(screen, profile, 'es'), parts(screen, profile, 'es'));
  const html = Object.values(parts(screen, profile, 'es')).join('');
  assert.equal(HERO_ART.size, 5);
  assert.match(html, /class="sk-paint" style="--art:url\('assets\/ui\/skills\/hero-combat\.webp'\);--art-m:url\('assets\/ui\/skills\/hero-combat-mobile\.webp'\)" aria-hidden="true"/);
  assert.match(html, /class="sk-hero" style="--art:url\('assets\/ui\/skills\/hero-combat\.webp'\);--art-m:url\('assets\/ui\/skills\/hero-combat-mobile\.webp'\)" aria-hidden="true"/);
  assert.doesNotMatch(html, /is-empty/);
  assert.doesNotMatch(html, /hero-exploration/);
  // Builders are pure: the same state renders the same strings.
  const state = skillSheetState(profile, 0), sel = { tree: 'combat', node: 'wave' };
  assert.equal(skillListHtml(state, sel, 'es'), skillListHtml(state, sel, 'es'));
  assert.equal(skillCenterHtml(state, sel, 'en'), skillCenterHtml(state, sel, 'en'));
  assert.equal(skillRightHtml(state, sel, 'en'), skillRightHtml(state, sel, 'en'));
});

test('clicking a tree selects it and clears the node; clicking a node toggles it', (t) => {
  t.after(() => setLocale('es'));
  const { screen } = fixture();
  let renders = 0;
  screen.render = () => { renders++; };
  const click = (selector, dataset) => screen.onClick({ target: { closest: (s) => (s === selector ? { dataset } : null) } });
  screen.skNode = 'lunge';
  click('[data-tree]', { tree: 'trade' });
  assert.deepEqual([screen.skTree, screen.skNode, renders], ['trade', null, 1]);
  click('[data-node]', { node: 'haggling' });
  assert.equal(screen.skNode, 'haggling');
  click('[data-node]', { node: 'haggling' });
  assert.equal(screen.skNode, null);
  click('[data-node]', { node: 'lunge' }); // a node of another tree is ignored
  assert.equal(screen.skNode, null);
  click('[data-tree]', { tree: 'exploration' }); // the hidden tree is not selectable
  assert.equal(screen.skTree, 'trade');
  assert.equal(renders, 3);
});

test('skills atlas: every tree and combat node has a painted cell; the five heroes ship with a mobile variant', async () => {
  const { ICON_ATLASES, hasAtlasIcon } = await import('../src/ui/kit.js');
  const { TREES, NODES } = await import('../src/data/skillTree.js');
  assert.equal(ICON_ATLASES.skills.ids.length, 21);
  for (const tree of TREES) assert.ok(hasAtlasIcon(tree.icon), tree.id);
  for (const node of NODES.filter((n) => n.tree === 'combat')) assert.ok(hasAtlasIcon(node.icon), node.id);
  assert.deepEqual([...HERO_ART], TREES.filter((t) => !t.hidden).map((t) => t.id));
  const { profile } = fixture();
  const state = skillSheetState(profile, 0), sel = { tree: 'combat', node: 'wave' };
  const html = skillCenterHtml(state, sel, 'es') + skillRightHtml(state, sel, 'es');
  assert.ok(html.includes('skills/hero-combat.webp') && html.includes('skills/hero-combat-mobile.webp'));
  assert.ok(html.includes('data-atlas="skills"'));
});

// SK04b: the Subir and Reiniciar arbol buttons and the status line. The sheet only renders the controller view.
const open = { enabled: true, busy: false, statusKey: 'idle', statusWhy: '' };
const adopted = (profile, extra = {}) => ({ ...profile, gold: 200, progression: { skills: {}, skg: { combat: 2 }, ...extra } });
const rightOf = (profile, node, lang, controls) => {
  const state = skillSheetState(profile, 0);
  return skillRightHtml(state, { tree: 'combat', node }, lang, {}, controls);
};
const buttonOf = (html, cls) => html.match(new RegExp(`<button class="btn ${cls}"[^>]*>`))[0];
const statusOf = (html) => html.match(/<p class="sk-status"[^>]*>([^<]*)/);

test('flag off: Subir and the reset are disabled and the locked note is shown in both languages', () => {
  const { profile } = fixture();
  const p = adopted(profile);
  for (const [lang, note] of [['es', 'Las acciones están deshabilitadas.'], ['en', 'Actions are disabled.']]) {
    const node = rightOf(p, 'lunge', lang);
    assert.match(buttonOf(node, 'sk-raise'), /disabled/);
    assert.doesNotMatch(buttonOf(node, 'sk-raise'), /data-skill-op/);
    assert.ok(text(node).includes(note), lang);
    const summary = rightOf(p, null, lang, { enabled: false });
    assert.match(buttonOf(summary, 'sk-reset'), /disabled/);
    assert.ok(text(summary).includes(note), lang);
  }
});

test('flag on with free points and an open tier: Subir carries the assign action, tree and node', () => {
  const { profile } = fixture();
  const html = rightOf(adopted(profile), 'lunge', 'es', open);
  const button = buttonOf(html, 'sk-raise');
  assert.match(button, /data-skill-op="assign" data-tree="combat" data-node="lunge"/);
  assert.doesNotMatch(button, /disabled/);
  assert.doesNotMatch(html, /sk-note/);
  assert.match(html, /<p class="sk-status" data-status="idle"/);
});

test('Subir names its reason: no free points, closed tier, max rank, draft node', () => {
  const { profile } = fixture();
  const none = adopted(profile, { skg: { combat: 0 }, skills: { lunge: 3, wave: 3 } }); // 6 spent, 4 earned
  assert.match(buttonOf(rightOf(none, 'blast', 'es', open), 'sk-raise'), /disabled title="Sin puntos libres"/);
  assert.match(buttonOf(rightOf(none, 'blast', 'en', open), 'sk-raise'), /disabled title="No free points"/);
  // Tier III of combat is closed at rank 3.
  assert.match(buttonOf(rightOf(adopted(profile), 'storm', 'es', open), 'sk-raise'), /disabled title="Nivel cerrado"/);
  assert.match(buttonOf(rightOf(adopted(profile, { skills: { lunge: 3 } }), 'lunge', 'en', open), 'sk-raise'), /disabled title="Max rank reached"/);
  assert.match(buttonOf(rightOf(adopted(profile), 'temple', 'es', open), 'sk-raise'), /disabled title="Bloqueada"/); // saber mastery 5 needed
  assert.match(buttonOf(rightOf(adopted(profile), 'pearl_affinity', 'es', open), 'sk-raise'), /disabled title="Disponible pronto"/);
});

test('the reset shows the free line at skr 0 and the 150 gold line after a reset', () => {
  const { profile } = fixture();
  const spent = { skills: { lunge: 1 } };
  const first = rightOf(adopted(profile, spent), null, 'es', open);
  assert.match(buttonOf(first, 'sk-reset'), /data-skill-op="reset" data-tree="combat"/);
  assert.doesNotMatch(buttonOf(first, 'sk-reset'), /disabled/);
  assert.ok(text(first).includes('Reiniciar árbol'));
  assert.ok(text(first).includes('Primer reinicio gratis'));
  assert.ok(text(rightOf(adopted(profile, spent), null, 'en', open)).includes('First reset is free'));
  const again = rightOf(adopted(profile, { ...spent, skr: { combat: 1 } }), null, 'es', open);
  assert.ok(text(again).includes('Cuesta 150 de oro'));
  assert.ok(!text(again).includes('Primer reinicio gratis'));
  assert.ok(text(rightOf(adopted(profile, { ...spent, skr: { combat: 1 } }), null, 'en', open)).includes('Costs 150 gold'));
  assert.match(buttonOf(again, 'sk-reset'), /data-skill-op="reset"/); // gold 200 covers the price
  const poor = rightOf({ ...adopted(profile, { ...spent, skr: { combat: 1 } }), gold: 149 }, null, 'es', open);
  assert.match(buttonOf(poor, 'sk-reset'), /disabled title="Oro insuficiente"/);
  const free = rightOf({ ...adopted(profile, spent), gold: 0 }, null, 'es', open);
  assert.doesNotMatch(buttonOf(free, 'sk-reset'), /disabled/); // the first reset costs nothing
  assert.match(buttonOf(rightOf(adopted(profile), null, 'es', open), 'sk-reset'), /disabled title="No hay puntos gastados"/);
});

test('busy disables both buttons and the status line says waiting; denials and saves are localized', () => {
  const { profile } = fixture();
  const busy = { ...open, busy: true, statusKey: 'waiting' };
  const p = adopted(profile, { skills: { lunge: 1 } });
  const node = rightOf(p, 'wave', 'es', busy), summary = rightOf(p, null, 'en', busy);
  assert.match(buttonOf(node, 'sk-raise'), /disabled/);
  assert.match(buttonOf(summary, 'sk-reset'), /disabled/);
  assert.match(node, /data-status="waiting"[^>]*>Enviando\.\.\./);
  assert.match(summary, /data-status="waiting"[^>]*>Sending\.\.\./);
  const status = (statusKey, statusWhy, lang) => statusOf(rightOf(p, 'wave', lang, { ...open, statusKey, statusWhy }))[1];
  assert.equal(status('denial', 'points', 'es'), 'No hay puntos libres.');
  assert.equal(status('denial', 'gold', 'en'), 'Not enough gold.');
  assert.equal(status('denial', 'storage', 'es'), 'No se pudo confirmar el guardado.');
  assert.equal(status('denial', 'nonsense', 'es'), 'La operación fue rechazada.');
  assert.equal(status('denial', 'constructor', 'en'), 'The operation was rejected.');
  assert.equal(status('synced', '', 'es'), 'Guardado');
  assert.equal(status('sessionOnly', '', 'en'), 'Saved for this session only');
  assert.equal(status('sessionOnly', '', 'es'), 'Guardado solo en esta sesión');
  assert.equal(status('idle', '', 'es'), '');
});

test('every server denial code has its own text in both languages', () => {
  const { profile } = fixture();
  for (const why of ['command', 'profile', 'limit', 'conflict', 'draft', 'tier', 'max', 'points', 'gate', 'empty', 'gold', 'disabled', 'account_required', 'busy', 'storage']) {
    for (const [lang, generic] of [['es', 'La operación fue rechazada.'], ['en', 'The operation was rejected.']]) {
      const line = statusOf(rightOf(profile, 'lunge', lang, { ...open, statusKey: 'denial', statusWhy: why }))[1];
      assert.ok(line.length > 0 && line !== generic, `${why} ${lang}`);
    }
  }
});

test('clicking Subir and the reset sends the controller command with the tree and node, then renders', () => {
  const { screen } = fixture();
  const sent = [];
  let renders = 0;
  screen.skills = { act: (op, args) => { sent.push([op, args]); return true; } };
  screen.render = () => { renders++; };
  const click = (dataset, disabled = false) => screen.onClick({ target: { closest: (s) => (s === '[data-skill-op]' ? { dataset, disabled } : null) } });
  click({ skillOp: 'assign', tree: 'combat', node: 'lunge' });
  click({ skillOp: 'reset', tree: 'combat' });
  click({ skillOp: 'assign', tree: 'combat', node: 'wave' }, true);
  click({ skillOp: 'retry', tree: 'combat' });
  assert.deepEqual(sent, [['assign', { tree: 'combat', node: 'lunge' }], ['reset', { tree: 'combat', node: undefined }], ['retry', { tree: 'combat', node: undefined }]]);
  assert.equal(renders, 3);
});

test('the retry button renders only while retryReady, in both languages and both columns', () => {
  const { profile } = fixture();
  const p = adopted(profile, { skills: { lunge: 1 } });
  const ready = { enabled: true, busy: true, retryReady: true, statusKey: 'waiting' };
  for (const [lang, label] of [['es', 'Reintentar'], ['en', 'Retry']]) {
    for (const html of [rightOf(p, 'wave', lang, ready), rightOf(p, null, lang, ready)]) {
      const retry = buttonOf(html, 'sk-retry');
      assert.match(retry, /data-skill-op="retry"/);
      assert.doesNotMatch(retry, /disabled/);
      assert.ok(text(html).includes(label), lang);
      assert.match(buttonOf(html, html.includes('sk-raise') ? 'sk-raise' : 'sk-reset'), /disabled/);
    }
  }
  for (const controls of [{ ...ready, retryReady: false }, { enabled: true, busy: false, retryReady: true, statusKey: 'idle' }, { enabled: false, busy: true, retryReady: true, statusKey: 'waiting' }]) {
    assert.doesNotMatch(rightOf(p, 'wave', 'es', controls), /sk-retry|data-skill-op="retry"/);
    assert.doesNotMatch(rightOf(p, null, 'en', controls), /sk-retry|data-skill-op="retry"/);
  }
});
