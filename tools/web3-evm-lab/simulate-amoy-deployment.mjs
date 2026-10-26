// Explicit read-only RPC review. Never load .env or access a wallet/key/signing provider.
import { AmoySimulationError, simulateAmoyDeployment } from './amoySimulation.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write('Simulacion Amoy: --simulate emite JSON; siete consultas RPC, sin firma/envio.\n'
    + 'Requiere MN_WEB3_WALLET_CHAIN_ID=80002 y MN_WEB3_WALLET_RPC_URL explicito.\n'
    + 'MN_WEB3_AMOY_DEPLOYER_ADDRESS, MN_WEB3_AMOY_MINT_OPERATOR_ADDRESS: direcciones publicas.\n'
    + 'MN_WEB3_AMOY_SIMULATION_GAS_LIMIT: entero decimal 53000..30000000 para simulacion.\n'
    + 'Costo orientativo en wei de POL de prueba, sin permiso de gasto ni cotizacion mainnet/USD.\n'
    + 'No carga .env, escribe archivos, usa claves o envia transacciones.\n');
} else if (args.length !== 1 || args[0] !== '--simulate') {
  process.stderr.write('{"ok":false,"why":"arguments"}\n');
  process.exitCode = 2;
} else {
  try {
    if (process.env.MN_WEB3_WALLET_CHAIN_ID !== '80002') throw new AmoySimulationError('input');
    const report = await simulateAmoyDeployment({ chainId: 80002,
      deployerAddress: process.env.MN_WEB3_AMOY_DEPLOYER_ADDRESS,
      mintOperatorAddress: process.env.MN_WEB3_AMOY_MINT_OPERATOR_ADDRESS,
      simulationGasLimit: process.env.MN_WEB3_AMOY_SIMULATION_GAS_LIMIT },
    { url: process.env.MN_WEB3_WALLET_RPC_URL });
    process.stdout.write(JSON.stringify({ ok: true, report }) + '\n');
  } catch (error) {
    const allowed = ['input', 'configuration', 'artifact', 'rpc', 'response', 'chain', 'gas', 'runtime', 'block'];
    const why = error instanceof AmoySimulationError && allowed.includes(error.why) ? error.why : 'rpc';
    process.stderr.write(JSON.stringify({ ok: false, why }) + '\n');
    process.exitCode = 1;
  }
}
