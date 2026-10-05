// Create a reproducible, commit-pinned local release folder without reading dirty source files.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maxGitBuffer = 512 * 1024 * 1024;
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: maxGitBuffer, stdio: ['ignore', 'pipe', 'pipe'] });
const gitBuffer = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: maxGitBuffer, stdio: ['ignore', 'pipe', 'pipe'] });
const fail = (message) => { throw new Error(message); };
const args = process.argv.slice(2);
if (args.length > 2) fail('Usage: node tools/build-release.mjs [commit=HEAD] [output=dist/<version>-<shortsha>]');

function argValue(raw, key, fallback) {
  if (raw === undefined) return fallback;
  return raw.startsWith(`${key}=`) ? raw.slice(key.length + 1) : raw;
}

const commitArg = argValue(args[0], 'commit', 'HEAD');
const outputArg = argValue(args[1], 'output', undefined);
const sourceSha = git('rev-parse', '--verify', `${commitArg}^{commit}`).trim();
if (!/^[0-9a-f]{40,64}$/i.test(sourceSha)) fail('Git did not return a full commit SHA.');
const shortSha = sourceSha.slice(0, 12);

const readCommitted = (name) => git('show', `${sourceSha}:${name}`);
const packageInfo = JSON.parse(readCommitted('package.json'));
const metaText = readCommitted('src/data/meta.js');
const protocolText = readCommitted('src/net/protocol.js');
const versionMatch = metaText.match(/\bversion\s*:\s*(['"])([^'"]+)\1/);
const protocolMatch = protocolText.match(/export\s+const\s+PROTOCOL_VERSION\s*=\s*(\d+)\b/);
if (!packageInfo.version || !versionMatch || !protocolMatch) fail('Could not read package, game version, and protocol version from the selected commit.');
if (packageInfo.version !== versionMatch[2]) fail(`Version mismatch in ${sourceSha}: package.json=${packageInfo.version}, src/data/meta.js=${versionMatch[2]}.`);
const version = packageInfo.version;
const protocolVersion = Number(protocolMatch[1]);
if (!Number.isSafeInteger(protocolVersion)) fail('Protocol version is not a safe integer.');

const distRoot = path.resolve(repo, 'dist');
const outputText = outputArg ?? path.join('dist', `${version}-${shortSha}`);
const outputPath = path.resolve(repo, outputText);
const relOutput = path.relative(distRoot, outputPath);
if (!relOutput || relOutput === '.' || relOutput.startsWith(`..${path.sep}`) || path.isAbsolute(relOutput)) {
  fail('Output must be a child folder of this repository’s dist directory.');
}

const realRepo = fs.realpathSync(repo);
if (fs.existsSync(distRoot) && fs.lstatSync(distRoot).isSymbolicLink()) fail('Repository dist directory must not be a symbolic link.');
fs.mkdirSync(distRoot, { recursive: true });
const realDist = fs.realpathSync(distRoot);
const distRelative = path.relative(realRepo, realDist);
if (distRelative.startsWith(`..${path.sep}`) || distRelative === '..' || path.isAbsolute(distRelative)) {
  fail('Repository dist directory resolves outside the repository.');
}
const outputParent = path.dirname(outputPath);
let cursor = distRoot;
for (const part of path.relative(distRoot, outputParent).split(path.sep).filter(Boolean)) {
  cursor = path.join(cursor, part);
  if (fs.existsSync(cursor)) {
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('Output path contains a symbolic link or non-directory component.');
  } else fs.mkdirSync(cursor);
}
const realParent = fs.realpathSync(outputParent);
const realRelative = path.relative(realDist, realParent);
if (realRelative.startsWith(`..${path.sep}`) || realRelative === '..' || path.isAbsolute(realRelative)) {
  fail('Output resolves outside this repository’s dist directory.');
}
if (fs.existsSync(outputPath)) {
  const stat = fs.lstatSync(outputPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('Output path exists and is not a regular directory.');
  if (fs.readdirSync(outputPath).length) fail('Output folder is already populated.');
}

const treeEntries = git('ls-tree', '-r', '-z', '--full-tree', sourceSha).split('\0').filter(Boolean);
const included = [];
for (const entry of treeEntries) {
  const tab = entry.indexOf('\t');
  const header = entry.slice(0, tab).split(' ');
  const filePath = entry.slice(tab + 1);
  if (header[1] !== 'blob') continue;
  const allowed = filePath === 'index.html'
    || (filePath.startsWith('src/') && filePath.endsWith('.js'))
    || (filePath.startsWith('styles/') && filePath.endsWith('.css'))
    || (filePath.startsWith('assets/') && /\.(json|glb|gltf|bin|png|jpe?g|webp|ktx2)$/i.test(filePath));
  if (allowed) included.push(filePath);
}
for (const required of ['index.html', 'tools/build-artifact.mjs', 'package.json', 'src/data/meta.js', 'src/net/protocol.js', 'assets/manifest.json']) {
  if (required === 'tools/build-artifact.mjs') {
    if (!treeEntries.some((entry) => entry.slice(entry.indexOf('\t') + 1) === required)) fail(`Commit is missing ${required}.`);
  } else if (required === 'package.json' || required === 'src/data/meta.js' || required === 'src/net/protocol.js') {
    // Read above from the object database; these are staging inputs, not published files.
  } else if (!included.includes(required)) fail(`Commit is missing required publish file ${required}.`);
}

const random = crypto.randomBytes(6).toString('hex');
const stageRoot = fs.mkdtempSync(path.join(distRoot, `.release-build-${shortSha}-${process.pid}-${random}-`));
for (const name of included) {
  const destination = path.join(stageRoot, name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, gitBuffer('show', `${sourceSha}:${name}`));
}
const builderPath = path.join(stageRoot, 'tools', 'build-artifact.mjs');
fs.mkdirSync(path.dirname(builderPath), { recursive: true });
fs.writeFileSync(builderPath, gitBuffer('show', `${sourceSha}:tools/build-artifact.mjs`));
const generatedPage = path.join(stageRoot, 'index.html');
const builderOutput = execFileSync(process.execPath, [builderPath, generatedPage], { cwd: stageRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let buildResult;
try { buildResult = JSON.parse(builderOutput); } catch { fail('Committed artifact builder did not return valid JSON metadata.'); }
if (!Array.isArray(buildResult.files)) fail('Committed artifact builder returned no publish file list.');

const publishPaths = new Set(['index.html']);
for (const item of buildResult.files) {
  if (typeof item !== 'string' || item.includes('\\') || path.posix.isAbsolute(item)) fail(`Invalid publish path returned by committed builder: ${item}`);
  const normalized = path.posix.normalize(item);
  if (normalized !== item || normalized === '..' || normalized.startsWith('../')) fail(`Unsafe publish path returned by committed builder: ${item}`);
  const allowed = (item.startsWith('src/') && item.endsWith('.js'))
    || (item.startsWith('assets/') && /\.(json|glb|gltf|bin|png|jpe?g|webp|ktx2)$/i.test(item));
  if (!allowed || !included.includes(item)) fail(`Committed builder requested an unapproved or absent file: ${item}`);
  publishPaths.add(item);
}
if (!publishPaths.has('assets/manifest.json')) fail('Publish set does not include assets/manifest.json.');

const files = [...publishPaths].sort();
const hasFile = (filePath) => fs.existsSync(path.join(stageRoot, filePath)) && fs.statSync(path.join(stageRoot, filePath)).isFile();
const page = fs.readFileSync(path.join(stageRoot, 'index.html'), 'utf8');
if (!/src\/main\.js/.test(page)) fail('Generated page does not reference src/main.js.');
for (const match of page.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
  const reference = match[1];
  if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(reference)) continue;
  const local = path.posix.normalize(path.posix.join('.', reference.split(/[?#]/, 1)[0]));
  if (local.startsWith('../') || !publishPaths.has(local) || !hasFile(local)) fail(`Generated page references a missing publish file: ${reference}`);
}
for (const moduleFile of files.filter((name) => name.startsWith('src/') && name.endsWith('.js'))) {
  const source = fs.readFileSync(path.join(stageRoot, moduleFile), 'utf8');
  const imports = [...source.matchAll(/^[\t ]*(?:import|export)\b[^\r\n;]*?\bfrom\s*["']([^"']+)["']|^[\t ]*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gm)];
  for (const match of imports) {
    const specifier = match[1] || match[2] || match[3];
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      if (specifier === 'three' || specifier === 'gsap' || specifier.startsWith('three/addons/')) continue;
      fail(`Unmapped bare module import ${specifier} in ${moduleFile}.`);
    }
    if (specifier.startsWith('/')) fail(`Absolute module import ${specifier} in ${moduleFile}.`);
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(moduleFile), specifier));
    if (!target.startsWith('src/') || !target.endsWith('.js') || !publishPaths.has(target) || !hasFile(target)) fail(`Module import ${specifier} from ${moduleFile} does not resolve inside the publish tree.`);
  }
}
try { JSON.parse(fs.readFileSync(path.join(stageRoot, 'assets/manifest.json'), 'utf8')); }
catch { fail('Published assets/manifest.json is missing or invalid JSON.'); }

const artifactFiles = files.map((name) => {
  const data = fs.readFileSync(path.join(stageRoot, name));
  return { path: name, bytes: data.byteLength, sha256: crypto.createHash('sha256').update(data).digest('hex') };
});
const release = { sourceSha, version, protocolVersion, files: artifactFiles };
if (!fs.existsSync(outputPath)) fs.mkdirSync(outputPath, { recursive: true });
for (const name of files) {
  const source = path.join(stageRoot, name);
  const destination = path.join(outputPath, name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}
fs.writeFileSync(path.join(outputPath, 'release.json'), `${JSON.stringify(release, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify({ output: path.relative(repo, outputPath).split(path.sep).join('/'), sourceSha, version, protocolVersion, fileCount: files.length, bytes: artifactFiles.reduce((sum, file) => sum + file.bytes, 0) })}\n`);
