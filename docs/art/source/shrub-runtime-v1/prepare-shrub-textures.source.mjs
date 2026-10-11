#!/usr/bin/env node
// Prepare compact shrub atlas derivatives from immutable generated PNG sources.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'materials/generated/tropical-shrub-v1';
const SNAPSHOT = 'docs/art/source/shrub-runtime-v1';
const OUT = 'assets/textures/shrub-v1';
const REVIEW = 'docs/art/shrubs';
const RECEIPT = `${SNAPSHOT}/textures-receipt.json`;
const TOOL_SNAPSHOT = `${SNAPSHOT}/prepare-shrub-textures.source.mjs`;
const INPUTS = ['albedo.png', 'normal.png', 'concept.png', 'prompts.json', 'receipt.json'];
const OUTPUTS = [
  { id: 'albedo-pc', size: 512, tile: 256, content: 240, gutter: 8, quality: 88 },
  { id: 'normal-pc', size: 512, tile: 256, content: 240, gutter: 8, lossless: true },
  { id: 'albedo-mobile', size: 256, tile: 128, content: 120, gutter: 4, quality: 85 },
  { id: 'normal-mobile', size: 256, tile: 128, content: 120, gutter: 4, lossless: true },
];
const cli = process.argv.slice(2);
if (cli.length > 1 || (cli.length && cli[0] !== '--check')) throw new Error('Usage: node tools/prepare-shrub-textures.mjs [--check]');
const check = cli[0] === '--check';
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const PY = String.raw`
from PIL import Image, ImageOps
import json, os, sys
src, out, cfg = sys.argv[1:4]
cfg = json.loads(cfg)
albedo = Image.open(os.path.join(src, 'albedo.png')).convert('RGBA')
normal = Image.open(os.path.join(src, 'normal.png')).convert('RGBA')
if albedo.size != (1254, 1254) or normal.size != albedo.size: raise ValueError('expected matching 1254x1254 atlases')
crop_rows = []
for outcfg in cfg['outputs']:
    size, tile, content, gutter = outcfg['size'], outcfg['tile'], outcfg['content'], outcfg['gutter']
    tiles = []
    for i in range(4):
        x, y = (i % 2) * 627, (i // 2) * 627
        box = (x, y, x + 627, y + 627)
        color = albedo.crop(box)
        n = normal.crop(box)
        threshold = color.getchannel('A').point(lambda a: 255 if a > 16 else 0)
        bounds = threshold.getbbox()
        if not bounds: raise ValueError('leaf tile has no visible alpha: '+str(i))
        left, top, right, bottom = bounds
        crop = (max(0,left-6), max(0,top-6), min(627,right+6), min(627,bottom+6))
        if outcfg['id'] == 'albedo-pc': crop_rows.append({'tile':i,'rect':[x+crop[0],y+crop[1],crop[2]-crop[0],crop[3]-crop[1]],'margin':6})
        color = color.crop(crop)
        n = n.crop(crop)
        # The albedo alpha is authoritative, including interior holes; neutralize transparent normal texels.
        alpha = color.getchannel('A')
        original_normal_alpha = n.getchannel('A')
        n.putalpha(alpha)
        pixels = n.load(); mask = alpha.load(); normal_mask = original_normal_alpha.load()
        for py in range(n.height):
            for px in range(n.width):
                if mask[px, py] == 0 or normal_mask[px, py] < 64:
                    pixels[px, py] = (128, 128, 255, mask[px, py])
        scale = min(content/color.width, content/color.height)
        resized = (max(1,round(color.width*scale)),max(1,round(color.height*scale)))
        color = color.resize(resized, Image.Resampling.LANCZOS)
        n = n.resize(resized, Image.Resampling.LANCZOS)
        color_alpha = color.getchannel('A')
        # Resize normal vectors and renormalize their XYZ direction.
        srcpix = n.load()
        for py in range(n.height):
            for px in range(n.width):
                r, g, b, a = srcpix[px, py]
                if a == 0: srcpix[px, py] = (128, 128, 255, 0); continue
                nx, ny, nz = (r / 127.5 - 1, g / 127.5 - 1, b / 127.5 - 1)
                length = max(1e-6, (nx*nx + ny*ny + nz*nz) ** 0.5)
                srcpix[px, py] = (round((nx/length + 1)*127.5), round((ny/length + 1)*127.5), round((nz/length + 1)*127.5), color_alpha.getpixel((px,py)))
        color_canvas = Image.new('RGBA',(content,content),(0,0,0,0))
        normal_canvas = Image.new('RGBA',(content,content),(128,128,255,0))
        dest = ((content-resized[0])//2,(content-resized[1])//2)
        color_canvas.alpha_composite(color,dest)
        normal_canvas.alpha_composite(n,dest)
        tiles.append((color_canvas, normal_canvas))
    channel = 0 if outcfg['id'].startswith('albedo') else 1
    atlas = Image.new('RGBA', (size, size), (0,0,0,0))
    for i, pair in enumerate(tiles):
        image = pair[channel]
        x, y = (i % 2) * tile, (i // 2) * tile
        ix, iy = x + gutter, y + gutter
        atlas.alpha_composite(image, (ix, iy))
        # Extrude the image border into a per-tile gutter to prevent adjacent tile bleed.
        top = image.crop((0,0,content,1)).resize((content,gutter)); atlas.paste(top,(ix,iy-gutter))
        bottom = image.crop((0,content-1,content,content)).resize((content,gutter)); atlas.paste(bottom,(ix,iy+content))
        left = image.crop((0,0,1,content)).resize((gutter,content)); atlas.paste(left,(ix-gutter,iy))
        right = image.crop((content-1,0,content,content)).resize((gutter,content)); atlas.paste(right,(ix+content,iy))
        for gx, gy, sx, sy in [(ix-gutter,iy-gutter,0,0),(ix+content,iy-gutter,content-1,0),(ix-gutter,iy+content,0,content-1),(ix+content,iy+content,content-1,content-1)]:
            atlas.paste(image.getpixel((sx,sy)),(gx,gy,gx+gutter,gy+gutter))
    path = os.path.join(out, outcfg['id']+'.webp')
    if outcfg.get('lossless'): atlas.save(path,'WEBP',lossless=True,method=6)
    else: atlas.save(path,'WEBP',quality=outcfg['quality'],method=6)
pc = Image.open(os.path.join(out, 'albedo-pc.webp')).convert('RGBA')
checker = Image.new('RGBA', pc.size, (213,213,213,255))
for y in range(0,pc.height,32):
    for x in range(0,pc.width,32):
        if (x//32+y//32)%2:
            from PIL import ImageDraw
            ImageDraw.Draw(checker).rectangle((x,y,x+31,y+31),fill=(165,165,165,255))
checker.alpha_composite(pc)
checker.convert('RGB').save(os.path.join(out,'shrub-atlas-v1-draft.png'), optimize=True)
with open(os.path.join(out,'shrub-crops.json'),'w') as f: json.dump(crop_rows,f)
`;
const PROBE_PY = String.raw`
from PIL import Image
from collections import deque
import json, os, sys
root, cfg = sys.argv[1:3]; cfg = json.loads(cfg); result = []
for scale in ('pc', 'mobile'):
    a = Image.open(os.path.join(root, 'albedo-'+scale+'.webp')).convert('RGBA')
    n = Image.open(os.path.join(root, 'normal-'+scale+'.webp')).convert('RGBA')
    aa, nn = list(a.getchannel('A').getdata()), list(n.getchannel('A').getdata())
    if len(aa) != len(nn): raise ValueError('paired dimensions differ')
    active = [p for p in n.getdata() if p[3] > cfg['cutoff']]
    if not active: raise ValueError('no pixels above shader alpha threshold')
    holes = []
    tile, gutter, content = cfg[scale]
    for index in range(4):
        ox, oy = (index % 2)*tile+gutter, (index//2)*tile+gutter
        alpha = a.crop((ox,oy,ox+content,oy+content)).getchannel('A')
        mask = alpha.tobytes(); w=h=content; seen=bytearray(w*h); queue=deque()
        for x in range(w):
            for y in (0,h-1):
                j=y*w+x
                if mask[j] <= cfg['cutoff'] and not seen[j]: seen[j]=1; queue.append(j)
        for y in range(h):
            for x in (0,w-1):
                j=y*w+x
                if mask[j] <= cfg['cutoff'] and not seen[j]: seen[j]=1; queue.append(j)
        while queue:
            j=queue.popleft(); x=j%w; y=j//w
            for nx,ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                if 0<=nx<w and 0<=ny<h:
                    k=ny*w+nx
                    if mask[k] <= cfg['cutoff'] and not seen[k]: seen[k]=1; queue.append(k)
        interior=[j for j in range(w*h) if mask[j]<=cfg['cutoff'] and not seen[j]]
        holes.append(len(interior))
    result.append({'scale':scale,'dimensions':[a.width,a.height],'alphaMismatches':sum(x!=y for x,y in zip(aa,nn)),
        'pixelsAboveAlphaCutoff':len(active),'alphaCutoff':cfg['cutoff']/255,'normalZBelow128AboveCutoff':sum(p[2]<128 for p in active),
        'minimumNormalZAboveCutoff':min(p[2] for p in active),'enclosedHolePixelsByTile':holes})
print(json.dumps(result))
`;
const scriptPath = fileURLToPath(import.meta.url);
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
const sourceMeta = INPUTS.map((name) => {
  const bytes = fs.readFileSync(path.join(ROOT, SOURCE, name));
  return { file: `${SOURCE}/${name}`, snapshot: `${SNAPSHOT}/${name}`, bytes: bytes.length, sha256: hash(bytes) };
});
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shrub-textures-v1-'));
try {
  const python = run('python', ['--version']);
  const pillow = run('python', ['-c', 'import PIL; print(PIL.__version__)']);
  run('python', ['-c', PY, path.join(ROOT, SOURCE), temp, JSON.stringify({ outputs: OUTPUTS })]);
  const crops = JSON.parse(fs.readFileSync(path.join(temp, 'shrub-crops.json'), 'utf8'));
  const derivatives = OUTPUTS.map((output) => {
    const bytes = fs.readFileSync(path.join(temp, `${output.id}.webp`));
    return { id: output.id, file: `${OUT}/${output.id}.webp`, dimensions: [output.size, output.size], bytes: bytes.length, sha256: hash(bytes), encoding: output.lossless ? 'lossless WebP' : `WebP quality ${output.quality}`, tileGrid: '2x2; albedo alpha authoritative; four per-tile gutters' };
  });
  const integrity = JSON.parse(run('python', ['-c', PROBE_PY, temp, JSON.stringify({ cutoff: 89, pc: [256, 8, 240], mobile: [128, 4, 120] })]));
  for (const probe of integrity) if (probe.alphaMismatches || probe.normalZBelow128AboveCutoff) throw new Error(`Texture pair integrity failed at ${probe.scale}: ${JSON.stringify(probe)}`);
  const toolBytes = fs.readFileSync(scriptPath);
  const draftBytes = fs.readFileSync(path.join(temp, 'shrub-atlas-v1-draft.png'));
  const receipt = { version: 1, family: 'shrub-textures-v1', generator: { script: 'tools/prepare-shrub-textures.mjs', snapshot: TOOL_SNAPSHOT, scriptSha256: hash(toolBytes), python, pillow, resampler: 'Pillow Lanczos; no color transform', normalResize: 'renormalized XYZ vectors after resize' }, sources: sourceMeta, tiles: ['leaf-a', 'leaf-b', 'leaf-c', 'leaf-d'], cropPixelsAtSource1254: Object.fromEntries(crops.map(({ tile, rect }) => [`leaf-${String.fromCharCode(97+tile)}`, rect])), cropRule: 'source albedo alpha >16 bounding box plus 6 px margin; same rectangle for color and normal; aspect preserved in tile', alpha: 'source albedo alpha used for both maps; original normal texels below alpha 64 neutralized before color-authoritative alpha is applied; holes retained', uv: { order: 'top-left, top-right, bottom-left, bottom-right', textureLoaderFlipY: true, inset: [1/64, 1/64], span: [15/32, 15/32] }, shaderAlphaThreshold: 0.35, integrity, derivatives, draft: { file: `${REVIEW}/shrub-atlas-v1-draft.png`, dimensions: [512,512], bytes: draftBytes.length, sha256: hash(draftBytes) }, aggregateRuntimeBytes: derivatives.reduce((n, d) => n + d.bytes, 0) };
  const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
  const verify = (file, bytes) => {
    if (fs.existsSync(file)) {
      if (!fs.readFileSync(file).equals(bytes)) throw new Error(`Refusing differing existing output: ${path.relative(ROOT, file)}`);
    } else if (check) throw new Error(`--check missing ${path.relative(ROOT, file)}`);
  };
  for (const source of sourceMeta) verify(path.join(ROOT, source.snapshot), fs.readFileSync(path.join(ROOT, source.file)));
  for (const derivative of derivatives) verify(path.join(ROOT, derivative.file), fs.readFileSync(path.join(temp, `${derivative.id}.webp`)));
  verify(path.join(ROOT, `${REVIEW}/shrub-atlas-v1-draft.png`), draftBytes);
  verify(path.join(ROOT, TOOL_SNAPSHOT), toolBytes);
  verify(path.join(ROOT, RECEIPT), receiptBytes);
  if (!check) {
    for (const source of sourceMeta) {
      const destination = path.join(ROOT, source.snapshot);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (!fs.existsSync(destination)) fs.copyFileSync(path.join(ROOT, source.file), destination, fs.constants.COPYFILE_EXCL);
    }
    for (const derivative of derivatives) {
      const destination = path.join(ROOT, derivative.file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (!fs.existsSync(destination)) fs.copyFileSync(path.join(temp, `${derivative.id}.webp`), destination, fs.constants.COPYFILE_EXCL);
    }
    for (const [relative, bytes] of [[`${REVIEW}/shrub-atlas-v1-draft.png`, draftBytes], [TOOL_SNAPSHOT, toolBytes]]) {
      const destination = path.join(ROOT, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const source = relative.endsWith('.png') ? path.join(temp, 'shrub-atlas-v1-draft.png') : scriptPath;
      if (!fs.existsSync(destination)) fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    }
    fs.mkdirSync(path.dirname(path.join(ROOT, RECEIPT)), { recursive: true });
    if (!fs.existsSync(path.join(ROOT, RECEIPT))) fs.writeFileSync(path.join(ROOT, RECEIPT), receiptBytes, { flag: 'wx' });
  }
  console.log(JSON.stringify({ check, derivatives, aggregateRuntimeBytes: receipt.aggregateRuntimeBytes }, null, 2));
} finally {
  const tempPath = path.resolve(temp), tempRoot = path.resolve(os.tmpdir());
  if (path.dirname(tempPath) !== tempRoot || !path.basename(tempPath).startsWith('shrub-textures-v1-')) throw new Error('Unsafe temp cleanup');
  fs.rmSync(temp, { recursive: true, force: true });
}
