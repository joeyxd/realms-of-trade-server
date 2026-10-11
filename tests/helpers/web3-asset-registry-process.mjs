import { database } from './web3-asset-registry-sql.mjs';

const [mode, location] = process.argv.slice(2);
const id = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const request = {
  operationId: id(900), action: 'register', assetId: id(901), worldId: 'process:world',
  worldGeneration: id(902), assetClass: 'plot', sourceKey: 'process:plot:0', contentId: 'process:lot',
  contentHash: 'e'.repeat(64), rightsHash: 'f'.repeat(64), to: id(903),
};
let sql;
try {
  if (mode === 'prepare') {
    sql = await database(location, { adapterOptions: { loseReply: (name) => name === 'mn_web3_prepare' } });
    let lost = null;
    try { await sql.registry.prepare(request); } catch (error) { lost = error.code; }
    if (lost !== 'unavailable') throw new Error(`Expected lost prepare reply, got ${lost}`);
    await sql.close(); sql = null;
    process.stdout.write(JSON.stringify({ phase: mode, lost, request }));
  } else if (mode === 'resume') {
    sql = await database(location, { reapply: true });
    const before = await sql.registry.loadOperation(request.operationId);
    if (!before || before.state !== 'pending' || JSON.stringify(before.request) !== JSON.stringify(request)) throw new Error('Pending request did not survive reopen');
    const prepared = await sql.registry.prepare(request);
    if (prepared.replay !== true) throw new Error('Prepare did not replay exact pending operation');
    const committed = await sql.registry.commit(request.operationId);
    await sql.close(); sql = null;
    process.stdout.write(JSON.stringify({ phase: mode, state: before.state, committed }));
  } else if (mode === 'read') {
    sql = await database(location);
    const operation = await sql.registry.loadOperation(request.operationId), asset = await sql.registry.loadAsset(request.assetId);
    const replay = await sql.registry.commit(request.operationId);
    await sql.close(); sql = null;
    process.stdout.write(JSON.stringify({ phase: mode, operation, asset, replay }));
  } else throw new Error(`Unknown process phase ${mode}`);
} catch (error) {
  process.stderr.write(JSON.stringify({ message: error.message, code: error.code })); process.exitCode = 1;
} finally { if (sql) await sql.close(); }
