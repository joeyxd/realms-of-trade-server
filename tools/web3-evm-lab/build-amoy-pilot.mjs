// Offline compilation only. This command never signs, estimates, deploys or sends transactions.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAmoyPilot, serializeAmoyPilot } from './amoyPilotBuild.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write('Contrato experimental Amoy: --build genera el artefacto; --check verifica su reproducibilidad.\nSolo compilacion local. Sin wallet, RPC, gas ni despliegue.\n');
} else if (args.length !== 1 || !['--build', '--check'].includes(args[0])) {
  process.stderr.write('{"ok":false,"why":"arguments"}\n');
  process.exitCode = 2;
} else {
  try {
    const build = buildAmoyPilot(), serialized = serializeAmoyPilot(build);
    const directory = fileURLToPath(new URL('./artifacts/', import.meta.url));
    const path = fileURLToPath(new URL('./artifacts/amoy-reader-721.json', import.meta.url));
    if (args[0] === '--build') {
      mkdirSync(directory, { recursive: true });
      writeFileSync(path, serialized, 'utf8');
    } else if (readFileSync(path, 'utf8') !== serialized) throw new Error('Artifact mismatch');
    process.stdout.write(JSON.stringify({ ok: true, mode: args[0].slice(2), targetChainId: 80002,
      contractName: build.contractName, compilerVersion: build.compilerVersion,
      creationBytes: build.artifact.evm.bytecode.object.length / 2,
      runtimeTemplateBytes: build.artifact.evm.deployedBytecode.object.length / 2,
      deployed: false }) + '\n');
  } catch {
    process.stderr.write('{"ok":false,"why":"build"}\n');
    process.exitCode = 1;
  }
}
