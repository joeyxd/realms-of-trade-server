import test from 'node:test';
import assert from 'node:assert/strict';
import { FreshwaterPanel } from '../src/ui/freshwaterPanel.js';

class Element {
  constructor() { this.attrs = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.textContent = ''; this.children = new Map(); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); }
  appendChild(child) { child.parentNode = this; return child; }
  focus() { this.focused = true; }
  querySelector(s) { return this.children.get(s) || null; }
  querySelectorAll(s) { return s === '.fresh-barrel' ? this.rows || [] : []; }
  set innerHTML(html) {
    this._html = html; this.children.clear();
    for (const match of html.matchAll(/class="([^"]+)"/g)) for (const name of match[1].split(/\s+/)) {
      if (!this.children.has(`.${name}`)) this.children.set(`.${name}`, new Element());
    }
    if (html.includes('fresh-barrel"')) {
      const count = [...html.matchAll(/<article class="fresh-barrel"/g)].length;
      this.rows = Array.from({ length: count }, () => {
        const row = new Element();
        for (const name of ['fresh-deposit', 'fresh-withdraw', 'fresh-canteen-refill', 'fresh-barrel-state']) row.children.set(`.${name}`, new Element());
        row.children.set('b', new Element()); row.children.set('span', new Element());
        return row;
      });
    }
  }
  click() { for (const fn of this.listeners.click || []) fn({ target: this }); }
}
class DocumentStub {
  constructor() { this.listeners = {}; }
  createElement() { return new Element(); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); }
  key(code) { for (const f of this.listeners.keydown || []) f({ code, key: code, preventDefault() {}, stopPropagation() {} }); }
}
function fixture({ locale = 'es', bucket = null, enabled = true, source = { id: 'spring-a', name: 'Ojo de agua', near: true }, barrels = [] } = {}) {
  let time = 0, lang = locale;
  const doc = new DocumentStub(), parent = new Element(); parent.ownerDocument = doc;
  const commands = [], toasts = [];
  const client = { joined: true, youServer: 2, freshwaterStatus: { enabled, source, barrels, gathering: 0 },
    profile: { eco: { tradeRev: 8, pack: { goods: { madera: 2, agua: 0 }, vessels: bucket ? [{ id: 'bucket', kind: 'bucket', water: bucket }] : [] }, ships: [] } },
    send(command) { commands.push(command); } };
  const panel = new FreshwaterPanel({ parent, client: () => client, locale: () => lang, toast: m => toasts.push(m), now: () => time });
  return { panel, client, doc, parent, commands, toasts, setTime: n => { time = n; }, setLocale: v => { lang = v; } };
}

test('craft, fill and decant use immutable exact commands and wait for authoritative profile changes', () => {
  const f = fixture(); f.panel.open();
  assert.equal(f.panel.craftBucket(), true);
  const craft = f.commands[0];
  assert.deepEqual(Object.keys(craft).sort(), ['t', 'type', 'op', 'opId', 'expectedRev', 'source', 'ship', 'part', 'n'].sort());
  assert.equal(craft.type, 'freshwater'); assert.equal(craft.op, 'craftBucket'); assert.equal(craft.expectedRev, 8);
  assert.equal(f.client.profile.eco.pack.goods.madera, 2); assert.equal(f.panel.craftButton.disabled, true);
  assert.equal(f.panel.acknowledge({ type: 'freshwater', opId: craft.opId, stage: 'gathering', progress: .5 }), true);
  assert.equal(f.panel.pending.command, craft); assert.equal(f.panel.pending.gathering, .5);
  assert.equal(f.panel.acknowledge({ type: 'freshwater', opId: craft.opId, ok: true }), true);
  assert.equal(f.panel.pending, null); assert.equal(f.panel.$('.fresh-status').textContent, 'Cubeta fabricada.');

  f.client.profile.eco.pack.vessels = [{ id: 'bucket', kind: 'bucket', water: 0 }];
  f.panel.fill(); const fill = f.commands[1];
  assert.equal(fill.op, 'fill'); assert.equal(fill.source, 'spring-a'); assert.equal(fill.n, 4);
  assert.equal(f.client.profile.eco.pack.vessels[0].water, 0);
  f.panel.acknowledge({ type: 'freshwater', opId: fill.opId, ok: true });
  assert.equal(f.toasts.at(-1), 'Agua recogida.');
  f.client.profile.eco.pack.vessels[0].water = 4; f.panel.update();
  f.panel.decant(); const decant = f.commands[2];
  assert.equal(decant.op, 'decant'); assert.equal(decant.n, 4);
  assert.equal(f.client.profile.eco.pack.goods.agua, 0);
});

test('barrel transfer clamps to available water/capacity and disables distant, broken, empty, full, and no-bucket cases', () => {
  const f = fixture({ bucket: 3, barrels: [
    { ship: 'raft-a', part: 'pA', water: 18, capacity: 20, near: true, broken: false, name: 'Reserva' },
    { ship: 'raft-a', part: 'pB', water: 4, capacity: 20, near: false, broken: false },
    { ship: 'raft-a', part: 'pC', water: 0, capacity: 20, near: true, broken: true },
    { ship: 'raft-a', part: 'pD', water: 20, capacity: 20, near: true, broken: false },
  ] });
  f.panel.open(); f.panel.render();
  const rows = f.panel.$('.fresh-barrels').rows;
  assert.equal(rows[0].querySelector('.fresh-deposit').disabled, false);
  assert.equal(rows[1].querySelector('.fresh-deposit').disabled, true);
  assert.equal(rows[2].querySelector('.fresh-withdraw').disabled, true);
  assert.equal(rows[3].querySelector('.fresh-deposit').disabled, true);
  f.panel.transfer('deposit', 'raft-a', 'pA', 2);
  assert.equal(f.commands[0].n, 2); assert.equal(f.commands[0].part, 'pA');
  assert.equal(f.client.profile.eco.pack.vessels[0].water, 3);
  const noBucket = fixture({ barrels: [{ ship: 'raft-a', part: 'pA', water: 5, capacity: 20, near: true, broken: false }] });
  noBucket.panel.open(); noBucket.panel.render();
  assert.equal(noBucket.panel.$('.fresh-barrels').rows[0].querySelector('.fresh-withdraw').disabled, true);
});

test('retry is the same command once; timeout preserves uncertain pending state until final acknowledgement', () => {
  const f = fixture({ bucket: 1 }); f.panel.open(); f.panel.decant();
  const command = f.commands[0]; f.setTime(999); f.panel.update(); assert.equal(f.commands.length, 1);
  f.setTime(1000); f.panel.update(); assert.equal(f.commands[1], command);
  f.setTime(5000); f.panel.update(); assert.equal(f.panel.pending.command, command);
  assert.equal(f.panel.$('.fresh-status').textContent, 'La conexión tarda. El resultado de esta solicitud sigue pendiente; espera la actualización.');
  f.panel.decant(); assert.equal(f.commands.length, 2);
  assert.equal(f.panel.acknowledge({ type: 'freshwater', opId: command.opId, ok: false, why: 'empty' }), true);
  assert.equal(f.panel.pending, null); assert.equal(f.panel.$('.fresh-status').textContent, 'No hay agua suficiente en el recipiente.');
});

test('session reset clears uncertainty; gathering is localized and Escape closes only the open panel', () => {
  const f = fixture({ locale: 'en', bucket: 1 }); f.panel.open();
  f.panel.fill(); const cmd = f.commands[0];
  f.panel.acknowledge({ type: 'freshwater', opId: cmd.opId, stage: 'gathering', progress: 0 });
  f.client.freshwaterStatus.gathering = .25; f.panel.update();
  assert.match(f.panel.collectButton.textContent, /Collecting water · 25%/);
  assert.equal(f.panel.pending.command, cmd);
  f.doc.key('Escape'); assert.equal(f.panel.active, false);
  f.client.youServer = 3; f.panel.update(); assert.equal(f.panel.pending, null);
  assert.equal(f.panel.root.hidden, true);
});

test('copy is bilingual, source/range guards are clear, and no bucket creation shortcut appears', () => {
  const f = fixture({ locale: 'en', source: { id: 'spring-a', name: 'Spring', near: false } }); f.panel.open();
  assert.equal(f.panel.craftButton.textContent, 'Craft bucket · 2 wood');
  assert.equal(f.panel.collectButton.disabled, true); assert.equal(f.panel.collectButton.title, 'Move closer to the spring to collect water.');
  assert.match(f.panel.$('.fresh-map').textContent, /marked spring inland/);
  assert.equal(f.panel.$('.fresh-status').textContent, '');
  f.setLocale('es'); f.panel.update(); assert.equal(f.panel.craftButton.textContent, 'Fabricar cubeta · 2 maderas');
  assert.equal(f.panel.active, true);
});
