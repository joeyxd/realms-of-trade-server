// Deterministic compile-only artifact. No env, wallet, RPC, deployment or transaction API.
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import solc from 'solc';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const SOURCE = 'AmoyReader721Pilot.sol';
const CONTRACT = 'AmoyReader721Pilot';
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const settings = {
  evmVersion: 'cancun', optimizer: { enabled: true, runs: 200 },
  outputSelection: { '*': { '*': ['abi', 'metadata', 'evm.bytecode.object',
    'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } },
};

function checkedCompile(input, callbacks) {
  const output = JSON.parse(solc.compile(JSON.stringify(input), callbacks));
  if ((output.errors ?? []).some(error => error.severity === 'error')) throw new Error('Pilot build: compile');
  return output;
}

export function buildAmoyPilot() {
  const ozRoot = realpathSync(resolve(DIR, 'node_modules/@openzeppelin/contracts'));
  const ozVersion = JSON.parse(readFileSync(resolve(ozRoot, 'package.json'), 'utf8')).version;
  if (!solc.version().startsWith('0.8.37+commit.f401782d.') || ozVersion !== '5.6.1') {
    throw new Error('Pilot build: toolchain');
  }
  const sources = { [SOURCE]: { content: readFileSync(resolve(DIR, 'contracts', SOURCE), 'utf8') } };
  checkedCompile({ language: 'Solidity', sources, settings }, { import(path) {
    try {
      const prefix = '@openzeppelin/contracts/';
      if (!path.startsWith(prefix) || !/^[a-zA-Z0-9_./@-]+\.sol$/.test(path)) throw new Error();
      const target = realpathSync(resolve(ozRoot, path.slice(prefix.length)));
      if (!target.startsWith(ozRoot + sep)) throw new Error();
      const content = readFileSync(target, 'utf8');
      sources[path] = { content };
      return { contents: content };
    } catch { return { error: 'Pilot import rejected' }; }
  } });
  // Recompile the complete Standard JSON input with no import callback or external source lookup.
  const standardInput = { language: 'Solidity', sources: Object.fromEntries(Object.entries(sources).sort()), settings };
  const output = checkedCompile(standardInput);
  const artifact = output.contracts?.[SOURCE]?.[CONTRACT];
  if (!artifact?.evm?.bytecode?.object || !artifact.evm.deployedBytecode.object) throw new Error('Pilot build: artifact');
  return {
    v: 1, purpose: 'Amoy ERC-721 reader experiment; no game rights', targetChainId: 80002,
    sourceName: SOURCE, contractName: CONTRACT, compilerVersion: solc.version(), openzeppelinVersion: ozVersion,
    constructor: { operatorMustBeExplicit: true, operatorImmutable: true, chainGuard: 80002 },
    artifact, standardInput,
    sourceHashes: Object.fromEntries(Object.entries(standardInput.sources)
      .map(([path, source]) => [path, sha256(source.content)])),
  };
}

export const serializeAmoyPilot = build => JSON.stringify(build, null, 2) + '\n';
