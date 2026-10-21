import { createHash } from 'node:crypto';
import { validateGmPublication } from '../src/editor/publicationValidation.js';
import { gmEditableBaseProps } from '../src/editor/baseIdentity.js';
import { canonicalJson, PREPARATION_SCHEMA, PREPARATION_VERSION, PUBLICATION_COMPILER_VERSION } from '../src/editor/publicationArtifact.js';
import { createGmPublicationAssets } from './gmPublicationAssets.mjs';
import { resourceLayout } from '../src/data/resources.js';
import { projectGmContent } from '../src/editor/contentProjection.js';
import { compileAuthoredResources } from '../src/editor/resourceAdapters.js';

const sha256 = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** Read-only preparation from a confirmed draft. No gameplay or content pointer is written. */
export function createGmPublicationService({ root, runtimeRoot = root, map, baseRevision, worldId, validateReferences, gameVersion, protocolVersion }) {
  const dependencies = createGmPublicationAssets({ root, runtimeRoot });
  let ready = false, base;
  return {
    async prepare() {
      await dependencies.prepare();
      base = { seed: map.seed >>> 0, revision: baseRevision, propsHash: sha256(map.props),
        collidersHash: sha256(map.colliders), resourcesHash: sha256(resourceLayout(map)) };
      ready = true;
    },
    // New preparations are schema 2. version 1 only rebuilds a retained schema 1 revision for its compatibility check.
    async build({ document, draftRevision, version = PREPARATION_VERSION }) {
      if (!ready) throw new Error('preparation_unavailable');
      if (![1, PREPARATION_VERSION].includes(version)) throw new Error('preparation_version');
      const checked = validateReferences(document);
      const { colliders, ...report } = validateGmPublication({ map, document: checked, baseRevision });
      if (!report.valid) return { report, revision: null };
      const projected = checked.terrain ? projectGmContent(map, checked, baseRevision) : null;
      const authoredResources = compileAuthoredResources(projected || map, checked);
      const coastal = new Set(gmEditableBaseProps(map, baseRevision).filter((entry) => entry.coastal).map((entry) => entry.id));
      const usesCoast = checked.baseOverrides.some((item) => coastal.has(item.id)) || checked.objects.some((item) => coastal.has(item.assetId));
      const assets = await dependencies.resolve(checked, usesCoast ? ['model:coast-rock-v1'] : []);
      const baselineAssets = await dependencies.resolveBaseline();
      if (assets.some((asset) => asset.status === 'candidate')) {
        report.issues.push({ severity: 'warning', code: 'candidate_assets' });
        report.summary.warnings++; report.summary.totalIssues++;
      }
      // Schema 1 hashes the whole release: every runtime file, both versions and every manifest file. Schema 2
      // (GM07b0) hashes what the content uses: its models (assets) and, of the manifest files, only the variants
      // of those models, since phones draw the mobile GLB. The release goes to preparedWith, outside the hash.
      const current = version === PREPARATION_VERSION, used = new Set(assets.map((asset) => asset.id));
      const content = { compilerVersion: PUBLICATION_COMPILER_VERSION, worldId, sourceRevision: draftRevision, base,
        document: checked, documentHash: sha256(checked),
        runtime: current ? { files: [] } : { ...dependencies.runtime, gameVersion, protocolVersion }, assets,
        baselineAssets: current ? baselineAssets.filter((asset) => used.has(asset.id)) : baselineAssets,
        collision: { count: colliders.length, sha256: sha256(colliders) }, validation: report };
      if (authoredResources.length) content.resources = { count: authoredResources.length, sha256: sha256(authoredResources) };
      if (projected) content.terrain = { gridSize: 561, sha256: sha256(Array.from(projected.heights)),
        ...(checked.terrain.version === 2 ? { materialsSha256: sha256(checked.terrain.materials) } : {}) };
      const revision = { schema: PREPARATION_SCHEMA, version, revisionId: sha256(content), content };
      if (current) revision.preparedWith = { gameVersion, protocolVersion, runtime: dependencies.runtime, baselineAssets };
      return { report, revision };
    },
  };
}
