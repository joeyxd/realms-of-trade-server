// IC08: the egress fence, key sealing and the deploy shape of the hosted inference data volume.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createEgressGuard, blockedAddress, pinnedRequestOptions } from '../server/agent/egress-guard.mjs';
import { createEndpointOpenAITransport } from '../server/agent/endpoint-openai-transport.mjs';
import { sealSecret, openSecret } from '../server/hostedInference.mjs';

const ROOT = new URL('../', import.meta.url);
const fakeLookup = table => (hostname, options, callback) => {
  const rows = table[hostname];
  if (!rows) { callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })); return; }
  callback(null, rows.map(address => ({ address, family: address.includes(':') ? 6 : 4 })));
};

test('fence: refuses http, userinfo and every non-public address, literal or resolved', async () => {
  const guard = createEgressGuard({ lookup: fakeLookup({ localhost: ['127.0.0.1', '::1'],
    'mixed.example': ['93.184.216.34', '10.0.0.7'], 'public.example': ['93.184.216.34'] }) });
  const refused = ['http://public.example/v1', 'https://user:pass@public.example/v1', 'https://127.0.0.1/v1',
    'https://localhost/v1', 'https://10.1.2.3/v1', 'https://172.20.0.1/v1', 'https://192.168.1.1/v1', 'https://100.64.0.1/v1',
    'https://169.254.169.254/latest', 'https://0.0.0.0/v1', 'https://[::1]/v1', 'https://[fe80::1]/v1', 'https://[fc00::1]/v1',
    'https://[::ffff:127.0.0.1]/v1', 'https://[64:ff9b::7f00:1]/v1', 'https://mixed.example/v1', 'https://2130706433/v1',
    'https://198.51.100.9/v1', 'https://[2001:db8::1]/v1', 'https://224.0.0.1/v1', 'https://255.255.255.255/v1'];
  for (const url of refused) assert.deepEqual(await guard.vet(url), { ok: false, why: 'egress_blocked' }, url);
  const allowed = await guard.vet('https://public.example/v1');
  assert.deepEqual({ ...allowed }, { ok: true, hostname: 'public.example', address: '93.184.216.34', family: 4 });
  assert.equal((await guard.vet('https://8.8.8.8/v1')).ok, true);
  assert.equal((await guard.vet('https://[2606:4700:4700::1111]/v1')).ok, true);
  assert.equal((await guard.vet('https://missing.example/v1')).why, 'transport_error');
  for (const address of ['::', '::ffff:10.0.0.1', '64:ff9b::a00:1', 'ff02::1', '198.18.0.1', '192.0.0.8', 'garbage'])
    assert.equal(blockedAddress(address), true, address);
  for (const address of ['93.184.216.34', '::ffff:93.184.216.34', '2a00:1450::1']) assert.equal(blockedAddress(address), false, address);
});

test('fence: the pinned lookup answers only the vetted address and keeps SNI on the hostname', async () => {
  const pinned = pinnedRequestOptions({ ok: true, hostname: 'api.example', address: '93.184.216.34', family: 4 });
  assert.equal(pinned.servername, 'api.example');
  const single = await new Promise(resolve => pinned.lookup('evil.example', {}, (error, address, family) => resolve({ error, address, family })));
  assert.deepEqual(single, { error: null, address: '93.184.216.34', family: 4 });
  const all = await new Promise(resolve => pinned.lookup('evil.example', { all: true }, (error, list) => resolve(list)));
  assert.deepEqual(all, [{ address: '93.184.216.34', family: 4 }]);
  assert.equal(pinnedRequestOptions({ hostname: '8.8.8.8', address: '8.8.8.8', family: 4 }).servername, undefined);
});

test('fence: a completion connects to the vetted address with Host = hostname, and a refusal never dials', async t => {
  const seen = [];
  const server = createServer((request, response) => {
    seen.push(request.headers.host);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'hola' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 1 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  // A test fence: "models.invalid" has no DNS; only the pinned lookup can reach the fake endpoint.
  const permissive = { vet: async url => ({ ok: true, hostname: new URL(url).hostname, address: '127.0.0.1', family: 4 }) };
  const transport = createEndpointOpenAITransport({ endpoint: { baseUrl: `http://models.invalid:${port}/v1`, apiKey: 'sk-test' },
    modelId: 'm', maxCalls: 2, maxOutputTokens: 16, timeoutMs: 5000, egress: permissive });
  const result = await transport.generate({ messages: [{ role: 'user', content: 'hola' }] });
  assert.equal(result.ok, true, result.why);
  assert.equal(result.text, 'hola');
  assert.deepEqual(seen, [`models.invalid:${port}`]);
  const strict = createEndpointOpenAITransport({ endpoint: { baseUrl: `http://127.0.0.1:${port}/v1` }, modelId: 'm', maxCalls: 1,
    maxOutputTokens: 16, timeoutMs: 5000, egress: createEgressGuard() });
  const blocked = await strict.generate({ messages: [{ role: 'user', content: 'hola' }] });
  assert.equal(blocked.why, 'egress_blocked');
  assert.equal(blocked.dispatched, false);
  assert.equal(seen.length, 1);
});

test('sealing: round trip; a wrong AAD or a wrong key fails; the ciphertext never holds the key', () => {
  const key = randomBytes(32), secret = 'sk-live-0123456789abcdef';
  const sealed = sealSecret(key, 'owner:endpoint', secret);
  assert.match(sealed, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
  assert.equal(sealed.includes(secret), false);
  assert.notEqual(sealSecret(key, 'owner:endpoint', secret), sealed, 'a fresh IV each time');
  assert.equal(openSecret(key, 'owner:endpoint', sealed), secret);
  assert.throws(() => openSecret(key, 'owner:other', sealed));
  assert.throws(() => openSecret(randomBytes(32), 'owner:endpoint', sealed));
  assert.throws(() => openSecret(key, 'owner:endpoint', 'plain-text'));
  assert.equal(openSecret(key, 'a:b', sealSecret(key, 'a:b', '')), '');
});

test('deploy: named volume marea-companions mounted with its env, directory created before USER node', async () => {
  const compose = await readFile(new URL('deploy/compose.vps.yml', ROOT), 'utf8');
  assert.match(compose, /^volumes:\r?\n  marea-companions:\r?\n    name: marea-companions\r?$/m);
  assert.match(compose, /^      - marea-companions:\/var\/lib\/marea-companions\r?$/m);
  assert.match(compose, /^      MN_HOSTED_INFERENCE_DIR: \/var\/lib\/marea-companions\r?$/m);
  const dockerfile = await readFile(new URL('deploy/Dockerfile', ROOT), 'utf8');
  const made = dockerfile.search(/^RUN mkdir -p \/var\/lib\/marea-companions && chown node:node \/var\/lib\/marea-companions/m);
  assert.ok(made > 0 && made < dockerfile.search(/^USER node\r?$/m));
  const example = await readFile(new URL('deploy/marea-negra.env.example', ROOT), 'utf8');
  for (const name of ['MN_HOSTED_INFERENCE', 'MN_HOSTED_INFERENCE_KEY', 'MN_HOSTED_INFERENCE_ACCOUNTS', 'MN_HOSTED_INFERENCE_MAX'])
    assert.match(example, new RegExp(`^${name}=`, 'm'));
  assert.match(example, /^MN_HOSTED_INFERENCE=0\r?$/m);
});
