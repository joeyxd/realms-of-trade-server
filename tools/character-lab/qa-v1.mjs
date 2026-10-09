// Real browser acceptance of the v1 artifacts and comparison lab. No game/FPS claim.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {chromium}=await import(pathToFileURL(process.env.MN_PLAYWRIGHT||path.join(root,'.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const out=path.join(root,'docs/art/characters-base-v1');await fs.mkdir(out,{recursive:true});
const evidence={schema:'character-lab-qa/v2',scope:'P02a isolated anatomy/UV/material studies; no gameplay or physical-device FPS acceptance',cases:[],failures:[]};
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  for(const spec of [{id:'desktop',width:1440,height:900,size:1024},{id:'mobile',width:390,height:844,size:512,isMobile:true,hasTouch:true}]){
    const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},isMobile:!!spec.isMobile,hasTouch:!!spec.hasTouch,deviceScaleFactor:1});
    const page=await context.newPage(),errors=[],requests=[],requestFailures=[],consoleErrors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text());});page.on('request',req=>{if(req.url().endsWith('.glb'))requests.push(req.url());});page.on('requestfailed',req=>requestFailures.push({url:req.url(),error:req.failure()?.errorText}));
    const result={...spec,bodies:[],errors,consoleErrors,requests,requestFailures};
    try{
      await page.goto((process.env.MN_CHARACTER_LAB_URL||'http://127.0.0.1:5194')+'/?v=1',{waitUntil:'networkidle'});
      await page.waitForFunction(()=>window.__characterLab?.state.loaded);
      for(const body of ['male','female']){
        await page.locator(`[data-body="${body}"]`).click();await page.waitForFunction(kind=>__characterLab.state.loaded&&__characterLab.state.body===kind&&__characterLab.active.kind===kind&&__characterLab.active.version==='v1',body);
        await page.locator('[data-pose="a"]').click();await page.locator('[data-view="front"]').click();await page.waitForTimeout(150);
        await page.screenshot({path:path.join(out,`${spec.id}-${body}-front-v1.png`),fullPage:!!spec.isMobile});
        const structural=await page.evaluate(()=>{
          const lab=__characterLab,m=lab.active;
          return {assetUrl:m.assetUrl,quality:m.quality,boneNames:Object.keys(m.bones),parts:m.meshes.map(mesh=>({name:mesh.name,joints:mesh.skeleton.bones.length,uv:!!mesh.geometry.attributes.uv,texture:mesh.userData.paintMaterial.map?{width:mesh.userData.paintMaterial.map.image.width,height:mesh.userData.paintMaterial.map.image.height}:null})),programsLinked:lab.renderer.info.programs.every(p=>lab.renderer.getContext().getProgramParameter(p.program,lab.renderer.getContext().LINK_STATUS)),glError:lab.renderer.getContext().getError(),horizontalOverflow:document.documentElement.scrollWidth>innerWidth};
        });
        assert(structural.quality===spec.size&&structural.parts.filter(p=>p.texture).every(p=>p.texture.width===spec.size&&p.texture.height===spec.size),'Incorrect loaded texture resolution');
        assert(structural.parts.length===5&&structural.parts.every(p=>p.joints===15&&p.uv)&&structural.boneNames.length===15,'Missing UV or skinned modules');
        assert(structural.programsLinked&&structural.glError===0&&!structural.horizontalOverflow,'Shader/UI error');
        const palette=await page.evaluate(()=>{const m=__characterLab.active.meshes;return {skin:Array.from(m.find(x=>x.name==='head_base').geometry.attributes.color.array),cloth:Array.from(m.find(x=>x.name==='base_top').geometry.attributes.color.array)};});
        await page.locator('[aria-label="Piel oscura"]').click();const recolor=await page.evaluate(before=>{const m=__characterLab.active.meshes,skin=m.find(x=>x.name==='head_base').geometry.attributes.color.array,cloth=m.find(x=>x.name==='base_top').geometry.attributes.color.array;return {skinChanged:skin.some((n,i)=>n!==before.skin[i]),clothesUnchanged:cloth.every((n,i)=>n===before.cloth[i])};},palette);
        assert(recolor.skinChanged&&recolor.clothesUnchanged,'Palette changes clothes or fails to change skin');await page.locator('[aria-label="Piel cálida"]').click();
        const poses=await page.evaluate(()=>{
          const lab=__characterLab,vec=lab.camera.position.clone();
          function positions(mesh){const p=[];for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,vec);p.push(vec.x,vec.y,vec.z);}return p;}
          lab.state.pose='idle';lab.sample(0);const rests=lab.active.meshes.map(positions);
          const checks=[];
          for(const pose of ['a','run','joints']){
            lab.state.pose=pose;lab.sample(.22);const parts=[];
            for(let m=0;m<lab.active.meshes.length;m++){
              const mesh=lab.active.meshes[m],rest=rests[m],p=positions(mesh),index=mesh.geometry.index.array;let maxStretch=1,moved=0;
              for(let i=0;i<p.length;i+=3)if(Math.hypot(p[i]-rest[i],p[i+1]-rest[i+1],p[i+2]-rest[i+2])>.02)moved++;
              for(let t=0;t<index.length;t+=3)for(const [a,b]of[[index[t],index[t+1]],[index[t+1],index[t+2]],[index[t+2],index[t]]]){const d=Math.hypot(rest[a*3]-rest[b*3],rest[a*3+1]-rest[b*3+1],rest[a*3+2]-rest[b*3+2]),after=Math.hypot(p[a*3]-p[b*3],p[a*3+1]-p[b*3+1],p[a*3+2]-p[b*3+2]);if(d>1e-5)maxStretch=Math.max(maxStretch,after/d);}
              parts.push({name:mesh.name,finite:p.every(Number.isFinite),movedVertices:moved,maxEdgeStretch:Number(maxStretch.toFixed(3))});
            }
            checks.push({pose,finite:parts.every(p=>p.finite),movedVertices:parts.find(p=>p.name==='body_base').movedVertices,maxEdgeStretch:Math.max(...parts.map(p=>p.maxEdgeStretch)),parts});
          }
          return checks;
        });
        const bodyResult={body,...structural,recolor,poses}; result.bodies.push(bodyResult);
        assert(poses.every(p=>p.finite&&p.movedVertices>10),'Poses produce invalid or unchanged skinned positions');
        assert(poses.every(p=>p.maxEdgeStretch<5),'Skin weights stretch body edges beyond the lab limit');
        for(const [pose,view,label]of[['a','face','face'],['idle','side','side'],['idle','back','back'],['joints','front','joints'],['idle','game','game']]){await page.locator(`[data-pose="${pose}"]`).click();await page.locator(`[data-view="${view}"]`).click();await page.waitForTimeout(140);await page.screenshot({path:path.join(out,`${spec.id}-${body}-${label}-v1.png`),fullPage:!!spec.isMobile});}
        await page.locator('[data-surface="uv"]').click();await page.locator('[data-view="front"]').click();await page.waitForTimeout(100);assert(await page.evaluate(()=>__characterLab.active.meshes.every(m=>m.material===__characterLab.active.meshes[0].material)),'UV checker did not apply');
        await page.screenshot({path:path.join(out,`${spec.id}-${body}-uv-v1.png`),fullPage:!!spec.isMobile});await page.locator('[data-surface="paint"]').click();
        await page.locator('#concept').click();await page.waitForFunction(()=>document.querySelector('#reference-image').complete&&document.querySelector('#reference-image').naturalWidth>1000);await page.locator('#close-reference').click();
        Object.assign(bodyResult,{checkerApplied:true,conceptLoaded:true});
      }
      // Verify the old assets remain selectable, then exercise a burst of overlapping requests.
      await page.locator('[data-version="v0"]').click();await page.waitForFunction(()=>__characterLab.state.loaded&&__characterLab.active.version==='v0');
      assert(await page.locator('#surface-controls').isHidden(),'v0 advertises unsupported UV');
      await page.evaluate(()=>{document.querySelector('[data-version="v1"]').click();document.querySelector('[data-body="male"]').click();document.querySelector('[data-version="v0"]').click();document.querySelector('[data-body="female"]').click();document.querySelector('[data-version="v1"]').click();document.querySelector('[data-body="male"]').click();});
      await page.waitForFunction(()=>__characterLab.state.loaded&&__characterLab.state.body==='male'&&__characterLab.active.kind==='male'&&__characterLab.active.version==='v1');
      assert(await page.locator('#download').getAttribute('href')===(await page.evaluate(()=>__characterLab.active.assetUrl)),'Download mismatch after burst');
      result.comparisonAndRapidSwitchPassed=true;await page.waitForLoadState('networkidle');
      assert(!errors.length&&!consoleErrors.length&&!requestFailures.length,'Browser/console/network errors');
      const v1=requests.filter(url=>url.includes('base-v1/'));assert(v1.length>=2&&v1.every(url=>spec.size===512?url.endsWith('-mobile.glb'):!url.endsWith('-mobile.glb')),'Fetched an incorrect device variant');
    }catch(error){evidence.failures.push({viewport:spec.id,message:error.message});}
    finally{evidence.cases.push(result);await context.close();}
  }
}finally{await browser.close();}
await fs.writeFile(path.join(out,'browser-evidence-v1.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({cases:evidence.cases.length,bodies:evidence.cases.reduce((n,c)=>n+c.bodies.length,0),failures:evidence.failures,poseStretch:evidence.cases.map(c=>({viewport:c.id,bodies:c.bodies.map(b=>({body:b.body,poses:b.poses}))}))}));if(evidence.failures.length)process.exitCode=1;
