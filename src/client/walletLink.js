// Optional key-control proof. Provider state and Supabase identity are checked at each async boundary.
import { createWalletProvider, WalletBrowserError } from './walletProvider.js';

const UUID = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const ERRORS = {
  auth: 'Inicia sesión en tu cuenta para vincular una wallet.',
  provider: 'No se pudo usar la wallet. Abre el juego en un navegador con wallet compatible.',
  disconnected: 'La wallet está desconectada. Conéctala de nuevo.',
  unsupported: 'Esta wallet no admite la firma de mensajes requerida.',
  cancelled: 'Firma cancelada. Puedes intentarlo de nuevo.',
  changed: 'Cambió la cuenta, la wallet o la red. Revisa los datos y vuelve a conectar.',
  chain: 'Selecciona en tu wallet la red indicada antes de conectar.',
  busy: 'Hay una solicitud pendiente en la wallet. Resuélvela antes de continuar.',
  pending: 'Hay un mensaje pendiente para otra dirección. Vuelve a esa dirección o espera a que caduque (hasta 10 minutos).',
  timeout: 'La wallet no respondió a tiempo. Resuelve su solicitud pendiente antes de reintentar.',
  unavailable: 'No se pudo confirmar el vínculo. Consulta su estado antes de reintentar.',
  response: 'La respuesta no coincide con este vínculo. Vuelve a consultar su estado.',
  signature: 'No se pudo validar la firma de esta wallet.',
  expired: 'El mensaje caducó. Vuelve a conectar para obtener uno nuevo.',
  used: 'El mensaje ya se utilizó. Consulta el vínculo antes de volver a conectar.',
  linked: 'Esta cuenta ya tiene una wallet vinculada. Consulta el vínculo.',
  conflict: 'La cuenta o esta wallet ya tiene un vínculo. Consulta su estado.',
  identity: 'Este intento ya no está disponible. Vuelve a consultar el vínculo.',
};
const fail = (code) => { throw new WalletBrowserError(code); };
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail('response');
}
const validAddress = (value) => typeof value === 'string' && ADDRESS.test(value) && value !== `0x${'0'.repeat(40)}`;
const validTime = (value) => Number.isSafeInteger(value) && value > 0 && value <= 253402300799999;
function linkOf(value, accountId, chainId) {
  if (value === null) return null;
  exact(value, ['accountId', 'address', 'chainId', 'challengeId']);
  if (value.accountId !== accountId || value.chainId !== chainId || !validAddress(value.address) || !UUID.test(value.challengeId)) fail('response');
  return { ...value };
}
function challengeOf(value, accountId, identity, origin, now) {
  exact(value, ['challengeId', 'accountId', 'address', 'chainId', 'nonce', 'message', 'issuedAt', 'expiresAt']);
  if (!UUID.test(value.challengeId) || value.accountId !== accountId || value.address !== identity.address || value.chainId !== identity.chainId
    || !/^[0-9a-f]{64}$/.test(value.nonce) || !validTime(value.issuedAt) || !validTime(value.expiresAt)
    || value.expiresAt - value.issuedAt < 30000 || value.expiresAt - value.issuedAt > 600000
    || value.issuedAt > now + 10000 || now >= value.expiresAt || typeof value.message !== 'string') fail('response');
  // The server formats an EIP-55 address. Preserve those exact bytes after matching the address.
  const displayAddress = value.message.split('\n')[1];
  if (!/^0x[0-9a-fA-F]{40}$/.test(displayAddress) || displayAddress.toLowerCase() !== identity.address) fail('response');
  const expected = `${origin} wants you to sign in with your Ethereum account:\n${displayAddress}\n\n`
    + `Vincular esta wallet a la cuenta ${accountId} de MAREA NEGRA. No autoriza compras ni transferencias.\n\n`
    + `URI: ${origin}/web3/wallet\nVersion: 1\nChain ID: ${identity.chainId}\nNonce: ${value.nonce}`
    + `\nIssued At: ${new Date(value.issuedAt).toISOString()}\nExpiration Time: ${new Date(value.expiresAt).toISOString()}\nRequest ID: ${value.challengeId}`;
  if (value.message !== expected) fail('response');
  return { ...value };
}

export class WalletLink {
  constructor({ auth, httpBase, origin = globalThis.location?.origin, fetchImpl = globalThis.fetch?.bind(globalThis),
    getProvider = () => globalThis.ethereum, now = Date.now, timeoutMs = 15000, providerTimeoutMs = 120000 } = {}) {
    Object.assign(this, { auth, origin, fetchImpl, getProvider, now, timeoutMs, providerTimeoutMs });
    this.base = null;
    try {
      const base = new URL(httpBase);
      if (base.origin === origin && base.pathname === '/' && !base.search && !base.hash && !base.username && !base.password
        && (base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) this.base = base.origin;
    } catch { /* Only a same-origin game can request account-bound proof. */ }
    this.listeners = new Set(); this.epoch = 0; this.accountId = ''; this.provider = null; this.blocked = false; this.destroyed = false;
    this.state = { enabled: false, busy: false, phase: 'disabled', chainId: null, address: '', message: '', link: null, error: '' };
    this.unsubscribeAuth = auth.subscribe((state) => {
      const id = state.signedIn && !state.guestChoice && UUID.test(state.accountId) ? state.accountId : '';
      if (id !== this.accountId) { this.accountId = id; this.invalidate(); this.publish({ link: null, error: '', phase: this.state.enabled ? 'idle' : 'disabled' }); }
    });
  }
  subscribe(callback) { this.listeners.add(callback); callback(this.snapshot()); return () => this.listeners.delete(callback); }
  snapshot() { return { ...this.state, link: this.state.link && { ...this.state.link } }; }
  publish(patch) { if (this.destroyed) return; this.state = { ...this.state, ...patch }; for (const callback of this.listeners) callback(this.snapshot()); }
  invalidate() {
    this.epoch++; this.challenge = null;
    this.publish({ busy: false, address: '', message: '', phase: this.state.link ? 'linked' : this.state.enabled ? 'idle' : 'disabled' });
  }
  cancel() { this.invalidate(); this.publish({ error: '' }); }
  setBlocked(value) { this.blocked = Boolean(value); if (this.blocked) this.cancel(); }
  guard(epoch, accountId) { if (this.destroyed || this.blocked || this.epoch !== epoch || this.accountId !== accountId) fail('changed'); }
  async request(route, input, epoch, accountId, anonymous = false) {
    this.guard(epoch, accountId);
    let authorization;
    if (!anonymous) {
      let identity;
      try { identity = await this.auth.sessionIdentity(); } catch { fail('auth'); }
      this.guard(epoch, accountId);
      if (identity.accountId !== accountId || typeof identity.token !== 'string' || !identity.token) fail('auth');
      authorization = `Bearer ${identity.token}`;
    }
    let response, value;
    try {
      response = await this.fetchImpl(`${this.base}/web3/wallet/${route}`, {
        method: input === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(this.timeoutMs), headers: { ...(authorization ? { authorization } : {}),
          ...(input === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      });
      value = await response.json();
    } catch { fail('unavailable'); }
    this.guard(epoch, accountId);
    if (!response.ok) fail(response.status === 401 ? 'auth' : value?.why === 'busy' ? 'pending' : ERRORS[value?.why] ? value.why : 'unavailable');
    return value;
  }
  async init() {
    if (this.state.enabled) return true;
    if (!this.base || !this.fetchImpl || this.blocked || this.destroyed) return false;
    const epoch = this.epoch, accountId = this.accountId;
    try {
      const value = await this.request('config', undefined, epoch, accountId, true);
      if (value?.enabled === false) { exact(value, ['enabled']); return false; }
      exact(value, ['enabled', 'origin', 'chainId', 'proof']);
      if (value.enabled !== true || value.origin !== this.origin || value.proof !== 'eoa'
        || !Number.isSafeInteger(value.chainId) || value.chainId < 1 || value.chainId > 2147483647) fail('response');
      this.publish({ enabled: true, chainId: value.chainId, phase: 'idle', error: '' }); return true;
    } catch { return false; }
  }
  getWallet() {
    if (!this.provider) {
      this.provider = createWalletProvider(this.getProvider(), { timeoutMs: this.providerTimeoutMs });
      this.unsubscribeProvider = this.provider.subscribe((event) => {
        // Initial permission approval commonly emits accountsChanged; re-read before showing review.
        if (event.type === 'accountsChanged' && this.state.phase === 'connecting') return;
        this.invalidate(); this.publish({ error: ERRORS.changed });
      });
    }
    return this.provider;
  }
  async operation(phase, work) {
    if (this.state.busy || this.blocked || !this.state.enabled || this.destroyed) return false;
    if (!this.accountId) { this.publish({ error: ERRORS.auth }); return false; }
    const epoch = ++this.epoch, accountId = this.accountId;
    this.publish({ busy: true, phase, error: '' });
    try { await work(epoch, accountId); this.guard(epoch, accountId); return true; }
    catch (error) {
      if (this.epoch === epoch && !this.destroyed) {
        this.challenge = null;
        this.publish({ message: '', address: '', phase: this.state.link ? 'linked' : 'idle', error: ERRORS[error?.code] || ERRORS.unavailable });
      }
      return false;
    } finally { if (this.epoch === epoch) this.publish({ busy: false }); }
  }
  refresh() {
    return this.operation('loading', async (epoch, accountId) => {
      const value = await this.request('link', undefined, epoch, accountId); exact(value, ['ok', 'link']);
      if (value.ok !== true) fail('response');
      const link = linkOf(value.link, accountId, this.state.chainId); this.challenge = null;
      this.publish({ link, message: '', address: '', phase: link ? 'linked' : 'idle' });
    });
  }
  prepare() {
    if (this.state.link) return Promise.resolve(false);
    return this.operation('connecting', async (epoch, accountId) => {
      const wallet = this.getWallet(), identity = await wallet.connect(); this.guard(epoch, accountId);
      if (identity.chainId !== this.state.chainId) fail('chain');
      const beforeIssue = await wallet.identity(); this.guard(epoch, accountId);
      if (beforeIssue.address !== identity.address || beforeIssue.chainId !== identity.chainId) fail('changed');
      const value = await this.request('challenge', identity, epoch, accountId); exact(value, ['ok', 'replay', 'challenge']);
      if (value.ok !== true || typeof value.replay !== 'boolean') fail('response');
      const challenge = challengeOf(value.challenge, accountId, identity, this.origin, this.now());
      const current = await wallet.identity(); this.guard(epoch, accountId);
      if (current.address !== identity.address || current.chainId !== identity.chainId) fail('changed');
      this.challenge = challenge;
      this.publish({ address: challenge.address, message: challenge.message, phase: 'review' });
    });
  }
  sign() {
    const challenge = this.challenge;
    if (!challenge || this.state.phase !== 'review') return Promise.resolve(false);
    return this.operation('signing', async (epoch, accountId) => {
      const wallet = this.getWallet(), identity = await wallet.identity(); this.guard(epoch, accountId);
      if (identity.address !== challenge.address || identity.chainId !== challenge.chainId) fail('changed');
      if (this.now() >= challenge.expiresAt) fail('expired');
      challengeOf(challenge, accountId, identity, this.origin, this.now());
      // Check the account once more before displaying the provider's signature prompt.
      const session = await this.auth.sessionIdentity(); this.guard(epoch, accountId);
      if (session.accountId !== accountId) fail('auth');
      const signature = await wallet.sign(challenge.message, challenge.address); this.guard(epoch, accountId);
      const current = await wallet.identity(); this.guard(epoch, accountId);
      if (current.address !== challenge.address || current.chainId !== challenge.chainId) fail('changed');
      if (this.now() >= challenge.expiresAt) fail('expired');
      this.publish({ phase: 'confirming' });
      const value = await this.request('verify', { challengeId: challenge.challengeId, message: challenge.message, signature }, epoch, accountId);
      exact(value, ['ok', 'link']); if (value.ok !== true) fail('response');
      const link = linkOf(value.link, accountId, challenge.chainId);
      if (!link || link.address !== challenge.address || link.challengeId !== challenge.challengeId) fail('response');
      this.challenge = null; this.publish({ link, address: '', message: '', phase: 'linked' });
    });
  }
  destroy() { this.cancel(); this.unsubscribeAuth?.(); this.unsubscribeProvider?.(); this.listeners.clear(); this.destroyed = true; }
}
