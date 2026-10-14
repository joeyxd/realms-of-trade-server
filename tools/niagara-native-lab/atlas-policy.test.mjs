import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { validateManifest, texturePlan, selectVariant, AUTOMATIC_VARIANTS, mipRgba8Bytes } from './atlas-policy.js';
const manifest = JSON.parse(fs.readFileSync(new URL('./atlas-manifest.json',import.meta.url)));
test('one pair per selection; NPOT device limits reject instead of changing quality',()=>{
  for(const variant of ['source','full','half','quarter']){
    const plan=texturePlan(manifest,variant,4096);assert.equal(plan.length,2);
    assert.ok(plan.every(r=>r.url.endsWith(variant==='source'?'.png':'.webp')));
  }
  assert.throws(()=>texturePlan(manifest,'source',2048),/limit/);
  assert.equal(selectVariant('auto',false),AUTOMATIC_VARIANTS.desktop);
  assert.equal(selectVariant('auto',true),AUTOMATIC_VARIANTS.mobile);
  assert.throws(()=>selectVariant('../../source',true));
});
test('mip accounting includes rectangular tail down to 1x1',()=>{
  assert.equal(mipRgba8Bytes(3,2),28);assert.equal(mipRgba8Bytes(2048,1024),11184812);
  assert.throws(()=>mipRgba8Bytes(0,512));
});
test('wrong source, grid, pixel identity, path or missing derivative cannot load',()=>{
  for(const mutate of [m=>m.inputs[0].sha256='0'.repeat(64),m=>m.inputs[0].file='../foo.png',
    m=>m.variants[0].grid=[4,8],m=>m.variants[0].mipRgba8Bytes++,m=>m.variants.pop(),
    m=>m.variants.find(r=>r.id==='full').decodedRgbaSha256='0'.repeat(64)]){
    const bad=structuredClone(manifest);mutate(bad);assert.throws(()=>validateManifest(bad));
  }
});
