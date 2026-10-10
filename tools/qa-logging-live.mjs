// Bounded public-TLS acceptance for authenticated cooperative Tala. This mutates the one live world.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { canStand } from '../src/sim/systems/movement.js';
import { DT, tuning } from '../src/data/tuning.js';
import { HARVEST } from '../src/data/resources.js';
import { economicCommand, economicOperationId } from '../server/economicAuthority.mjs';
import { storeFromEnv } from '../server/store.mjs';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';

const usage = 'usage: node tools/qa-logging-live.mjs before|resume|after|cleanup [--env-file PATH] [--fixture PATH] [--evidence PATH]';
const phaseArg = process.argv[2];
if (phaseArg === '--help' || phaseArg === '-h') { console.log(usage); process.exit(0); }

class QaFailure extends Error { constructor(label) { super(label); this.label = label; } }
const ensure = (condition, label) => { if (!condition) throw new QaFailure(label); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
const stable = value => JSON.stringify(sort(value));
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
const unwrap = result => { if (!result || result.error) throw new QaFailure('provider operation failed'); return result.data; };
const progression = profile => profile?.progression;
const accountProfile = profile => ({ gold: profile?.gold, statsGold: profile?.stats?.gold,
  goods: profile?.eco?.pack?.goods, tradeRev: profile?.eco?.tradeRev, tools: profile?.tools,
  progression: progression(profile) });

async function main() {
  const phase = phaseArg;
  if (!['before', 'resume', 'after', 'cleanup'].includes(phase)) throw new QaFailure(usage);
  let envFile = null, fixturePath = path.resolve('.scratch/logging-live-fixture.json');
  let evidencePath = path.resolve('docs/delivery/prg01b2-logging/logging-live-acceptance.json');
  for (let i = 3; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--env-file' && process.argv[i + 1] && !envFile) envFile = process.argv[++i];
    else if (arg === '--fixture' && process.argv[i + 1]) fixturePath = path.resolve(process.argv[++i]);
    else if (arg === '--evidence' && process.argv[i + 1]) evidencePath = path.resolve(process.argv[++i]);
    else throw new QaFailure(usage);
  }
  if (envFile) { try { process.loadEnvFile(path.resolve(envFile)); } catch { throw new QaFailure('environment file unavailable'); } }

  const worldId = process.env.WORLD_ID || 'marea-negra';
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12000) }) } };
  ensure(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && process.env.SUPABASE_PUBLIC_KEY,
    'provider configuration unavailable');
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, options);
  const pub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, options);
  let store;
  try { store = storeFromEnv(); } catch { throw new QaFailure('durable store configuration unavailable'); }
  let base;
  try { base = new URL(process.env.MN_M5_TARGET || 'https://marea.62.171.136.148.sslip.io'); }
  catch { throw new QaFailure('public TLS target required'); }
  ensure(base.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(base.hostname), 'public TLS target required');
  const basePath = base.pathname.replace(/\/$/, ''); base.search = ''; base.hash = '';
  const wsUrl = new URL(`${basePath}/ws`, base); wsUrl.protocol = 'wss:';

  let fixture = null, evidence = { schema: 'mn.logging.live.v1', phases: [] }, clients = [];
  try {
    if (fs.existsSync(fixturePath)) fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    if (fs.existsSync(evidencePath)) evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  } catch { throw new QaFailure('fixture or evidence file invalid'); }
  const saveFixture = () => {
    fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
    fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n', { mode: 0o600 });
    try { fs.chmodSync(fixturePath, 0o600); } catch { /* Windows ACLs may not expose POSIX modes. */ }
  };
  const record = (check, data = {}) => {
    const item = { check, pass: true, at: new Date().toISOString(), ...data };
    let row = evidence.phases.find(value => value.phase === phase);
    if (!row) { row = { phase, checks: [] }; evidence.phases.push(row); }
    row.checks.push(item); fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n'); console.log(JSON.stringify(item));
  };

  async function publicStatus({ idle = false } = {}) {
    const healthResponse = await fetch(new URL(`${basePath}/health`, base), { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    ensure(healthResponse.ok && await healthResponse.text() === 'ok', 'public health check failed');
    const response = await fetch(new URL(`${basePath}/status`, base), { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    ensure(response.ok, 'public status unavailable');
    const status = await response.json(), storage = status?.storage;
    ensure(status.errors === 0 && storage?.durable === true && storage?.accounts === true
      && storage?.errors === 0 && storage?.economic?.enabled === true
      && storage.economic.failed === false && storage.economic.pending === 0
      && storage?.resources?.enabled === true && storage.resources.ready === true && storage.resources.logging === true
      && storage?.world?.id === worldId && storage.world.ready === true && storage.world.failed === false
      && storage.tickBlocked === false, 'live Tala authority is not enabled and healthy');
    if (idle) ensure(status.players === 0 && status.sockets === 0 && storage.unsaved === 0 && storage.profileWrites === 0
      && storage.worldWriting === false && storage.economic.pending === 0, 'public world is not idle for live Tala QA');
    return { status, uptime: status.uptime, worldVersion: storage.world.version };
  }
  async function authConfiguration() {
    const response = await fetch(new URL(`${basePath}/auth/config`, base), { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    ensure(response.ok, 'public auth configuration unavailable');
    const auth = await response.json();
    ensure(auth?.enabled === true && new URL(auth.url).origin === new URL(process.env.SUPABASE_URL).origin,
      'public auth provider mismatch');
  }
  async function readyCheck() {
    const resource = await store.checkResourceOperations(), logging = await store.checkLoggingOperations();
    ensure(resource.version === 1 && logging.version === 1, 'SQL resource or logging readiness unavailable');
    const denied = await pub.rpc('mn_logging_operations_ready');
    ensure(denied.error?.code === '42501', 'public SQL016 readiness RPC was not denied');
  }
  async function waitFlush() {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const { status } = await publicStatus(); const s = status.storage;
      if (s.profileWrites === 0 && s.worldWriting === false && s.economic.pending === 0 && s.unsaved === 0) {
        await sleep(350);
        const confirmed = (await publicStatus()).status;
        if (confirmed.storage.profileWrites === 0 && confirmed.storage.worldWriting === false
          && confirmed.storage.economic.pending === 0 && confirmed.storage.unsaved === 0) return confirmed;
      }
      await sleep(300);
    }
    throw new QaFailure('bounded public flush wait expired');
  }
  async function createAccount(label, practice) {
    const email = `mn-logging-qa-${randomUUID()}@example.com`, password = `Aa1!${randomBytes(24).toString('base64url')}`;
    const signup = unwrap(await admin.auth.admin.generateLink({ type: 'signup', email, password }));
    ensure(signup.user?.id && signup.properties?.hashed_token, 'synthetic account creation failed');
    const item = { label, accountId: signup.user.id, email, password, sentinel: 41900 + (label === 'A' ? 1 : 2) };
    fixture.accounts[label] = item; saveFixture();
    unwrap(await pub.auth.verifyOtp({ token_hash: signup.properties.hashed_token, type: 'signup' }));
    const profile = newProfile(); profile.pirateId = `account:${item.accountId}`; profile.gold = item.sentinel;
    profile.stats.gold = item.sentinel; profile.tools.axe = 1;
    profile.progression = { v: 1, practice: { logging: practice }, milestones: [], knowledge: [] };
    ensure(sanitizeProfile(profile), 'synthetic seed profile rejected by sanitizer');
    const saved = await store.initializeProfile(item.accountId, profile);
    ensure(saved?.version === 1 && stable(accountProfile(saved.data)) === stable(accountProfile(profile)),
      'synthetic profile seed did not persist');
    item.initialProfileHash = hash(accountProfile(profile)); saveFixture();
    const login = unwrap(await pub.auth.signInWithPassword({ email, password }));
    ensure(login.user?.id === item.accountId && login.session?.access_token, 'synthetic account login failed');
    item.accessToken = login.session.access_token; saveFixture();
    return item;
  }

  class Player {
    constructor(label, token, accountId) {
      this.label = label; this.token = token; this.accountId = accountId; this.ws = null; this.messages = [];
      this.profile = null; this.entity = null; this.position = null; this.map = null; this.resources = null;
      this.tick = 0; this.sentTick = 0; this.seq = 0;
    }
    async enter() {
      this.messages = []; this.profile = null; this.entity = null; this.position = null; this.resources = null; this.map = null;
      this.ws = new WebSocket(wsUrl, { origin: base.origin, handshakeTimeout: 10000 }); clients.push(this);
      this.ws.on('message', raw => {
        let message; try { message = JSON.parse(raw); } catch { return; }
        this.messages.push(message); if (this.messages.length > 5000) this.messages.splice(0, 2000);
        if (Number.isSafeInteger(message.tick)) this.tick = Math.max(this.tick, message.tick);
        if (message.t === 'welcome') { this.entity = message.you; if (Number.isSafeInteger(message.seed)) this.map = generateWorld(message.seed); }
        if (message.t === 'profile') this.profile = message.p;
        if (message.t === 'snap' && message.resources) this.resources = message.resources;
        const own = message.ents?.find(row => row[0] === this.entity);
        if (own) this.position = { x: own[2], y: own[3], z: own[4] };
      });
      await new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', () => reject(new QaFailure('public websocket unavailable'))); });
      this.send({ t: 'hello', v: PROTOCOL_VERSION, name: `Tala QA ${this.label}`, skin: 0, weapon: 0, token: this.token });
      await this.wait(m => m.t === 'welcome'); await this.wait(m => m.t === 'profile'); await this.wait(m => m.t === 'snap' && m.resources);
      ensure(this.profile?.pirateId === `account:${this.accountId}` && this.profile.tools?.axe === 1,
        `authenticated synthetic profile ${this.label} mismatch`);
    }
    send(message) { ensure(this.ws?.readyState === WebSocket.OPEN, 'websocket is not open'); this.ws.send(JSON.stringify(message)); }
    async wait(predicate, timeout = 25000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const message = this.messages.find(predicate); if (message) return message;
        if (this.messages.some(m => m.t === 'error' || m.t === 'full')) throw new QaFailure('public admission rejected');
        await sleep(40);
      }
      throw new QaFailure('bounded public response wait expired');
    }
    inputs(mx, mz) {
      this.sentTick = Math.max(this.sentTick, this.tick);
      const cmds = Array.from({ length: 6 }, () => ({ seq: ++this.seq, mx, mz, ax: 0, az: 0,
        btn: 0, prs: 0, pt: ++this.sentTick, w: 0 }));
      this.send({ t: 'inputs', cmds });
    }
    navEdge(from, to) {
      const distance = Math.hypot(to.x - from.x, to.z - from.z);
      if (distance < 1e-8) return { x: to.x, z: to.z, y: from.y };
      const samples = Math.max(1, Math.ceil(distance / 0.3));
      let prior = { ...from, y: Number.isFinite(from.y) ? from.y : this.map.groundAt(from.x, from.z) };
      for (let i = 1; i <= samples; i++) {
        const t = i / samples, x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
        if (!canStand({ map: this.map }, x, z, tuning.player.radius, prior.y)) return null;
        const y = this.map.groundAt(x, z), step = Math.hypot(x - prior.x, z - prior.z);
        if ((this.map.onDock(prior.x, prior.z) || this.map.onDock(x, z))
          ? Math.abs(y - prior.y) >= 0.6 : (y - prior.y) / step > tuning.world.maxSlope) return null;
        prior = { x, y, z };
      }
      return prior;
    }
    routeTo(target, radius) {
      ensure(this.map && this.position, 'navigation map or player position unavailable');
      const start = { ...this.position, y: Number.isFinite(this.position.y) ? this.position.y : this.map.groundAt(this.position.x, this.position.z) };
      if (Math.hypot(start.x - target.x, start.z - target.z) <= radius) return [];
      const key = (x, z) => `${x},${z}`, startKey = key(0, 0), within = (x, z) => Math.hypot(x, z) < 180;
      const open = [{ ix: 0, iz: 0, ...start, g: 0, f: Math.max(0, Math.hypot(start.x-target.x,start.z-target.z)-radius), key: startKey }];
      const best = new Map([[startKey, 0]]), parent = new Map(), points = new Map([[startKey, start]]);
      const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]; let found = null, visited = 0;
      while (open.length && visited < 18000) {
        open.sort((a,b)=>a.f-b.f); const current = open.shift();
        if (current.g !== best.get(current.key)) continue; visited++;
        if (Math.hypot(current.x-target.x,current.z-target.z)<=radius) { found=current.key; break; }
        for (const [dx,dz] of directions) {
          const ix=current.ix+dx, iz=current.iz+dz; if (!within(ix,iz)) continue;
          const x=start.x+ix*0.8, z=start.z+iz*0.8, edge=this.navEdge(current,{x,z}); if(!edge) continue;
          const nextKey=key(ix,iz), g=current.g+0.8*(dx&&dz?Math.SQRT2:1); if(g>=(best.get(nextKey)??Infinity)) continue;
          best.set(nextKey,g); parent.set(nextKey,current.key); points.set(nextKey,edge);
          open.push({ix,iz,...edge,g,key:nextKey,f:g+Math.max(0,Math.hypot(x-target.x,z-target.z)-radius)});
        }
      }
      ensure(found, 'no safe normal route to palm');
      const route=[]; for(let cursor=found;cursor!==startKey;cursor=parent.get(cursor)) route.push(points.get(cursor)); route.reverse();
      const compressed=[]; let anchor=start,index=0;
      while(index<route.length){let farthest=index;for(let probe=route.length-1;probe>index;probe--)if(this.navEdge(anchor,route[probe])){farthest=probe;break;}
        compressed.push(route[farthest]);anchor=route[farthest];index=farthest+1;}
      return compressed;
    }
    async walk(target, radius=1.8) {
      const deadline=Date.now()+60000; let route=this.routeTo(target,radius),waypoint=0,replans=0,progressAt=Date.now(),prior={...this.position};
      while(Date.now()<deadline&&Math.hypot(this.position.x-target.x,this.position.z-target.z)>radius){
        while(waypoint<route.length&&Math.hypot(this.position.x-route[waypoint].x,this.position.z-route[waypoint].z)<=0.65) waypoint++;
        const goal=route[waypoint]||target,dx=goal.x-this.position.x,dz=goal.z-this.position.z,d=Math.hypot(dx,dz);
        this.inputs(d>0.1?dx/d:0,d>0.1?dz/d:0); await sleep(120);
        if(Date.now()-progressAt>1400){if(Math.hypot(this.position.x-prior.x,this.position.z-prior.z)<0.18){
          ensure(++replans<=3,'normal movement stalled after bounded route replans');route=this.routeTo(target,radius);waypoint=0;}
          progressAt=Date.now();prior={...this.position};}
      }
      this.inputs(0,0); await sleep(700); ensure(Math.hypot(this.position.x-target.x,this.position.z-target.z)<=radius+0.5,'normal walk to palm failed');
    }
    async leave() {
      if (!this.ws) return; const socket=this.ws; this.ws=null;
      if(socket.readyState===WebSocket.OPEN) await new Promise(resolve=>{const timer=setTimeout(()=>{socket.terminate();resolve();},2500);
        socket.once('close',()=>{clearTimeout(timer);resolve();});socket.close();});
    }
  }
  async function closeAll() { for (const client of clients) await client.leave(); }
  async function operation(player, node, expectedTicks, expectedHits, expectedCount, label) {
    const priorProfile = structuredClone(player.profile);
    const command = { t:'cmd', type:'resource', op:'gather', opId:`talaqa_${randomUUID()}`, node:node.id, expectedRev:node.rev };
    fixture.commands.push({ label, account:player.accountId, command, operationId:economicOperationId(worldId,player.accountId,command.opId) });
    saveFixture(); player.send(command);
    const event=await player.wait(m=>m.t==='event'&&m.ev?.type==='resource'&&m.ev.opId===command.opId);
    const ack=event.ev;
    ensure(ack.ok===true&&ack.durable===true&&ack.op==='gather'&&ack.actionTicks===expectedTicks,
      `${label} durable ACK or action cadence mismatch`);
    ensure(ack.rev===node.rev+1&&ack.remaining===HARVEST.palmHits-expectedHits&&ack.count===expectedCount,
      `${label} node progression or material count mismatch`);
    const expectedTradeRev = priorProfile.eco.tradeRev + (expectedCount > 0 ? 1 : 0);
    await player.wait(m=>m.t==='profile'&&m.p?.eco?.tradeRev>=expectedTradeRev);
    player.profile=player.messages.filter(m=>m.t==='profile').at(-1).p;
    const receipt=await store.loadEconomicOperation(fixture.commands.at(-1).operationId);
    ensure(receipt?.request?.account===player.accountId&&receipt.request.world===worldId
      &&stable(receipt.request.command)===stable(economicCommand(command))&&receipt.request.ack.ok===true
      &&receipt.result?.ack?.opId===command.opId,
    `${label} durable receipt mismatch`);
    fixture.commands.at(-1).ack=ack;
    fixture.commands.at(-1).receiptProfiles=(receipt.request.beneficiaries||[]).map(row=>({
      account:row.account,expectedVersion:row.expectedVersion,version:row.expectedVersion+1,
      progression:row.profile.progression,profileHash:hash(accountProfile(row.profile)) }));
    if (expectedCount === 2) {
      ensure(stable(receipt.result.profiles) === stable(receipt.request.beneficiaries
        .map(row => ({ account: row.account, version: row.expectedVersion + 1 }))),
      `${label} receipt profile versions mismatch`);
      const beforeRows = new Map(receipt.request.beneficiaries.map(row => [row.account, row.before.progression.practice.logging]));
      const afterRows = new Map(receipt.request.beneficiaries.map(row => [row.account, row.profile.progression.practice.logging]));
      const shares = Object.fromEntries([...afterRows].map(([account, amount]) => [account, amount - beforeRows.get(account)]));
      ensure(receiptProfilesForShares(receipt, shares, player.accountId), `${label} receipt does not encode the fixed practice budget`);
      fixture.commands.at(-1).receiptShares = shares;
    }
    saveFixture(); return { command, ack, receipt };
  }
  function receiptProfilesForShares(receipt, shares, actor) {
    return receipt.request.beneficiaries.length === 1 ? shares[actor] === 10
      : shares[actor] === 7 && Object.entries(shares).some(([account, amount]) => account !== actor && amount === 3);
  }
  async function simpleOperation(player, fields, label) {
    const command = {t:'cmd', opId:`talaqa_${randomUUID()}`, ...fields};
    const item = {label, account:player.accountId, command, operationId:economicOperationId(worldId,player.accountId,command.opId)};
    fixture.commands.push(item); saveFixture(); player.send(command);
    const event = await player.wait(m => m.t === 'event' && m.ev?.type === command.type && m.ev.opId === command.opId);
    ensure(event.ev.ok === true && event.ev.durable === true, `${label} was not durably confirmed`);
    const receipt = await store.loadEconomicOperation(item.operationId);
    ensure(receipt?.result?.ack?.ok === true && stable(receipt.request.command) === stable(economicCommand(command)), `${label} receipt mismatch`);
    item.ack = event.ev; saveFixture();
    await player.wait(m => m.t === 'profile' && m.p?.eco?.tradeRev === receipt.request.profile.eco.tradeRev);
    return event.ev;
  }
  async function finishCanary(a, b) {
    ensure(a.profile.progression.practice.logging === 60 && b.profile.progression.practice.logging === 3,
      'resume requires the verified cooperative threshold state');
    // Normal backpack capacity is ten; process and sell the first yield through existing M5 commands.
    ensure((a.profile.eco.pack.goods.tronco || 0) === 2 && !a.profile.eco.pack.goods.madera, 'unexpected canary cargo before normal processing');
    await a.walk(a.resources.bench);
    await simpleOperation(a, {type:'resource',op:'craft',recipe:'madera',n:2,expectedRev:a.profile.eco.tradeRev}, 'A_process_two_logs');
    ensure((a.profile.eco.pack.goods.madera || 0) === 2 && !a.profile.eco.pack.goods.tronco, 'normal crafting did not process exactly two logs');
    await a.walk(a.map.landmarks.village, 16);
    const quote = {t:'cmd',type:'commerce',op:'quote',town:'aldea',g:'madera',n:2,side:'sell',opId:`talaqa_${randomUUID()}`};
    a.send(quote);
    const quoted = (await a.wait(m => m.t === 'event' && m.ev?.type === 'commerce' && m.ev.opId === quote.opId)).ev;
    ensure(quoted.ok === true && Number.isSafeInteger(quoted.total), 'normal two-wood sale quote unavailable');
    const sold = await simpleOperation(a, {type:'commerce',op:'sell',town:'aldea',g:'madera',n:2,expectedTotal:quoted.total}, 'A_sell_processed_wood');
    ensure(sold.total === quoted.total && a.profile.gold === fixture.accounts.A.sentinel + quoted.total
      && Object.keys(a.profile.eco.pack.goods).length === 0 && a.profile.progression.practice.logging === 60,
      'normal sale changed practice or settled unexpected cargo/gold');
    fixture.accounts.A.expectedGold = a.profile.gold; saveFixture();
    const nextPalm = choosePalm(a, new Set([fixture.palmId])); await a.walk(nextPalm);
    let node = snapshotNode(a,nextPalm.id);
    const trained = await operation(a,node,45,1,0,'A_trained_next_palm_hit');
    fixture.trainedPalm={id:nextPalm.id,revision:trained.ack.rev,actionTicks:trained.ack.actionTicks}; saveFixture();
    // Finish the synthetic contributor's cycle before deleting its account, so future players never
    // depend on a deleted beneficiary profile. The solo completion earns ten further practice.
    for (const hit of [2,3]) {
      await sleep(850);
      await a.wait(m => m.t === 'snap' && m.resources?.nodes?.some(n => n.id === nextPalm.id && n.hits === hit-1));
      node = snapshotNode(a,nextPalm.id);
      const result = await operation(a,node,45,hit,hit===3?2:0,`A_trained_completion_hit_${hit}`);
      fixture.trainedPalm.revision = result.ack.rev;
    }
    ensure(a.profile.progression.practice.logging === 70 && b.profile.progression.practice.logging === 3,
      'trained solo completion did not preserve the cooperative award and add ten once');
    await closeAll(); const flushed = await waitFlush();
    ensure(flushed.players === 0 && flushed.sockets === 0, 'canary sessions did not close before checkpoint');
    fixture.beforeRestartProfiles={};
    for(const label of ['A','B']) {
      const row=await store.loadProfile(fixture.accounts[label].accountId);
      fixture.beforeRestartProfiles[label]={version:row.version,hash:hash(accountProfile(row.data)),fullHash:hash(row.data)};
    }
    const world = await store.loadWorld(worldId);
    const ids = [...new Set(fixture.commands.filter(c => c.command.op === 'gather').map(c => c.command.node))];
    fixture.expectedResourceTargets = Object.fromEntries(ids.map(id => [id, {
      node:world.data.resources.nodes.find(n => n.id === id), ledger:world.data.resources.logging[id],
    }]));
    fixture.hostUptimeBefore=flushed.uptime; fixture.completedBefore=true; saveFixture();
    record('cooperative 7/3 credit and threshold persisted; normal craft/sale made room and trained solo hits used 45 ticks', {
      commandCount:fixture.commands.length,shares:{A:7,B:3},practiceAtThreshold:{A:60,B:3},practiceAtCheckpoint:{A:70,B:3},
      actionTicks:{thresholdCompletion:54,nextHit:45},hostUptimeBefore:fixture.hostUptimeBefore,
      completedSyntheticCycles:2,partialSyntheticCycles:0,
    });
  }
  function snapshotNode(player,id) { return player.resources?.nodes?.find(node=>node.id===id); }
  function choosePalm(player, excluded=new Set()) {
    const choices=(player.resources?.nodes||[]).filter(n=>n.kind==='palm'&&n.ready===true&&n.hits===0&&!excluded.has(n.id))
      .sort((a,b)=>Math.hypot(a.x-player.position.x,a.z-player.position.z)-Math.hypot(b.x-player.position.x,b.z-player.position.z));
    ensure(choices.length>0,'no ready palm available for bounded canary'); return choices[0];
  }
  async function exactReplays(players) {
    for(const item of fixture.commands){
      const player=players.get(item.account); ensure(player,'replay player missing');
      const beforeProfiles = await Promise.all(Object.values(fixture.accounts).map(account => store.loadProfile(account.accountId)));
      const beforeWorld=await store.loadWorld(worldId);
      const beforeState = {nodes:beforeWorld.data.resources.nodes,logging:beforeWorld.data.resources.logging};
      const priorReceipt = await store.loadEconomicOperation(item.operationId);
      ensure(priorReceipt?.result?.ack, 'replay receipt missing');
      player.send(item.command);
      const event=await player.wait(m=>m.t==='event'&&m.ev?.type===item.command.type&&m.ev.opId===item.command.opId);
      ensure(event.ev.ok===priorReceipt.result.ack.ok&&(event.ev.replay===true||event.ev.historical===true),'exact command replay not identified as historical');
      const afterProfiles = await Promise.all(Object.values(fixture.accounts).map(account => store.loadProfile(account.accountId)));
      const afterWorld=await store.loadWorld(worldId);
      ensure(beforeProfiles.every((before, index) => stable(before) === stable(afterProfiles[index]))
        &&stable(beforeState)===stable({nodes:afterWorld.data.resources.nodes,logging:afterWorld.data.resources.logging}),
      'exact replay duplicated a profile award or changed current world node/ledger');
    }
  }

  try {
    await authConfiguration();
    if (phase !== 'cleanup') {
      const live=await publicStatus({ idle:true }); await readyCheck();
      if (phase === 'resume') {
        ensure(fixture?.schema === 'mn.logging.live.private.v1' && fixture.worldId === worldId && fixture.palmCompletion
          && !fixture.completedBefore, 'resume requires an incomplete canary after cooperative completion');
        const players = [];
        for (const label of ['A','B']) {
          const item = fixture.accounts[label];
          const login = unwrap(await pub.auth.signInWithPassword({email:item.email,password:item.password}));
          ensure(login.user?.id === item.accountId && login.session?.access_token, 'synthetic resume login failed');
          item.accessToken = login.session.access_token;
          const player = new Player(label,item.accessToken,item.accountId); await player.enter(); players.push(player);
        }
        saveFixture(); await finishCanary(...players); return;
      }
      if(phase==='before'){
        ensure(fixture===null,'fixture already exists; use after or cleanup');
        fixture={schema:'mn.logging.live.private.v1',worldId,createdAt:new Date().toISOString(),commands:[],accounts:{},completedBefore:false}; saveFixture();
        await createAccount('A',53); await createAccount('B',0);
        const a=new Player('A',fixture.accounts.A.accessToken,fixture.accounts.A.accountId),b=new Player('B',fixture.accounts.B.accessToken,fixture.accounts.B.accountId);
        await a.enter(); await b.enter();
        ensure((await store.loadWorld(worldId))?.data?.resources?.v===2,'durable resource snapshot is not v2');
        const initialPalm=choosePalm(a); fixture.palmId=initialPalm.id;
        await a.walk(initialPalm); let node=snapshotNode(a,initialPalm.id); ensure(node?.rev===initialPalm.rev&&node.hits===0,'selected palm changed before first hit');
        const first=await operation(a,node,54,1,0,'A_first_hit');
        await b.wait(m=>m.t==='snap'&&m.resources?.nodes?.some(n=>n.id===fixture.palmId&&n.rev===first.ack.rev));
        await b.walk(initialPalm); node=snapshotNode(b,initialPalm.id); ensure(node?.rev===first.ack.rev&&node.hits===1,'palm did not expose A hit to B');
        const second=await operation(b,node,54,2,0,'B_hit_before_disconnect');
        await b.leave(); const disconnected=await waitFlush();
        const bRow=await store.loadProfile(fixture.accounts.B.accountId);
        ensure(bRow?.data?.progression?.practice?.logging===0,'B profile baseline did not flush before disconnect');
        await a.wait(m=>m.t==='snap'&&m.resources?.nodes?.some(n=>n.id===fixture.palmId&&n.rev===second.ack.rev));
        node=snapshotNode(a,initialPalm.id); ensure(node?.rev===second.ack.rev&&node.hits===2,'palm state changed before finisher');
        const final=await operation(a,node,54,3,2,'A_final_hit_offline_beneficiary');
        const aAfter=await store.loadProfile(fixture.accounts.A.accountId), bAfter=await store.loadProfile(fixture.accounts.B.accountId);
        ensure(aAfter?.data?.progression?.practice?.logging===60&&bAfter?.data?.progression?.practice?.logging===3,
          'cooperative 7/3 Tala shares did not persist for online and offline contributors');
        ensure(aAfter.data.progression.milestones.includes('logging_steady')&&!bAfter.data.progression.milestones.includes('logging_steady'),
          'Tala milestone did not match the 60-practice threshold');
        ensure(aAfter.data.gold===fixture.accounts.A.sentinel&&bAfter.data.gold===fixture.accounts.B.sentinel
          &&aAfter.data.stats.gold===fixture.accounts.A.sentinel&&bAfter.data.stats.gold===fixture.accounts.B.sentinel,
          'synthetic gold sentinels changed');
        ensure((aAfter.data.eco.pack.goods.tronco||0)===2&&(bAfter.data.eco.pack.goods.tronco||0)===0,
          'palm cargo was not limited to the finisher');
        const receiptProfiles=final.receipt.request.beneficiaries;
        ensure(Array.isArray(receiptProfiles)&&receiptProfiles.length===2
          &&receiptProfiles.find(p=>p.account===a.accountId)?.profile.progression.practice.logging===60
          &&receiptProfiles.find(p=>p.account===b.accountId)?.profile.progression.practice.logging===3,
          'completion receipt omitted a current beneficiary profile');
        fixture.palmCompletion={revision:final.ack.rev,operationId:fixture.commands.at(-1).operationId,
          profileVersions:{A:aAfter.version,B:bAfter.version},profileHashes:{A:hash(accountProfile(aAfter.data)),B:hash(accountProfile(bAfter.data))},
          shareAmounts:{A:7,B:3},goldSentinels:{A:aAfter.data.gold,B:bAfter.data.gold},offlineFlushUptime:disconnected.uptime};
        fixture.expectedProfiles={A:accountProfile(aAfter.data),B:accountProfile(bAfter.data)};
        saveFixture();
        await b.enter(); ensure(b.profile.progression.practice.logging===3,'B did not reconnect with confirmed Tala practice');
        fixture.bReconnectVerified=true; saveFixture();
        await finishCanary(a,b);
        return;
      }
      ensure(fixture?.schema==='mn.logging.live.private.v1'&&fixture.worldId===worldId&&fixture.completedBefore===true,
        'private live fixture is missing or incomplete');
      ensure(Number.isFinite(fixture.hostUptimeBefore)&&live.uptime<fixture.hostUptimeBefore,'public host restart was not observed');
      for(const label of ['A','B']){
        const item=fixture.accounts[label], row=await store.loadProfile(item.accountId);
        ensure(row?.data?.pirateId===`account:${item.accountId}`
          &&row.version===fixture.beforeRestartProfiles[label].version
          &&hash(accountProfile(row.data))===fixture.beforeRestartProfiles[label].hash
          &&hash(row.data)===fixture.beforeRestartProfiles[label].fullHash,
          `synthetic profile ${label} did not survive restart`);
        const login = unwrap(await pub.auth.signInWithPassword({ email: item.email, password: item.password }));
        ensure(login.user?.id === item.accountId && login.session?.access_token, 'synthetic account relogin failed');
        item.accessToken = login.session.access_token;
      }
      saveFixture();
      const a=new Player('A',fixture.accounts.A.accessToken,fixture.accounts.A.accountId),b=new Player('B',fixture.accounts.B.accessToken,fixture.accounts.B.accountId);
      await a.enter(); await b.enter();
      ensure(a.profile.progression.practice.logging>=60&&b.profile.progression.practice.logging===3,
        'restart did not restore both Tala practice balances');
      const currentA=accountProfile(a.profile),currentB=accountProfile(b.profile),world=await store.loadWorld(worldId);
      if (fixture.restartCheckpoint) {
        const snapshot = a.messages.find(m => m.t === 'snap' && m.resources?.nodes?.some(n => n.id === fixture.trainedPalm.id));
        const publicNode = snapshot.resources.nodes.find(n => n.id === fixture.trainedPalm.id);
        const savedNode = fixture.expectedResourceTargets[fixture.trainedPalm.id].node;
        const remaining = Math.max(0, savedNode.readyAt - fixture.restartCheckpoint.resourceTick - snapshot.tick);
        ensure(Math.abs(publicNode.wait - remaining * DT) <= DT + 1e-9,
          'trained palm respawn deadline did not use the paused logical clock after downtime');
        record(remaining > 0 ? 'v2 palm respawn clock paused during the single host downtime'
          : 'v2 palm deadline consistent; it had elapsed before shutdown so downtime pause is not measured', {
          offlineMs: fixture.restartCheckpoint.offlineMs, remainingTicks:remaining,
          expectedWaitSeconds:remaining * DT, publicWaitSeconds:publicNode.wait, toleranceSeconds:DT,
          pauseMeasured: remaining > 0,
        });
      }
      const completionNode=world?.data?.resources?.nodes?.find(n=>n.id===fixture.palmId);
      ensure(completionNode?.rev===fixture.palmCompletion.revision&&completionNode.hits===3,
        'completed palm ledger state did not survive restart');
      const ledgers=world.data.resources.logging;
      ensure(ledgers?.[fixture.palmId]?.contributors?.length===2,'durable palm contributor ledger missing');
      for (const [id, expected] of Object.entries(fixture.expectedResourceTargets)) {
        ensure(stable({node: world.data.resources.nodes.find(node => node.id === id), ledger: ledgers[id]}) === stable(expected),
          'exact completed or partial palm cycle, deadline and contributors did not survive restart');
      }
      const beforeWorld=stable({node:completionNode,ledger:ledgers[fixture.palmId]});
      await exactReplays(new Map([[a.accountId,a],[b.accountId,b]]));
      const afterWorld=await store.loadWorld(worldId), afterNode=afterWorld.data.resources.nodes.find(n=>n.id===fixture.palmId);
      ensure(stable({node:afterNode,ledger:afterWorld.data.resources.logging[fixture.palmId]})===beforeWorld,
        'exact replay changed completed palm state');
      for(const item of fixture.commands){
        const receipt=await store.loadEconomicOperation(item.operationId);
        ensure(receipt&&receipt.request.account===item.account&&receipt.request.world===worldId,
          'durable Tala receipt missing after restart');
      }
      const end=await waitFlush();
      record('graceful restart restored authenticated profiles, contributor ledger and exact replay without duplicate effects',{
        commandCount:fixture.commands.length,receiptCount:fixture.commands.length,practice:{A:currentA.progression.practice.logging,B:currentB.progression.practice.logging},
        palmHash:hash(fixture.palmId),ledgerHash:hash(ledgers[fixture.palmId]),hostUptimeAfter:end.uptime});
      return;
    }

    ensure(fixture?.schema==='mn.logging.live.private.v1'&&fixture.worldId===worldId,'private cleanup fixture invalid');
    await closeAll(); await waitFlush();
    const cleanupWorld = await store.loadWorld(worldId);
    const syntheticIds = new Set(Object.values(fixture.accounts).map(account => account.accountId));
    ensure(cleanupWorld.data.resources.nodes.every(node => node.kind !== 'palm' || node.hits === 3
      || !(cleanupWorld.data.resources.logging[node.id]?.contributors || []).some(c => syntheticIds.has(c.actor))),
      'finish every synthetic contributor palm cycle before deleting beneficiary profiles');
    let retainedReceipts=0;
    for(const label of ['A','B']){
      const item=fixture.accounts[label]; if(!item) continue;
      const user=unwrap(await admin.auth.admin.getUserById(item.accountId));
      ensure(user.user?.email===item.email,'synthetic Auth identity mismatch');
      const row=await store.loadProfile(item.accountId);
      if(row) ensure(row.data?.pirateId===`account:${item.accountId}`&&row.data?.gold===(item.expectedGold??item.sentinel)
        &&row.data?.stats?.gold===item.sentinel,'profile does not match exact synthetic ownership sentinels');
      for(const command of fixture.commands.filter(c=>c.account===item.accountId)){
        const receipt=await store.loadEconomicOperation(command.operationId); if(receipt) retainedReceipts++;
      }
      if(row){
        const deleted=await admin.from('mn_profiles').delete().eq('player_id',item.accountId).select('player_id');
        unwrap(deleted); ensure(deleted.data?.length===1&&deleted.data[0].player_id===item.accountId,'synthetic profile delete did not match exact account');
      }
      unwrap(await admin.auth.admin.deleteUser(item.accountId));
      const absent=await admin.auth.admin.getUserById(item.accountId);
      ensure(!absent.data?.user&&absent.error?.status===404&&await store.loadProfile(item.accountId)===null,
        'synthetic Auth/profile cleanup could not be verified');
    }
    const world=await store.loadWorld(worldId), palm=world?.data?.resources?.nodes?.find(n=>n.id===fixture.palmId);
    ensure(world?.data?.resources?.v===2 && (!fixture.palmId || palm),'cleanup lost durable canary world state');
    for (const command of fixture.commands) {
      const receipt = await store.loadEconomicOperation(command.operationId);
      if (command.ack) ensure(receipt, 'cleanup lost a confirmed durable receipt');
    }
    record('removed only exact synthetic Auth/profile rows; retained operation receipts and public world history',{
      syntheticAccounts:Object.keys(fixture.accounts).length,retainedReceiptCount:retainedReceipts,worldMutationRetained:true,
      ...(fixture.palmId ? { palmHash:hash(fixture.palmId) } : {})});
    fs.unlinkSync(fixturePath);
  } catch(error) {
    const failure={phase,pass:false,reason:error instanceof QaFailure?error.label:'acceptance failed; provider details suppressed',at:new Date().toISOString()};
    evidence.failures??=[]; evidence.failures.push(failure); fs.mkdirSync(path.dirname(evidencePath),{recursive:true});
    fs.writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n'); console.log(JSON.stringify(failure)); process.exitCode=1;
  } finally { await closeAll(); }
}

main().catch(error=>{ console.log(JSON.stringify({phase:phaseArg,pass:false,
  reason:error instanceof QaFailure?error.label:'acceptance failed; provider details suppressed',at:new Date().toISOString()})); process.exitCode=1; });
