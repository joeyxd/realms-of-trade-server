// Local, read-only preview of the real game. No multiplayer server or persistence activation.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
export function createSandPreviewServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      const requestURL = new URL(req.url, 'http://local');
      const url = decodeURIComponent(requestURL.pathname);
      if (url !== '/' && !['/src/', '/styles/', '/assets/'].some((p) => url.startsWith(p))) { res.writeHead(404).end(); return; }
      const file = path.resolve(root, `.${url === '/' ? '/index.html' : url}`);
      const real = await fs.promises.realpath(file);
      if (!real.startsWith(root + path.sep) || !(await fs.promises.stat(real)).isFile()) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') res.end();
      else if (url === '/' && requestURL.searchParams.get('art') === 'rocks') {
        // Local author preview only: use the game's existing solo debug command after Play.
        const preview = `<script type="module">
          const timer = setInterval(() => {
            const m = window.__mn;
            if (m?.st?.mode === 'playing' && m.teleport) { clearInterval(timer); m.teleport(113, 63); }
          }, 200);
          setTimeout(() => clearInterval(timer), 120000);
        </script>`;
        res.end((await fs.promises.readFile(real, 'utf8')).replace('</body>', preview + '</body>'));
      } else fs.createReadStream(real).pipe(res);
    } catch { res.writeHead(404).end(); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createSandPreviewServer();
  server.listen(5192, '127.0.0.1', () => console.log('Mapa con arenas: http://127.0.0.1:5192/?solo&debug&q=high&tod=day\nCtrl+C para cerrar.'));
}
