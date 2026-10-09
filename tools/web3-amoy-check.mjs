import { createAmoyRpcProbe, AmoyRpcProbeError } from '../server/web3/amoyRpcProbe.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Uso: node tools/web3-amoy-check.mjs --check\n'
    + 'Diagnostico Amoy solo lectura: red, bloque, selectores por hash e identity precompile.\n'
    + 'Requiere MN_WEB3_RPC_URL y MN_WEB3_WALLET_CHAIN_ID=80002 en el proceso.\n'
    + 'No carga .env, inicia el juego, firma, envia transacciones ni necesita fondos.\n'
    + 'No prueba honestidad/finalidad, rechazo de bloques no canonicos, archivo historico,\n'
    + 'contratos NFT, Supabase, wallet, OpenSea o costes de gas. Sin fallback ni reintentos.');
} else if (args.length !== 1 || args[0] !== '--check') {
  console.error(JSON.stringify({ ok: false, why: 'arguments' }));
  process.exitCode = 2;
} else {
  try {
    const env = process.env;
    if (env.MN_WEB3_WALLET_CHAIN_ID !== '80002') throw new AmoyRpcProbeError('configuration');
    const probe = createAmoyRpcProbe({ url: env.MN_WEB3_RPC_URL, chainId: 80002 });
    console.log(JSON.stringify(await probe.observe()));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, why: error instanceof AmoyRpcProbeError ? error.code : 'unavailable' }));
    process.exitCode = 1;
  }
}
