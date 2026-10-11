// Per-body placements are explicit art calibration, not a 3D attachment contract.
import fs from 'node:fs/promises';
const dir='docs/art/source/character-alpha-v1', prefix='/'+dir+'/';
const inspection=JSON.parse(await fs.readFile(dir+'/alpha-inspection.json','utf8'));
const byFile=new Map(inspection.images.map(i=>[i.file,i]));
const usedFiles=new Set();
const asset=(file)=>{const m=byFile.get(file);if(!m)throw Error('Missing inspected source '+file);if(m.transparencyCheck!=='pass')throw Error('Source failed alpha validation: '+file);usedFiles.add(file);return {url:prefix+file,mobileUrl:prefix+'mobile/'+file,width:m.dimensions.width,height:m.dimensions.height,sha256:m.sha256};};
const piece=(id,label,file,target)=>{const m=byFile.get(file);let [x,y,r,b]=m.alphaAbove128BBox;x=Math.max(0,x-3);y=Math.max(0,y-3);r=Math.min(m.dimensions.width,r+3);b=Math.min(m.dimensions.height,b+3);return {id,label,...asset(file),sourceRect:[x,y,r-x,b-y],rect:[target[0]/1024,target[1]/1536,target[2]/1024,target[3]/1536]};};
const male={id:'male',label:'Explorador',base:asset('male-base-v1.png'),master:asset('male-scout-master-v1.png'),defaults:{hair:'scout',eyes:'amber',brows:'scout',mouth:'smile',top:'scout',bottom:'scout',boots:'scout',gloves:'scout',harness:'scout',goggles:'scout',pouch:'scout',rope:'scout'},layers:{
hair:[piece('scout','Explorador','male-hair-scout-v1.png',[390,21,260,225]),piece('swept','Barrido','male-hair-swept-v1.png',[404,18,242,210])],
eyes:[piece('amber','Ámbar','male-eyes-amber-v1.png',[503,134,90,36]),piece('blue','Océano','male-eyes-blue-v2.png',[503,134,90,36])],
brows:[piece('scout','Aventurero','male-brows-scout-v1.png',[500,118,98,29])],
mouth:[piece('smile','Sonrisa','male-mouth-smile-v1.png',[516,183,58,31])],
beard:[{...piece('short','Barba corta','male-beard-short-v2.png',[465,151,125,79]),mask:'base'}],
top:[piece('scout','Camisa marfil','male-shirt-v1.png',[227,241,553,385])],
bottom:[piece('scout','Pantalón remendado','male-breeches-v1.png',[277,602,478,532])],
boots:[piece('scout','Cuero y latón','male-boots-v1.png',[139,1181,745,294])],
gloves:[piece('scout','Guantes de cubierta','scout-gloves-v1.png',[272,574,519,237])],
harness:[piece('scout','Explorador','scout-harness-v1.png',[284,275,390,410])],
goggles:[piece('scout','Gafas de latón','scout-goggles-v1.png',[447,58,198,97])],
pouch:[piece('scout','Bolsa de herramientas','scout-pouch-v1.png',[579,593,107,162])],
rope:[piece('scout','Cuerda marinera','scout-rope-v1.png',[529,619,89,187])]
}};
const female={id:'female',label:'Exploradora',base:asset('female-base-v1.png'),master:asset('female-scout-master-v1.png'),defaults:{...male.defaults,hair:'pony'},layers:{
hair:[piece('pony','Coleta magenta','female-hair-pony-v1.png',[330,5,323,280])],
eyes:[piece('amber','Ámbar','female-eyes-amber-v1.png',[526,146,88,36])],
brows:[piece('scout','Aventurera','female-brows-v1.png',[520,129,96,31])],
mouth:[piece('smile','Sonrisa','female-mouth-smile-v1.png',[537,192,53,29])],
beard:[],
top:[piece('scout','Camisa marfil','female-shirt-v1.png',[252,247,515,355])],
bottom:[piece('scout','Pantalón remendado','female-breeches-v1.png',[304,562,479,576])],
boots:[piece('scout','Cuero y latón','female-boots-v1.png',[174,1178,738,305])],
gloves:[piece('scout','Guantes de cubierta','scout-gloves-v1.png',[285,537,514,274])],
harness:[piece('scout','Explorador','scout-harness-v1.png',[302,273,375,371])],
goggles:[piece('scout','Gafas de latón','scout-goggles-v1.png',[458,63,192,100])],
pouch:[piece('scout','Bolsa de herramientas','scout-pouch-v1.png',[593,558,97,157])],
rope:[piece('scout','Cuerda marinera','scout-rope-v1.png',[537,583,92,187])]
}};
const manifest={schema:'character-alpha-catalog/v1',scope:'Isolated 2D fixed-view visual study; not saved game identity or rigged 3D',reference:'User Horizon Tides creator reference, 2026-10-08; images individually generated with built-in image_gen',canvas:{width:1024,height:1536},backgrounds:[{id:'harbor',label:'Puerto tropical',...asset('harbor-background-v1.png')}],bodies:[male,female]};
await fs.writeFile(dir+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
const receipt={schema:'character-alpha-selected-sources/v1',status:'pass',usedImageCount:usedFiles.size,transparentImageCount:[...usedFiles].filter(f=>!byFile.get(f).expectedOpaque).length,usedBytesTotal:[...usedFiles].reduce((sum,f)=>sum+byFile.get(f).bytes,0),images:[...usedFiles].sort().map(f=>byFile.get(f)),excludedImages:inspection.images.filter(i=>!usedFiles.has(i.file)).map(i=>({file:i.file,sha256:i.sha256,reason:i.file==='male-beard-short-v1.png'?'Rejected dangling jaw outline; replaced by v2, kept as generation evidence':'Rejected alpha; replaced by v2, kept as generation evidence',transparencyCheck:i.transparencyCheck})),visualAcceptance:'Author review pending; technical alpha validity does not mean an exact match to the reference'};
await fs.writeFile(dir+'/selected-sources.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({bodies:manifest.bodies.length,sources:usedFiles.size,archivedAttempts:inspection.images.length,layerOptions:manifest.bodies.map(b=>({id:b.id,count:Object.values(b.layers).reduce((n,items)=>n+items.length,0)}))}));
