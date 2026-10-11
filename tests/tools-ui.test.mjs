import test from 'node:test';
import assert from 'node:assert/strict';
import { craftAcknowledgementMatches, WorkbenchPanel, workbenchPreview } from '../src/ui/workbench.js';

const profile = (goods, tools = {}) => ({ eco: { pack: { cap: 10, goods }, tradeRev: 4 }, tools });

test('workbench previews wood batches with the legacy call shape', () => {
  const preview = workbenchPreview(profile({ tronco: 3 }), 2);
  assert.equal(preview.recipe, 'madera');
  assert.equal(preview.inputNeeded, 2);
  assert.equal(preview.outputAmount, 2);
  assert.equal(preview.canCraft, true);
});

test('stone axe preview requires its full material list and shows owned utility state', () => {
  const short = workbenchPreview(profile({ madera: 1, piedra: 0 }), 1, 'hacha_piedra');
  assert.equal(short.inputs.length, 2);
  assert.equal(short.materialsFit, false);
  assert.equal(short.canCraft, false);
  const ready = workbenchPreview(profile({ madera: 1, piedra: 1 }), 1, 'hacha_piedra');
  assert.equal(ready.canCraft, true);
  assert.equal(ready.outputName, 'Hacha de piedra');
  assert.equal(ready.usedBefore, 5);
  assert.equal(ready.usedAfter, 0, 'the consumed materials leave the backpack');
  assert.equal(ready.spaceAfter, 10, 'the fixed utility belt tool adds no backpack volume');
  const owned = workbenchPreview(profile({ madera: 1, piedra: 1 }, { axe: 1 }), 1, 'hacha_piedra');
  assert.equal(owned.ownedTool, true);
  assert.equal(owned.maxCraftable, 0);
  assert.equal(owned.canCraft, false);
});

test('stone pick preview requires two stones and remains a single craft', () => {
  const short = workbenchPreview(profile({ madera: 1, piedra: 1 }), 1, 'pico_piedra');
  assert.equal(short.materialsFit, false);
  assert.equal(short.craftMax, 1);
  const ready = workbenchPreview(profile({ madera: 1, piedra: 2 }), 1, 'pico_piedra');
  assert.equal(ready.canCraft, true);
  assert.equal(ready.tool, 'pickaxe');
  assert.equal(ready.usedBefore, 7);
  assert.equal(ready.usedAfter, 0, 'wood and both stones leave the backpack');
  assert.equal(ready.spaceAfter, 10);
});

test('craft receipt must match the immutable request recipe, output, and next revision', () => {
  const command = Object.freeze({ recipe: 'pico_piedra', n: 1, expectedRev: 8 });
  const pending = { command, recipe: 'pico_piedra', tool: 'pickaxe', tier: 1, count: 1 };
  const valid = { ok: true, tool: 'pickaxe', tier: 1, count: 1, rev: 9 };
  assert.equal(craftAcknowledgementMatches(pending, valid), true);
  for (const bad of [
    { ...valid, tool: 'axe' }, { ...valid, tier: 2 }, { ...valid, count: 2 }, { ...valid, rev: 8 },
  ]) assert.equal(craftAcknowledgementMatches(pending, bad), false);
  assert.equal(Object.isFrozen(command), true);

  const wood = { command: Object.freeze({ recipe: 'madera', expectedRev: 4 }), recipe: 'madera', count: 3 };
  assert.equal(craftAcknowledgementMatches(wood, { ok: true, good: 'madera', count: 3, rev: 5 }), true);
  assert.equal(craftAcknowledgementMatches(wood, { ok: true, good: 'tronco', count: 3, rev: 5 }), false);
});

function panelForConfirm(goods, recipe, qty) {
  const sent = [];
  const panel = Object.create(WorkbenchPanel.prototype);
  panel.qty = qty;
  panel.recipe = recipe;
  panel.pending = null;
  panel.lastResult = '';
  panel.context = () => ({ profile: profile(goods) });
  panel.submitCommand = (command) => { sent.push(command); return true; };
  panel.update = () => {};
  return { panel, sent };
}

test('actual madera confirmation captures the batch label and immutable retry command', () => {
  const { panel, sent } = panelForConfirm({ tronco: 3 }, 'madera', 2);
  assert.equal(panel.confirm(), true);
  const pending = panel.pending;
  assert.equal(pending.label, '2 tablas');
  assert.equal(pending.command.recipe, 'madera');
  assert.equal(pending.command.n, 2);
  assert.equal(Object.isFrozen(pending.command), true);
  panel.recipe = 'pico_piedra';
  panel.qty = 1;
  pending.sentAt = performance.now() - 6000;
  assert.equal(panel.retry(), true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1], 'retry submits the same captured request');
  assert.equal(panel.pending.recipe, 'madera');
});

test('actual tool confirmation captures a single tool request for retry', () => {
  const { panel, sent } = panelForConfirm({ madera: 1, piedra: 2 }, 'pico_piedra', 1);
  assert.equal(panel.confirm(), true);
  assert.equal(panel.pending.label, 'Pico de piedra');
  assert.equal(panel.pending.tool, 'pickaxe');
  assert.equal(panel.pending.command.recipe, 'pico_piedra');
  panel.pending.sentAt = performance.now() - 6000;
  assert.equal(panel.retry(), true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1]);
});
