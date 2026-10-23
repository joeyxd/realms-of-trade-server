// Offline comparison and provenance checks; this data never enters native generation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FILM_SOURCE_SHA256 } from './film-identity.js';
const root = new URL('../../', import.meta.url), hash = b => crypto.createHash('sha256').update(b).digest('hex');
const sourceBytes = await fs.readFile(new URL('./film-source.json', import.meta.url));
assert.equal(hash(sourceBytes), FILM_SOURCE_SHA256);
const source = JSON.parse(sourceBytes);
const backend = await fs.readFile(new URL(source.backendMetadata.file, root));
assert.equal(hash(backend), source.backendMetadata.sha256);
const script = await fs.readFile(new URL('tools/unreal-niagara-probe/capture_color.py', root));
const acceptedParticles = JSON.parse(await fs.readFile(new URL('.scratch/unreal/reference11/particles/step_0120.json', root)));
const reports = [], files = [];
for (const run of ['color07', 'color08']) {
  const dir = new URL(`.scratch/unreal/${run}/`, root);
  const bytes = await fs.readFile(new URL('color-report.json', dir)), report = JSON.parse(bytes);
  assert.equal(report.schema, 'st01c-color-reference/v1'); assert.equal(report.images.length, 8); assert.equal(report.chart.length, 48);
  assert.equal(report.script_sha256, hash(script)); assert.equal(report.status, 'complete'); assert.equal(report.asset_saves, 0);
  assert.equal(report.source_sha256, '985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165');
  assert.equal(report.settings.pre_exposure_override, 1); assert.equal(report.settings.custom_projection, false);
  assert.equal(report.capture_state.always_persist_rendering_state, true); assert.equal(report.capture_state.anti_aliasing, false);
  assert.equal(report.cvars['r.BackbufferQuantizationDitheringOverride'], 32);
  const particles = await fs.readFile(new URL('particles.json', dir)); assert.equal(hash(particles), report.particles_sha256);
  assert.deepEqual(JSON.parse(particles), acceptedParticles);
  for (const row of report.images) for (const [kind, entry] of Object.entries(row.files)) {
    assert.ok(/^[A-Za-z0-9_-]+\.(png|hdr|rgba16f)$/.test(entry.file));
    const artifact = await fs.readFile(new URL(entry.file, dir)); assert.equal(hash(artifact), entry.sha256);
    if (kind === 'raw') assert.equal(artifact.byteLength, 512*512*8);
    if (kind === 'ldr') {
      assert.ok(Math.abs(entry.target.displayGamma-2.2) < .000001);
      assert.equal(entry.target.resourceDisplayOutputFormat, 0); assert.equal(entry.target.resourceDisplayColorGamut, 0);
      assert.equal(entry.target.sdrLutQuantizationBits, 10);
    }
  }
  assert.notEqual(report.images[0].files.ldr.sha256, report.images[4].files.ldr.sha256, 'Exposure must change final output');
  assert.equal(report.images[0].files.raw.sha256, report.images[4].files.raw.sha256, 'Manual exposure must not change raw scene source');
  assert.deepEqual(JSON.parse(await fs.readFile(new URL('color-platform.json', dir))), JSON.parse(backend));
  reports.push(report); files.push({ run, reportSha256: hash(bytes), particleSha256: report.particles_sha256 });
}
// PNG compressor streams need not be identical. Verify decoded RGBA bytes,
// then retain each container hash separately and compare the complete metadata.
const pixels = JSON.parse(execFileSync('python', ['tools/niagara-native-lab/check-color-repeat.py', 'color07', 'color08'],
  { cwd: fileURLToPath(root), encoding: 'utf8' }));
const normalized = reports.map(r => { const copy = structuredClone(r); copy.images.forEach(row => { row.files.ldr.sha256 = 'decoded PNG validated separately'; }); return copy; });
assert.deepEqual(normalized[0], normalized[1], 'Two runs must reproduce HDR, readback and profile');
const result = { schema: 'st01c-color-validation/v1', inputs: files, framesPerRun: 8, filesPerFrame: 3,
  exactRepeatedHdrFiles: 16, exactRepeatedPngPixels: pixels.length, pngDecodedPixels: pixels,
  pngContainerHashesMayDiffer: true, exactRepeatedReadback: true, sameParticlesAsAcceptedReference: true,
  manualExposureChangesLdrOnly: true, sourceOnlyLut: true, nativeCapturedParticleStateInputs: 0,
  sourcePresetSha256: FILM_SOURCE_SHA256, backendSha256: source.backendMetadata.sha256 };
await fs.mkdir(new URL('.scratch/color-lab/', root), { recursive: true });
await fs.writeFile(new URL('.scratch/color-lab/reference-validation.json', root), JSON.stringify(result, null, 2)+'\n');
console.log(JSON.stringify(result));
