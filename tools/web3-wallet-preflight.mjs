import { runWalletPreflight, WalletPreflightError } from '../server/web3/walletPreflight.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Uso: node tools/web3-wallet-preflight.mjs --check\n'
    + 'Solo lectura. Usa variables del proceso; no carga .env ni inicia el juego.\n'
    + 'Requiere MN_WEB3_WALLET_ENABLED=1, MN_WEB3_WALLET_ORIGIN, MN_WEB3_WALLET_CHAIN_ID,\n'
    + 'MN_WEB3_RPC_URL, SUPABASE_URL, SUPABASE_PUBLIC_KEY y SUPABASE_SERVICE_KEY.\n'
    + 'Comprueba SQL de wallet y RPC; no prueba login, extensión, finalidad ni uso de activos.');
} else if (args.length !== 1 || args[0] !== '--check') {
  console.error(JSON.stringify({ ok: false, why: 'arguments' }));
  process.exitCode = 2;
} else {
  try { console.log(JSON.stringify(await runWalletPreflight())); }
  catch (error) {
    console.error(JSON.stringify({ ok: false, why: error instanceof WalletPreflightError ? error.code : 'unavailable' }));
    process.exitCode = 1;
  }
}
