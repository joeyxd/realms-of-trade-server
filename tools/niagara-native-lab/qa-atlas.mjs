import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
if(!process.argv[2]) throw new Error('Pass Playwright module path');
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const run=process.argv[3]||'budget01';if(!/^[A-Za-z0-9_-]{1,40}$/.test(run))throw new Error('Invalid run');
const out=new URL(`../../.scratch/atlas-lab/${run}/`,import.meta.url);await fs.mkdir(out,{recursive:true});
const cases=[];
for(const tick of [0,15,30,60,90,120,180,240,360,480])for(const view of ['front','oblique','side'])for(const bias of [0,1])
  cases.push({kind:'pilot',tick,view,bias,layer:'both',surface:'none',cell:false,frame:0});
for(const layer of ['flame','smoke'])for(const view of ['front','oblique','side'])for(const bias of [0,1])
  cases.push({kind:'layer',tick:120,view,bias,layer,surface:'none',cell:false,frame:0});
for(const surface of ['wall','floor'])for(const layer of ['both','flame','smoke'])for(const bias of [0,1])
  cases.push({kind:'depth',tick:120,view:'oblique',bias,layer,surface,cell:false,frame:0});
for(const layer of ['flame','smoke'])for(let frame=0;frame<(layer==='flame'?32:60);frame++)for(const bias of [0,1])
  cases.push({kind:'cell',tick:120,view:'front',bias,layer,surface:'none',cell:true,frame});
cases.forEach((row,i)=>row.file=`case-${String(i).padStart(3,'0')}.png`);
await fs.writeFile(new URL('cases.json',out),JSON.stringify(cases,null,2)+'\n');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const results=[];
try{
  for(const variant of ['source','full','half','quarter']){
    const directory=new URL(variant+'/',out);await fs.mkdir(directory,{recursive:true});
    const page=await browser.newPage({viewport:{width:1280,height:1150}}),errors=[],requests=[];
    page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
    await page.goto(`http://127.0.0.1:5197/tools/niagara-native-lab/budget.html?variant=${variant}`);
    await page.waitForFunction(()=>window.budgetLab?.ready||window.budgetLab?.errors.length);
    assert.ok(await page.evaluate(()=>budgetLab.ready),JSON.stringify(await page.evaluate(()=>budgetLab.errors)));
    assert.equal(await page.evaluate(()=>budgetLab.variant),variant);
    const selected=await page.evaluate(()=>budgetLab.selected);
    for(const row of cases){
      const {kind,file,...controls}=row;
      await page.evaluate(c=>budgetLab.configure(c),controls);
      await fs.writeFile(new URL(file,directory),Buffer.from(await page.locator('#preview').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
    }
    await page.evaluate(()=>budgetLab.configure({tick:120,view:'oblique',bias:0,layer:'both',surface:'none',cell:false,frame:0}));
    await page.screenshot({path:fileURLToPath(new URL('desktop.png',directory)),fullPage:true});
    const snapshot=await page.evaluate(()=>budgetLab.snapshot);
    const benchmark=await page.evaluate(()=>budgetLab.benchmark());
    assert.deepEqual(await page.evaluate(()=>budgetLab.snapshot),snapshot);
    const invalid=await page.evaluate(()=>{try{budgetLab.configure({frame:NaN});return false;}catch{return true;}});assert.equal(invalid,true);
    await page.locator('#play').click();await page.waitForFunction(()=>budgetLab.snapshot.systemAge>2);
    await page.locator('#play').click();await page.locator('#reset').click();assert.deepEqual(await page.evaluate(()=>budgetLab.snapshot),snapshot);
    await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:fileURLToPath(new URL('mobile-layout.png',directory)),fullPage:true});
    const stats=await page.evaluate(()=>budgetLab.stats);
    const atlasRequests=requests.filter(r=>/\/textures\/.+\.png|\/atlas-build\/v1\/.+\.webp/.test(r.url));
    assert.equal(atlasRequests.length,2);assert.deepEqual(atlasRequests.map(r=>new URL(r.url).pathname).sort(),selected.map(r=>r.url).sort());
    assert.ok(requests.every(r=>r.method==='GET'&&(r.url.startsWith('http://127.0.0.1:5197/')||r.url.startsWith('blob:'))));
    assert.ok(!requests.some(r=>/particles\/|update-fixture|\.rgba16f|\.hdr/.test(r.url)));
    await page.evaluate(()=>{budgetLab.dispose();budgetLab.dispose();});
    assert.deepEqual(await page.evaluate(()=>budgetLab.resourcesAfterDispose),{geometries:0,textures:0});assert.deepEqual(errors,[]);
    results.push({variant,cases:cases.length,selected,stats,benchmark,errors,requests,resourcesAfterDispose:{geometries:0,textures:0}});
    await page.close();console.log(JSON.stringify({variant,cases:cases.length,stats,benchmark}));
  }
  // Initial coarse-pointer selection: load only its chosen pair, without originals.
  for(const mobile of [false,true]){
    const context=await browser.newContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{});
    const page=await context.newPage();await page.goto('http://127.0.0.1:5197/tools/niagara-native-lab/budget.html');
    await page.waitForFunction(()=>window.budgetLab?.ready||window.budgetLab?.errors.length);
    assert.ok(await page.evaluate(()=>budgetLab.ready));
    assert.equal(await page.evaluate(()=>budgetLab.variant),'full');
    assert.equal(await page.evaluate(()=>budgetLab.mobileMemoryAccepted),false);
    results.push({automatic:true,mobile,variant:await page.evaluate(()=>budgetLab.variant),selected:await page.evaluate(()=>budgetLab.selected),mobileMemoryAccepted:false});
    await page.evaluate(()=>budgetLab.dispose());await context.close();
  }
  // Both early corruption and a post-upload startup failure must release resources.
  for(const fault of ['corrupt-texture','late-startup']){
    const page=await browser.newPage();
    if(fault==='corrupt-texture')await page.route('**/full-smoke.webp',route=>route.fulfill({status:200,body:Buffer.from('invalid')}));
    else await page.route('**/budget-lab.js',async route=>{const response=await route.fetch();
      const body=(await response.text()).replace('draw();state.ready=true;',"draw();throw new Error('injected late startup');state.ready=true;");
      assert.ok(body.includes('injected late startup'));await route.fulfill({response,body});});
    await page.goto('http://127.0.0.1:5197/tools/niagara-native-lab/budget.html');
    await page.waitForFunction(()=>window.budgetLab?.errors.length);
    assert.equal(await page.evaluate(()=>budgetLab.ready),false);
    assert.deepEqual(await page.evaluate(()=>budgetLab.resourcesAfterDispose),{geometries:0,textures:0});
    results.push({fault,errors:await page.evaluate(()=>budgetLab.errors),resourcesAfterDispose:{geometries:0,textures:0}});await page.close();
  }
  await fs.writeFile(new URL('browser.json',out),JSON.stringify({schema:'st01c-atlas-browser/v1',run,cases:cases.length,results},null,2)+'\n');
}finally{await browser.close();}
