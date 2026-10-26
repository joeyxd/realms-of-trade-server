const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/;
const MAX_CHAIN_ID = 2147483647;

export class WalletBrowserError extends Error {
  constructor(code) {
    super(code);
    this.name = 'WalletBrowserError';
    this.code = code;
  }
}

function walletError(code) {
  return new WalletBrowserError(code);
}

function mapProviderError(error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  if (code === 4001) return walletError('cancelled');
  if (code === 4900 || code === 4901) return walletError('disconnected');
  if (code === 4200 || code === -32601) return walletError('unsupported');
  return walletError('provider');
}

function accountFrom(result) {
  if (!Array.isArray(result)) throw walletError('provider');
  if (result.length === 0) throw walletError('disconnected');
  const address = result[0];
  if (typeof address !== 'string' || !ADDRESS_RE.test(address) || /^0x0{40}$/i.test(address)) {
    throw walletError('provider');
  }
  return address.toLowerCase();
}

function chainFrom(result) {
  if (typeof result !== 'string' || !/^0x[0-9a-f]+$/i.test(result)) throw walletError('chain');
  const value = Number.parseInt(result.slice(2), 16);
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_CHAIN_ID) throw walletError('chain');
  return value;
}

function encodeUtf8Hex(message) {
  const bytes = new TextEncoder().encode(message);
  let result = '0x';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}

export function createWalletProvider(provider, { timeoutMs = 120000 } = {}) {
  if (!provider || typeof provider.request !== 'function' || typeof provider.on !== 'function' ||
      typeof provider.removeListener !== 'function') throw walletError('provider');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive');

  let busy = false;
  const subscriptions = new Set();

  function request(method, params) {
    let pending;
    try {
      pending = Promise.resolve(provider.request({ method, params }));
    } catch (error) {
      pending = Promise.reject(error);
    }
    const timed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(walletError('timeout')), timeoutMs);
      pending.then(
        value => { clearTimeout(timer); resolve(value); },
        error => { clearTimeout(timer); reject(mapProviderError(error)); },
      );
    });
    // Keep the operation lock until the provider call really settles, even if its caller timed out.
    return { timed, settled: pending.then(() => undefined, () => undefined) };
  }

  async function perform(work) {
    if (busy) throw walletError('busy');
    busy = true;
    let pendingCount = 0;
    let operationEnded = false;
    const releaseIfDone = () => {
      if (operationEnded && pendingCount === 0) busy = false;
    };
    const runRequest = (method, params) => {
      const call = request(method, params);
      pendingCount++;
      call.settled.then(() => { pendingCount--; releaseIfDone(); });
      return call.timed;
    };
    try {
      return await work(runRequest);
    } finally {
      operationEnded = true;
      releaseIfDone();
    }
  }

  function resolveIdentity(accounts, chain) {
    return { address: accountFrom(accounts), chainId: chainFrom(chain) };
  }

  return {
    subscribe(callback) {
      if (typeof callback !== 'function') throw new TypeError('callback must be a function');
      const listeners = {
        accountsChanged: value => callback({ type: 'accountsChanged', value: Array.isArray(value) ? value.map(v => typeof v === 'string' ? v.toLowerCase() : null) : null }),
        chainChanged: value => callback({ type: 'chainChanged', value: typeof value === 'string' ? value : null }),
        disconnect: () => callback({ type: 'disconnect' }),
      };
      for (const [event, listener] of Object.entries(listeners)) provider.on(event, listener);
      subscriptions.add(listeners);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        subscriptions.delete(listeners);
        for (const [event, listener] of Object.entries(listeners)) provider.removeListener(event, listener);
      };
    },
    connect() {
      return perform(async run => {
        const accounts = await run('eth_requestAccounts');
        const chain = await run('eth_chainId');
        return resolveIdentity(accounts, chain);
      });
    },
    identity() {
      return perform(async run => {
        const accounts = await run('eth_accounts');
        const chain = await run('eth_chainId');
        return resolveIdentity(accounts, chain);
      });
    },
    sign(message, address) {
      return perform(async run => {
        if (typeof message !== 'string' || typeof address !== 'string' || !ADDRESS_RE.test(address) || /^0x0{40}$/i.test(address)) {
          throw walletError('provider');
        }
        const signature = await run('personal_sign', [encodeUtf8Hex(message), address.toLowerCase()]);
        if (typeof signature !== 'string' || !SIGNATURE_RE.test(signature)) throw walletError('signature');
        return signature;
      });
    },
  };
}
