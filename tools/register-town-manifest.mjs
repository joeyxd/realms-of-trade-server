#!/usr/bin/env node
// Register only the paired S14 town wood atlases while preserving unrelated manifest entries.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { normalizeManifest } from '../src/render/assets/manifest.js';

const root = new URL('../', import.meta.url);
const file = new URL('assets/manifest.json', root);
const before = fs.readFileSync(file);
const manifest = JSON.parse(before);
const receiptFile = new URL('docs/art/town-wood/material-receipt-v1.json', root);
if (!fs.existsSync(receiptFile)) throw new Error('Missing S14 material receipt');
const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
const expected = [
  { id: 'tex:town-wood-albedo-v1', src: 'textures/town-wood-v1/atlas-albedo-desktop.webp', mobileSrc: 'textures/town-wood-v1/atlas-albedo-mobile.webp', repeat: [1, 1], notes: 'S14 supplied town wood albedo maps in a padded 4x4 atlas; desktop 2048 / mobile 1024. See docs/art/town-wood/material-receipt-v1.json.' },
  { id: 'tex:town-wood-normal-v1', src: 'textures/town-wood-v1/atlas-normal-desktop.webp', mobileSrc: 'textures/town-wood-v1/atlas-normal-mobile.webp', repeat: [1, 1], data: true, notes: 'S14 supplied town wood tangent-space normal maps in a padded 4x4 atlas; desktop 2048 / mobile 1024. See docs/art/town-wood/material-receipt-v1.json.' },
].map((entry) => ({ kind: 'tex', ...entry }));
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
for (const entry of expected) {
  for (const relative of [entry.src, entry.mobileSrc]) {
    const path = `assets/${relative}`;
    const recorded = receipt.derivatives?.find((item) => item.path === path);
    const target = new URL(path, root);
    if (!recorded || !fs.existsSync(target) || fs.statSync(target).size !== recorded.bytes || digest(fs.readFileSync(target)) !== recorded.sha256) throw new Error(`Missing or unverified S14 derivative: ${path}`);
  }
}
let changed = false;
for (const entry of expected) {
  const current = manifest.assets.find((item) => item.id === entry.id);
  if (current && JSON.stringify(current) !== JSON.stringify(entry)) throw new Error(`Refusing different manifest entry: ${entry.id}`);
  if (!current) { manifest.assets.push(entry); changed = true; }
}
const valid = normalizeManifest(manifest);
for (const entry of expected) if (!valid.entries.has(entry.id)) throw new Error(valid.errors.join('\n'));
if (!fs.readFileSync(file).equals(before)) throw new Error('Manifest changed during registration');
if (changed) {
  const temporary = new URL(`assets/manifest.json.${process.pid}.town.tmp`, root);
  try {
    fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    if (!fs.readFileSync(file).equals(before)) throw new Error('Concurrent manifest edit');
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.rmSync(temporary); }
}
console.log(`S14 town wood manifest: 2 runtime atlas entries${changed ? ' added' : ' unchanged'}.`);
