// Builds basichit-source.json from the pinned NS_BasicHit compiler output and source export,
// never from captured particles (T-1021-03; recipe docs/delivery/st01c/basichit/RECIPE.md).
// Every number is decoded from a VM constant table (CachedScriptVM InternalParameters), a LUT or the
// exposed user parameters of system.t3d; an HLSL literal only names the role of the value it matches.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = 'tools/niagara-native-lab/basichit-source.json';
const MANIFEST = 'docs/delivery/st01c/basichit/source-export-manifest.json';
const COMPILED = '.scratch/unreal/basichit-compiled/';
const T3D = '.scratch/unreal/basichit-source/system.t3d';
const SYSTEM_PREFIX = /.*NS_BasicHit\.NS_BasicHit:?/;
const f32 = Math.fround;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const check = (ok, message) => { if (!ok) throw new Error(message); };
const bitsOf = value => { const b = Buffer.alloc(4); b.writeFloatLE(value); return b.toString('hex'); };

let out = path.join(ROOT, OUT);
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--out' && process.argv[i + 1]) out = path.resolve(process.argv[++i]);
  else throw new Error('Usage: node tools/niagara-native-lab/prepare-basichit-source.mjs [--out <path>]');
}

// ---------- Pinned inputs; sha256 over the bytes on disk, in read order.
const inputs = [];
function read(file) {
  const bytes = fs.readFileSync(path.join(ROOT, file));
  inputs.push({ file, sha256: sha(bytes) });
  return bytes;
}
const manifest = JSON.parse(read(MANIFEST));
const reportBytes = read(COMPILED + 'report.json');
check(sha(reportBytes) === manifest.compiled?.reportSha256, 'Unreviewed compiler output: report.json');
const report = JSON.parse(reportBytes);
// Script ids are the file prefixes of report.json (an array keeps the read order 01..11).
const SCRIPTS = [['01', ':SystemUpdateScript'],
  ['02', ':NE_Flame_Basic_001.SpawnScript'], ['03', ':NE_Flame_Basic_001.UpdateScript'],
  ['06', ':NE_Basic_Flash001_3.SpawnScript'], ['07', ':NE_Basic_Flash001_3.UpdateScript'],
  ['10', ':NE_SimpleBurst.SpawnScript'], ['11', ':NE_SimpleBurst.UpdateScript']];
const hlsl = {};
for (const [id, suffix] of SCRIPTS) {
  const row = report.scripts.find(s => s.file.startsWith(id + '-'));
  check(row && row.path.endsWith(suffix) && row.compileStatus === 'NCS_UpToDate', 'Unexpected compiled script ' + id);
  const raw = read(COMPILED + row.file);
  check(sha(raw) === row.sha256, 'Unreviewed compiled script ' + row.file);
  hlsl[id] = { file: row.file, lines: raw.toString('utf8').split(/\r?\n/) };
}
const t3dBytes = read(T3D);
check(sha(t3dBytes) === manifest.exports.find(e => e.file === 'system.t3d')?.sha256, 'Unreviewed source export: system.t3d');
const t3d = t3dBytes.toString('utf8').split(/\r?\n/);

// ---------- HLSL roles (1-based lines; each fragment must be unique in its script)
function line(id, fragment) {
  const hits = [];
  hlsl[id].lines.forEach((l, i) => { if (l.includes(fragment)) hits.push(i + 1); });
  check(hits.length === 1, `${hlsl[id].file}: ${hits.length} matches for ${fragment}`);
  return hits[0];
}
const at = (id, fragment) => `${hlsl[id].file}:${line(id, fragment)}`;
function literal(id, fragment) {
  const m = hlsl[id].lines[line(id, fragment) - 1].match(/=\s*(?:float[234]\()?([-\d.e+,]+)\)?;/);
  check(m, 'No literal in ' + fragment);
  const values = m[1].split(',').map(Number);
  return values.length === 1 ? values[0] : values;
}
function spawnRange(id) {
  return [line(id, 'void SimulateMapSpawn(inout FSimulationContext Context)'), line(id, 'void SimulateMapUpdate(inout FSimulationContext Context)')];
}

// ---------- T3D objects: begin line, path below the system, body lines.
const objects = [];
{
  const stack = [];
  t3d.forEach((text, i) => {
    const m = text.match(/^\s*Begin Object .*?ExportPath="[^']*'([^']+)'/);
    if (m) { stack.push({ start: i + 1, path: m[1].replace(SYSTEM_PREFIX, '') || 'System', body: [] }); return; }
    if (/^\s*End Object/.test(text)) { const o = stack.pop(); if (o) objects.push(o); return; }
    if (stack.length) stack[stack.length - 1].body.push([i + 1, text]);
  });
}
function object(objectPath) {
  const hits = objects.filter(o => o.path === objectPath && o.body.length > 0);
  check(hits.length === 1, 'T3D object ' + objectPath);
  return hits[0];
}
// VM constant table of a script: float entries (type 99) by bit pattern, in table order.
function vmTable(scriptPath) {
  const o = object(scriptPath);
  const rows = o.body.filter(([, l]) => /^\s*CachedScriptVM=/.test(l));
  check(rows.length === 1, 'CachedScriptVM of ' + scriptPath);
  const [lineNo, text] = rows[0], head = 'InternalParameters=(Parameters=(';
  const start = text.indexOf(head);
  check(start >= 0, 'No VM constant table for ' + scriptPath);
  const re = /\(VarData=\(([\d,]*)\),Name="([^"]+)",TypeDefHandle=\(RegisteredTypeIndex=(\d+)\)\),?/y;
  re.lastIndex = start + head.length;
  const floats = new Map();
  let r;
  while ((r = re.exec(text))) {
    if (r[3] !== '99') continue;
    const bytes = Buffer.from(r[1].split(',').map(Number));
    check(bytes.length === 4, 'Float constant size ' + r[2]);
    const bits = bytes.toString('hex');
    if (!floats.has(bits)) floats.set(bits, { name: r[2], value: bytes.readFloatLE(0) });
  }
  check(floats.size > 0, 'Empty VM constant table for ' + scriptPath);
  return { script: scriptPath, line: lineNo, floats };
}
const tables = Object.fromEntries(SCRIPTS.map(([id, suffix]) => [id, vmTable(suffix.slice(1))]));

// ---------- Constants: the value is the VM table entry whose bits equal f32 of the HLSL role.
const constants = [];
function vm(key, id, expected, cites) {
  const table = tables[id], list = [].concat(expected);
  const entries = list.map(v => {
    const entry = table.floats.get(bitsOf(f32(v)));
    check(entry, `${table.script} VM table lacks ${v} (${key})`);
    return entry;
  });
  const value = entries.map(e => e.value);
  constants.push({ key, value: Array.isArray(expected) ? value : value[0], bits: list.map(v => bitsOf(f32(v))),
    vm: { script: table.script, names: entries.map(e => e.name), t3dLine: table.line }, hlsl: cites });
  return Array.isArray(expected) ? value : value[0];
}
// Folded range of a RandomRangeFloat call: the VM holds Min and Max - Min.
function span(key, id, minFragment, maxFragment) {
  const min = literal(id, minFragment), max = literal(id, maxFragment);
  const cites = [at(id, minFragment), at(id, maxFragment)];
  const minimum = vm(key + '.min', id, min, cites);
  const width = vm(key + '.span', id, Array.isArray(min) ? min.map((a, i) => f32(f32(max[i]) - f32(a))) : f32(f32(max) - f32(min)), cites);
  return { min: minimum, span: width };
}
const scalar = (key, id, fragment) => vm(key, id, literal(id, fragment), [at(id, fragment)]);

// ---------- Curves (LUT): bound by CachedDefaultDataInterfaces; the spawn copy must be identical.
function curve(scriptPath, index, expectName) {
  const script = object(scriptPath);
  const binding = script.body.find(([, l]) => l.includes(`CachedDefaultDataInterfaces(${index})=`));
  check(binding && binding[1].includes(`'NiagaraDataInterfaceCurve_${index}'`) && binding[1].includes(expectName), `Curve binding ${scriptPath} ${index}`);
  const o = object(`${scriptPath}.NiagaraDataInterfaceCurve_${index}`);
  const lut = new Map(), props = {};
  let keysLine = null, keys = '';
  for (const [n, l] of o.body) {
    let m = l.match(/^\s*ShaderLUT\((\d+)\)=([-\d.e]+)\s*$/);
    if (m) { check(!lut.has(+m[1]), 'Repeated LUT sample'); lut.set(+m[1], { value: f32(+m[2]), line: n }); }
    m = l.match(/^\s*(LUTMinTime|LUTMaxTime|LUTInvTimeRange|LUTNumSamplesMinusOne)=([-\d.e]+)\s*$/);
    if (m) props[m[1]] = +m[2];
    if (/^\s*Curve=\(Keys=/.test(l)) { keysLine = n; keys = l.trim(); }
  }
  const sampleCount = props.LUTNumSamplesMinusOne + 1;
  check(Number.isInteger(sampleCount) && sampleCount > 1 && [...lut.keys()].every(i => i < sampleCount), 'LUT sample count ' + o.path);
  // Absent array elements are zero; absent LUTMinTime/LUTInvTimeRange keep the class defaults 0 and 1,
  // which equal the first and last key times of the exported Curve keys.
  const times = [...keys.matchAll(/Time=([-\d.e]+)/g)].map(m => +m[1]);
  const firstTime = /Keys=\(\(Time=/.test(keys) ? times[0] : 0;
  const rangeDefaulted = props.LUTMinTime === undefined;
  check(rangeDefaulted === (props.LUTInvTimeRange === undefined), 'Partial LUT range ' + o.path);
  if (rangeDefaulted) check(firstTime === 0 && times.at(-1) === 1, 'A defaulted LUT range needs keys 0..1: ' + o.path);
  const lines = [...lut.values()].map(e => e.line);
  return { object: `${o.path} (T3D:${o.start})`, binding: `T3D:${binding[0]}`, keysLine, lutLines: `${Math.min(...lines)}-${Math.max(...lines)}`,
    sampleCount, rangeDefaulted, minTime: f32(props.LUTMinTime ?? 0), inverseRange: f32(props.LUTInvTimeRange ?? 1),
    samples: Array.from({ length: sampleCount }, (_, i) => lut.get(i)?.value ?? 0) };
}
function curvePair(prefix, index, expectName) {
  const update = curve(`${prefix}.UpdateScript`, index, expectName), spawn = curve(`${prefix}.SpawnScript`, index, expectName);
  check(update.minTime === spawn.minTime && update.inverseRange === spawn.inverseRange &&
    JSON.stringify(update.samples) === JSON.stringify(spawn.samples), 'Spawn and update LUT differ: ' + update.object);
  return { ...update, spawnCopy: spawn.object };
}

// ---------- Random calls: counter = position of the call in SimulateMapSpawn (RandomCounterDeterministic).
function randomCalls(id, rows) {
  const [begin, end] = spawnRange(id);
  let previous = [0, 0];
  return rows.map(([counter, fn, component, role, fragment, topLevel = fragment], i) => {
    check(counter === i + 1, 'Random counters must be consecutive');
    const cite = line(id, fragment), top = line(id, topLevel);
    check(top > begin && top < end, 'Random call outside SimulateMapSpawn: ' + topLevel);
    check(top > previous[0] || (top === previous[0] && cite > previous[1]), 'Random call order: ' + fragment);
    previous = [top, cite];
    return { counter, fn, component, role, hlsl: `${hlsl[id].file}:${cite}` };
  });
}

// ---------- Disabled graph nodes stay out of the compiled scripts (RECIPE.md, causal chains).
function disabledNodes(prefix, emitter) {
  return objects.filter(o => o.path.startsWith(`${prefix}.NiagaraScriptSource_0.NiagaraGraph_0.NiagaraNodeFunctionCall_`) && o.body.length > 0)
    .flatMap(o => {
      const off = o.body.find(([, l]) => /^\s*EnabledState=Disabled\s*$/.test(l));
      if (!off) return [];
      const name = o.body.map(([, l]) => l.match(/^\s*FunctionDisplayName="([^"]+)"/)).find(Boolean);
      check(name, 'Disabled node without a display name: ' + o.path);
      return [{ emitter, module: name[1], t3dLine: off[0] }];
    });
}

// ---------- System update (01): EmitterState Once and SpawnBurst_Instantaneous per emitter.
check(!hlsl['01'].lines.some(l => /SpawnRate/.test(l)), 'A SpawnRate module is compiled');
function emitterTiming(name, frags) {
  const constantOf = fragment => fragment.match(/Constant\d+/)[0], resultOf = fragment => fragment.match(/Result\d+/)[0];
  check(literal('01', frags.newState) === 1, 'Loop end must set Inactive: ' + name);
  line('01', `EmitterState_EmitterChangeState_${name}_Func(${constantOf(frags.newState)}, Context.Map.Local.EmitterState.LoopCountIncreased,`);
  const loop = scalar(`${name}.emitterState.loopSeconds`, '01', frags.loop);
  check(literal('01', frags.loopFloor) === .016667, 'Loop duration floor ' + name);
  const count = scalar(`${name}.burst.count`, '01', frags.count);
  check(Number.isInteger(count) && count >= 1, 'Burst count ' + name);
  // InterpStartDt = SpawnTime - (LoopedAge - DeltaTime); IntervalDt is a constant.
  line('01', `float ${frags.start} = ${constantOf(frags.spawnTime)} - ${resultOf(frags.window)};`);
  line('01', `${frags.output}.InterpStartDt = ${frags.start};`);
  line('01', `${frags.output}.IntervalDt = ${constantOf(frags.interval)};`);
  return {
    emitterState: { mode: 'Once', loopSeconds: loop, loopEnd: at('01', frags.newState) },
    burst: { count, spawnTime: scalar(`${name}.burst.spawnTime`, '01', frags.spawnTime),
      intervalDt: scalar(`${name}.burst.intervalDt`, '01', frags.interval), window: at('01', frags.window) }
  };
}
const timing = {
  NE_Flame_Basic_001: emitterTiming('NE_Flame_Basic_001', { newState: 'int Constant169 = 1;', loop: 'float Constant150 = 1;',
    loopFloor: 'float Constant151 = 0.016667;', count: 'int Constant205 = 1;', spawnTime: 'float Constant201 = 0;', start: 'Result235', output: 'Output15',
    interval: 'float Constant211 = 0;', window: 'float Result234 = Context.Map.SpawnBurst_Instantaneous.Age - Context.Map.Engine.DeltaTime;' }),
  NE_Basic_Flash001: emitterTiming('NE_Basic_Flash001', { newState: 'int Constant105 = 1;', loop: 'float Constant86 = 0.970833;',
    loopFloor: 'float Constant87 = 0.016667;', count: 'int Constant141 = 1;', spawnTime: 'float Constant137 = 0;', start: 'Result160', output: 'Output13',
    interval: 'float Constant147 = 0;', window: 'float Result159 = Context.Map.SpawnBurst_Instantaneous.Age - Context.Map.Engine.DeltaTime;' }),
  NE_SimpleBurst: emitterTiming('NE_SimpleBurst', { newState: 'int Constant41 = 1;', loop: 'float Constant22 = 1;',
    loopFloor: 'float Constant23 = 0.016667;', count: 'int Constant77 = 250;', spawnTime: 'float Constant73 = 0;', start: 'Result85', output: 'Output11',
    interval: 'float Constant83 = 0;', window: 'float Result84 = Context.Map.SpawnBurst_Instantaneous.Age - Context.Map.Engine.DeltaTime;' })
};

// ParticleState kill epsilon: update script table, and the same rule in the update pass of the spawn
// script (unless the compiler folded it with a constant lifetime, checked by the caller).
function killEpsilon(name, updateId, spawnId, spawnFragment, folded = false) {
  const epsilon = scalar(`${name}.killEpsilon`, updateId, 'float Constant2 = 0.0001;');
  check(literal(updateId, 'float Constant1 = 1e-05;') === 1e-5, 'Lifetime floor ' + name);
  check(literal(spawnId, spawnFragment) === literal(updateId, 'float Constant2 = 0.0001;'), 'Kill epsilon of the spawn pass ' + name);
  if (!folded) scalar(`${name}.killEpsilon.spawnPass`, spawnId, spawnFragment);
  return epsilon;
}

// ---------- NE_Flame_Basic_001 (02 spawn, 03 update)
const exposed = t3d.findIndex(l => /^\s*ExposedParameters=\(UserParameterRedirects/.test(l));
const lifeMatch = t3d[exposed]?.match(/SortedParameterOffsets=\(\(Offset=0,Name="User\.LifeTime",TypeDefHandle=\(RegisteredTypeIndex=99\)\)\),ParameterData=\(([\d,]+)\)/);
check(lifeMatch && lifeMatch[1].split(',').length === 4, 'User.LifeTime');
const lifeBytes = Buffer.from(lifeMatch[1].split(',').map(Number));
const userLifetime = lifeBytes.readFloatLE(0);
constants.push({ key: 'NE_Flame_Basic_001.lifetime', value: userLifetime, bits: [lifeBytes.toString('hex')],
  user: { parameter: 'User.LifeTime', t3dLine: exposed + 1 },
  hlsl: [at('02', 'Context.MapSpawn.InitializeParticle.Lifetime = Context.MapSpawn.User.LifeTime;')] });
const flame = {
  name: 'NE_Flame_Basic_001', scripts: { spawn: hlsl['02'].file, update: hlsl['03'].file }, ...timing.NE_Flame_Basic_001,
  killEpsilon: killEpsilon('NE_Flame_Basic_001', '03', '02', 'float Constant109 = 0.0001;'),
  lifetime: userLifetime,
  spriteSize: { ...span('NE_Flame_Basic_001.spriteSize', '02', 'float Constant23 = 120;', 'float Constant24 = 120;'), counter: 1 },
  colorScale: { ...span('NE_Flame_Basic_001.colorScale', '02', 'float4 Constant47 = float4(0.7,0.7,0.7,1);', 'float4 Constant48 = float4(1,1,1,1);'), counter: 2 },
  colorBase: scalar('NE_Flame_Basic_001.colorBase', '02', 'float4 Constant61 = float4(3470,468.92,65.6487,1);'),
  writeSpriteRotation: true,
  rotation: { ...span('NE_Flame_Basic_001.rotation', '02', 'float Constant69 = 0.25;', 'float Constant70 = 0.5;'), counter: 3 },
  subUVFrames: scalar('NE_Flame_Basic_001.subUVFrames', '03', 'float Constant32 = 40;'),
  curves: { alpha: curvePair('NE_Flame_Basic_001', 0, 'Scale Alpha.FloatCurve001'), size: curvePair('NE_Flame_Basic_001', 1, 'Value.Scale Factor.FloatCurve') },
  randomCalls: randomCalls('02', [
    [1, 'random3', 'x', 'SpriteSize 120..120', 'UniformRangedFloat_Emitter_Func(UniformRangedFloat_Emitter_FuncOutput_UniformRangedFloat, Context);'],
    [2, 'random4', 'xyzw', 'color scale (0.7,0.7,0.7,1)..1', 'UniformRangedVector4_Emitter_Func(UniformRangedVector4_Emitter_FuncOutput_UniformRangedVec4, Context);'],
    [3, 'random3', 'x', 'SpriteRotation 0.25..0.5', 'UniformRangedFloat001_Emitter_Func(UniformRangedFloat001_Emitter_FuncOutput_UniformRangedFloat, Context);'],
    [4, 'random3', 'x', 'MaterialRandom 0..1 (not simulated)', 'RandomRangeFloat_A1PYV2PYSPF5RZOBZN3JSJFNC_Func(Constant75']])
};
vm('NE_Flame_Basic_001.subUVFrames.spawnPass', '02', literal('02', 'float Constant139 = 40;'), [at('02', 'float Constant139 = 40;')]);
line('02', 'Context.MapSpawn.InitializeParticle.WriteSpriteRotation = Constant59;');
line('02', 'bool Constant59 = true;');

// ---------- NE_Basic_Flash001 (06 spawn, 07 update)
const flash = {
  name: 'NE_Basic_Flash001', scripts: { spawn: hlsl['06'].file, update: hlsl['07'].file }, ...timing.NE_Basic_Flash001,
  killEpsilon: killEpsilon('NE_Basic_Flash001', '07', '06', 'float Constant55 = 0.0001;', true),
  lifetime: scalar('NE_Basic_Flash001.lifetime', '06', 'float Constant47 = 0.3;'),
  spriteSize: scalar('NE_Basic_Flash001.spriteSize', '06', 'float2 Constant50 = float2(100,100);'),
  color: scalar('NE_Basic_Flash001.color', '06', 'float4 Constant48 = float4(37,6,0.7,1);'),
  writeSpriteRotation: false,
  curves: { alpha: curvePair('NE_Basic_Flash001_3', 0, 'Scale Alpha.FloatCurve001'), size: curvePair('NE_Basic_Flash001_3', 1, 'Value.Scale Factor.FloatCurve') },
  randomCalls: randomCalls('06', [
    [1, 'random3', 'x', 'MaterialRandom 0..1 (not simulated)', 'RandomRangeFloat_A1PYV2PYSPF5RZOBZN3JSJFNC_Func(Constant19']])
};
// The spawn pass folds max(0.3, 1e-5) - 0.0001 into one kill threshold.
vm('NE_Basic_Flash001.killThreshold.spawnPass', '06', f32(f32(flash.lifetime) - f32(flash.killEpsilon)), [at('06', 'float Constant55 = 0.0001;')]);
line('06', 'Context.MapSpawn.InitializeParticle.WriteSpriteRotation = Constant42;');
line('06', 'bool Constant42 = false;');

// ---------- NE_SimpleBurst (10 spawn, 11 update)
for (const fragment of ['Context.MapSpawn.InitializeParticle.WriteSpriteRotation = Constant65;', 'bool Constant65 = false;',
  'Context.MapSpawn.CalculateSizeAndRotationalInertiaByMass.DensitybyMaterialType = Constant98;', 'int Constant98 = 1;',
  'Context.MapSpawn.CalculateSizeAndRotationalInertiaByMass.ManuallyEnterDensity = Constant99;', 'bool Constant99 = false;',
  'Context.MapSpawn.CalculateSizeAndRotationalInertiaByMass.CalculateMeshScale = Constant108;', 'bool Constant108 = false;',
  'Context.MapSpawn.AddVelocityFromPoint.UseFalloffDistance = Constant135;', 'bool Constant135 = false;',
  'Context.MapSpawn.AddVelocityFromPoint.DefaultPosition = Context.MapSpawn.Particles.Position;',
  'Context.MapSpawn.AddVelocityFromPoint.VelocityOrigin = SimulationPosition_Emitter_FuncOutput_SimulationPosition;'])
  line('10', fragment);
line('11', 'Context.Map.Transient.DragIgnoreMass = Constant22;');
line('11', 'bool Constant22 = true;');
const thresholdFragment = 'float Constant179 = 1e-05;';
const simpleBurst = {
  name: 'NE_SimpleBurst', scripts: { spawn: hlsl['10'].file, update: hlsl['11'].file }, ...timing.NE_SimpleBurst,
  killEpsilon: killEpsilon('NE_SimpleBurst', '11', '10', 'float Constant186 = 0.0001;'),
  lifetime: { ...span('NE_SimpleBurst.lifetime', '10', 'float Constant47 = 0.1;', 'float Constant48 = 0.6;'), counter: 2 },
  mass: { ...span('NE_SimpleBurst.mass', '10', 'float Constant59 = 0.4;', 'float Constant60 = 2;'), counter: 3 },
  sizeFromMass: {
    densityMaterial: 'steel',
    density: scalar('NE_SimpleBurst.sizeFromMass.density', '10', 'float Constant118 = 8050;'),
    volumeScale: scalar('NE_SimpleBurst.sizeFromMass.volumeScale', '10', 'float Constant130 = 1e+06;'),
    exponent: scalar('NE_SimpleBurst.sizeFromMass.exponent', '10', 'float Constant131 = 0.333333;'),
    // UserSpriteDimensionPreference = (1,1) * 3 / (1 + 1 + 1), folded by the compiler.
    spriteDimension: vm('NE_SimpleBurst.sizeFromMass.spriteDimension', '10', 1, [at('10', 'float Constant126 = 3;')]),
    calculateMeshScale: false
  },
  color: scalar('NE_SimpleBurst.color', '10', 'float4 Constant96 = float4(36,7,0.7,1);'),
  writeSpriteRotation: false,
  speed: { ...span('NE_SimpleBurst.speed', '10', 'float Constant143 = 75;', 'float Constant144 = 400;'), counter: 6 },
  direction: { ...span('NE_SimpleBurst.direction', '10', 'float2 Constant168 = float2(0,-1);', 'float2 Constant169 = float2(6.28319,1);'), counter: 7 },
  velocityFromPoint: { useFalloffDistance: false,
    thresholdSquared: vm('NE_SimpleBurst.velocityFromPoint.thresholdSquared', '10', f32(f32(literal('10', thresholdFragment)) * f32(literal('10', thresholdFragment))), [at('10', thresholdFragment)]) },
  drag: scalar('NE_SimpleBurst.drag', '11', 'float Constant10 = 0.75;'),
  curves: { alpha: curvePair('NE_SimpleBurst', 1, 'Scale Alpha.FloatCurve'), size: curvePair('NE_SimpleBurst', 0, 'Value.Scale Factor.FloatCurve') },
  randomCalls: randomCalls('10', [
    [1, 'random3', 'x', 'SpriteSize 0.2..0.5, overwritten by the size from mass', 'UniformRangedFloat_Emitter_Func(UniformRangedFloat_Emitter_FuncOutput_UniformRangedFloat, Context);'],
    [2, 'random3', 'x', 'Lifetime 0.1..0.6', 'UniformRangedFloat003_Emitter_Func(UniformRangedFloat003_Emitter_FuncOutput_UniformRangedFloat, Context);'],
    [3, 'random3', 'x', 'Mass 0.4..2', 'UniformRangedFloat005_Emitter_Func(UniformRangedFloat005_Emitter_FuncOutput_UniformRangedFloat, Context);'],
    [4, 'random3', 'x', 'SpriteRotation 0..1, discarded (WriteSpriteRotation false)', 'UniformRangedFloat006_Emitter_Func(UniformRangedFloat006_Emitter_FuncOutput_UniformRangedFloat, Context);'],
    [5, 'random3', 'x', 'MaterialRandom 0..1 (not simulated)', 'RandomRangeFloat_A1PYV2PYSPF5RZOBZN3JSJFNC_Func(Constant81'],
    [6, 'random3', 'x', 'VelocityStrength 75..400', 'UniformRangedFloat002_Emitter_Func(UniformRangedFloat002_Emitter_FuncOutput_UniformRangedFloat, Context);'],
    [7, 'random3', 'xy', 'fallback unit vector (phi, cos theta)', 'RandomRangeFloat_997IPWV7MOPKM3SJE09WFADXW_Func(Constant168', 'AddVelocityFromPoint_Emitter_Func(Context);'],
    [8, 'random3', 'x', 'unit circle angle, discarded', 'RandomRangeFloat_A1PYV2PYSPF5RZOBZN3JSJFNC_Func(Constant174', 'AddVelocityFromPoint_Emitter_Func(Context);']])
};
vm('NE_SimpleBurst.drag.spawnPass', '10', literal('10', 'float Constant194 = 0.75;'), [at('10', 'float Constant194 = 0.75;')]);
check(literal('10', 'float Constant194 = 0.75;') === simpleBurst.drag, 'Drag of the spawn pass');

// ---------- Result
const emitters = [flame, flash, simpleBurst];
const seeds = report.settings.emitters.map(e => e.fixtureSeed);
check(JSON.stringify(report.settings.emitters.map(e => e.name)) === JSON.stringify(emitters.map(e => e.name)), 'Emitter handles');
check(seeds.every((s, i) => Number.isInteger(s) && s === seeds[0] + i), 'Fixture seeds are fixtureSeedBase + handle index');
const disabled = [...disabledNodes('NE_Flame_Basic_001', flame.name), ...disabledNodes('NE_Basic_Flash001_3', flash.name), ...disabledNodes('NE_SimpleBurst', simpleBurst.name)];
check(JSON.stringify(disabled.map(d => `${d.emitter}.${d.module}`).sort()) === JSON.stringify(['NE_Flame_Basic_001.AddVelocity',
  'NE_Flame_Basic_001.SpawnRate', 'NE_Flame_Basic_001.SphereLocation', 'NE_SimpleBurst.GravityForce', 'NE_SimpleBurst.SphereLocation']),
  'Disabled graph nodes differ from the reviewed recipe');
for (const { emitter, module } of disabled) {
  const ids = { NE_Flame_Basic_001: ['02', '03'], NE_Basic_Flash001: ['06', '07'], NE_SimpleBurst: ['10', '11'] }[emitter];
  check(!ids.some(id => hlsl[id].lines.some(l => l.includes(`${module}_Emitter_Func`))), `Disabled ${module} is compiled into ${emitter}`);
}
const result = {
  schema: 'st01c-basichit-source/v1',
  system: manifest.system,
  engine: manifest.engine,
  recipe: 'docs/delivery/st01c/basichit/RECIPE.md',
  scope: 'Compiled CPU recipe of NS_BasicHit: burst-only births, EmitterState Once, system at the origin in world space. ' +
    'Values from the VM constant tables, LUTs and user parameters of system.t3d; no captured particle state is read.',
  emitterNames: emitters.map(e => e.name),
  fixtureSeeds: seeds,
  emitters,
  disabledNodes: disabled,
  constants,
  inputs
};
const text = JSON.stringify(result, null, 2) + '\n';
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, text);
console.log(JSON.stringify({ bytes: Buffer.byteLength(text), sha256: sha(text), constants: constants.length, particleStatesRead: 0 }));
