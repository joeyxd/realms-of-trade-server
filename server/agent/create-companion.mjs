import { lstat, mkdir, open, realpath, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_COMPANION_DRAFT, ROLE_TEMPLATES, PERSONALITY_TEMPLATES, TRAIT_TEMPLATES,
  COMPANION_LOOKS, buildCompanionDocuments, validateCompanionDraft } from '../../src/net/companionTemplates.js';
import { loadOwnerFiles } from './owner-files.mjs';

const FILES = Object.freeze({ personality: 'personality.md', objectives: 'objectives.json', memory: 'memory.jsonl',
  guide: 'gameplay-guide.md', manifest: 'companion-manifest.json' });

export async function createCompanionFiles({ directory, draft, scope } = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('invalid_directory');
  const validatedDraft = validateCompanionDraft(draft);
  const documents = buildCompanionDocuments(validatedDraft, scope);
  const target = path.resolve(directory);
  const parent = path.dirname(target), basename = path.basename(target);
  if (!basename || basename === '.' || basename === path.parse(target).root) throw new TypeError('invalid_directory');
  const realParent = await realpath(parent);
  const checkedTarget = path.join(realParent, basename);
  let created = false, ownedStat;
  try {
    await mkdir(checkedTarget);
    created = true;
    ownedStat = await lstat(checkedTarget);
    if (!ownedStat.isDirectory() || ownedStat.isSymbolicLink()) throw new TypeError('unsafe_directory');
    for (const [key, filename] of Object.entries(FILES)) {
      const handle = await open(path.join(checkedTarget, filename), 'wx', 0o600);
      try { await handle.writeFile(documents[key], 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
    }
    const loaded = await loadOwnerFiles({ directory: checkedTarget, scope });
    if (!loaded.ok || loaded.files.personality.content !== documents.personality ||
        loaded.files.objectives.content !== documents.objectives || loaded.files.memory.content !== '') {
      throw new Error('owner_files_validation_failed');
    }
    return { manifest: JSON.parse(documents.manifest), paths: Object.fromEntries(Object.entries(FILES).map(([key, filename]) =>
      [key, path.join(checkedTarget, filename)])) };
  } catch (error) {
    if (created && ownedStat) {
      try {
        const current = await lstat(checkedTarget);
        if (current.isDirectory() && !current.isSymbolicLink() && current.dev === ownedStat.dev && current.ino === ownedStat.ino) {
          for (const filename of Object.values(FILES)) await unlink(path.join(checkedTarget, filename)).catch(() => {});
          await rmdir(checkedTarget).catch(() => {});
        }
      } catch { /* Leave changed or inaccessible paths untouched. */ }
    }
    throw error;
  }
}

function parseArgs(argv) {
  const args = {};
  const supported = ['--directory', '--name', '--role', '--owner', '--character', '--world', '--base-url', '--model'];
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!supported.includes(key) || Object.hasOwn(args, key) || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new TypeError('invalid_arguments');
    }
    args[key] = argv[++index];
  }
  for (const required of ['--directory', '--name', '--role', '--owner', '--character', '--world', '--base-url', '--model']) {
    if (!Object.hasOwn(args, required)) throw new TypeError('invalid_arguments');
  }
  if (!Object.hasOwn(ROLE_TEMPLATES, args['--role'])) throw new TypeError('invalid_role');
  const scope = { ownerId: args['--owner'], characterId: args['--character'], worldId: args['--world'] };
  const draft = { ...DEFAULT_COMPANION_DRAFT, name: args['--name'], role: args['--role'],
    baseUrl: args['--base-url'], modelId: args['--model'] };
  return { directory: args['--directory'], scope, draft };
}

export { ROLE_TEMPLATES, PERSONALITY_TEMPLATES, TRAIT_TEMPLATES, COMPANION_LOOKS };

async function main() {
  if (process.argv[2] === '--help' && process.argv.length === 3) {
    process.stdout.write('node tools/agent/create-companion.mjs --directory PATH --name NAME --role sailor|marine|builder|harvester|resident --owner ID --character ID --world ID --base-url http://127.0.0.1:PORT/v1 --model MODEL\n');
    return;
  }
  const result = await createCompanionFiles(parseArgs(process.argv.slice(2)));
  process.stdout.write(JSON.stringify({ created: true, directory: path.dirname(result.paths.personality), files: result.paths,
    provider: result.manifest.provider, authority: result.manifest.authority }) + '\n');
}

// The tools/agent/create-companion.mjs shim calls this too, so the documented CLI path keeps working.
export function runCreateCompanionCli() {
  main().catch((error) => {
    process.stderr.write(`${error?.message === 'invalid_companion_draft' ? 'invalid_companion_draft' : error?.code === 'EEXIST' ? 'destination_exists' : 'create_companion_failed'}\n`);
    process.exitCode = 1;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runCreateCompanionCli();
