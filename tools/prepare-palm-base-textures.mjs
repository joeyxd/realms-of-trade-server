#!/usr/bin/env node
import crypto from 'node:crypto';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import{fileURLToPath}from'node:url';import{spawnSync}from'node:child_process';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),SRC='docs/art/source/palm-base-textures-v1',OUT='assets/textures/palm-base-v1',REVIEW='docs/art/palm-bases',RECEIPT=SRC+'/receipt.json';
const INPUTS=[{id:'albedo',filename:'texturas pintadas a mano palmera.png'},{id:'normal',filename:'Atlas normal mapas de palmeras tropicales.png'}];
const TILES=[{id:'leaf-small-a',crop:[384,746,76,137],seed:[34,54]},{id:'leaf-small-b',crop:[680,1024,48,117],seed:[23,63]}];
const OUTPUTS=[{id:'albedo-pc',channel:'albedo',size:[512,256],half:256,content:240,gutter:8,quality:88},{id:'normal-pc',channel:'normal',size:[512,256],half:256,content:240,gutter:8,lossless:true},{id:'albedo-mobile',channel:'albedo',size:[256,128],half:128,content:120,gutter:4,quality:85},{id:'normal-mobile',channel:'normal',size:[256,128],half:128,content:120,gutter:4,lossless:true}].map(x=>({...x,path:OUT+'/'+x.id+'.webp'}));
const args=process.argv.slice(2);if(args.length>1||(args.length&&!['--draft','--check'].includes(args[0])))throw Error('Usage: node tools/prepare-palm-base-textures.mjs [--draft|--check]');const draft=args[0]==='--draft',check=args[0]==='--check';
const MASK={background:'low chroma (max-min < 18) and mean < 75 transparent',foreground:'chroma >= 18 or mean >= 75',selection:'8-connected foreground component containing tile seed',edgeInk:'2-pixel dilation',resizedAlpha:'Lanczos then binary threshold at 128',normalOutside:[128,128,255],approval:'root inspected cropped leaf draft for local integration; heuristic alpha, not hand-painted'};
const UV={origin:'pixel top-left; TextureLoader flipY=true',order:TILES.map(t=>t.id),tilesPerRow:2,pc:{atlas:[512,256],tile:[256,256],content:240,gutter:8,offsets:[[0,0],[.5,0]],inset:[1/64,1/32],span:[15/32,15/16]},mobile:{atlas:[256,128],tile:[128,128],content:120,gutter:4,offsets:[[0,0],[.5,0]],inset:[1/64,1/32],span:[15/32,15/16]},crops:Object.fromEntries(TILES.map(t=>[t.id,t.crop]))};
function fail(s){throw Error(s)}function hash(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}function run(c,a){const r=spawnSync(c,a,{encoding:'utf8',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw Error(c+' failed '+r.status+': '+(r.stderr||r.stdout));return r.stdout.trim()}function info(p){return JSON.parse(run('python',['-c',"from PIL import Image;import json,sys;i=Image.open(sys.argv[1]);print(json.dumps({'size':[i.width,i.height],'mode':i.mode}))",p]))}
const sources=INPUTS.map(s=>{const p=path.join(ROOT,'materials',s.filename),i=info(p);if(i.size[0]!==1254||i.size[1]!==1254||i.mode!=='RGB')fail('Unexpected source '+s.filename);return{id:s.id,source:'materials/'+s.filename,copy:SRC+'/'+s.id+'.png',sha256:hash(p),bytes:fs.statSync(p).size,dimensions:[1254,1254],mode:'RGB'}});
function pointsFor(o){const p=[];for(let n=0;n<2;n++){const t=TILES[n],sx=Math.round((t.seed[0]+.5)*o.content/t.crop[2]-.5),sy=Math.round((t.seed[1]+.5)*o.content/t.crop[3]-.5),x=n*o.half+o.gutter;p.push([x+1,o.gutter+1],[x+sx,o.gutter+sy])}return p}
function probe(file,points){return JSON.parse(run('python',['-c',"from PIL import Image;import json,sys;i=Image.open(sys.argv[1]).convert('RGBA');print(json.dumps([i.getpixel(tuple(p))[3] for p in json.loads(sys.argv[2])]))",file,JSON.stringify(points)]))}
const PY=String.raw`from PIL import Image,ImageFilter,ImageChops,ImageDraw
from collections import deque
import json,os,sys
src,out,mode=sys.argv[1:4];cfg=json.loads(sys.argv[4]);tiles=cfg['tiles'];outputs=cfg['outputs']
albedo=Image.open(os.path.join(src,'texturas pintadas a mano palmera.png')).convert('RGB');normal=Image.open(os.path.join(src,'Atlas normal mapas de palmeras tropicales.png')).convert('RGB')
def fgmask(im):
 r,g,b=im.split();hi=ImageChops.lighter(ImageChops.lighter(r,g),b);lo=ImageChops.darker(ImageChops.darker(r,g),b);ch=ImageChops.subtract(hi,lo)
 mean=Image.frombytes('L',im.size,bytes((a+b+c)//3 for a,b,c in zip(r.tobytes(),g.tobytes(),b.tobytes())))
 return ImageChops.lighter(ch.point(lambda v:255 if v>=18 else 0),mean.point(lambda v:255 if v>=75 else 0))
fg=fgmask(albedo)
def select(mask,seed):
 w,h=mask.size;data=mask.tobytes();x,y=seed;start=y*w+x
 if not data[start]:raise ValueError('seed hits background '+str(seed))
 seen=bytearray(w*h);seen[start]=1;q=deque([start])
 while q:
  p=q.popleft();px=p%w;py=p//w
  for dy in (-1,0,1):
   for dx in (-1,0,1):
    nx=px+dx;ny=py+dy
    if 0<=nx<w and 0<=ny<h:
     n=ny*w+nx
     if data[n] and not seen[n]:seen[n]=1;q.append(n)
 return Image.frombytes('L',(w,h),bytes(255 if v else 0 for v in seen))
def piece(t,ch,size):
 x,y,w,h=t['crop'];srcim=albedo if ch=='albedo' else normal;rgb=srcim.crop((x,y,x+w,y+h));a=select(fg.crop((x,y,x+w,y+h)),t['seed']).filter(ImageFilter.MaxFilter(5))
 if ch=='normal':rgb=rgb.copy();rgb.paste((128,128,255),(0,0,w,h),ImageChops.invert(a))
 rgba=rgb.convert('RGBA');rgba.putalpha(a);rgba=rgba.resize((size,size),Image.Resampling.LANCZOS);rgba.putalpha(rgba.getchannel('A').point(lambda v:255 if v>=128 else 0));return rgba
if mode=='draft':
 checker=Image.new('RGB',(512,256),(213,213,213));d=ImageDraw.Draw(checker)
 for y in range(0,256,16):
  for x in range(0,512,16):
   if (x//16+y//16)%2:d.rectangle((x,y,x+15,y+15),fill=(164,164,164))
 atlas=Image.new('RGB',(512,256),(80,80,80));alpha=Image.new('L',(512,256),0)
 for i,t in enumerate(tiles):
  q=piece(t,'albedo',240);x=i*256+8;atlas.paste(q.convert('RGB'),(x,8));alpha.paste(q.getchannel('A'),(x,8))
 checker.paste(atlas,(0,0),alpha);checker.save(os.path.join(out,'leaves-v1-draft.png'));alpha.save(os.path.join(out,'leaves-alpha-v1-draft.png'));raise SystemExit(0)
def gutters(a,x,half,g,c):
 q=a.crop((x+g,g,x+g+c,g+c));a.paste(q.crop((0,0,c,1)).resize((c,g)),(x+g,0));a.paste(q.crop((0,c-1,c,c)).resize((c,g)),(x+g,g+c));a.paste(q.crop((0,0,1,c)).resize((g,c)),(x,g));a.paste(q.crop((c-1,0,c,c)).resize((g,c)),(x+g+c,g));a.paste(q.getpixel((0,0)),(x,0,x+g,g));a.paste(q.getpixel((c-1,0)),(x+g+c,0,x+half,g));a.paste(q.getpixel((0,c-1)),(x,g+c,x+g,half));a.paste(q.getpixel((c-1,c-1)),(x+g+c,g+c,x+half,half))
for o in outputs:
 a=Image.new('RGBA',tuple(o['size']),(0,0,0,0))
 for i,t in enumerate(tiles):a.alpha_composite(piece(t,o['channel'],o['content']),(i*o['half']+o['gutter'],o['gutter']))
 for i in range(2):gutters(a,i*o['half'],o['half'],o['gutter'],o['content'])
 p=os.path.join(out,o['id']+'.webp')
 if o.get('lossless'):a.save(p,'WEBP',lossless=True,method=6)
 else:a.save(p,'WEBP',quality=o['quality'],method=6)
`;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'palm-base-textures-v1-'));
try{
 const python=run('python',['--version']),pillow=run('python',['-c','import PIL;print(PIL.__version__)']);
 if(draft){run('python',['-c',PY,path.join(ROOT,'materials'),temp,'draft',JSON.stringify({tiles:TILES,outputs:OUTPUTS})]);fs.mkdirSync(path.join(ROOT,REVIEW),{recursive:true});for(const f of ['leaves-v1-draft.png','leaves-alpha-v1-draft.png'])fs.copyFileSync(path.join(temp,f),path.join(ROOT,REVIEW,f));console.log('Draft atlas and alpha preview written; final outputs untouched.')}
 else{
  const rp=path.join(ROOT,RECEIPT),old=fs.existsSync(rp)?JSON.parse(fs.readFileSync(rp,'utf8')):null;if(check&&!old)fail('Missing receipt');
  if(old&&JSON.stringify(old.sources)!==JSON.stringify(sources))fail('Receipt source metadata differs');
  for(const s of sources){const p=path.join(ROOT,s.copy);if(check&&(!fs.existsSync(p)||hash(p)!==s.sha256))fail('Source copy mismatch '+s.copy);if(!check&&fs.existsSync(p)&&hash(p)!==s.sha256)fail('Refusing differing source '+s.copy)}
  run('python',['-c',PY,path.join(ROOT,'materials'),temp,'final',JSON.stringify({tiles:TILES,outputs:OUTPUTS})]);
  const derivatives=OUTPUTS.map(o=>{const p=path.join(temp,o.id+'.webp'),i=info(p);if(i.size[0]!==o.size[0]||i.size[1]!==o.size[1]||i.mode!=='RGBA')fail('Bad dimensions '+o.id);const points=pointsFor(o),alpha=probe(p,points);if(alpha[0]!==0||alpha[2]!==0||alpha[1]!==255||alpha[3]!==255)fail('Alpha probe failed '+o.id+': '+alpha);return{id:o.id,path:o.path,dimensions:o.size,mode:i.mode,bytes:fs.statSync(p).size,sha256:hash(p),encoding:o.lossless?'lossless WebP':'WebP quality '+o.quality,alphaProbes:{points,alpha,labels:['leaf A background','leaf A seed','leaf B background','leaf B seed']}}});
  const receipt={schemaVersion:1,family:'palm-base-textures-v1',generator:{script:'tools/prepare-palm-base-textures.mjs',scriptSha256:hash(fileURLToPath(import.meta.url)),python,pillow,resampler:'Pillow Lanczos; no gamma/color transform'},sources,tiles:TILES,mask:MASK,normalPairing:'same UV crops; visually registered only; bake not certified',uvLayout:UV,derivatives,aggregateRuntimeBytes:derivatives.reduce((a,b)=>a+b.bytes,0)};
  if(old&&JSON.stringify(old)!==JSON.stringify(receipt))fail('Receipt differs from recomputed result; refusing writes');
  if(check){for(const d of derivatives){const p=path.join(ROOT,d.path);if(!fs.existsSync(p)||hash(p)!==d.sha256)fail('Derivative mismatch '+d.path)}console.log('palm-base-textures-v1 check OK')}
  else{
   for(const d of derivatives){const p=path.join(ROOT,d.path);if(fs.existsSync(p)){const prior=old?.derivatives?.find(x=>x.path===d.path);if(!prior||prior.sha256!==hash(p)||prior.sha256!==d.sha256)fail('Refusing differing derivative '+d.path)}}
   for(const s of sources){const p=path.join(ROOT,s.copy);fs.mkdirSync(path.dirname(p),{recursive:true});if(!fs.existsSync(p))fs.copyFileSync(path.join(ROOT,s.source),p,fs.constants.COPYFILE_EXCL)}
   for(const d of derivatives){const p=path.join(ROOT,d.path);fs.mkdirSync(path.dirname(p),{recursive:true});if(!fs.existsSync(p))fs.copyFileSync(path.join(temp,d.id+'.webp'),p,fs.constants.COPYFILE_EXCL)}
   fs.mkdirSync(path.dirname(rp),{recursive:true});fs.writeFileSync(rp,JSON.stringify(receipt,null,2)+'\n');console.log('palm-base textures generated');
  }
 }
}finally{const p=path.resolve(temp);if(path.dirname(p)!==path.resolve(os.tmpdir())||!path.basename(p).startsWith('palm-base-textures-v1-'))fail('Unsafe temp cleanup');fs.rmSync(p,{recursive:true,force:true})}

