import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { validateManifest, texturePlan, selectVariant, AUTOMATIC_VARIANTS, mipRgba8Bytes } from './atlas-policy.js';
const manifest = JSON.parse(fs.readFileSync(new URL('./atlas-manifest.json',import.meta.url)));
const KTX2_VARIANTS=['ktx2-uastc','ktx2-uastc-box','ktx2-rgba8','ktx2-rgba8-box'];
test('one pair per selection; NPOT device limits reject instead of changing quality',()=>{
  for(const variant of ['source','full','half','quarter',...KTX2_VARIANTS]){
    const plan=texturePlan(manifest,variant,4096);assert.equal(plan.length,2);
    assert.ok(plan.every(r=>r.url.endsWith(variant==='source'?'.png':variant.startsWith('ktx2-')?'.ktx2':'.webp')));
  }
  assert.throws(()=>texturePlan(manifest,'source',2048),/limit/);
  assert.equal(selectVariant('auto',false),AUTOMATIC_VARIANTS.desktop);
  assert.equal(selectVariant('auto',true),AUTOMATIC_VARIANTS.mobile);
  assert.deepEqual({...AUTOMATIC_VARIANTS},{desktop:'full',mobile:'full'});
  for(const variant of KTX2_VARIANTS)assert.equal(selectVariant(variant,true),variant);
  assert.throws(()=>selectVariant('../../source',true));
});
test('automatic selection never picks a KTX2 variant',()=>{
  for(const coarse of [false,true])assert.ok(!selectVariant('auto',coarse).startsWith('ktx2-'));
});
test('mip accounting includes rectangular tail down to 1x1',()=>{
  assert.equal(mipRgba8Bytes(3,2),28);assert.equal(mipRgba8Bytes(2048,1024),11184812);
  assert.throws(()=>mipRgba8Bytes(0,512));
});
test('wrong source, grid, pixel identity, path or missing derivative cannot load',()=>{
  for(const mutate of [m=>m.inputs[0].sha256='0'.repeat(64),m=>m.inputs[0].file='../foo.png',
    m=>m.variants[0].grid=[4,8],m=>m.variants[0].mipRgba8Bytes++,m=>m.variants.pop(),
    m=>m.variants.find(r=>r.id==='full').decodedRgbaSha256='0'.repeat(64),
    m=>m.variants.find(r=>r.id==='ktx2-uastc').lossy=false,m=>m.variants.find(r=>r.id==='ktx2-uastc').levelCount--,
    m=>m.variants.find(r=>r.id==='ktx2-uastc').transfer='linear',m=>m.variants.find(r=>r.id==='ktx2-uastc').gpuBlockBytes++,
    m=>m.variants.find(r=>r.id==='ktx2-uastc').file='ktx2-uastc-flame.webp',
    m=>m.variants.find(r=>r.id==='ktx2-uastc').encoder.commandLine+=' --uastc_rdo_l',
    // 2x2 diagnostic variants: codec, filter and size facts are pinned per variant.
    m=>m.variants.find(r=>r.id==='ktx2-uastc').encoder.commandLine+=' --filter box',
    m=>m.variants.find(r=>r.id==='ktx2-uastc-box').encoder.commandLine=m.variants.find(r=>r.id==='ktx2-uastc-box').encoder.commandLine.replace(' --filter box',''),
    m=>m.variants.find(r=>r.id==='ktx2-rgba8').encoder.commandLine+=' --encode uastc',
    m=>m.variants.find(r=>r.id==='ktx2-rgba8').lossy=true,m=>m.variants.find(r=>r.id==='ktx2-rgba8').codec='uastc',
    m=>m.variants.find(r=>r.id==='ktx2-rgba8').colorModel='UASTC',m=>m.variants.find(r=>r.id==='ktx2-rgba8').gpuBlockBytes--,
    m=>m.variants.find(r=>r.id==='ktx2-rgba8-box').levels[0].uncompressedByteLength++,
    m=>m.variants.find(r=>r.id==='ktx2-rgba8-box').encoder.commandLine=m.variants.find(r=>r.id==='ktx2-rgba8-box').encoder.commandLine.replace(' --filter box',' --filter tent')]){
    const bad=structuredClone(manifest);mutate(bad);assert.throws(()=>validateManifest(bad));
  }
});
