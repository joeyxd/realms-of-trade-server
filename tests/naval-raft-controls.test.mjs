import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LiveNavigationView } from '../src/client/liveNavigationView.js';
import { NavalLabCamera } from '../src/render/naval/camera.js';
import { RaftLayer } from '../src/render/rafts.js';
import { buildNavalRig, navalPose, newNavalState, stepNaval } from '../src/sim/naval/handling.js';
import { LAB_FIXTURES } from '../tools/naval-lab/fixtures.js';

// PT04 (Joi, R1 and R2): the raft turned the wrong way and the throttle had to be held.
function harness({ deck = false } = {}) {
  const view = Object.create(LiveNavigationView.prototype), levers = [];
  const client = { naval: { active: true }, deck: { active: deck } };
  view.getClient = () => client; view.isActive = () => true;
  view.input = { keys: new Set(), pad: {}, joy: null, slotHeld: () => false, enabled: true };
  view.axes = { x: 0, y: 0 }; view.captureHeld = false;
  view.touch = { setLever: (value) => levers.push(value), clear() {} };
  const frame = (enabled = true) => { view.stepLever(enabled); return view.fixedAxes(); };
  // The key-down hotkey runs leverKey; the input layer then adds the code to the held set.
  const press = (code) => { view.leverKey(code); view.input.keys.add(code); const axes = frame(); view.input.keys.delete(code); frame(); return axes; };
  return { view, client, levers, frame, press };
}

test('stick, keys and pad steer the mirror of their x at the helm and on deck', () => {
  const { view, client, frame } = harness();
  view.input.keys.add('KeyD');
  assert.equal(frame().naval.steer, -1);
  view.input.keys.clear(); view.input.keys.add('ArrowLeft');
  assert.equal(frame().naval.steer, 1);
  view.input.keys.clear(); view.axes = { x: 0.5, y: 0.9 };
  assert.equal(frame().naval.steer, -0.5, 'the touch wheel only steers; its y does not shrink the turn');
  view.axes = { x: 0, y: 0 }; view.input.pad = { mx: -0.25, my: 0 };
  assert.equal(frame().naval.steer, 0.25);
  view.input.pad = {};
  assert.equal(Object.is(frame().naval.steer, 0), true, 'a neutral stick sends +0, not -0');
  client.deck.active = true; view.input.keys.add('KeyD'); view.input.keys.add('KeyW');
  const deck = frame().deck;
  assert.ok(deck.mx < 0 && deck.mz > 0, 'on deck right walks toward raft-local -x, which is screen-right');
});

test('the sail lever stays where W and S leave it and S at zero brakes only while held', () => {
  const { view, levers, frame, press } = harness();
  assert.deepEqual(frame().naval, { throttle: 0, brake: 0, steer: 0, capture: false, jump: 0, canto: 0 });
  assert.equal(press('KeyW').naval.throttle, 0.25);
  assert.equal(frame().naval.throttle, 0.25, 'the sail stays after W is released');
  press('KeyW'); press('ArrowUp'); press('KeyW'); press('KeyW');
  assert.equal(frame().naval.throttle, 1);
  view.input.keys.add('KeyW');
  for (let i = 0; i < 5; i++) frame();
  view.input.keys.delete('KeyW');
  assert.equal(frame().naval.throttle, 1, 'holding a key steps once');
  press('KeyS');
  assert.equal(frame().naval.throttle, 0.75);
  view.leverKey('KeyS');
  assert.equal(frame().naval.throttle, 0.5, 'a tap shorter than a frame still steps');
  press('ArrowDown'); press('KeyS');
  assert.deepEqual(frame().naval, { throttle: 0, brake: 0, steer: 0, capture: false, jump: 0, canto: 0 });
  view.leverKey('KeyS'); view.input.keys.add('KeyS');
  assert.deepEqual(frame().naval, { throttle: 0, brake: 1, steer: 0, capture: false, jump: 0, canto: 0 });
  assert.equal(levers.at(-1).value, -1);
  view.input.keys.delete('KeyS');
  assert.equal(frame().naval.brake, 0);
  view.input.pad = { my: 0.8 }; frame(); view.input.pad = {}; frame();
  assert.equal(frame().naval.throttle, 0.25, 'the pad stick steps like W');
  assert.deepEqual(levers.at(-1), { visible: true, value: 0.25 });
});

test('the touch lever sails and brakes, and taking the helm or losing focus resets it', () => {
  const { view, client, levers, frame } = harness();
  frame();
  view.sail = 0.6; view.leverBrake = 0;
  assert.equal(frame().naval.throttle, 0.6);
  view.sail = 0; view.leverBrake = 0.5;
  assert.deepEqual(frame().naval, { throttle: 0, brake: 0.5, steer: 0, capture: false, jump: 0, canto: 0 });
  view.sail = 0.75; view.leverBrake = 0;
  client.deck.active = true;
  assert.deepEqual(frame().naval, { throttle: 0, brake: 0, steer: 0, capture: false, jump: 0, canto: 0 }, 'on deck neither the sail nor the walk stick reaches the raft');
  assert.equal(levers.at(-1).visible, false);
  view.leverKey('KeyS'); view.input.keys.add('KeyS');
  assert.equal(frame().naval.brake, 0, 'walking astern does not brake');
  assert.equal(view.sail, 0.75, 'on deck W and S walk and leave the lever alone');
  view.input.keys.clear();
  client.deck.active = false;
  assert.equal(frame().naval.throttle, 0, 'back at the helm the lever starts at zero');
  view.sail = 0.5;
  frame(false); frame(false);
  assert.equal(frame().naval.throttle, 0.5, 'a pause or an open panel keeps the sail set');
  view.clearInput(false);
  assert.equal(frame().naval.throttle, 0);
});

test('stick right turns the bow toward screen-right under the live chase camera', () => {
  const fixture = LAB_FIXTURES.find((entry) => entry.id === 'empty') || LAB_FIXTURES[0];
  const rig = buildNavalRig(fixture.parts, fixture.cargo);
  const { view, frame } = harness();
  view.axes = { x: 1, y: 0 }; view.sail = 1;
  const input = frame().naval;
  let state = { ...newNavalState(), yaw: 0.7 };
  const camera = new THREE.PerspectiveCamera(50, 844 / 390, 0.1, 1400);
  new NavalLabCamera(camera).update(1 / 60, { state, rig, pose: navalPose(state, rig) });
  camera.updateMatrixWorld(true);
  const bow = (s) => new THREE.Vector3(s.x + Math.sin(s.yaw) * 4, 0, s.z + Math.cos(s.yaw) * 4).project(camera).x
    - new THREE.Vector3(s.x, 0, s.z).project(camera).x;
  const before = bow(state);
  for (let tick = 0; tick < 90; tick++) state = stepNaval(state, { throttle: input.throttle, brake: 0, steer: input.steer }, rig, { yaw: 0, strength: 0 });
  assert.ok(state.yaw < 0.7, `yaw ${state.yaw}`);
  assert.ok(bow(state) > before + 0.01, 'the bow swings right on screen');
});

test('the tiller blade trails toward the side the raft turns', () => {
  const fixture = LAB_FIXTURES.find((entry) => entry.id === 'empty') || LAB_FIXTURES[0];
  const layer = new RaftLayer(new THREE.Scene(), { skin: false, sailingRig: true });
  const record = { id: 'tiller-sign', parts: fixture.parts, x: 4, y: 0.72, z: 3, yaw: 0, owner: 9 };
  const pilot = { x: 4, y: 0.72, z: 3, f: 0 };
  try {
    layer.update([record], 0);
    const straight = layer.setSailing(record.id, { active: true, steer: 0, pilot }).handleWorld;
    const left = layer.setSailing(record.id, { active: true, steer: 1, pilot }).handleWorld;
    // steer +1 turns the bow toward +x (yaw grows), so the aft blade and handle swing to +x.
    assert.ok(left.x > straight.x + 0.03, `${left.x} vs ${straight.x}`);
  } finally { layer.dispose?.(); }
});

test('PT05: the mouse wheel zooms the chase camera only while it drives the view', () => {
  const { view } = harness(), shown = [];
  view.sceneCamera = new NavalLabCamera(new THREE.PerspectiveCamera(50, 1.6, 0.1, 1400));
  view.touch.setZoom = (level, count) => shown.push([level, count]);
  view.cameraWasNaval = false;
  assert.equal(view.wheelZoom(1), false, 'on foot the wheel stays with the iso rig');
  assert.equal(view.sceneCamera.zoomIdx, 1);
  view.cameraWasNaval = true;
  assert.equal(view.wheelZoom(1), true);
  assert.equal(view.sceneCamera.zoomIdx, 2);
  assert.deepEqual(shown.at(-1), [2, 3], 'the touch button shows the new step');
  view.paused = true;
  assert.equal(view.wheelZoom(-1), true, 'paused, the wheel is swallowed');
  assert.equal(view.sceneCamera.zoomIdx, 2);
});

test('D6: the deck prompt takes the nearby helm before offering swim', () => {
  const {view,client}=harness({deck:true}), calls=[];
  const raft={id:'raft',x:0,y:.72,z:0,yaw:0,helm:{x:1,y:0,z:1,f:0}};
  Object.assign(client,{joined:true,youServer:1,cur:{x:1,z:1},renderRafts:()=>[raft],
    voyage:{active:true,phase:'sailing',shipId:'raft',canSwim:true},helmNaval:()=>calls.push('helm')});
  view.command=op=>calls.push(op);
  const action=view.navigationInteraction();
  assert.equal(action.key,'E'); assert.deepEqual(action.actions.map(a=>a.key),['E','G']);
  action.run(); assert.deepEqual(calls,['helm']);
  client.cur.x=5;
  assert.equal(view.navigationInteraction().key,'G');
});
