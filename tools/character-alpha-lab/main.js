const MANIFEST_URL = '/docs/art/source/character-alpha-v1/manifest.json';
const CATEGORIES = ['hair', 'eyes', 'brows', 'mouth', 'beard', 'top', 'bottom', 'boots', 'gloves', 'harness', 'goggles', 'pouch', 'rope'];
const DRAW_ORDER = ['bottom', 'boots', 'top', 'gloves', 'harness', 'eyes', 'brows', 'mouth', 'beard', 'hair', 'goggles', 'pouch', 'rope'];
const LABELS = { top:'Camisa', bottom:'Pantalón', boots:'Botas', gloves:'Guantes', harness:'Arnés y cinturón', hair:'Cabello', eyes:'Ojos', brows:'Cejas', mouth:'Boca', beard:'Barba', goggles:'Gafas', pouch:'Bolsa', rope:'Cuerda' };
const canvas = document.querySelector('#character'), ctx = canvas.getContext('2d');
const $ = (selector) => document.querySelector(selector);
const state = { manifest:null, bodyId:null, mode:'master', backdrop:'scene', backgroundId:null, zoom:'full', selections:Object.fromEntries(CATEGORIES.map((key)=>[key,null])), images:new Map(), thumbnails:new Map(), generation:0, renderReady:false, composedSnapshot:null };
const status = $('#status');
const exportButtons = [$('#export-png'), $('#export-json')];

function showError(message) { status.textContent = message; $('#load-state').textContent = 'CATÁLOGO NO DISPONIBLE'; $('#asset-note').textContent = 'No se pudieron cargar las ilustraciones'; }
function abs(url) { return new URL(url, location.origin).href; }
function loadImage(url) {
  const key = abs(url);
  if (state.images.has(key)) return state.images.get(key);
  const promise = new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(`No se pudo cargar ${url}`)); image.src = key; });
  state.images.set(key, promise);
  return promise;
}
function body() { return state.manifest.bodies.find((item)=>item.id===state.bodyId) ?? state.manifest.bodies[0]; }
function imageQuality() { return matchMedia('(max-width: 700px)').matches ? 'mobile' : 'desktop'; }
function assetUrl(asset) { return imageQuality()==='mobile'&&asset.mobileUrl ? asset.mobileUrl : asset.url; }
function drawImageRect(image, rect, sourceRect, sourceSize, destination=ctx) {
  const [x,y,w,h]=rect??[0,0,1,1], dx=x*canvas.width,dy=y*canvas.height,dw=w*canvas.width,dh=h*canvas.height;
  if(sourceRect){const [sx,sy,sw,sh]=sourceRect,scaleX=image.naturalWidth/(sourceSize?.[0]??image.naturalWidth),scaleY=image.naturalHeight/(sourceSize?.[1]??image.naturalHeight);destination.drawImage(image,sx*scaleX,sy*scaleY,sw*scaleX,sh*scaleY,dx,dy,dw,dh);}
  else destination.drawImage(image,dx,dy,dw,dh);
}
function snapshot(selectedBody=body()) { return {bodyId:selectedBody.id,bodyLabel:selectedBody.label,mode:state.mode,selections:{...state.selections},backdrop:state.backdrop,backgroundId:state.backdrop==='scene'?state.backgroundId:null,quality:imageQuality(),mobileFallback:imageQuality()==='mobile'&&mobileFallback(selectedBody)}; }
function mobileFallback(selectedBody) { const assets=[state.mode==='master'?selectedBody.master:selectedBody.base,...CATEGORIES.map((category)=>selectedBody.layers?.[category]?.find((item)=>item.id===state.selections[category])).filter(Boolean)];if(state.backdrop==='scene')assets.push(state.manifest.backgrounds?.find((item)=>item.id===state.backgroundId));return assets.some((asset)=>asset?.url&&!asset.mobileUrl); }
function setExportReady(ready) { state.renderReady=ready;for(const button of exportButtons)button.disabled=!ready; }

async function render() {
  if (!state.manifest) return;
  const generation=++state.generation, selectedBody=body(), output=snapshot(selectedBody);
  setExportReady(false);state.composedSnapshot=null;
  status.textContent='Componiendo ilustración…';
  try {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if (state.mode==='master') {
      const image=await loadImage(assetUrl(selectedBody.master));
      if(generation!==state.generation)return;
      drawImageRect(image);
    } else {
      const base=await loadImage(assetUrl(selectedBody.base));
      if(generation!==state.generation)return;
      drawImageRect(base);
      for (const category of DRAW_ORDER) {
        const option=selectedBody.layers?.[category]?.find((item)=>item.id===state.selections[category]);
        if(option?.url) {
          const image=await loadImage(assetUrl(option)); if(generation!==state.generation)return;
          if(option.mask==='base') {
            const layer=document.createElement('canvas');layer.width=canvas.width;layer.height=canvas.height;
            const layerContext=layer.getContext('2d');
            drawImageRect(image,option.rect,option.sourceRect,[option.width,option.height],layerContext);
            layerContext.globalCompositeOperation='destination-in';drawImageRect(base,null,null,null,layerContext);
            ctx.drawImage(layer,0,0);
          } else drawImageRect(image,option.rect,option.sourceRect,[option.width,option.height]);
        }
      }
    }
    if(generation!==state.generation)return;
    status.textContent=''; $('#load-state').textContent='CATÁLOGO LISTO';
    $('#asset-note').textContent=state.mode==='master'?'Preset ilustrado generado':`Composición modular · ${Object.values(state.selections).filter(Boolean).length} piezas activas`;
    $('#stage-name').textContent=selectedBody.label;
    state.composedSnapshot=output;setExportReady(true);
  } catch(error) { if(generation===state.generation) showError(`Error de carga: ${error.message}`); }
}

async function thumbnail(asset) {
  const url=assetUrl(asset),sourceRect=asset.sourceRect,sourceSize=[asset.width,asset.height];const key=`${url}|${sourceRect?.join(',')??''}`;
  if(state.thumbnails.has(key))return state.thumbnails.get(key);
  const image=await loadImage(url);let sx=0,sy=0,sw=image.naturalWidth,sh=image.naturalHeight;
  if(sourceRect){const scaleX=image.naturalWidth/(sourceSize[0]||image.naturalWidth),scaleY=image.naturalHeight/(sourceSize[1]||image.naturalHeight);[sx,sy,sw,sh]=sourceRect.map((value,index)=>value*(index%2===0?scaleX:scaleY));}
  else {
    const native=document.createElement('canvas');native.width=image.naturalWidth;native.height=image.naturalHeight;const nx=native.getContext('2d',{willReadFrequently:true});nx.drawImage(image,0,0);
    const pixels=nx.getImageData(0,0,native.width,native.height).data;let left=native.width,top=native.height,right=-1,bottom=-1;
    for(let y=0;y<native.height;y++)for(let x=0;x<native.width;x++)if(pixels[(y*native.width+x)*4+3]>12){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    if(right>=left){sx=left;sy=top;sw=right-left+1;sh=bottom-top+1;}
  }
  const c=document.createElement('canvas');c.width=96;c.height=96;const x=c.getContext('2d');const pad=4,fit=Math.min(88/(sw+pad*2),88/(sh+pad*2)),outW=sw*fit,outH=sh*fit;x.drawImage(image,sx,sy,sw,sh,(96-outW)/2,(96-outH)/2,outW,outH);
  const result=c.toDataURL('image/png');state.thumbnails.set(key,result);return result;
}

function setMode(mode) { state.mode=mode; document.querySelectorAll('[data-mode]').forEach((button)=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode))); render(); }
async function renderParts() {
  const root=$('#parts');root.replaceChildren();const selected=body();
  for(const category of CATEGORIES){
    const options=selected.layers?.[category]??[];
    const section=document.createElement('section');section.className='part-group';section.dataset.category=category;
    const header=document.createElement('div');header.className='part-head';const title=document.createElement('h3');title.textContent=LABELS[category];const count=document.createElement('small');count.textContent=`${options.length} opciones`;header.append(title,count);section.append(header);
    if(!options.length){const empty=document.createElement('div');empty.className='empty-message';empty.textContent='Sin piezas en este cuerpo';section.append(empty);root.append(section);continue;}
    const grid=document.createElement('div');grid.className='choices';
    const none=makeChoice(category,null,'Ninguno',null);grid.append(none);
    for(const option of options){const choice=makeChoice(category,option.id,option.label,option);grid.append(choice);}
    section.append(grid);root.append(section);
  }
}
function normalizeSelections(selected=body()) { for(const category of CATEGORIES){if(!selected.layers?.[category]?.some((item)=>item.id===state.selections[category]))state.selections[category]=null;} }
function applyDefaults(selected=body()) { state.selections=Object.fromEntries(CATEGORIES.map((category)=>[category,selected.defaults?.[category]??null]));normalizeSelections(selected); }
function makeChoice(category,id,label,asset) {
  const button=document.createElement('button');button.className='choice';button.type='button';button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(state.selections[category]===id));
  if(asset?.url){const img=document.createElement('img');img.alt='';img.loading='lazy';thumbnail(asset).then((src)=>{img.src=src;}).catch(()=>{img.alt='Vista previa no disponible';});button.append(img);}else{const thumb=document.createElement('span');thumb.className='empty-thumb';thumb.textContent='—';button.append(thumb);}
  const caption=document.createElement('span');caption.textContent=label;button.append(caption);
  button.addEventListener('click',()=>{const section=button.closest('.part-group');const category=section.dataset.category;state.selections[category]=id;section.querySelectorAll('.choice').forEach((choice)=>choice.setAttribute('aria-pressed',String(choice===button)));setMode('modular');});
  return button;
}

function buildBackgrounds() {
  const root=$('#backgrounds');root.replaceChildren();
  for(const item of state.manifest.backgrounds){const button=document.createElement('button');button.className='background-choice';button.type='button';button.setAttribute('aria-pressed',String(item.id===state.backgroundId));
    const img=document.createElement('img');img.alt='';img.src=abs(assetUrl(item));img.onerror=()=>{img.remove();};const label=document.createElement('span');label.textContent=item.label;button.append(img,label);
    button.addEventListener('click',()=>{state.backgroundId=item.id;root.querySelectorAll('button').forEach((b)=>b.setAttribute('aria-pressed',String(b===button)));state.backdrop='scene';syncBackdrop();render();});root.append(button);}
}
function syncBackdrop(){document.querySelectorAll('[data-backdrop]').forEach((button)=>button.setAttribute('aria-pressed',String(button.dataset.backdrop===state.backdrop)));const artboard=$('#artboard');artboard.classList.toggle('backdrop-checker',state.backdrop==='checker');artboard.classList.toggle('backdrop-dark',state.backdrop==='dark');const background=state.manifest?.backgrounds?.find((item)=>item.id===state.backgroundId);artboard.style.backgroundImage=state.backdrop==='scene'&&background?.url?`linear-gradient(#14232b44,#14232b44),url("${abs(assetUrl(background))}")`:'';artboard.style.backgroundSize=state.backdrop==='scene'?'cover':'';artboard.style.backgroundPosition='center';document.body.style.setProperty('--harbor-scene',background?.url?`url("${abs(assetUrl(background))}")`:'none');}

function initialize() {
  const manifest=state.manifest;
  if(!manifest?.bodies?.length)throw new Error('El manifiesto no contiene cuerpos ilustrados.');
  canvas.width=Number(manifest.canvas?.width)||1024;canvas.height=Number(manifest.canvas?.height)||1536;
  state.bodyId=manifest.bodies[0].id;state.backgroundId=manifest.backgrounds?.[0]?.id??null;
  const select=$('#body-select');select.replaceChildren();for(const item of manifest.bodies){const option=document.createElement('option');option.value=item.id;option.textContent=item.label;select.append(option);}select.value=state.bodyId;
  applyDefaults();select.addEventListener('change',()=>{state.bodyId=select.value;applyDefaults();renderParts();render();});
  document.querySelectorAll('[data-mode]').forEach((button)=>button.addEventListener('click',()=>setMode(button.dataset.mode)));
  document.querySelectorAll('[data-zoom]').forEach((button)=>button.addEventListener('click',()=>{state.zoom=button.dataset.zoom;document.querySelectorAll('[data-zoom]').forEach((b)=>b.setAttribute('aria-pressed',String(b===button)));$('#artboard').classList.toggle('zoom-face',state.zoom==='face');}));
  document.querySelectorAll('[data-backdrop]').forEach((button)=>button.addEventListener('click',()=>{state.backdrop=button.dataset.backdrop;syncBackdrop();render();}));
  $('#reset').addEventListener('click',()=>{applyDefaults();setMode('modular');renderParts();});
  $('#shuffle').addEventListener('click',()=>{for(const category of CATEGORIES){const choices=body().layers?.[category]??[];state.selections[category]=choices.length?choices[Math.floor(Math.random()*choices.length)].id:null;}setMode('modular');renderParts();});
  $('#export-png').addEventListener('click',()=>downloadPng());$('#export-json').addEventListener('click',downloadDescriptor);
  buildBackgrounds();syncBackdrop();renderParts();$('#asset-note').textContent=`${manifest.bodies.length} bases · ${manifest.backgrounds?.length??0} fondos`;render();
}
function makeExportCanvas() {
  const exportCanvas=document.createElement('canvas');exportCanvas.width=canvas.width;exportCanvas.height=canvas.height;exportCanvas.getContext('2d').drawImage(canvas,0,0);return exportCanvas;
}
function downloadPng(){if(!state.renderReady||!state.composedSnapshot)return;const out=makeExportCanvas(),composed=state.composedSnapshot;out.toBlob((blob)=>{if(!blob){showError('No se pudo crear el PNG.');return;}const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`explorador-${composed.bodyId}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);},'image/png');}
function downloadDescriptor(){if(!state.renderReady||!state.composedSnapshot)return;const composed=state.composedSnapshot,descriptor={schema:state.manifest.schema,scope:'local-visual-preview',reference:state.manifest.reference,bodyId:composed.bodyId,mode:composed.mode,quality:composed.quality,mobileFallback:composed.mobileFallback,backgroundId:composed.backgroundId,backdrop:composed.backdrop,parts:composed.mode==='modular'?composed.selections:null,createdAt:new Date().toISOString()};const blob=new Blob([JSON.stringify(descriptor,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`explorador-${composed.bodyId}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}

fetch(MANIFEST_URL).then((response)=>{if(!response.ok)throw new Error(`HTTP ${response.status} al leer el manifiesto`);return response.json();}).then((manifest)=>{state.manifest=manifest;status.textContent='';initialize();}).catch((error)=>showError(`No se pudo abrir el catálogo: ${error.message}`));
