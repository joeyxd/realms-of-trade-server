import * as THREE from 'three';
import { PilotParticles, toScene } from './particles.js';
import { NativeSimulation } from './native-simulation.js';
import { SOURCE_PRESET_SHA256 } from './source-identity.js';
import { FILM_SOURCE_SHA256 } from './film-identity.js';
import { createFilmLUT, filmFragment } from './film-color.js';
import { DepthStage } from './depth-stage.js';
import { selectVariant, texturePlan, validateManifest, ATLAS_MANIFEST_SHA256, MOBILE_MEMORY_ACCEPTED } from './atlas-policy.js';
const $ = id => document.getElementById(id);
const state = { ready: false, errors: [] }; window.budgetLab = state;
let cleanup = () => {};
const releases = []; let renderer;
const own = resource => { releases.push(() => resource.dispose()); return resource; };
cleanup = () => { while(releases.length) releases.pop()();
  if(renderer) state.resourcesAfterDispose = {...renderer.info.memory}; };
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2,'0')).join('');
async function bytesAt(path, hash) { const response = await fetch(path); if (!response.ok) throw new Error(`Missing asset: ${path}`);
  const bytes = await response.arrayBuffer(); if (hash && await digest(bytes) !== hash) throw new Error(`Asset hash mismatch: ${path}`); return bytes; }
async function jsonAt(path, hash) { return JSON.parse(new TextDecoder().decode(await bytesAt(path, hash))); }
try {
  const requested = new URLSearchParams(location.search).get('variant') || 'auto';
  const variant = selectVariant(requested, matchMedia('(pointer: coarse)').matches);
  const manifestBytes = await bytesAt('./atlas-manifest.json');
  const manifestText = new TextDecoder().decode(manifestBytes).replaceAll('\r\n','\n');
  if(await digest(new TextEncoder().encode(manifestText)) !== ATLAS_MANIFEST_SHA256) throw new Error('Unreviewed atlas manifest');
  const manifest = validateManifest(JSON.parse(manifestText));
  renderer = own(new THREE.WebGLRenderer({ canvas: $('preview'), antialias: false, preserveDrawingBuffer: true }));
  renderer.setPixelRatio(1); renderer.setSize(512,512,false); renderer.info.autoReset = false;
  const textures = [];
  const selected = texturePlan(manifest, variant, renderer.capabilities.maxTextureSize);
  // Upload only the selected pair; never preload a larger quality or the references.
  for (const row of selected) {
    const bytes = await bytesAt(row.url, row.sha256); if (bytes.byteLength !== row.bytes) throw new Error('Unexpected atlas size');
    const url = URL.createObjectURL(new Blob([bytes])); releases.push(()=>URL.revokeObjectURL(url));
    const texture = own(await new THREE.TextureLoader().loadAsync(url)); textures.push(texture);
    if (texture.image.width !== row.dimensions[0] || texture.image.height !== row.dimensions[1]) throw new Error('Unexpected decoded atlas dimensions');
    texture.colorSpace = THREE.SRGBColorSpace; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
    URL.revokeObjectURL(url);
  }
  const simulation = new NativeSimulation(await jsonAt('./pilot-source.json', SOURCE_PRESET_SHA256));
  const film = createFilmLUT(await jsonAt('./film-source.json', FILM_SOURCE_SHA256));
  own(film.texture);
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-2,2,2,-2,.01,100);
  const center = new THREE.Vector3(...toScene([0,0,100]));
  const positions = { front:[500,0,100], side:[0,500,100], oblique:[332.23151219433737,332.23151219433737,271.0100716628343] };
  const particles = own(new PilotParticles(scene,textures)), depth = own(new DepthStage(512));
  const hdr = own(new THREE.WebGLRenderTarget(512,512,{type:THREE.HalfFloatType,depthBuffer:true}));
  hdr.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const output = new THREE.Scene(), outputCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const uniforms = { image:{value:hdr.texture}, filmLUT:{value:film.texture}, exposure:{value:1} };
  const material = own(new THREE.ShaderMaterial({uniforms,glslVersion:THREE.GLSL3,toneMapped:false,depthTest:false,depthWrite:false,
    vertexShader:'out vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:filmFragment}));
  const quad = new THREE.Mesh(own(new THREE.PlaneGeometry(2,2)),material); output.add(quad);
  let tick=120, view='oblique', bias=0, layer='both', surface='none', cell=false, frame=0, playing=false, previous=0, accumulator=0, raf=0;
  const gl = renderer.getContext(), extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  state.device = { webgl2:renderer.capabilities.isWebGL2, maxTextureSize:renderer.capabilities.maxTextureSize,
    gpuTimerAvailable:!!extension, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  state.requested = requested; state.variant = variant; state.selected = selected;
  state.mobileMemoryAccepted = MOBILE_MEMORY_ACCEPTED;
  function draw() {
    if (state.disposed) return;
    const started = performance.now(), snapshot = simulation.seek(tick);
    state.snapshot = snapshot;
    const rendered = structuredClone(snapshot);
    if (cell) {
      const index = layer === 'smoke' ? 1 : 0;
      rendered.emitters.forEach((e,i) => { e.particles = i !== index ? [] : [{ uniqueId:0, position:[0,0,100],size:[153.806,153.806],
        rotation:0,subImage:Math.min(frame,index ? 59 : 31),color:[1,1,1,1] }]; });
    }
    particles.update(rendered, [layer !== 'smoke', layer !== 'flame']);
    camera.position.set(...toScene(positions[view])); camera.lookAt(center); camera.updateMatrixWorld();
    depth.configure(surface,50,camera,center); renderer.info.reset(); renderer.toneMapping = THREE.NoToneMapping;
    depth.render(renderer,camera,hdr,scene,particles,true); renderer.setRenderTarget(null);
    uniforms.exposure.value = 2**bias; renderer.render(output,outputCamera);
    state.stats = { calls:renderer.info.render.calls, triangles:renderer.info.render.triangles, particles:particles.count,
      textures:renderer.info.memory.textures, atlasDownloadBytes:selected.reduce((n,r)=>n+r.bytes,0),
      atlasMipRgba8Bytes:selected.reduce((n,r)=>n+r.mipRgba8Bytes,0), lutBytes:film.generatedBytes,
      // HDR RGBA16F + depth32; opaque RGBA8 + depth32. Excludes driver/canvas overhead.
      targetEstimatedBytes:512*512*(8+4+4+4), submitMilliseconds:performance.now()-started,
      projectedQuadAreaScreenRatio: rendered.emitters.reduce((n,e,i)=>n+(layer==='both'||(i===0)===(layer==='flame')?
        e.particles.reduce((s,p)=>s+p.size[0]*p.size[1]/(400*400),0):0),0) };
    $('time').textContent = `${(tick/60).toFixed(2)} s`; $('tick').value = tick;
    $('frame').max = layer === 'smoke' ? 59 : 31;
    $('cost').textContent = `${variant} · ${selected.map(r=>`${r.inputId || r.id}: ${r.dimensions.join('×')}`).join(' / ')}\n`+
      `${(state.stats.atlasDownloadBytes/1024).toFixed(1)} KiB descargados · ${(state.stats.atlasMipRgba8Bytes/1048576).toFixed(2)} MiB de atlas estimados\n`+
      `${particles.count} partículas · ${state.stats.calls} draw calls · LUT 256 KiB · targets 5 MiB estimados\n`+
      (['half','quarter'].includes(variant)?'Diagnóstico: esta reducción no pasó todas las pruebas de silueta.':'Detalle original conservado; presupuesto de memoria móvil pendiente.');
  }
  state.configure = options => {
    const allowed = ['tick','view','bias','layer','surface','cell','frame'];
    if (!options || Object.keys(options).some(k=>!allowed.includes(k))) throw new Error('Unknown budget controls');
    const n = {tick,view,bias,layer,surface,cell,frame,...options};
    if (!Number.isInteger(n.tick)||n.tick<0||n.tick>480||!Object.hasOwn(positions,n.view)||![0,1].includes(n.bias)||
        !['both','flame','smoke'].includes(n.layer)||!['none','wall','floor'].includes(n.surface)||typeof n.cell!=='boolean'||
        !Number.isInteger(n.frame)||n.frame<0||n.frame>59) throw new Error('Invalid budget controls');
    ({tick,view,bias,layer,surface,cell,frame}=n); draw();
  };
  state.benchmark = async () => {
    // Diagnostic on this browser/backend, never a physical-phone FPS claim.
    const cpu=[]; for(let repeat=0;repeat<20;repeat++){ const sim=new NativeSimulation(simulation.source);
      for(let t=0;t<480;t++){ const start=performance.now();sim.advance();cpu.push(performance.now()-start); } }
    const submit=[]; for(let i=0;i<60;i++){const start=performance.now();draw();submit.push(performance.now()-start);}
    let gpuMilliseconds=null, disjoint=null;
    if(extension){const query=gl.createQuery();gl.beginQuery(extension.TIME_ELAPSED_EXT,query);draw();gl.endQuery(extension.TIME_ELAPSED_EXT);
      for(let i=0;i<100&&!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE);i++) await new Promise(r=>setTimeout(r,10));
      disjoint=!!gl.getParameter(extension.GPU_DISJOINT_EXT);
      if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)&&!disjoint) gpuMilliseconds=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6;
      gl.deleteQuery(query); }
    const percentile=(list,p)=>list.slice().sort((a,b)=>a-b)[Math.floor((list.length-1)*p)];
    return { cpuStepP50Ms:percentile(cpu,.5), cpuStepP95Ms:percentile(cpu,.95), submitP95Ms:percentile(submit,.95),gpuMilliseconds,disjoint,device:state.device };
  };
  const change = () => { try { state.configure({ tick:Number($('tick').value),view:$('camera').value,bias:Number($('bias').value),
    layer:$('layer').value,surface:$('surface').value,cell:$('cell').checked,frame:Number($('frame').value) }); }
    catch(e){state.errors.push(String(e));$('cost').textContent=e.message;} };
  for(const id of ['camera','bias','layer','surface','cell','frame']) $(id).onchange=change;
  $('tick').oninput=change; $('variant').value=requested;
  $('variant').onchange=()=>{const url=new URL(location.href);url.searchParams.set('variant',$('variant').value);location.href=url.href;};
  $('play').onclick=()=>{playing=!playing;previous=0;accumulator=0;$('play').textContent=playing?'Pausar':'Reproducir';};
  $('reset').onclick=()=>{playing=false;$('play').textContent='Reproducir';$('camera').value='oblique';$('bias').value='0';$('layer').value='both';$('surface').value='none';$('cell').checked=false;$('frame').value='0';$('tick').value='120';change();};
  function animate(now) { if(state.disposed)return; if(playing){if(previous)accumulator+=Math.min(.1,(now-previous)/1000);previous=now;
      while(accumulator>=1/60){tick=(tick+1)%481;accumulator-=1/60;}draw();} raf=requestAnimationFrame(animate); }
  state.dispose=()=>{if(state.disposed)return;state.disposed=true;cancelAnimationFrame(raf);cleanup();state.ready=false;};
  window.addEventListener('pagehide',state.dispose,{once:true});draw();state.ready=true;raf=requestAnimationFrame(animate);
} catch(e){cleanup();state.errors.push(String(e));$('cost').textContent=`No se pudo abrir: ${e.message}`;console.error(e);}
