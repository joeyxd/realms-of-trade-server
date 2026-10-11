// Test-only EVM message execution and minimal loopback RPC. No keys, upstream RPC or deployment API.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { createServer } from 'node:http';
import { createVM } from '@ethereumjs/vm';
import { createCustomCommon, Mainnet, Hardfork } from '@ethereumjs/common';
import { createAccount, createAddressFromString, hexToBytes, bytesToHex } from '@ethereumjs/util';
import { encodeDeployData, encodeFunctionData, keccak256, stringToHex } from 'viem';
import solc from 'solc';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const CHAIN_ID = 31337; // Deliberately distinct from Amoy and Polygon mainnet.
const ZERO_HASH = `0x${'0'.repeat(64)}`;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const addresses = Object.freeze({
  alice: `0x${'11'.repeat(20)}`, bob: `0x${'22'.repeat(20)}`, outsider: `0x${'33'.repeat(20)}`,
});
let compiled;

export class EvmFixtureError extends Error {
  constructor(code, returnData = '0x') {
    super(`Local EVM fixture: ${code}`);
    this.code = code;
    this.returnData = returnData;
  }
}
const fail = (code) => { throw new EvmFixtureError(code); };
const quantity = (n) => `0x${n.toString(16)}`;
const validQuantity = (s) => typeof s === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(s);
const validAddress = (s) => typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);

function compileFixtures() {
  if (compiled) return compiled;
  const root = realpathSync(resolve(DIR, 'node_modules/@openzeppelin/contracts'));
  const importedSources = new Set();
  const result = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { 'ReaderFixtures.sol': { content: readFileSync(resolve(DIR, 'contracts/ReaderFixtures.sol'), 'utf8') } },
    settings: { evmVersion: 'cancun', optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } },
  }), { import: (path) => {
    // Resolve only installed OpenZeppelin sources, with real-path containment checked.
    try {
      const prefix = '@openzeppelin/contracts/';
      if (!path.startsWith(prefix) || !/^[a-zA-Z0-9_./@-]+\.sol$/.test(path)) throw new Error();
      const target = realpathSync(resolve(root, path.slice(prefix.length)));
      if (!target.startsWith(root + sep)) throw new Error();
      importedSources.add(path);
      return { contents: readFileSync(target, 'utf8') };
    } catch { return { error: 'Fixture import rejected' }; }
  } }));
  const errors = (result.errors ?? []).filter(e => e.severity === 'error');
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  const contracts = result.contracts?.['ReaderFixtures.sol'];
  if (!contracts?.Reader721Fixture?.evm.bytecode.object || !contracts?.Reader1155Fixture?.evm.bytecode.object) fail('compile');
  compiled = { compilerVersion: solc.version(), contracts, importedSources: [...importedSources].sort() };
  return compiled;
}

export async function createEvmFixture() {
  const artifacts = compileFixtures();
  return createEvmContractFixture({ chainId: CHAIN_ID, compilerVersion: artifacts.compilerVersion,
    evmVersion: 'cancun', importedSources: artifacts.importedSources, deployments: [
      { kind: 'erc721', artifact: artifacts.contracts.Reader721Fixture, args: ['LOCAL TEST ONLY', 'TEST'] },
      { kind: 'erc1155', artifact: artifacts.contracts.Reader1155Fixture, args: [] },
    ] });
}

// Local-only messages, including simulated chain IDs for contracts that check CHAINID.
// This function has no upstream RPC, keys, transaction signer or public deployment path.
export async function createEvmContractFixture({ chainId, compilerVersion, evmVersion, importedSources, deployments }) {
  if (!Number.isSafeInteger(chainId) || chainId < 1 || evmVersion !== 'cancun'
    || !Array.isArray(deployments) || !deployments.length) fail('input');
  const common = createCustomCommon({ name: 'marea-negra-SIMULATED-contract-fixture', chainId },
    Mainnet, { hardfork: Hardfork.Cancun });
  const vm = await createVM({ common });
  for (const address of Object.values(addresses)) {
    await vm.stateManager.putAccount(createAddressFromString(address), createAccount({ balance: 0n, nonce: 0n }));
  }
  const blocks = new Map(), byHash = new Map(), canonical = new Set(), calls = [];
  let head, queue = Promise.resolve(), server;
  const serial = (work) => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  const root = async () => bytesToHex(await vm.stateManager.getStateRoot());
  const reset = async (stateRoot) => {
    await vm.stateManager.setStateRoot(hexToBytes(stateRoot));
    vm.evm.journal.cleanJournal();
    vm.stateManager.originalStorageCache.clear();
  };
  const record = async () => {
    const number = head ? BigInt(head.number) + 1n : 0n;
    const stateRoot = await root();
    const parentHash = head?.hash ?? ZERO_HASH, timestamp = quantity(1700000000n + number);
    // This is a synthetic fixture identity, not an Ethereum header or consensus block hash.
    const hash = keccak256(stringToHex(JSON.stringify({ number: quantity(number), parentHash, timestamp, stateRoot })));
    head = Object.freeze({ number: quantity(number), hash, parentHash, timestamp });
    blocks.set(head.number, head);
    byHash.set(hash, { block: head, stateRoot });
    canonical.add(hash);
    return { ...head };
  };
  const execute = async (opts) => {
    // Reset EIP-2929 warmth and original storage across independent fixture messages.
    vm.evm.journal.cleanJournal();
    vm.stateManager.originalStorageCache.clear();
    const result = await vm.evm.runCall(opts);
    await vm.evm.journal.cleanup();
    if (result.execResult.exceptionError) throw new EvmFixtureError('revert', bytesToHex(result.execResult.returnValue));
    return result;
  };
  await record();
  const contracts = {};
  for (const { kind, artifact, args } of deployments) {
    if (typeof kind !== 'string' || Object.hasOwn(contracts, kind)) fail('input');
    const result = await execute({ caller: createAddressFromString(addresses.alice), gasLimit: 10000000n,
      data: hexToBytes(encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args })) });
    if (!result.createdAddress) fail('create');
    contracts[kind] = Object.freeze({ address: result.createdAddress.toString(), abi: artifact.abi });
    await record();
  }
  Object.freeze(contracts);

  const rpc = (method, params) => serial(async () => {
    if (!Array.isArray(params)) fail('input');
    if (method === 'eth_chainId') { if (params.length) fail('input'); return quantity(BigInt(chainId)); }
    if (method === 'eth_getBlockByNumber') {
      if (params.length !== 2 || params[1] !== false || !validQuantity(params[0])) fail('input');
      const block = blocks.get(params[0]);
      return block ? { ...block } : null;
    }
    if (!['eth_getCode', 'eth_call'].includes(method)) fail('method');
    const ref = params[1];
    if (params.length !== 2 || !ref || typeof ref !== 'object' || Array.isArray(ref)
      || Object.keys(ref).length !== 2 || ref.requireCanonical !== true
      || typeof ref.blockHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(ref.blockHash)) fail('input');
    const snapshot = byHash.get(ref.blockHash);
    if (!snapshot || !canonical.has(ref.blockHash)) fail('block');
    const currentRoot = await root();
    try {
      await reset(snapshot.stateRoot);
      if (method === 'eth_getCode') {
        if (!validAddress(params[0])) fail('input');
        return bytesToHex(await vm.stateManager.getCode(createAddressFromString(params[0])));
      }
      const call = params[0];
      if (!call || typeof call !== 'object' || Object.keys(call).sort().join(',') !== 'data,gas,to'
        || !validAddress(call.to) || typeof call.data !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(call.data)
        || call.data.length > 8194 || !validQuantity(call.gas) || BigInt(call.gas) > 10000000n) fail('input');
      const data = hexToBytes(call.data);
      // Model the transaction intrinsic/calldata deduction for these plain eth_call fixtures.
      const intrinsic = 21000n + data.reduce((sum, byte) => sum + (byte === 0 ? 4n : 16n), 0n);
      if (BigInt(call.gas) < intrinsic) fail('input');
      const result = await execute({ caller: createAddressFromString(ZERO_ADDRESS),
        to: createAddressFromString(call.to), data, gasLimit: BigInt(call.gas) - intrinsic });
      return bytesToHex(result.execResult.returnValue);
    } finally {
      // eth_call and historical root switching never change the fixture head state, even on revert.
      await reset(currentRoot);
    }
  });

  return Object.freeze({
    chainId, simulated: true, addresses, contracts, calls,
    compilerVersion, evmVersion, importedSources: [...importedSources],
    head: () => ({ ...head }),
    stateRoot: () => serial(root),
    invalidateBlock: (hash) => canonical.delete(hash),
    rpc,
    write: (kind, functionName, args, caller = addresses.alice) => serial(async () => {
      const contract = contracts[kind];
      if (!contract || !validAddress(caller)) fail('input');
      const before = await root();
      try {
        const result = await execute({ caller: createAddressFromString(caller),
          to: createAddressFromString(contract.address), gasLimit: 10000000n,
          data: hexToBytes(encodeFunctionData({ abi: contract.abi, functionName, args })) });
        return { block: await record(), returnData: bytesToHex(result.execResult.returnValue),
          logs: (result.execResult.logs ?? []).map(([addr, topics, data]) =>
            ({ address: bytesToHex(addr), topics: topics.map(bytesToHex), data: bytesToHex(data) })) };
      } catch (error) { await reset(before); throw error; }
    }),
    async start() {
      if (server) fail('started');
      server = createServer(async (req, res) => {
        let id = null;
        try {
          if (req.method !== 'POST' || req.url !== '/') fail('input');
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 65536) fail('input'); chunks.push(chunk); }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          id = body.id;
          if (body.jsonrpc !== '2.0' || !Number.isSafeInteger(id) || typeof body.method !== 'string') fail('input');
          calls.push(structuredClone(body));
          const result = await rpc(body.method, body.params);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
        } catch (error) {
          if (res.destroyed) return;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id,
            error: { code: -32000, message: `Local fixture: ${error instanceof EvmFixtureError ? error.code : 'input'}` } }));
        }
      });
      server.requestTimeout = 5000;
      await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      if (server) {
        const active = server;
        server = undefined;
        await new Promise((accept, reject) => { active.close(error => error ? reject(error) : accept()); active.closeAllConnections(); });
      }
      await queue;
    },
  });
}
