// Web Worker entry: hosts the authoritative LocalServer off the main thread.
import { LocalServer } from './localServer.js';
import { MSG } from './protocol.js';

let server = null;
const CLIENT = 1;

self.onmessage = (ev) => {
  const msg = ev.data;
  if (msg && msg.t === 'boot') {
    server = new LocalServer({ fire: true, seed: msg.seed, bots: msg.bots, debug: !!msg.debug, send: (_id, m) => self.postMessage(m) });
    server.connect(CLIENT);
    server.start();
    self.postMessage({ t: MSG.READY });
    return;
  }
  if (server) server.receive(CLIENT, msg);
};
