// Local review launcher. It does not read .env or connect to a production account store.
import path from 'node:path';
import { createGameServer } from '../../server/index.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const game = createGameServer({ root, port: Number(process.env.MN_ASSET_WORKSHOP_PORT || 5301), host: '127.0.0.1', bots: 0,
  saveSecret: 'asset-workshop-offline-local', publicAuth: { enabled: false }, chat: { enabled: false }, log: () => {} });
console.log(`Taller de assets local: http://127.0.0.1:${await game.listen()}/?solo`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await game.close(); process.exit(0); });
