import { createErc1155Reader, Erc1155ReadError } from '../server/web3/erc1155Reader.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Uso: node tools/web3-edition-read.mjs --read\n'
    + 'Solo lectura ERC-1155. Usa variables del proceso; no carga .env ni inicia el juego.\n'
    + 'Requiere MN_WEB3_RPC_URL, MN_WEB3_WALLET_CHAIN_ID, MN_WEB3_READ_CONTRACT,\n'
    + 'MN_WEB3_READ_HOLDER, MN_WEB3_READ_TOKEN_ID, MN_WEB3_READ_BLOCK_NUMBER y MN_WEB3_READ_BLOCK_HASH.\n'
    + 'Contrato fijo y bloque por numero/hash; exige RPC compatible con EIP-1898.\n'
    + 'Saldo decimal exacto, incluido cero. No acredita tirada, existencia del tipo o derecho jugable.');
} else if (args.length !== 1 || args[0] !== '--read') {
  console.error(JSON.stringify({ ok: false, why: 'arguments' }));
  process.exitCode = 2;
} else {
  try {
    const env = process.env, rawChain = env.MN_WEB3_WALLET_CHAIN_ID;
    const chainId = typeof rawChain === 'string' ? Number(rawChain) : NaN;
    if (String(chainId) !== rawChain) throw new Erc1155ReadError('configuration');
    const reader = createErc1155Reader({ url: env.MN_WEB3_RPC_URL, chainId,
      contractAddress: env.MN_WEB3_READ_CONTRACT });
    console.log(JSON.stringify(await reader.observeBalance({ tokenId: env.MN_WEB3_READ_TOKEN_ID,
      holderAddress: env.MN_WEB3_READ_HOLDER, blockNumber: env.MN_WEB3_READ_BLOCK_NUMBER,
      blockHash: env.MN_WEB3_READ_BLOCK_HASH })));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, why: error instanceof Erc1155ReadError ? error.code : 'unavailable' }));
    process.exitCode = 1;
  }
}
