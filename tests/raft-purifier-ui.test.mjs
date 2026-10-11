import test from 'node:test';
import assert from 'node:assert/strict';
import { EDITOR_PARTS } from '../src/data/raftEditor.js';
import { CommercePanel } from '../src/ui/commerce.js';
import { RaftEditor } from '../src/ui/raftEditor.js';
import { newHold } from '../src/sim/economy/cargo.js';
import { productionKey } from '../src/sim/economy/raftProduction.js';
import { getLocale, setLocale, t } from '../src/core/i18n.js';

function commerceFor({ parts, activeParts = parts, voyage = false, work = {} }) {
  const panel = Object.create(CommercePanel.prototype);
  const hold = newHold(40);
  const grid = { parts, work };
  const context = {
    record: { id: 'raft-a', rev: 1, parts: activeParts, voyage },
    ship: { id: 'raft-a', rev: 1, grid, hold },
    profile: { eco: { tradeRev: 1 } },
  };
  panel.context = () => context;
  panel.productionStatus = null;
  panel.cargoSnapshot = null;
  panel.fireEnabled = () => true;
  return panel;
}

test('purifier is available in the raft editor with an ES/EN label and passive production help', () => {
  assert.ok(EDITOR_PARTS.includes('purifier'));
  const button = { innerHTML: '' };
  const editor = Object.create(RaftEditor.prototype);
  editor.$ = () => button;
  editor.root = { querySelectorAll: () => [] };
  editor.syncStoragePalette = () => {};

  const oldLocale = getLocale();
  try {
    setLocale('es'); editor.renderPalette();
    assert.match(button.innerHTML, /data-part="purifier"/);
    assert.match(button.innerHTML, /Purificador/);
    assert.match(t('systems.raft.purifierHelp'), /96 s simulados/);
    assert.match(t('systems.raft.purifierHelp'), /No usa combustible/);
    assert.match(t('systems.raft.purifierHelp'), /con H o el botón táctil/);
    setLocale('en'); editor.renderPalette();
    assert.match(button.innerHTML, /Purifier/);
    assert.match(t('systems.raft.purifierHelp'), /96 simulated seconds/);
    assert.match(t('systems.raft.purifierHelp'), /no fuel/i);
    assert.match(t('systems.raft.purifierHelp'), /with H or its touch button/);
  } finally {
    setLocale(oldLocale);
  }
});

test('production tab shows purifier output at one water every 96 simulated seconds in both locales', () => {
  const parts = [['purifier', 2, 1, 0, 0]];
  const panel = commerceFor({ parts });
  try {
    setLocale('es');
    const spanish = panel.productionHtml();
    assert.match(spanish, /Agua dulce/);
    assert.match(spanish, /96 s simulados por lote/);
    assert.match(spanish, /amarrada/);
    setLocale('en');
    const english = panel.productionHtml();
    assert.match(english, /Fresh water/);
    assert.match(english, /96 simulated seconds per batch/);
    assert.match(english, /moored/);
    assert.match(english, /no offline time is banked/i);
  } finally { setLocale('es'); }
});

test('production projection reports destroyed purifiers and voyage pauses without presenting them as working', () => {
  const parts = [['purifier', 2, 1, 0, 0]];
  const broken = commerceFor({ parts, activeParts: [] });
  const key = productionKey(parts[0]);
  broken.productionStatus = { id: 'raft-a', rev: 3, raftRev: 3, daySec: 960, blocked: '', rows: [{
    key, part: 'purifier', name: 'Purificador', rate: 10, inputs: {}, outputs: { agua: 1 },
    progress: 0.4, status: 'working', remainingDays: 0.06,
  }] };
  assert.equal(broken.productionData().rows[0].status, 'broken');
  assert.equal(broken.productionData().rows[0].remainingDays, null);
  setLocale('en');
  assert.match(broken.productionHtml(), /Module destroyed/);

  const sailing = commerceFor({ parts, voyage: true });
  sailing.productionStatus = { id: 'raft-a', rev: 1, raftRev: 1, daySec: 960, blocked: '', rows: [{
    key, part: 'purifier', name: 'Purificador', rate: 10, inputs: {}, outputs: { agua: 1 },
    progress: 0.4, status: 'working', remainingDays: 0.06,
  }] };
  assert.equal(sailing.productionData().blocked, 'voyage');
  assert.equal(sailing.productionData().rows[0].status, 'voyage');
  assert.match(sailing.productionHtml(), /Paused during voyage/);
  setLocale('es');
  assert.match(sailing.productionHtml(), /Pausada durante el viaje/);
});

test('a current profile supplies newer fractional purifier progress and its matching ETA', () => {
  const parts = [['purifier', 2, 1, 0, 0]], key = productionKey(parts[0]);
  const panel = commerceFor({ parts, work: { [key]: 0.25 } });
  const c = panel.context();
  c.profile.eco.tradeRev = 2;
  c.ship.rev = 2;
  panel.productionStatus = { id: 'raft-a', rev: 1, raftRev: 1, daySec: 960, blocked: '', rows: [{
    key, part: 'purifier', name: 'Purificador', rate: 10, inputs: {}, outputs: { agua: 1 },
    progress: 0.9, status: 'working', remainingDays: 0.01,
  }] };

  try {
    const production = panel.productionData();
    assert.equal(production.profileIsCurrent, true);
    assert.equal(production.rows[0].progress, 0.25);
    assert.ok(Math.abs(production.rows[0].remainingDays - 0.075) < 1e-12);
    setLocale('en');
    assert.match(panel.productionHtml(), /Next batch: 72 simulated seconds/);
  } finally { setLocale('es'); }
});

test('an older profile preserves the authoritative production row and working ETA', () => {
  const parts = [['purifier', 2, 1, 0, 0]], key = productionKey(parts[0]);
  const panel = commerceFor({ parts, work: { [key]: 0.1 } });
  panel.productionStatus = { id: 'raft-a', rev: 3, raftRev: 3, daySec: 960, blocked: '', rows: [{
    key, part: 'purifier', name: 'Purificador', rate: 10, inputs: {}, outputs: { agua: 1 },
    progress: 0.65, status: 'working', remainingDays: 0.035,
  }] };

  try {
    const production = panel.productionData();
    assert.equal(production.profileIsCurrent, false);
    assert.equal(production.rows[0].progress, 0.65);
    assert.equal(production.rows[0].status, 'working');
    assert.equal(production.rows[0].remainingDays, 0.035);
    setLocale('en');
    assert.match(panel.productionHtml(), /65%/);
    assert.match(panel.productionHtml(), /Next batch: 34 simulated seconds/);
  } finally { setLocale('es'); }
});

test('empty production panel points to the purifier and describes its no-fuel output', () => {
  const panel = commerceFor({ parts: [['foundation', 0, 0, 0]] });
  try {
    setLocale('es');
    assert.match(panel.productionHtml(), /purificador/);
    setLocale('en');
    assert.match(panel.productionHtml(), /purifier/);
  } finally { setLocale('es'); }
});
