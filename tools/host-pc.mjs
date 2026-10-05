// One local authority and one temporary HTTPS tunnel, with a private shutdown endpoint.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createGameServer } from '../server/index.mjs';
import { storeFromEnv } from '../server/store.mjs';
import { accountAuthFromEnv } from '../server/auth.mjs';
import { GAME } from '../src/data/meta.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, '.scratch', 'pc-host');
const SESSION = path.join(STATE, 'session.json');
const LINK = path.join(ROOT, 'URL-PARA-AMIGOS.txt');
// Official Cloudflare release and SHA256, checked against its GitHub release metadata.
const RELEASE = '2026.9.3';
const BINARY_HASH = 'f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2';
const BINARY = path.join(STATE, `cloudflared-${RELEASE}.exe`);
const DOWNLOAD = `https://github.com/cloudflare/cloudflared/releases/download/${RELEASE}/cloudflared-windows-amd64.exe`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { values } = parseArgs({ options: {
  local: { type: 'boolean' }, stop: { type: 'boolean' }, 'no-open': { type: 'boolean' },
  port: { type: 'string' }, help: { type: 'boolean' },
  tunnel: { type: 'string' },
} });

function readSession() {
  try { return JSON.parse(fs.readFileSync(SESSION, 'utf8')); } catch { return null; }
}

async function control(session, action) {
  if (!session || !Number.isInteger(session.controlPort) || session.controlPort < 1 || session.controlPort > 65535) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${session.controlPort}/${action}`, {
      method: action === 'stop' ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${session.controlToken}` }, signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch { return false; }
}

async function cloudflared() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('El túnel automático necesita Windows de 64 bits. Usa --local en otros equipos.');
  const valid = () => fs.existsSync(BINARY) && createHash('sha256').update(fs.readFileSync(BINARY)).digest('hex') === BINARY_HASH;
  if (valid()) return BINARY;
  console.log('Descargando cloudflared oficial (solo la primera vez, sin instalación global)...');
  const response = await fetch(DOWNLOAD, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`No se pudo descargar cloudflared: HTTP ${response.status}.`);
  const body = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(body).digest('hex') !== BINARY_HASH) throw new Error('La descarga no coincide con el SHA256 oficial. No se ejecutará.');
  const temp = `${BINARY}.${process.pid}.tmp`;
  fs.writeFileSync(temp, body);
  fs.renameSync(temp, BINARY);
  return BINARY;
}

function openBrowser(url) {
  if (values['no-open'] || process.platform !== 'win32') return;
  // Explorer receives a validated URL as one argument, without shell interpolation.
  const browser = spawn('explorer.exe', [url], { detached: true, stdio: 'ignore', windowsHide: true });
  browser.on('error', () => {});
  browser.unref();
}

async function main() {
  if (values.help) {
    console.log('npm run play:friends [-- --port 5173 --no-open --tunnel auto|ngrok|cloudflare]\nnpm run play:local\nnpm run play:stop\nMantén el lanzador encendido; Ctrl+C lo detiene.');
    return;
  }
  const existing = readSession();
  if (values.stop) {
    console.log(await control(existing, 'stop') ? 'Cerrando el juego y el túnel...' : 'No hay un lanzador activo.');
    return;
  }
  if (await control(existing, 'health')) {
    console.log(`El servidor ya está encendido.\nEn tu PC: ${existing.localUrl}\nPara compartir: ${existing.publicUrl || 'túnel en preparación o modo local'}\nUsa DETENER-JUEGO.cmd para apagarlo.`);
    openBrowser(existing.publicUrl || existing.localUrl);
    return;
  }

  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const port = Number(values.port || process.env.PORT || 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('El puerto debe ser un número entre 1 y 65535.');
  const maxPlayers = Number(process.env.MAX_PLAYERS || 4), bots = Number(process.env.BOTS || 3);
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 32) throw new Error('MAX_PLAYERS debe estar entre 2 y 32.');
  if (!Number.isInteger(bots) || bots < 0 || bots > 32) throw new Error('BOTS debe estar entre 0 y 32.');
  const requestedTunnel = values.tunnel || process.env.PC_TUNNEL || 'auto';
  if (!['auto', 'ngrok', 'cloudflare'].includes(requestedTunnel)) throw new Error('El túnel debe ser auto, ngrok o cloudflare.');
  const ngrokCommand = process.platform === 'win32' ? 'ngrok.exe' : 'ngrok';
  const ngrokReady = !values.local && requestedTunnel === 'auto' &&
    spawnSync(ngrokCommand, ['config', 'check'], { windowsHide: true, stdio: 'ignore', timeout: 5000 }).status === 0;
  const tunnelKind = requestedTunnel === 'auto' ? (ngrokReady ? 'ngrok' : 'cloudflare') : requestedTunnel;
  fs.mkdirSync(STATE, { recursive: true });
  const secretFile = path.join(STATE, 'save-secret');
  if (!process.env.SAVE_SECRET) {
    if (!fs.existsSync(secretFile)) {
      try { fs.writeFileSync(secretFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    process.env.SAVE_SECRET = fs.readFileSync(secretFile, 'utf8').trim();
    if (!process.env.SAVE_SECRET) throw new Error('El secreto local de guardado está vacío.');
  }
  fs.rmSync(LINK, { force: true });
  const localUrl = `http://localhost:${port}`;
  const auth = accountAuthFromEnv(process.env);
  const gs = createGameServer({ port, host: '127.0.0.1', maxPlayers, bots, dev: false,
    saveSecret: process.env.SAVE_SECRET, store: storeFromEnv(process.env),
    resolvePlayer: auth.resolvePlayer, publicAuth: auth.publicConfig, initializeAccounts: auth.publicConfig.enabled,
    worldId: process.env.WORLD_ID ?? 'marea-negra', worldSaveMs: Number(process.env.WORLD_SAVE_SECONDS ?? 60) * 1000,
    origins: [localUrl, `http://127.0.0.1:${port}`],
  });
  let tunnel, admin, session, shuttingDown;
  const shutdown = () => {
    if (shuttingDown) return shuttingDown;
    shuttingDown = (async () => {
      console.log('Cerrando el túnel y guardando los perfiles...');
      tunnel?.kill();
      const deadline = setTimeout(() => process.exit(1), 15000);
      deadline.unref();
      if (readSession()?.pid === process.pid) fs.rmSync(SESSION, { force: true });
      fs.rmSync(LINK, { force: true });
      if (admin) await new Promise((resolve) => admin.close(resolve));
      await gs.close();
      clearTimeout(deadline);
    })();
    return shuttingDown;
  };
  const onSignal = () => { shutdown().then(() => process.exit(0), () => process.exit(1)); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  // A listen failure must reject instead of becoming an unhandled server error.
  try {
    await Promise.race([gs.listen(), new Promise((_, reject) => gs.server.once('error', reject))]);
    const controlToken = randomBytes(32).toString('hex');
    admin = http.createServer((req, res) => {
      if (req.headers.authorization !== `Bearer ${controlToken}`) { res.writeHead(403).end(); return; }
      if (req.url === '/health' && req.method === 'GET') { res.writeHead(200).end('ok'); return; }
      if (req.url === '/stop' && req.method === 'POST') {
        res.writeHead(200, { connection: 'close' }).end('closing');
        setImmediate(onSignal);
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise((resolve, reject) => { admin.once('error', reject); admin.listen(0, '127.0.0.1', resolve); });
    session = { pid: process.pid, controlPort: admin.address().port, controlToken, localUrl, publicUrl: null, tunnel: values.local ? null : tunnelKind };
    const saveSession = () => fs.writeFileSync(SESSION, JSON.stringify(session), { mode: 0o600 });
    saveSession();
    console.log(`${GAME.title} · ${maxPlayers} jugadores · puerto ${port}\nEn tu PC: ${localUrl}\nCuentas: ${auth.publicConfig.enabled ? 'activadas' : 'modo invitado'} · DEV desactivado`);
    if (values.local) {
      fs.writeFileSync(LINK, `En tu PC: ${localUrl}\nModo local. Para generar una URL pública usa JUGAR-CON-AMIGOS.cmd.\n`);
      openBrowser(localUrl);
      return;
    }
    console.log(`Preparando túnel ${tunnelKind}...`);
    const binary = tunnelKind === 'ngrok' ? ngrokCommand : await cloudflared();
    if (shuttingDown) return;
    // Explicit empty config avoids colliding with any personal Cloudflare tunnels.
    const config = path.join(STATE, 'quick-tunnel.yml');
    fs.writeFileSync(config, '{}\n');
    const tunnelArgs = tunnelKind === 'ngrok'
      ? ['http', `http://127.0.0.1:${port}`, '--log=stdout', '--log-format=json', '--inspect=false']
      : ['tunnel', '--config', config, '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`];
    tunnel = spawn(binary, tunnelArgs,
      { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const tunnelLog = fs.createWriteStream(path.join(STATE, 'tunnel.log'), { flags: 'w' });
    const publicUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('El túnel tardó demasiado en generar la URL. Revisa .scratch/pc-host/tunnel.log.')), 60000);
      let buffer = '';
      const scan = (chunk) => {
        tunnelLog.write(chunk);
        buffer = (buffer + String(chunk)).slice(-4096);
        const match = buffer.match(/https:\/\/[a-z0-9-]+\.(?:trycloudflare\.com|ngrok-free\.(?:dev|app)|ngrok\.(?:app|dev))\b/);
        if (match) { clearTimeout(timeout); resolve(match[0]); }
      };
      tunnel.stdout.on('data', scan);
      tunnel.stderr.on('data', scan);
      tunnel.once('error', () => { clearTimeout(timeout); reject(new Error(`No se pudo ejecutar ${tunnelKind}. Usa --tunnel cloudflare si ngrok no está instalado.`)); });
      tunnel.once('exit', () => {
        clearTimeout(timeout); tunnelLog.end();
        reject(new Error('El túnel se cerró antes de obtener la URL. Revisa .scratch/pc-host/tunnel.log.'));
        if (!shuttingDown) { console.error('Se perdió el túnel. Reinicia JUGAR-CON-AMIGOS.cmd.'); onSignal(); }
      });
    });
    gs.game.origins.push(publicUrl);
    console.log('URL asignada; comprobando que el juego sea accesible por HTTPS...');
    let ready = false;
    const readyDeadline = Date.now() + 180000;
    let nextNotice = Date.now() + 15000;
    while (Date.now() < readyDeadline && !shuttingDown) {
      try {
        const response = await fetch(`${publicUrl}/health`, { headers: { 'ngrok-skip-browser-warning': 'marea-negra-playtest' }, signal: AbortSignal.timeout(3000) });
        if (response.ok && (await response.text()) === 'ok') { ready = true; break; }
      } catch {}
      if (Date.now() >= nextNotice) {
        console.log('Esperando que la dirección HTTPS nueva esté disponible en DNS...');
        nextNotice = Date.now() + 15000;
      }
      await sleep(1000);
    }
    if (shuttingDown) return;
    if (!ready) throw new Error('La URL pública todavía no responde. Revisa la conexión y vuelve a iniciar el lanzador.');
    session.publicUrl = publicUrl;
    saveSession();
    fs.writeFileSync(LINK, `URL PARA LOS DOS: ${publicUrl}\n\nEn tu PC también puedes entrar en ${localUrl}\nMantén tu PC encendida. Para apagar: DETENER-JUEGO.cmd o Ctrl+C.\n${tunnelKind === 'cloudflare' ? 'La URL cambia al iniciar un nuevo túnel.' : 'Si ngrok muestra su aviso inicial, pulsa Visit Site para entrar al juego.'}\n`);
    console.log(`\nURL PARA LOS DOS: ${publicUrl}\nGuardada en URL-PARA-AMIGOS.txt\nMantén tu PC encendida. Ctrl+C o DETENER-JUEGO.cmd para apagar.\n`);
    openBrowser(publicUrl);
  } catch (error) {
    await shutdown();
    if (error.code === 'EADDRINUSE') throw new Error(`El puerto ${port} ya está ocupado. Cierra la vista previa que lo utiliza y vuelve a iniciar; no arrancamos otra autoridad de cuentas.`);
    throw error;
  }
}

main().catch((error) => { console.error(`No se pudo iniciar: ${error.message}`); process.exitCode = 1; });
