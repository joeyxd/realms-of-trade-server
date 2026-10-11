// Exercise the real local appearance controls, rigid head binding, and downloaded composition.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {chromium}=await import(pathToFileURL(process.env.MN_PLAYWRIGHT||path.join(root,'.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const out=path.join(root,'docs/art/character-appearance-v1');await fs.mkdir(out,{recursive:true});
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const evidence={schema:'character-appearance-browser/v1',scope:'P03a isolated local UI and downloads; no saved identity, game or physical-device performance acceptance',cases:[],failures:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  for(const spec of [{id:'desktop',width:1440,height:900,size:1024},{id:'mobile',width:390,height:844,size:512,isMobile:true,hasTouch:true}]) {
    const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},isMobile:!!spec.isMobile,hasTouch:!!spec.hasTouch,deviceScaleFactor:1,acceptDownloads:true});
    const page=await context.newPage(),errors=[],requests=[],failed=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>{if(r.url().endsWith('.glb'))requests.push(r.url());});page.on('requestfailed',r=>failed.push(r.url()));
    const result={...spec,bodies:[],errors,requests,failed};
    const choose=async(field,id)=>{await page.locator(`[data-appearance-field="${field}"][data-option="${id}"]`).click();};
    const capture=async(name)=>{await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(100);await page.screenshot({path:path.join(out,`${spec.id}-${name}.png`)});};
    try {
      await page.goto((process.env.MN_CHARACTER_LAB_URL||'http://127.0.0.1:5194')+'/?v=3&appearance=1',{waitUntil:'networkidle'});
      await page.waitForFunction(()=>window.__characterLab?.state.loaded&&__characterLab.active.appearance);
      // A requested body must invalidate an export even while the old model is still displayed.
      let staleDownloads=0;const staleListener=()=>staleDownloads++;
      page.on('download',staleListener);
      await page.route('**/female-base-v3*.glb',async route=>{await new Promise(resolve=>setTimeout(resolve,2000));await route.continue();});
      await page.evaluate(()=>{document.querySelector('#download-appearance').click();document.querySelector('[data-body="female"]').click();});
      await page.waitForFunction(()=>__characterLab.state.loaded&&__characterLab.active.kind==='female');
      await page.waitForFunction(()=>!document.querySelector('#download-appearance').textContent.includes('Preparando'));
      page.off('download',staleListener);await page.unroute('**/female-base-v3*.glb');
      assert(staleDownloads===0,'Export downloaded the previous body during a pending load');result.staleExportSuppressed=true;
      for(const kind of ['male','female']) {
        await page.locator(`[data-body="${kind}"]`).click();await page.waitForFunction(k=>__characterLab.state.loaded&&__characterLab.active.kind===k&&__characterLab.active.appearance,kind);
        await page.locator('#reset-appearance').click();await page.locator('[data-pose="idle"]').click();await page.locator('[data-view="face"]').click();
        const body={kind,hairs:[],beards:[],eyes:[],brows:[]};result.bodies.push(body);
        for(const id of ['scout','swept','pony','crop','none']) {
          await choose('hairId',id);
          const info=await page.evaluate(()=>({id:__characterLab.active.appearance.descriptor.hairId,
            hairMeshes:__characterLab.active.appearance.meshes.filter(m=>m.userData.family==='hair').length,
            triangles:__characterLab.visibleMeshes(__characterLab.active).reduce((n,m)=>n+m.geometry.index.count/3,0)}));
          assert(info.id===id&&info.hairMeshes===(id==='none'?0:1),'Hair selection mismatch');body.hairs.push(info);
          if(id!=='none')await capture(`${kind}-hair-${id}-face`);
        }
        await choose('hairId','swept');
        for(const id of ['none','stubble','full']) {
          await choose('beardId',id);
          const info=await page.evaluate(()=>({id:__characterLab.active.appearance.descriptor.beardId,count:__characterLab.active.appearance.meshes.filter(m=>m.userData.family==='beard').length}));
          assert(info.id===id&&info.count===(id==='none'?0:1),'Beard selection mismatch');body.beards.push(info);
          if(id!=='none')await capture(`${kind}-beard-${id}-face`);
        }
        for(const id of ['neutral','keen','soft']) {await choose('eyesId',id);body.eyes.push(await page.evaluate(()=>__characterLab.active.appearance.descriptor.eyesId));}
        for(const id of ['natural','bold','arched']) {await choose('browsId',id);body.brows.push(await page.evaluate(()=>__characterLab.active.appearance.descriptor.browsId));}
        const families=await page.evaluate(()=>Object.fromEntries(__characterLab.visibleMeshes(__characterLab.active).map(m=>[m.userData.family||m.name,Array.from(m.geometry.attributes.color.array)])));
        const isolation=[];
        for(const [field,id,family] of [['hairPaletteId','copper','hair'],['beardPaletteId','silver','beard'],['browPaletteId','black','brows']]) {
          const before=await page.evaluate(()=>Object.fromEntries(__characterLab.visibleMeshes(__characterLab.active).map(m=>[m.userData.family||m.name,Array.from(m.geometry.attributes.color.array)])));
          await page.locator(`[data-appearance-select="${field}"]`).selectOption(id);
          const changed=await page.evaluate(before=>__characterLab.visibleMeshes(__characterLab.active).filter(m=>m.geometry.attributes.color.array.some((v,i)=>v!==before[m.userData.family||m.name][i])).map(m=>m.userData.family||m.name),before);
          assert(changed.length===1&&changed[0]===family,`Palette changes other family: ${field}`);isolation.push({field,changed});
        }
        for(const id of ['sea','leaf','slate','amber'])await choose('irisPaletteId',id);
        const after=await page.evaluate(()=>Object.fromEntries(__characterLab.visibleMeshes(__characterLab.active).map(m=>[m.userData.family||m.name,Array.from(m.geometry.attributes.color.array)])));
        assert(['body_base','head_base','base_top','base_shorts'].every(n=>after[n].every((v,i)=>v===families[n][i])),'Appearance changes skin or clothes');
        body.paletteIsolation=isolation;
        body.bind=await page.evaluate(()=>{
          const lab=__characterLab,model=lab.active,vector=lab.camera.position.clone();
          function localPoints(){const inv=model.bones.head.matrixWorld.clone().invert();return model.appearance.meshes.map(m=>Array.from({length:m.geometry.attributes.position.count},(_,i)=>m.getVertexPosition(i,vector).applyMatrix4(m.matrixWorld).applyMatrix4(inv).toArray()));}
          lab.state.pose='idle';lab.sample(0);const rest=localPoints();lab.state.pose='joints';lab.sample(.22);const moved=localPoints();let max=0;
          for(let m=0;m<rest.length;m++)for(let i=0;i<rest[m].length;i++)max=Math.max(max,Math.hypot(...rest[m][i].map((v,k)=>v-moved[m][i][k])));
          return {maxHeadLocalDriftMeters:max,parts:model.appearance.meshes.map(m=>m.name),sharedSkeleton:model.appearance.meshes.every(m=>m.skeleton===model.meshes.find(m=>m.name==='head_base').skeleton)};
        });
        assert(body.bind.sharedSkeleton&&body.bind.maxHeadLocalDriftMeters<1e-5,'Head attachment drifts under pose');
        await page.locator('[data-pose="idle"]').click();
        for(const view of ['front','side','back','game']) {await page.locator(`[data-view="${view}"]`).click();await capture(`${kind}-captain-${view}`);}
        await choose('hairId','pony');await choose('beardId','none');await choose('eyesId','keen');await choose('browsId','arched');await choose('irisPaletteId','sea');
        await page.locator('[data-view="back"]').click();await capture(`${kind}-pony-back`);
        await page.locator('[data-view="face"]').click();await capture(`${kind}-selected-face`);
        const selected=await page.evaluate(()=>({...__characterLab.active.appearance.descriptor}));
        const downloadPromise=page.waitForEvent('download');await page.locator('#download-appearance').click();const download=await downloadPromise;
        const destination=path.join(out,`${spec.id}-${kind}-selected.glb`);await download.saveAs(destination);
        const bytes=await fs.readFile(destination),json=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
        const meta=json.nodes.find(n=>n.extras?.schema==='character-lab-appearance/v1')?.extras;
        const names=json.nodes.filter(n=>n.mesh!==undefined).map(n=>n.name);
        assert(JSON.stringify(meta.appearance)===JSON.stringify(selected)&&meta.body===kind&&meta.textureSize===spec.size,'Downloaded metadata differs from current selection');
        assert(names.includes('hair_pony')&&!names.includes('eyes_base')&&!names.some(n=>n.includes('beard_')||n.endsWith('_outline')),'Downloaded geometry has stale modules');
        body.download={path:path.relative(root,destination).replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),names,metadata:meta};
        const b64=bytes.toString('base64');
        body.reimport=await page.evaluate(async b64=>{
          const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
          const bytes=await (await fetch('data:model/gltf-binary;base64,'+b64)).arrayBuffer(),gltf=await new GLTFLoader().parseAsync(bytes,'');
          const meshes=[];gltf.scene.traverse(o=>{if(o.isMesh)meshes.push(o);});
          const info={parts:meshes.length,skinned:meshes.every(m=>m.isSkinnedMesh&&m.skeleton.bones.length===15),maps:meshes.filter(m=>m.material.map).map(m=>m.material.map.image.width)};
          for(const mesh of meshes){mesh.geometry.dispose();mesh.material.dispose();}return info;
        },b64);
        assert(body.reimport.skinned&&body.reimport.maps.length===4&&body.reimport.maps.every(n=>n===spec.size),'Downloaded GLB does not reimport with expected rig/maps');
        assert(await page.evaluate(()=>!document.documentElement.scrollWidth||document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
        assert(await page.evaluate(()=>__characterLab.renderer.info.programs.every(p=>__characterLab.renderer.getContext().getProgramParameter(p.program,__characterLab.renderer.getContext().LINK_STATUS))&&__characterLab.renderer.getContext().getError()===0),'Shader/GL error');
        console.log(JSON.stringify({viewport:spec.id,body:kind,downloadBytes:body.download.bytes,headDrift:body.bind.maxHeadLocalDriftMeters}));
      }
      // Preserve the composition while older bases are compared, then exercise overlapping base requests.
      await page.locator('[data-version="v2"]').click();await page.waitForFunction(()=>__characterLab.state.loaded&&__characterLab.active.version==='v2');
      assert(await page.locator('#appearance-controls').isHidden(),'Unsupported base offers modules');
      await page.evaluate(()=>{document.querySelector('[data-version="v3"]').click();document.querySelector('[data-body="male"]').click();document.querySelector('[data-body="female"]').click();document.querySelector('[data-body="male"]').click();});
      await page.waitForFunction(()=>__characterLab.state.loaded&&__characterLab.active.kind==='male'&&__characterLab.active.version==='v3'&&__characterLab.active.appearance?.descriptor.hairId==='pony');
      result.rapidSwitchPreserved=true;
      await page.locator('#reset-appearance').click();assert(await page.evaluate(()=>__characterLab.active.appearance.descriptor.hairId==='scout'&&__characterLab.active.appearance.descriptor.beardId==='none'),'Reset failed');
      assert(!errors.length&&!failed.length,'Browser/network errors');
      assert(requests.filter(u=>u.includes('base-v3/')).every(u=>spec.size===512?u.endsWith('-mobile.glb'):!u.endsWith('-mobile.glb')),'Incorrect texture variant request');
    } catch(error){evidence.failures.push({case:spec.id,message:error.message});}
    finally{evidence.cases.push(result);await context.close();}
  }
} finally{await browser.close();}
await fs.writeFile(path.join(out,'browser-evidence-v1.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({cases:evidence.cases.length,bodies:evidence.cases.flatMap(c=>c.bodies).length,failures:evidence.failures,downloads:evidence.cases.flatMap(c=>c.bodies.filter(b=>b.download).map(b=>b.download.bytes))}));
if(evidence.failures.length)process.exitCode=1;
