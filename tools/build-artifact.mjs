// Builds the page file for publishing as a multi-file Artifact: same game, styles inlined, no
// <!doctype>/<html>/<head>/<body> (the host wraps the page). JS modules are published as-is.
// Usage: node tools/build-artifact.mjs <outFile>   → prints the list of files to publish.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist', 'index.html'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
const fonts = [...head.matchAll(/<link rel="(?:preconnect|stylesheet)" href="https:\/\/fonts\.[^"]+"[^>]*>/g)].map((m) => m[0]).join('\n');
const css = [...head.matchAll(/<link rel="stylesheet" href="(styles\/[^"]+)">/g)]
  .map((m) => `/* ${m[1]} */\n` + fs.readFileSync(path.join(root, m[1]), 'utf8')).join('\n');

const page = `${title}
<meta name="theme-color" content="#0b1630">
${fonts}
<style>
${css}
</style>
${body.trim()}
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) walk(rel);
    else if (e.name.endsWith('.js')) files.push(rel);
  }
};
walk('src');
console.log(JSON.stringify({ page: out, bytes: page.length, files }, null, 1));
