// Build the local author-facing reference gallery without modifying source art or runtime assets.
import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalog=JSON.parse(await readFile(path.join(root,'docs/art/items-index.json'),'utf8'));
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cards=[];
const groups=[...new Set(catalog.items.map(item=>item.group))];
for(const item of catalog.items){
 await access(path.join(root,item.reference));
 const files=await readdir(path.join(root,item.intake));
 const received=files.filter(name=>/\.(glb|gltf|fbx|obj|blend|zip)$/i.test(name));
 const status=received.length && !item.modelStatus.includes('optimizado')?`${received.length} entrega(s) recibida(s), por revisar`:item.modelStatus;
 cards.push(`<article data-group="${escape(item.group)}" data-search="${escape(item.label+' '+item.id).toLowerCase()}">
 <a class="image" href="${escape(item.reference)}"><img src="${escape(item.reference)}" alt="${escape(item.label)}" loading="lazy"></a>
 <div class="body"><span class="tag">${escape(item.group)}</span><h2>${escape(item.label)}</h2>
 <p class="status">${escape(item.iconStatus)} · ${escape(status)}</p><p>${escape(item.notes)}</p>
 <a class="button" href="${escape(item.reference)}" download="${escape(item.id)}-reference.png">PNG para Tripo</a>
 <a class="button secondary" href="${escape(item.intake)}/README.md">Dónde entregar</a>
 <code>${escape(item.intake)}/${escape(item.model)}</code>
 ${received.length?`<ul>${received.map(name=>`<li><a href="${escape(item.intake+'/'+name)}">${escape(name)}</a></li>`).join('')}</ul>`:''}
 </div></article>`);
}
const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Arte y modelos · Marea Negra</title><style>
:root{color-scheme:dark;font:16px/1.5 system-ui,sans-serif;background:#0a1420;color:#edf3f9}*{box-sizing:border-box}body{margin:0}main{max-width:1360px;margin:auto;padding:32px 24px 64px}h1{font-size:clamp(30px,5vw,48px);line-height:1.1;margin:0 0 16px}header p{max-width:850px;color:#b9c9d9}a{color:#9ed2ff}nav{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}.notice{background:#162b40;border-left:4px solid #f4af44;padding:14px 18px;border-radius:6px}.controls{display:flex;gap:12px;flex-wrap:wrap;margin:26px 0}input,select{font:inherit;padding:11px 14px;border:1px solid #426079;border-radius:6px;background:#112338;color:inherit}input{flex:1;min-width:180px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:20px}article{border:1px solid #30485d;background:#102033;border-radius:10px;overflow:hidden}article[hidden]{display:none}.image{display:flex;height:220px;align-items:center;justify-content:center;background:radial-gradient(ellipse,#304459,#14253a)}img{max-height:200px;max-width:90%;object-fit:contain}.body{padding:18px}h2{margin:8px 0;font-size:23px}.body p{font-size:14px;color:#b9c9d9}.tag{color:#ffd18a;text-transform:uppercase;font-size:11px;letter-spacing:.1em;font-weight:700}.status{color:#d3e6f8!important}.button{display:inline-block;text-decoration:none;background:#f4af44;color:#172332;font-weight:700;padding:9px 12px;border-radius:5px;margin:3px 4px 8px 0;font-size:14px}.secondary{background:#27435d;color:#d8ebff}code{display:block;font-size:12px;color:#90adc7;overflow-wrap:anywhere;padding-top:9px}.small{font-size:13px;color:#a7bed2}.count{margin:0 0 15px;color:#a7bed2}footer{margin-top:32px;border-top:1px solid #30485d;padding-top:20px;color:#a7bed2}
</style></head><body><main><header><p class="tag">Marea Negra · mesa de trabajo del autor</p><h1>Arte, referencias y modelos</h1>
<p>Un objeto, una referencia elegida y una carpeta de entrega. Aquí están las 17 piezas de supervivencia y cocina; antorcha, resina y coco aparecen una sola vez.</p>
<div class="notice"><strong>Originales y versiones del juego:</strong> cada tarjeta muestra la referencia, la entrega fuente y su estado. Guarda nuevas versiones de antorcha, resina y coco en <code>docs/art/source/torch-resin-coconut-v1/{antorcha,resina,coco}/</code> Los originales se conservan fuera del juego.</div>
<nav><a href="docs/art/ITEMS.md">Guía y cola de modelos</a><a href="docs/art/cooking-icons-v1/cooking-tripo-pack-v1.zip">ZIP de cocina</a><a href="docs/art/torch-resin-coconut-v1/tripo-and-icons.zip">ZIP antorcha, resina y coco</a><a href="docs/art/tripo-items-v1.md">Herramientas, armas y ropa</a><a href="docs/art/README.md">Terreno, pueblo y otros packs</a></nav>
<p class="small">Los PNG tienen transparencia. Sube a Tripo un objeto individual; las propuestas todavía no son recetas del juego. Una referencia o un icono terminado no significa que el mesh esté integrado.</p></header>
<div class="controls"><input id="search" type="search" placeholder="Buscar objeto…" aria-label="Buscar objeto"><select id="group" aria-label="Filtrar grupo"><option value="">Todos los grupos</option>${groups.map(group=>`<option>${escape(group)}</option>`).join('')}</select></div>
<p class="count" id="count"></p><section class="grid">${cards.join('\n')}</section>
<footer>Para otra versión: <code>antorcha-v2.glb · resina-v2.glb · coco-v2.glb</code> Si Tripo exporta otro nombre, déjalo tal cual. Conserva también el ZIP/texturas que acompañen la entrega. Actualizar esta galería: <code>node tools/art-catalog/build-items-index.mjs</code></footer>
<script>const search=document.querySelector('#search'),group=document.querySelector('#group'),cards=[...document.querySelectorAll('article')];function filter(){let count=0;for(const card of cards){card.hidden=!(card.dataset.search.includes(search.value.trim().toLowerCase())&&(!group.value||group.value===card.dataset.group));if(!card.hidden)count++}document.querySelector('#count').textContent=count+' de '+cards.length+' objetos'}search.addEventListener('input',filter);group.addEventListener('change',filter);filter();</script></main></body></html>\n`;
await writeFile(path.join(root,'ARTE-Y-MODELOS.html'),html.replace(/[ \t]+$/gm,''));
console.log(JSON.stringify({references:cards.length,gallery:'ARTE-Y-MODELOS.html'}));
