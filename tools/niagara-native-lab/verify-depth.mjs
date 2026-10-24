// Reference validation is offline; no observed states enter the native generator.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { DataUtils } from 'three';
import { NativeSimulation } from '../../src/render/vfx/niagara/native-simulation.js';
import { SOURCE_PRESET_SHA256 } from '../../src/render/vfx/niagara/source-identity.js';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const root = new URL('../../', import.meta.url);
const bytes = await fs.readFile(new URL('../../src/render/vfx/niagara/pilot-source.json', import.meta.url));
assert.equal(hash(bytes), SOURCE_PRESET_SHA256);
const native = new NativeSimulation(JSON.parse(bytes)).seek(120);
const sourceBytes = await fs.readFile(new URL('tools/unreal-niagara-probe/capture_depth.py', root));
const reports = [], calibration = [], inputs = [];
for (const run of ['depth02', 'depth03']) {
  const dir = new URL(`.scratch/unreal/${run}/`, root);
  const reportBytes = await fs.readFile(new URL('depth-report.json', dir));
  const report = JSON.parse(reportBytes); reports.push(report);
  assert.equal(report.status, 'complete'); assert.equal(report.images.length, 22);
  assert.equal(report.source_sha256, '985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165');
  assert.equal(report.script_sha256, hash(sourceBytes));
  assert.equal(report.settings.custom_projection, false); assert.equal(report.asset_saves, 0);
  const observedBytes = await fs.readFile(new URL('particles.json', dir));
  assert.equal(hash(observedBytes), report.particles_sha256);
  const observed = JSON.parse(observedBytes);
  const accepted = JSON.parse(await fs.readFile(new URL('.scratch/unreal/reference11/particles/step_0120.json', root)));
  assert.deepEqual(observed, accepted);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(native.emitters[i].particles.map(p => p.uniqueId), observed.emitters[i].particles.map(p => p.uniqueId));
    for (let j = 0; j < native.emitters[i].particles.length; j++) {
      const p = native.emitters[i].particles[j], q = observed.emitters[i].particles[j];
      assert.ok(p.position.every((v, c) => Math.abs(v-q.position[c]) < .002));
      assert.ok(p.color.every((v, c) => Math.abs(v-q.color[c]) < .00001));
    }
  }
  for (const row of report.images) {
    assert.ok(/^[A-Za-z0-9_-]+\.hdr$/.test(row.file));
    const hdr = await fs.readFile(new URL(row.file, dir)); assert.equal(hash(hdr), row.sha256);
    if (row.case.startsWith('calibration')) {
      const image = new RGBELoader().parse(hdr.buffer.slice(hdr.byteOffset, hdr.byteOffset + hdr.byteLength));
      assert.equal(image.width, 512); assert.equal(image.height, 512);
      const rgb = Array.from(image.data.slice((256 * 512 + 256) * 4, (256 * 512 + 256) * 4 + 3), DataUtils.fromHalfFloat);
      const expected = Math.min(1, Math.max(0, row.gap_cm / 100));
      assert.ok(rgb.every(v => Math.abs(v-expected) < .01), JSON.stringify({ run, gap: row.gap_cm, rgb, expected }));
      calibration.push({ run, gapCm: row.gap_cm, expected, unrealLinearRGB: rgb });
    }
  }
  inputs.push({ run, reportSha256: hash(reportBytes), particleSha256: report.particles_sha256 });
}
assert.equal(reports[0].particles_sha256, reports[1].particles_sha256);
assert.deepEqual(reports[0].images, reports[1].images);
const result = { schema: 'st01c-depth-validation/v1', inputs, imagesPerRun: 22, repeatableImageHashes: true,
  calibrationQualification: 'Positive gaps measure the fade ramp; zero/negative black outputs also include opaque depth occlusion, not an independent proof of the clamp branch.',
  calibration, nativeCapturedStateInputs: 0, sameParticlesAsAcceptedReference: true };
await fs.mkdir(new URL('.scratch/depth-lab/', root), { recursive: true });
await fs.writeFile(new URL('.scratch/depth-lab/reference-validation.json', root), JSON.stringify(result, null, 2)+'\n');
console.log(JSON.stringify(result));
