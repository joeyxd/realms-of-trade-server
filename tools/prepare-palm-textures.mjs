#!/usr/bin/env node
// Prepare a compact 2x2 palm atlas; --draft stops before runtime assets and source copies.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SRC='docs/art/source/palm-textures-v1', OUT='assets/textures/palm-family-v1', REVIEW='docs/art/palms';
const INPUTS=[{id:'albedo',file:'texturas pintadas a mano palmera.png'},{id:'normal',file:'Atlas normal mapas de palmeras tropicales.png'}];
const TILES=[
 {id:'trunk',crop:[32,18,163,832],alpha:'opaque'},
 {id:'leaf-a',crop:[647,6,224,584],seed:[113,294],alpha:'seeded-candidate-mask'},
 {id:'leaf-b',crop:[856,6,221,516],seed:[114,294],alpha:'seeded-candidate-mask'},
 {id:'coconut',crop:[396,494,124,132],alpha:'opaque'},
];
const OUTPUTS=[
 {id:'albedo-desktop',channel:'albedo',size:1024,content:480,gutter:16,quality:88},
 {id:'normal-desktop',channel:'normal',size:1024,content:480,gutter:16,lossless:true},
 {id:'albedo-mobile',channel:'albedo',size:512,content:240,gutter:8,quality:85},
 {id:'normal-mobile',channel:'normal',size:512,content:240,gutter:8,lossless:true},
].map(x=>({...x,path:OUT+'/'+x.id+'.webp'}));
const cli=process.argv.slice(2);
if(cli.length>1||(cli.length&&!['--draft','--check'].includes(cli[0])))throw Error('Usage: node tools/prepare-palm-textures.mjs [--draft|--check]');
const draft=cli[0]==='--draft', check=cli[0]==='--check';
const MASK={rule:'max(R,G,B)-min(R,G,B) < 18 and mean(R,G,B) in [24,75]',scope:'leaf-a and leaf-b only; trunk/coconut stay opaque',blackInk:'pixels with mean below 24 stay opaque',normalOutside:[128,128,255],edgeColorDilationPixels:2,status:'candidate heuristic; exact mask has not been manually approved'};
const UV={origin:'pixel top-left; TextureLoader flipY=true',order:TILES.map(t=>t.id),tilesPerRow:2,desktop:{atlas:1024,tile:512,content:480,gutter:16},mobile:{atlas:512,tile:256,content:240,gutter:8},shaderInset:[1/64,1/64],shaderSpan:[15/32,15/32],sourceCrops:Object.fromEntries(TILES.map(t=>[t.id,t.crop]))};
function run(cmd,args){const r=spawnSync(cmd,args,{encoding:'utf8',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw Error(cmd+' failed: '+(r.stderr||r.stdout));return r.stdout.trim();}
function hash(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}
function info(p){return JSON.parse(run('python',['-c',"from PIL import Image;import json,sys;i=Image.open(sys.argv[1]);print(json.dumps({'size':[i.width,i.height],'mode':i.mode}))",p]));}
const sources=INPUTS.map(s=>{const p=path.join(ROOT,'materials',s.file);if(!fs.existsSync(p))throw Error('Missing materials/'+s.file);const i=info(p);if(i.size[0]!==1254||i.size[1]!==1254||i.mode!=='RGB')throw Error('Expected 1254x1254 RGB: '+s.file);return {id:s.id,source:'materials/'+s.file,path:SRC+'/'+s.id+'.png',sha256:hash(p),bytes:fs.statSync(p).size,size:[1254,1254],mode:'RGB'};});
const PY=String.raw`from PIL import Image, ImageFilter, ImageChops, ImageMath, ImageDraw
from collections import deque
import json,os,sys
src,out,mode=sys.argv[1:4]; params=json.loads(sys.argv[4]); specs=params['outputs']; TILES=params['tiles']
albedo=Image.open(os.path.join(src,'texturas pintadas a mano palmera.png')).convert('RGB')
normal=Image.open(os.path.join(src,'Atlas normal mapas de palmeras tropicales.png')).convert('RGB')
def candidate_mask(im):
 r,g,b=im.convert('RGB').split(); hi=ImageChops.lighter(ImageChops.lighter(r,g),b); lo=ImageChops.darker(ImageChops.darker(r,g),b)
 chroma=ImageChops.subtract(hi,lo); mean=Image.frombytes('L',im.size,bytes((a+b+c)//3 for a,b,c in zip(r.tobytes(),g.tobytes(),b.tobytes())))
 background=ImageChops.multiply(chroma.point(lambda v:255 if v<18 else 0),mean.point(lambda v:255 if 24<=v<=75 else 0))
 return ImageChops.invert(background)
leafmask=candidate_mask(albedo)
def selected_component(mask,seed):
 w,h=mask.size; data=mask.tobytes(); sx,sy=seed; start=sy*w+sx
 if not data[start]: raise ValueError('leaf seed is not opaque: '+str(seed))
 seen=bytearray(w*h); seen[start]=1; q=deque([start])
 while q:
  p=q.popleft(); x=p%w; y=p//w
  for dy in (-1,0,1):
   for dx in (-1,0,1):
    nx=x+dx; ny=y+dy
    if 0<=nx<w and 0<=ny<h:
     n=ny*w+nx
     if data[n] and not seen[n]:seen[n]=1;q.append(n)
 return Image.frombytes('L',(w,h),bytes(255 if v else 0 for v in seen))
if mode=='draft':
 checker=Image.new('RGB',(1024,1024),(213,213,213)); d=ImageDraw.Draw(checker)
 for y in range(0,1024,32):
  for x in range(0,1024,32):
   if (x//32+y//32)%2:d.rectangle((x,y,x+31,y+31),fill=(164,164,164))
 atlas=Image.new('RGB',(1024,1024),(80,80,80)); alpha=Image.new('L',(1024,1024),0)
 for i,t in enumerate(TILES):
  x,y,w,h=t['crop']; rgb=albedo.crop((x,y,x+w,y+h)); a=selected_component(leafmask.crop((x,y,x+w,y+h)),t['seed']) if t['alpha']!='opaque' else Image.new('L',(w,h),255)
  sz=(480,480); rgb=rgb.resize(sz,Image.Resampling.LANCZOS); a=a.resize(sz,Image.Resampling.LANCZOS)
  ox=(i%2)*512+16+(480-sz[0])//2; oy=(i//2)*512+16+(480-sz[1])//2
  atlas.paste(rgb,(ox,oy)); alpha.paste(a,(ox,oy))
 checker.paste(atlas,(0,0),alpha); checker.save(os.path.join(out,'atlas-draft.png')); alpha.save(os.path.join(out,'alpha-mask-draft.png')); raise SystemExit(0)
def gutter(atlas,x,y,half,g,c):
 core=atlas.crop((x+g,y+g,x+g+c,y+g+c))
 atlas.paste(core.crop((0,0,c,1)).resize((c,g)),(x+g,y))
 atlas.paste(core.crop((0,c-1,c,c)).resize((c,g)),(x+g,y+g+c))
 atlas.paste(core.crop((0,0,1,c)).resize((g,c)),(x,y+g))
 atlas.paste(core.crop((c-1,0,c,c)).resize((g,c)),(x+g+c,y+g))
 atlas.paste(core.getpixel((0,0)),(x,y,x+g,y+g)); atlas.paste(core.getpixel((c-1,0)),(x+g+c,y,x+half,y+g))
 atlas.paste(core.getpixel((0,c-1)),(x,y+g+c,x+g,y+half)); atlas.paste(core.getpixel((c-1,c-1)),(x+g+c,y+g+c,x+half,y+half))
for spec in specs:
 channel=spec['channel']; atlas=Image.new('RGBA',(spec['size'],spec['size']),(0,0,0,0))
 for i,t in enumerate(TILES):
  x,y,w,h=t['crop']; srcim=albedo if channel=='albedo' else normal; rgb=srcim.crop((x,y,x+w,y+h))
  a=selected_component(leafmask.crop((x,y,x+w,y+h)),t['seed']) if t['alpha']!='opaque' else Image.new('L',(w,h),255)
  if t['alpha']!='opaque':
   exp=a.filter(ImageFilter.MaxFilter(5)); edge=ImageChops.subtract(exp,a); rgb=rgb.copy(); rgb.paste(rgb.filter(ImageFilter.MaxFilter(3)),(0,0),edge)
  if channel=='normal' and t['alpha']!='opaque': rgb.paste((128,128,255),(0,0,w,h),ImageChops.invert(a))
  rgba=rgb.convert('RGBA'); rgba.putalpha(a); sz=(spec['content'],spec['content'])
  rgba=rgba.resize(sz,Image.Resampling.LANCZOS); half=spec['size']//2
  ox=(i%2)*half+spec['gutter']+(spec['content']-sz[0])//2; oy=(i//2)*half+spec['gutter']+(spec['content']-sz[1])//2
  atlas.alpha_composite(rgba,(ox,oy))
 half=spec['size']//2
 for i in range(4):gutter(atlas,(i%2)*half,(i//2)*half,half,spec['gutter'],spec['content'])
 p=os.path.join(out,spec['id']+'.webp')
 if channel=='normal':atlas.save(p,'WEBP',lossless=True,method=6)
 else:atlas.save(p,'WEBP',quality=spec['quality'],method=6)
`;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'palm-family-v1-'));
try{
 const python=run('python',['--version']),pillow=run('python',['-c','import PIL;print(PIL.__version__)']);
 if(draft){run('python',['-c',PY,path.join(ROOT,'materials'),tmp,'draft',JSON.stringify({outputs:OUTPUTS,tiles:TILES})]);fs.mkdirSync(path.join(ROOT,REVIEW),{recursive:true});for(const n of ['atlas-draft.png','alpha-mask-draft.png'])fs.copyFileSync(path.join(tmp,n),path.join(ROOT,REVIEW,n));console.log('Draft atlas and alpha mask saved under '+REVIEW+'; final outputs untouched.');}
 else{
  const receiptPath=path.join(ROOT,SRC,'receipt.json'),old=fs.existsSync(receiptPath)?JSON.parse(fs.readFileSync(receiptPath,'utf8')):null;
  if(check&&!old)throw Error('Missing receipt: '+SRC+'/receipt.json');
  if(old&&JSON.stringify(old.sources)!==JSON.stringify(sources))throw Error('Receipt source metadata differs from originals');
  for(const s of sources){const p=path.join(ROOT,s.path);if(check&&(!fs.existsSync(p)||hash(p)!==s.sha256||fs.statSync(p).size!==s.bytes))throw Error('Source copy mismatch: '+s.path);if(!check&&fs.existsSync(p)&&hash(p)!==s.sha256)throw Error('Refusing differing source copy: '+s.path);}
  run('python',['-c',PY,path.join(ROOT,'materials'),tmp,'final',JSON.stringify({outputs:OUTPUTS,tiles:TILES})]);
  const derivatives=OUTPUTS.map(o=>{const p=path.join(tmp,o.id+'.webp'),i=info(p);if(i.size[0]!==o.size||i.size[1]!==o.size||i.mode!=='RGBA')throw Error('Unexpected derivative '+o.id);return {id:o.id,path:o.path,size:[o.size,o.size],mode:i.mode,bytes:fs.statSync(p).size,sha256:hash(p),encoding:o.lossless?'lossless WebP':'WebP quality '+o.quality};});
  const receipt={schemaVersion:1,family:'palm-textures-v1',generator:{script:'tools/prepare-palm-textures.mjs',scriptSha256:hash(fileURLToPath(import.meta.url)),python,pillow,resampler:'Pillow Lanczos; no explicit gamma/color conversion'},sources,tiles:TILES,uvLayout:UV,mask:MASK,normalPairing:'same UV crops; visually registered only, bake alignment not verified',derivatives,aggregateRuntimeBytes:derivatives.reduce((n,x)=>n+x.bytes,0)};
  if(old&&JSON.stringify(old)!==JSON.stringify(receipt))throw Error('Existing receipt differs from recomputed recipe; refusing all writes');
  if(check){if(JSON.stringify(old)!==JSON.stringify(receipt))throw Error('Receipt differs from recomputed recipe');for(const d of derivatives){const p=path.join(ROOT,d.path);if(!fs.existsSync(p)||hash(p)!==d.sha256)throw Error('Derivative mismatch: '+d.path);}console.log('palm-textures-v1 check OK: source copies and four recomputed outputs.');}
  else{
   for(const d of derivatives){const p=path.join(ROOT,d.path);if(fs.existsSync(p)){const prev=old?.derivatives?.find(x=>x.path===d.path);if(!prev||prev.sha256!==hash(p)||prev.sha256!==d.sha256)throw Error('Refusing unreceipted/differing derivative: '+d.path);}}
   for(const s of sources){const p=path.join(ROOT,s.path);fs.mkdirSync(path.dirname(p),{recursive:true});if(!fs.existsSync(p))fs.copyFileSync(path.join(ROOT,s.source),p,fs.constants.COPYFILE_EXCL);}
   for(const d of derivatives){const p=path.join(ROOT,d.path);fs.mkdirSync(path.dirname(p),{recursive:true});if(!fs.existsSync(p))fs.copyFileSync(path.join(tmp,d.id+'.webp'),p,fs.constants.COPYFILE_EXCL);}
   fs.mkdirSync(path.dirname(receiptPath),{recursive:true});fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');console.log('Palm texture derivatives and receipt written.');
  }
 }
}finally{const p=path.resolve(tmp);if(path.dirname(p)!==path.resolve(os.tmpdir())||!path.basename(p).startsWith('palm-family-v1-'))throw Error('Unsafe temp cleanup');fs.rmSync(p,{recursive:true,force:true});}
