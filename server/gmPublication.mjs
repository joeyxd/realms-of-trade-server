import { createHash } from 'node:crypto';
import { validateGmPublication } from '../src/editor/publicationValidation.js';
import { gmEditableBaseProps } from '../src/editor/baseIdentity.js';
import { canonicalJson, PREPARATION_SCHEMA, PUBLICATION_COMPILER_VERSION } from '../src/editor/publicationArtifact.js';
import { createGmPublicationAssets } from './gmPublicationAssets.mjs';
import { resourceLayout } from '../src/data/resources.js';

const sha256 = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** Read-only preparation from a confirmed draft. No gameplay or content pointer is written. */
export function createGmPublicationService({ root, map, baseRevision, worldId, validateReferences, gameVersion, protocolVersion }) {
  const dependencies = createGmPublicationAssets({ root });
  let ready = false, base;
  return {
    async prepare() {
      await dependencies.prepare();
      base = { seed: map.seed >>> 0, revision: baseRevision, propsHash: sha256(map.props),
        collidersHash: sha256(map.colliders), resourcesHash: sha256(resourceLayout(map)) };
      ready = true;
    },
    async build({ document, draftRevision }) {
      if (!ready) throw new Error('preparation_unavailable');
      const checked = validateReferences(document);
      const { colliders, ...report } = validateGmPublication({ map, document: checked, baseRevision });
      if (!report.valid) return { report, revision: null };
      const coastal = new Set(gmEditableBaseProps(map, baseRevision).filter((entry) => entry.coastal).map((entry) => entry.id));
      const usesCoast = checked.baseOverrides.some((item) => coastal.has(item.id)) || checked.objects.some((item) => coastal.has(item.assetId));
      const assets = await dependencies.resolve(checked, usesCoast ? ['model:coast-rock-v1'] : []);
      const baselineAssets = await dependencies.resolveBaseline();
      if (assets.some((asset) => asset.status === 'candidate')) {
        report.issues.push({ severity: 'warning', code: 'candidate_assets' });
        report.summary.warnings++; report.summary.totalIssues++;
      }
      const content = { compilerVersion: PUBLICATION_COMPILER_VERSION, worldId, sourceRevision: draftRevision, base,
        document: checked, documentHash: sha256(checked), runtime: { ...dependencies.runtime, gameVersion, protocolVersion }, assets, baselineAssets,
        collision: { count: colliders.length, sha256: sha256(colliders) }, validation: report };
      const revision = { schema: PREPARATION_SCHEMA, version: 1, revisionId: sha256(content), content };
      return { report, revision };
    },
  };
}
