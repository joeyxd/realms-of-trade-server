// Add prepared appearance studies with catalog-wide CAS; never change existing asset rows.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),file=path.join(root,'tools/art-catalog/catalog.json');
const source='docs/art/source/character-appearance-v1',qa='docs/art/character-appearance-v1';
const sources=['hair.mjs','face.mjs','assemble.mjs','glb.mjs','generate.mjs','inspect.mjs'];
const desired=['male','female'].map(kind=>({
  id:`char-appearance-${kind}-v1`,name:kind==='male'?'Apariencia masculina v1':'Apariencia femenina v1',
  category:'Personajes modulares',priority:'P0',kind:'model',state:'prepared',
  description:'Ensayo P03a de cabello, barba, ojos y cejas intercambiables sobre v3, con descarga del montaje local.',
  variants:['escritorio','móvil','módulos'],destination:['src/render/characters.js','src/render/assets/manifest.js'],
  nextStep:'Refinar el acabado artístico P02/P03 y preparar prendas/sockets P04 antes de la integración.',
  notes:'Geometría opaca propia, piezas rígidas al hueso head; fuentes v3 intactas. Sin identidad guardada, equipo autoritativo ni aceptación de rendimiento físico.',
  references:[
    {label:'Selección en el visor',path:`${qa}/desktop-${kind}-selected-face.png`,role:'preview'},
    {label:'Concepto de la base',path:`docs/art/source/characters-base-v0/${kind}-concept-v1.png`,role:'reference'},
    {label:'Plan del creador · snapshot P03a',path:`${source}/plan-snapshot-v5.md`,role:'reference'},
  ],
  files:[
    {label:'Montaje inicial · escritorio',path:`${source}/${kind}-appearance-v1.glb`,role:'model'},
    {label:'Montaje inicial · móvil',path:`${source}/${kind}-appearance-v1-mobile.glb`,role:'mobile'},
    ...Object.entries({hair:['scout','swept','pony','crop'],beard:['stubble','full'],eyes:['neutral','keen','soft'],brows:['natural','bold','arched']}).flatMap(([family,ids])=>ids.map(id=>({label:`Pieza ${family} · ${id}`,path:`${source}/${kind}-${family}-${id}-v1.glb`,role:'model'}))),
    ...sources.map(n=>({label:`Fuente editable · ${n}`,path:`${source}/${n}.txt`,role:'source'})),
    {label:'Catálogo de opciones',path:`${source}/appearance-catalog.json`,role:'source'},
    {label:'Recibo de modelos/dependencias',path:`${source}/appearance-receipt.json`,role:'source'},
    {label:'Entrega P03a',path:'docs/delivery/character-appearance-v1.md',role:'evidence'},
  ],
  evidence:[
    {label:'QA navegador',path:`${qa}/browser-evidence-v1.json`,role:'evidence'},
    {label:'Contrato CPU y hashes',path:`${qa}/cpu-evidence-v1.json`,role:'evidence'},
    {label:'Descargas HTTP',path:`${qa}/artifact-evidence-v1.json`,role:'evidence'},
    ...['hair-scout-face','hair-swept-face','hair-pony-face','hair-crop-face','beard-stubble-face','beard-full-face','captain-front','captain-side','captain-back','captain-game','pony-back'].map(view=>({label:`Escritorio · ${view}`,path:`${qa}/desktop-${kind}-${view}.png`,role:'evidence'})),
    {label:'Selección móvil',path:`${qa}/mobile-${kind}-selected-face.png`,role:'evidence'},
  ],
}));
const before=fs.readFileSync(file),catalog=JSON.parse(before),check=process.argv.includes('--check');
const artifacts=new Set(desired.flatMap(row=>['references','files','evidence'].flatMap(key=>row[key].map(a=>a.path))));
for(const artifact of artifacts)if(!fs.existsSync(path.join(root,artifact)))throw new Error(`Missing artifact: ${artifact}`);
let changed=false;const rows=catalog.rows.slice();
for(const row of desired){const old=rows.find(r=>r.id===row.id);if(old){if(JSON.stringify(old)!==JSON.stringify(row))throw new Error(`Existing row differs: ${row.id}`);}else{if(check)throw new Error(`Missing row: ${row.id}`);rows.push(row);changed=true;}}
if(changed){const tmp=`${file}.${process.pid}.appearance.tmp`;try{fs.writeFileSync(tmp,JSON.stringify({...catalog,rows,revision:catalog.revision+1,updatedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});if(!fs.readFileSync(file).equals(before))throw new Error('Catalog changed concurrently');fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.rmSync(tmp);}}
console.log(JSON.stringify({check:check?'ok':'registered',changed,rows:desired.map(r=>r.id),artifacts:artifacts.size}));
