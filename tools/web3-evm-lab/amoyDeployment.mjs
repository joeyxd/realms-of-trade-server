// Offline deployment review from the reproducible pilot. No RPC, signing or transaction submission.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';
import { encodeDeployData, getAddress, isAddress, keccak256 } from 'viem';
import { buildAmoyPilot, serializeAmoyPilot } from './amoyPilotBuild.mjs';

const ARTIFACT_PATH = 'tools/web3-evm-lab/artifacts/amoy-reader-721.json';
const ARTIFACT_URL = new URL('./artifacts/amoy-reader-721.json', import.meta.url);
const ZERO = `0x${'0'.repeat(40)}`;
const FIELDS = ['chainId', 'deployerAddress', 'mintOperatorAddress'];

export class AmoyDeploymentError extends Error {
  constructor(why) {
    super(`Amoy deployment: ${why}`);
    this.name = 'AmoyDeploymentError';
    this.why = why;
  }
}
const rejectInput = () => { throw new AmoyDeploymentError('input'); };

function deploymentInput(input) {
  if (!input || typeof input !== 'object' || isProxy(input)) rejectInput();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) rejectInput();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== FIELDS.length || keys.some(key => !FIELDS.includes(key))) rejectInput();
  const values = {};
  for (const key of FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) rejectInput();
    values[key] = descriptor.value;
  }
  if (values.chainId !== 80002) rejectInput();
  for (const key of ['deployerAddress', 'mintOperatorAddress']) {
    const address = values[key];
    if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)
      || !isAddress(address, { strict: true }) || address.toLowerCase() === ZERO) rejectInput();
    values[key] = getAddress(address);
  }
  return values;
}

function expectedRuntime(build, operator) {
  const template = build.artifact.evm.deployedBytecode;
  const code = Buffer.from(template.object, 'hex');
  const groups = Object.values(template.immutableReferences);
  // This pilot has exactly one immutable (mintOperator), referenced twice by its runtime.
  if (groups.length !== 1 || groups[0].length !== 2) throw new Error('Unexpected immutables');
  const spans = [];
  for (const { start, length } of groups[0]) {
    if (!Number.isSafeInteger(start) || start < 0 || length !== 32 || start + length > code.length
      || spans.some(([low, high]) => start < high && start + length > low)
      || code.subarray(start, start + length).some(byte => byte !== 0)) throw new Error('Invalid immutable span');
    spans.push([start, start + length]);
    code.set(Buffer.from(operator.slice(2).padStart(64, '0'), 'hex'), start);
  }
  return `0x${code.toString('hex')}`;
}

export function prepareAmoyDeployment(input) {
  const { chainId, deployerAddress, mintOperatorAddress } = deploymentInput(input);
  try {
    const build = buildAmoyPilot();
    const serialized = serializeAmoyPilot(build);
    if (readFileSync(ARTIFACT_URL, 'utf8') !== serialized) throw new Error('Artifact mismatch');
    const bytecode = `0x${build.artifact.evm.bytecode.object}`;
    const data = encodeDeployData({ abi: build.artifact.abi, bytecode, args: [mintOperatorAddress] });
    const runtime = expectedRuntime(build, mintOperatorAddress);
    return {
      v: 1, purpose: 'Amoy ERC-721 deployment review; no game rights',
      network: { name: 'Polygon Amoy', chainId, chainIdHex: '0x13882', gasToken: 'POL de prueba', networkVerified: false },
      contract: { name: build.contractName, compilerVersion: build.compilerVersion,
        evmVersion: build.standardInput.settings.evmVersion, deployerAddress, mintOperatorAddress, operatorImmutable: true },
      artifact: { path: ARTIFACT_PATH, sha256: createHash('sha256').update(serialized, 'utf8').digest('hex'),
        creationCodeHash: keccak256(bytecode), creationBytes: (bytecode.length - 2) / 2 },
      transaction: { chainId: '0x13882', from: deployerAddress, data, value: '0x0' },
      verification: { expectedRuntimeBytecode: runtime, expectedRuntimeCodeHash: keccak256(runtime),
        runtimeBytes: (runtime.length - 2) / 2 },
      readiness: { offlinePrepared: true, rpcSimulated: false, gasEstimated: false,
        signed: false, broadcast: false, deployed: false },
    };
  } catch {
    // Compiler/filesystem/library errors can contain local paths; expose only a bounded category.
    throw new AmoyDeploymentError('artifact');
  }
}
