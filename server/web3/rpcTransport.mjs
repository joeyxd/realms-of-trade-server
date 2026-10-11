// Shared bounded transport. Only named read methods are available to server-side adapters.
export class RpcProbeError extends Error {
  constructor(code) { super(`RPC probe: ${code}`); this.name = 'RpcProbeError'; this.code = code; }
}
const fail = (code) => { throw new RpcProbeError(code); };
const MAX_BYTES = 1048576;
export function rpcQuantity(value) {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value)) fail('response');
  return value.toLowerCase();
}
export function rpcHash(value, zeroAllowed = false) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)
    || (!zeroAllowed && /^0x0{64}$/.test(value))) fail('response');
  return value.toLowerCase();
}
export function rpcBlock(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('response');
  return { number: rpcQuantity(value.number), hash: rpcHash(value.hash),
    parentHash: rpcHash(value.parentHash, true), timestamp: rpcQuantity(value.timestamp) };
}
async function readJson(response, signal) {
  if (!response?.ok || !response.body || typeof response.body.getReader !== 'function') fail('rpc');
  const length = response.headers?.get('content-length');
  if (length !== null && length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) fail('response');
  const reader = response.body.getReader(), parts = []; let size = 0;
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) fail('rpc');
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) fail('rpc');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) fail('response');
      parts.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail('response'); }
  } finally {
    // Cancellation is best-effort and must not extend the request deadline.
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

export function createRpcTransport({ url, chainId, fetchFn = fetch, timeoutMs = 10000 } = {}) {
  let endpoint;
  try {
    if (typeof url !== 'string' || !url || url.length > 8192 || /\s/.test(url)) fail('configuration');
    endpoint = new URL(url);
    if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash
      || (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) fail('configuration');
  } catch { fail('configuration'); }
  if (!Number.isSafeInteger(chainId) || chainId < 1 || chainId > 2147483647
    || typeof fetchFn !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30000) fail('configuration');
  const call = async (method, params, id) => {
    const abort = new AbortController(); let timer;
    try {
      const work = (async () => {
        const response = await fetchFn(endpoint.href, { method: 'POST', redirect: 'error', credentials: 'omit',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: abort.signal });
        if (abort.signal.aborted) fail('rpc');
        const result = await readJson(response, abort.signal);
        if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== 3
          || result.jsonrpc !== '2.0' || result.id !== id || !Object.hasOwn(result, 'result')) fail('response');
        return result.result;
      })();
      return await Promise.race([work, new Promise((_resolve, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(new RpcProbeError('rpc')); }, timeoutMs);
      })]);
    } catch (error) {
      if (error instanceof RpcProbeError && ['response', 'rpc'].includes(error.code)) fail(error.code);
      fail('rpc');
    } finally { clearTimeout(timer); abort.abort(); }
  };
  return Object.freeze({
    chainId: (id) => call('eth_chainId', [], id),
    blockByNumber: (number, id) => call('eth_getBlockByNumber', [number, false], id),
    codeAtHash: (contract, blockHash, id) => call('eth_getCode', [contract, { blockHash, requireCanonical: true }], id),
    callAtHash: (contract, data, blockHash, gas, id) => call('eth_call', [
      { to: contract, data, gas }, { blockHash, requireCanonical: true },
    ], id),
  });
}
