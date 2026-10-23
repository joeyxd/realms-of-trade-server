// Explicit public addresses only. Output is an unsigned review, not a deploy command.
import { AmoyDeploymentError, prepareAmoyDeployment } from './amoyDeployment.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write('Preparacion Amoy: --prepare genera JSON sin firmar. No envia transacciones.\n'
    + 'Requiere MN_WEB3_WALLET_CHAIN_ID=80002, MN_WEB3_AMOY_DEPLOYER_ADDRESS y MN_WEB3_AMOY_MINT_OPERATOR_ADDRESS.\n'
    + 'Solo direcciones publicas; no carga .env ni usa RPC, wallet, claves o fondos.\n'
    + 'Simulacion, gas, firma y recibos publicos siguen pendientes.\n');
} else if (args.length !== 1 || args[0] !== '--prepare') {
  process.stderr.write('{"ok":false,"why":"arguments"}\n');
  process.exitCode = 2;
} else {
  try {
    if (process.env.MN_WEB3_WALLET_CHAIN_ID !== '80002') throw new AmoyDeploymentError('input');
    const report = prepareAmoyDeployment({ chainId: 80002,
      deployerAddress: process.env.MN_WEB3_AMOY_DEPLOYER_ADDRESS,
      mintOperatorAddress: process.env.MN_WEB3_AMOY_MINT_OPERATOR_ADDRESS });
    process.stdout.write(JSON.stringify({ ok: true, report }) + '\n');
  } catch (error) {
    const why = error instanceof AmoyDeploymentError && error.why === 'input' ? 'input' : 'artifact';
    process.stderr.write(JSON.stringify({ ok: false, why }) + '\n');
    process.exitCode = 1;
  }
}
