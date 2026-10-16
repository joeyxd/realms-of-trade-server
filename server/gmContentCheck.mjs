// Offline candidate-image check. Does not open transports or touch gameplay persistence.
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createGmContentRegistry } from './gmContentRegistry.mjs';
import { createGmPublicationService } from './gmPublication.mjs';
import { createGmDraftValidator } from './gmDraftValidation.mjs';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

export async function checkGmContentRelease({ directory, root }) {
  const state = JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8'));
  const registry = createGmContentRegistry({ directory, root, worldId: state.worldId });
  await registry.prepare();
  const current = await registry.state();
  if (current.revisionId === null) return true;
  const revision = await registry.load(current.revisionId), baseRevision = 'terrain-s21-v1';
  const map = generateWorld(GAME.seed);
  const validateReferences = createGmDraftValidator({ map, baseRevision,
    manifest: JSON.parse(await fs.readFile(path.join(root, 'assets/manifest.json'), 'utf8')),
    editorCatalog: JSON.parse(await fs.readFile(path.join(root, 'assets/editor/catalog.json'), 'utf8')) });
  const publication = createGmPublicationService({ root, map, baseRevision, worldId: state.worldId,
    validateReferences, gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION });
  await publication.prepare();
  const built = await publication.build({ document: revision.content.document, draftRevision: revision.content.sourceRevision });
  if (built.revision?.revisionId !== revision.revisionId) throw new Error('content_incompatible');
  return true;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await checkGmContentRelease({ directory: process.env.MN_GM_CONTENT_DIR,
      root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') });
    console.log('content compatible');
  } catch { console.error('content incompatible or unavailable; activate base before updating'); process.exitCode = 1; }
}
