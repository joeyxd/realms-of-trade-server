import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { normalizeManifest } from '../src/render/assets/manifest.js';

const MAX_INDEX_BYTES = 8 * 1024 * 1024;
const MAX_CONTENT_BYTES = 64 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const ID = /^(?:model|prop):[A-Za-z0-9][A-Za-z0-9._:-]{0,156}$/;
const BASE_ID = /^base:(?:rock|flower|pebble):\d+:[a-f0-9]+$/;
const HEX = /^[a-f0-9]{64}$/i;
const TEXTURE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.ktx2']);
const RUNTIME_DIRS = ['src'];
const RUNTIME_FILES = [
  'src/editor/document.js', 'src/editor/baseIdentity.js', 'src/editor/publicationValidation.js',
  'src/editor/publicationArtifact.js', 'src/editor/modelFactory.js', 'src/net/protocol.js',
  'server/gmPublication.mjs', 'server/gmPublicationAssets.mjs',
  'index.html', 'package.json', 'package-lock.json',
  'assets/manifest.json', 'assets/editor/catalog.json',
];

export class GmPublicationAssetsError extends Error {
  constructor(code) { super(`GM publication assets unavailable: ${code}`); this.name = 'GmPublicationAssetsError'; this.code = code; }
}

function fail(code) { throw new GmPublicationAssetsError(code); }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function jsonBytes(value) { return Buffer.from(JSON.stringify(value), 'utf8'); }
function containedRelative(base, target) {
  const relative = path.relative(base, target);
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function safeRelative(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(value) || value.includes('\\') || value.includes(':') ||
      value.startsWith('/') || value.startsWith('\\') || value.split('/').some((part) => !part || part === '.' || part === '..')) return false;
  return true;
}

function entriesOf(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.assets)) fail('runtime');
  return value.assets;
}

function isModelOrProp(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return ['model', 'prop'].includes(entry.kind) ||
    (typeof entry.id === 'string' && ['model', 'prop'].includes(entry.id.split(':')[0]));
}

function validateGlb(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== bytes.length) fail('asset_format');
  let offset = 12, first = true, json = null, binaryLength = null;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail('asset_format');
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (length % 4 !== 0 || offset + length > bytes.length) fail('asset_format');
    if (first) {
      if (type !== 0x4e4f534a) fail('asset_format');
      try { json = JSON.parse(bytes.toString('utf8', offset, offset + length).replace(/[\u0000\u0020]+$/g, '')); }
      catch { fail('asset_format'); }
      first = false;
    } else if (type === 0x004e4942) {
      if (binaryLength !== null) fail('asset_format');
      binaryLength = length;
    }
    offset += length;
  }
  if (offset !== bytes.length || !json || typeof json !== 'object' || Array.isArray(json) ||
      json.asset?.version !== '2.0') fail('asset_format');
  for (const field of ['buffers', 'images']) {
    if (!Array.isArray(json[field])) continue;
    for (const item of json[field]) {
      if (item?.uri !== undefined && (typeof item.uri !== 'string' || !/^data:/i.test(item.uri))) fail('asset_format');
    }
  }
  const embedded = Array.isArray(json.buffers) ? json.buffers.filter((buffer) => buffer && buffer.uri === undefined) : [];
  if (embedded.length > 1 || (embedded.length === 1 && (!Number.isSafeInteger(embedded[0].byteLength) ||
      binaryLength === null || embedded[0].byteLength > binaryLength || binaryLength - embedded[0].byteLength > 3)) ||
      (embedded.length === 0 && binaryLength !== null)) fail('asset_format');
}

function loaderMetadata(entry) {
  const loader = { kind: entry.kind || entry.id.split(':')[0] };
  for (const key of ['fit', 'size', 'height', 'scale', 'rotY', 'yOffset', 'shadow', 'toon', 'props']) {
    if (entry[key] !== undefined) loader[key] = key === 'toon' ? structuredClone(entry[key]) : entry[key];
  }
  return loader;
}

async function readBounded(file, maxBytes, code = 'runtime') {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size > maxBytes) fail(code);
  const bytes = await readFile(file);
  if (bytes.length > maxBytes) fail(code);
  return bytes;
}

async function listFiles(root, dir) {
  let names;
  try { names = await readdir(path.join(root, dir), { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const item of names) {
    const rel = `${dir}/${item.name}`;
    if (item.isDirectory()) files.push(...await listFiles(root, rel));
    else if (item.isFile()) files.push(rel);
  }
  return files;
}

export function createGmPublicationAssets({ root }) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new TypeError('root must be absolute');
  const absoluteRoot = path.resolve(root);
  let prepared = null;

  async function prepare() {
    try {
      const [manifestBytes, catalogBytes] = await Promise.all([
        readBounded(path.join(absoluteRoot, 'assets/manifest.json'), MAX_INDEX_BYTES),
        readBounded(path.join(absoluteRoot, 'assets/editor/catalog.json'), MAX_INDEX_BYTES),
      ]);
      const manifest = JSON.parse(manifestBytes.toString('utf8'));
      const catalog = JSON.parse(catalogBytes.toString('utf8'));
      const normalizedManifest = normalizeManifest(manifest);
      if (normalizedManifest.errors.length) fail('runtime');
      const rawIndex = new Map();
      for (const entry of entriesOf(manifest)) {
        if (isModelOrProp(entry) && typeof entry.id === 'string') rawIndex.set(entry.id, entry);
      }
      // Matching catalog entries replace manifest entries, as in the editor's own index.
      for (const entry of entriesOf(catalog)) {
        if (isModelOrProp(entry) && typeof entry.id === 'string') rawIndex.set(entry.id, entry);
      }
      const rawEntries = [...rawIndex.values()];
      const normalized = normalizeManifest({ version: 1, assets: rawEntries });
      if (normalized.errors.some((message) => /src must be a relative path inside assets/i.test(message))) fail('asset_reference');
      if (normalized.errors.length || normalized.entries.size !== rawEntries.length) fail('runtime');
      const indexed = new Map(rawEntries.map((raw) => [raw.id, { entry: normalized.entries.get(raw.id), raw }]));

      const files = new Set(RUNTIME_FILES);
      for (const dir of RUNTIME_DIRS) for (const rel of await listFiles(absoluteRoot, dir)) files.add(rel);
      const runtimeFiles = [];
      for (const rel of [...files].sort()) {
        const bytes = await readBounded(path.join(absoluteRoot, rel), MAX_INDEX_BYTES);
        runtimeFiles.push({ path: rel, sha256: sha256(bytes), bytes: bytes.length });
      }
      const runtimeDigest = sha256(jsonBytes(runtimeFiles));
      prepared = { indexed, manifestEntries: [...normalizedManifest.entries.values()],
        runtime: { sha256: runtimeDigest, files: runtimeFiles } };
      return structuredClone(prepared.runtime);
    } catch (error) {
      if (error instanceof GmPublicationAssetsError) throw error;
      fail('runtime');
    }
  }

  async function resolve(document, extraAssetIds = []) {
    if (!prepared) fail('runtime');
    let serialized;
    try { serialized = JSON.stringify(document); } catch { fail('asset_reference'); }
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_DOCUMENT_BYTES ||
        !document || !Array.isArray(document.objects) || !Array.isArray(extraAssetIds)) fail('asset_reference');
    const ids = new Set([...document.objects.map((item) => item?.assetId), ...extraAssetIds]);
    for (const id of ids) {
      if (typeof id !== 'string' || (id.startsWith('base:') ? !BASE_ID.test(id) : !ID.test(id))) fail('asset_reference');
    }
    const selected = [...ids].filter((id) => !id.startsWith('base:')).sort();
    const output = [];
    for (const id of selected) {
      const selectedEntry = prepared.indexed.get(id);
      const entry = selectedEntry?.entry, raw = selectedEntry?.raw;
      if (!entry || !['model', 'prop'].includes(entry.kind) || !safeRelative(entry.src) || !entry.src.toLowerCase().endsWith('.glb')) fail('asset_reference');
      try {
        const assetsRoot = await realpath(path.join(absoluteRoot, 'assets'));
        const file = path.resolve(assetsRoot, ...entry.src.split('/'));
        if (!containedRelative(assetsRoot, file)) fail('asset_reference');
        const realFile = await realpath(file);
        if (!containedRelative(assetsRoot, realFile)) fail('asset_reference');
        const bytes = await readBounded(realFile, MAX_CONTENT_BYTES, 'asset_unavailable');
        validateGlb(bytes);
        const digest = sha256(bytes);
        if (raw.stats?.sha256 !== undefined && (!HEX.test(raw.stats.sha256) || raw.stats.sha256.toLowerCase() !== digest)) fail('asset_hash');
        output.push({ id, src: `assets/${entry.src}`, sha256: digest, bytes: bytes.length,
          loader: loaderMetadata(entry), status: typeof raw.status === 'string' ? raw.status : 'ready' });
      } catch (error) {
        if (error instanceof GmPublicationAssetsError) throw error;
        if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error?.code)) fail('asset_unavailable');
        fail('asset_unavailable');
      }
    }
    return output;
  }

  async function resolveBaseline() {
    if (!prepared) fail('runtime');
    const output = [];
    try {
      const assetsRoot = await realpath(path.join(absoluteRoot, 'assets'));
      for (const entry of prepared.manifestEntries) {
        const variants = [['default', entry.src]];
        if (entry.kind === 'tex' && entry.mobileSrc) variants.push(['mobile', entry.mobileSrc]);
        for (const [variant, src] of variants) {
          if (!safeRelative(src)) fail('asset_reference');
          const extension = path.extname(src).toLowerCase();
          if (entry.kind === 'tex' ? !TEXTURE_EXTENSIONS.has(extension) : extension !== '.glb') fail('asset_format');
          const file = path.resolve(assetsRoot, ...src.split('/'));
          if (!containedRelative(assetsRoot, file)) fail('asset_reference');
          const realFile = await realpath(file);
          if (!containedRelative(assetsRoot, realFile)) fail('asset_reference');
          const bytes = await readBounded(realFile, MAX_CONTENT_BYTES, 'asset_unavailable');
          if (entry.kind !== 'tex') validateGlb(bytes);
          output.push({ id: entry.id, variant, src: `assets/${src}`, sha256: sha256(bytes), bytes: bytes.length });
        }
      }
      output.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.variant < b.variant ? -1 : a.variant > b.variant ? 1 : 0);
      return output;
    } catch (error) {
      if (error instanceof GmPublicationAssetsError) throw error;
      if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error?.code)) fail('asset_unavailable');
      fail('asset_unavailable');
    }
  }

  return { prepare, resolve, resolveBaseline, get runtime() { return prepared ? structuredClone(prepared.runtime) : null; } };
}
