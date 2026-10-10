// Browser acceptance of actual panels using local profiles and explicit protocol fixtures.
// This checks presentation/input; durable store/host acceptance lives in artisan-* tests.
import http from 'node:http';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd(), out = resolve('docs/delivery/prg01c-artisan/ui');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.MN_PLAYWRIGHT
  || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs')).href);
const fixture = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles/vars.css"><link rel="stylesheet" href="/styles/hud.css">
<link rel="stylesheet" href="/styles/raft-editor.css"><link rel="stylesheet" href="/styles/workbench.css"><link rel="stylesheet" href="/styles/community.css"><link rel="stylesheet" href="/styles/artisan.css">
<style>body{margin:0;background:linear-gradient(130deg,#294b50,#193a47);font-family:system-ui}#stage{position:relative;container:stage/size;width:100vw;height:100vh}canvas{width:100%;height:100%}#ui{position:absolute;inset:0;pointer-events:none}*{transition:none!important}</style>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<div id="stage"><canvas id="qa-canvas" tabindex="0"></canvas><div id="ui"></div></div><script type="module">
import * as THREE from 'three';
import { ArtisanPanel } from '/src/ui/artisan.js';
import { CommunityPanel } from '/src/ui/community.js';
import { RaftEditor } from '/src/ui/raftEditor.js';
import { WorkbenchPanel } from '/src/ui/workbench.js';
import { newProfile } from '/src/sim/systems/inventory.js';
const profile=newProfile(), ship=profile.eco.ships.find(s=>s.kind==='raft');
ship.id='qa:raft'; ship.rev=1; ship.grid.parts=[['foundation',0,0,0,0],['foundation',1,0,0,0],['foundation',2,0,0,0],['crate',0,0,0,0],['crate',1,0,0,0]];
ship.hold={cap:12,goods:{madera:4}};
const parent=document.querySelector('#ui'), requests=[];
let project={id:'salty-shore-carpentry',version:7,requirements:{madera:4,piedra:2},contributed:{madera:4,piedra:2},complete:true};
const bench={x:0,y:0,z:0}, player={x:0,y:0,z:0,dead:false};
const workbench=new WorkbenchPanel({parent,profile:()=>profile,player:()=>player,bench:()=>bench,enabled:()=>true,blocked:()=>false,submit(command){requests.push(command);return true;},onContext(active){if(active){artisan?.close();community?.close();}}});
let community,artisan;
community=new CommunityPanel({parent,profile:()=>profile,context:()=>workbench.context(),enabled:()=>true,submit(command){requests.push(command);return true;},onContext(active){if(active)workbench.close();}});
artisan=new ArtisanPanel({parent,profile:()=>profile,context:()=>workbench.context(),enabled:()=>true,getLocale:()=>document.documentElement.lang,
  submit(command){requests.push(command); if(command.op==='list')queueMicrotask(()=>artisan.onResult({type:'artisan',op:'list',opId:command.opId,ok:true,project,durable:true,rev:profile.eco.tradeRev}));return true;},
  onContext(active){if(active){workbench.close();community.close();}else document.querySelector('#qa-canvas').focus({preventScroll:true});}});
const communityTrigger=document.createElement('button');communityTrigger.type='button';communityTrigger.className='community-trigger';communityTrigger.textContent='Obra comunitaria';communityTrigger.setAttribute('aria-label','Consultar y aportar a la obra comunitaria');communityTrigger.addEventListener('click',()=>community.active?community.close():community.open());workbench.$('.wb-head').appendChild(communityTrigger);
const artisanTrigger=document.createElement('button');artisanTrigger.type='button';artisanTrigger.className='community-trigger';artisanTrigger.textContent='Visitar artesano';artisanTrigger.addEventListener('click',()=>artisan.open());workbench.$('.wb-head').appendChild(artisanTrigger);
const record={id:ship.id,owner:1,x:0,y:.72,z:0,yaw:0,rev:ship.rev,parts:ship.grid.parts};
const editor=new RaftEditor({parent,scene:new THREE.Scene(),canvas:document.querySelector('canvas'),camera:new THREE.PerspectiveCamera(),profile:()=>profile,
  rafts:()=>[record],youServer:()=>1,player:()=>({x:0,y:.72,z:0,dead:false}),send:m=>requests.push(m),enabled:()=>true});
editor.context=()=>({profile,ship,record,player:{x:0,y:.72,z:0,dead:false}});
window.qa={artisan,community,workbench,communityTrigger,artisanTrigger,editor,canvas:document.querySelector('#qa-canvas'),profile,ship,record,requests,async set(lang,practice,known=false,complete=true){
  artisan.reset();editor.close();document.documentElement.lang=lang;
  profile.progression={v:1,practice:{logging:practice},milestones:practice>=60?['logging_steady']:[],knowledge:known?['raft_storage']:[]};
  profile.eco.pack.goods={madera:2};project={...project,contributed:{madera:complete?4:2,piedra:2},complete};
  artisan.open();await Promise.resolve();artisan.update();
},showEditor(){artisan.close();editor.toggle();editor.selected='storage';editor.target={x:2,z:0,level:0,dir:0};editor.render();},openWorkbench(lang){document.documentElement.lang=lang;artisanTrigger.textContent=lang.startsWith('en')?'Visit artisan':'Visitar artesano';artisan.close();community.close();editor.close();communityTrigger.hidden=false;artisanTrigger.hidden=false;return workbench.open();}};
await window.qa.set('es',60);
</script></html>`;
const server = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/fixture') { res.setHeader('content-type','text/html; charset=utf-8'); res.end(fixture); return; }
  const file = resolve(root, '.' + decodeURIComponent(path));
  if (!file.startsWith(root + sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('content-type', ({'.js':'text/javascript','.css':'text/css'})[extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise(done => server.listen(0,'127.0.0.1',done));
const browser = await chromium.launch({channel:'chrome',headless:true});
const report={scope:'Actual ArtisanPanel/RaftEditor with local profile/protocol fixtures; no live host or physical phone',checks:[]};
try {
  for (const [device,viewport] of Object.entries({desktop:{width:1280,height:720},compact:{width:390,height:844},landscape:{width:844,height:390}})) {
    const page=await browser.newPage({viewport,isMobile:device!=='desktop',hasTouch:device!=='desktop'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');await page.waitForFunction(()=>window.qa?.artisan);
    for(const locale of ['es','en']) {
      for(const [state,practice,known,complete] of [['locked',30,false,true],['project',60,false,false],['ready',60,false,true],['known',70,true,true]]) {
        await page.evaluate(args=>window.qa.set(...args),[locale,practice,known,complete]);
        const check=await page.evaluate(()=>{const r=document.querySelector('.artisan-panel'),b=r.getBoundingClientRect();return {
          text:r.textContent.replace(/\s+/g,' ').trim(),enabled:!r.querySelector('[data-learn]').disabled,
          fits:b.left>=0&&b.top>=0&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1,noOverflow:r.scrollWidth<=r.clientWidth+1,
          specCards:r.querySelectorAll('[data-spec]').length};});
        if(!check.fits||!check.noOverflow||check.enabled!==(state==='ready')||check.specCards!==1||errors.length)throw Error(JSON.stringify({device,locale,state,check,errors}));
        const screenshot=device+'-'+locale+'-'+state+'.png';await page.screenshot({path:resolve(out,screenshot)});
        report.checks.push({device,locale,state,...check,screenshot});
      }
      await page.evaluate(()=>{window.qa.profile.eco.pack.goods={madera:2};window.qa.profile.progression.knowledge=[];window.qa.showEditor();});
      const locked=await page.evaluate(()=>({disabled:document.querySelector('.re-action').disabled,text:document.querySelector('.re-shelter-help').textContent}));
      if(!locked.disabled)throw Error('Storage must remain locked before teaching');
      await page.evaluate(()=>{window.qa.profile.progression.knowledge=['raft_storage'];window.qa.ship.hold.goods={madera:4};window.qa.editor.update();});
      const learned=await page.evaluate(()=>({disabled:document.querySelector('.re-action').disabled,text:document.querySelector('.re-shelter-help').textContent,undefinedIcon:document.querySelector('[data-part="storage"]').textContent.includes('undefined')}));
      if(learned.disabled||learned.undefinedIcon||errors.length)throw Error(JSON.stringify({device,locale,learned,errors}));
      const screenshot=device+'-'+locale+'-storage.png';await page.screenshot({path:resolve(out,screenshot)});
      report.checks.push({device,locale,state:'storage',locked,learned,screenshot});
    }
    if (device === 'compact' || device === 'landscape') {
      const locale=device==='compact'?'es':'en';
      await page.evaluate(lang=>window.qa.openWorkbench(lang),locale);
      const header=await page.evaluate(()=>{
        const h=document.querySelector('.wb-head'),r=h.getBoundingClientRect(),heading=h.querySelector('.wb-heading').getBoundingClientRect();
        const controls=[...h.querySelectorAll('.community-trigger')].map(b=>{const x=b.getBoundingClientRect();return {label:b.getAttribute('aria-label')||b.textContent.trim(),text:b.textContent.trim(),left:x.left,top:x.top,right:x.right,bottom:x.bottom,width:x.width,height:x.height,visible:!b.hidden};});
        const close=h.querySelector('.wb-close').getBoundingClientRect();
        return {rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},scrollWidth:h.scrollWidth,clientWidth:h.clientWidth,
          heading:{left:heading.left,right:heading.right,width:heading.width},close:{left:close.left,right:close.right},controls};
      });
      const fit=header.scrollWidth<=header.clientWidth+1 && header.heading.width>0 && header.heading.right<=header.close.left+1
        && header.controls.length===2 && header.controls.every(c=>c.visible&&c.label&&c.text&&c.width>=110&&c.height>=32
          && c.left>=header.rect.left&&c.right<=header.rect.right+1&&c.top>=header.rect.top&&c.bottom<=header.rect.bottom+1)
        && Math.abs(header.controls[0].top-header.controls[1].top)<=1
        && header.controls[0].right<=header.controls[1].left+1;
      if(!fit)throw Error(JSON.stringify({device,locale,header,errors}));
      const screenshot=device+'-'+locale+'-workbench-triggers.png';await page.screenshot({path:resolve(out,screenshot)});
      await page.locator('.wb-head .community-trigger').nth(1).focus();await page.keyboard.press('Enter');
      const switchedToArtisan=await page.evaluate(()=>({workbench:window.qa.workbench.active,artisan:window.qa.artisan.active,
        visible:!window.qa.artisan.root.hidden,focusedClose:document.activeElement===window.qa.artisan.$('[data-close]')}));
      if(switchedToArtisan.workbench||!switchedToArtisan.artisan||!switchedToArtisan.visible||!switchedToArtisan.focusedClose)throw Error(JSON.stringify({device,switchedToArtisan,errors}));
      await page.keyboard.press('Escape');
      const artisanClosed=await page.evaluate(()=>({closed:!window.qa.artisan.active&&window.qa.artisan.root.hidden,
        focusRestoredToOpener:document.activeElement===window.qa.artisanTrigger,
        focusOnCanvas:document.activeElement===window.qa.canvas,
        focusRemainsInsideHiddenArtisan:window.qa.artisan.root.contains(document.activeElement)}));
      if(!artisanClosed.closed||!artisanClosed.focusOnCanvas||artisanClosed.focusRemainsInsideHiddenArtisan)throw Error(JSON.stringify({device,artisanClosed,errors}));
      await page.evaluate(lang=>window.qa.openWorkbench(lang),locale);
      await page.locator('.wb-head .community-trigger').nth(0).focus();await page.keyboard.press('Enter');
      const switchedToCommunity=await page.evaluate(()=>({workbench:window.qa.workbench.active,community:window.qa.community.active,visible:!window.qa.community.root.hidden}));
      if(switchedToCommunity.workbench||!switchedToCommunity.community||!switchedToCommunity.visible||errors.length)throw Error(JSON.stringify({device,switchedToCommunity,errors}));
      await page.locator('.community-panel [data-close]').click();
      const communityClosed=await page.evaluate(()=>!window.qa.community.active&&window.qa.community.root.hidden);
      if(!communityClosed||errors.length)throw Error(JSON.stringify({device,communityClosed,errors}));
      report.checks.push({device,locale,state:'workbench-trigger-integration',header,fit,switchedToArtisan,artisanClosed,switchedToCommunity,communityClosed,screenshot});
    }
    await page.close();
  }
  await writeFile(resolve(out,'evidence.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({checks:report.checks.length,out}));
} finally {await browser.close();await new Promise(done=>server.close(done));}
