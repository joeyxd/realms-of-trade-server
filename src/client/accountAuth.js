// Public Supabase Auth client. The game server remains the authority for every account profile.
const CONFIG_TIMEOUT_MS = 5000;
const AUTH_TIMEOUT_MS = 10000;

const ERRORS = Object.freeze({
  offline: 'Las cuentas solo están disponibles en línea.',
  config: 'No se pudo cargar la configuración de cuentas. Puedes jugar como invitado.',
  sdk: 'No se pudo iniciar el servicio de cuentas. Puedes jugar como invitado.',
  credentials: 'No se pudo iniciar sesión. Revisa el correo y la contraseña.',
  signup: 'No se pudo crear la cuenta. Revisa los datos e inténtalo de nuevo.',
  resend: 'No se pudo reenviar el correo. Inténtalo de nuevo.',
  logout: 'No se pudo cerrar la sesión. Inténtalo de nuevo.',
  session: 'No se pudo validar la sesión. Inténtalo de nuevo.',
});

const PROVIDER_ERRORS = Object.freeze({
  email_not_confirmed: 'Confirma tu correo antes de iniciar sesión.',
  weak_password: 'Elige una contraseña más segura.',
  over_email_send_rate_limit: 'Demasiados intentos. Espera un momento y vuelve a probar.',
  over_request_rate_limit: 'Demasiados intentos. Espera un momento y vuelve a probar.',
});

function normalizedBase(value) {
  const base = String(value || '');
  return base.endsWith('/') ? base : `${base}/`;
}

function timeoutFetch(fetchImpl) {
  return (input, init = {}) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(AUTH_TIMEOUT_MS) });
}

function validConfig(value) {
  if (!value || value.enabled !== true) return { enabled: false };
  if (typeof value.url !== 'string' || !value.url || typeof value.publicKey !== 'string' || !value.publicKey) return null;
  return { enabled: true, url: value.url, publicKey: value.publicKey };
}

export class AccountAuth {
  constructor({ httpBase, fetchImpl = globalThis.fetch?.bind(globalThis), createClient = null } = {}) {
    this.httpBase = normalizedBase(httpBase);
    this.fetchImpl = fetchImpl;
    this.createClientOverride = createClient;
    this.client = null;
    this.clientPromise = null;
    this.config = null;
    this.listeners = new Set();
    this.bootstrapPromise = null;
    this.state = { enabled: false, busy: false, email: '', accountId: '', signedIn: false, guestChoice: false, error: '' };
  }

  subscribe(callback) {
    if (typeof callback !== 'function') throw new TypeError('subscribe requiere una función');
    this.listeners.add(callback);
    callback({ ...this.state });
    return () => this.listeners.delete(callback);
  }

  publish(patch) {
    if (patch.signedIn === false) patch = { ...patch, accountId: '' };
    this.state = { ...this.state, ...patch };
    const snapshot = { ...this.state };
    for (const callback of this.listeners) callback(snapshot);
  }

  async bootstrap({ online = false } = {}) {
    if (!online) {
      this.publish({ enabled: false, guestChoice: true, signedIn: false, email: '', error: ERRORS.offline });
      return false;
    }
    if (this.bootstrapPromise) return this.bootstrapPromise;
    this.bootstrapPromise = this.loadConfig();
    try { return await this.bootstrapPromise; }
    finally { this.bootstrapPromise = null; }
  }

  async loadConfig() {
    if (!this.fetchImpl || !this.httpBase) {
      this.publish({ enabled: false, error: ERRORS.config });
      return false;
    }
    this.publish({ error: '' });
    try {
      const response = await this.fetchImpl(`${this.httpBase}auth/config`, { signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS) });
      if (!response.ok) throw new Error('config');
      const config = validConfig(await response.json());
      if (!config) throw new Error('config');
      this.config = config.enabled ? config : null;
      this.publish({ enabled: config.enabled, guestChoice: !config.enabled, signedIn: false, email: '', error: '' });
      if (!config.enabled) return false;
      try { await this.ensureClient(); }
      catch {
        this.publish({ enabled: true, error: ERRORS.sdk });
      }
      return true;
    } catch {
      this.config = null;
      this.publish({ enabled: false, guestChoice: false, signedIn: false, email: '', error: ERRORS.config });
      return false;
    }
  }

  async loadSdk() {
    if (this.createClientOverride) return this.createClientOverride;
    if (globalThis.supabase?.createClient) return globalThis.supabase.createClient;
    if (typeof document === 'undefined') throw new Error('sdk');
    const src = `${this.httpBase}auth/sdk.js`;
    let script = [...document.scripts].find((item) => item.src === src);
    if (!script) {
      script = document.createElement('script');
      script.src = src;
      script.async = true;
      document.head.append(script);
    }
    await new Promise((resolve, reject) => {
      if (globalThis.supabase?.createClient) { resolve(); return; }
      const cleanup = () => {
        clearTimeout(timer);
        script.removeEventListener('load', loaded);
        script.removeEventListener('error', failed);
      };
      const loaded = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); script.remove(); reject(new Error('sdk')); };
      const timer = setTimeout(failed, AUTH_TIMEOUT_MS);
      script.addEventListener('load', loaded, { once: true });
      script.addEventListener('error', failed, { once: true });
    });
    if (!globalThis.supabase?.createClient) throw new Error('sdk');
    return globalThis.supabase.createClient;
  }

  async ensureClient() {
    if (this.client) return this.client;
    if (!this.config) throw new Error('config');
    if (this.clientPromise) return this.clientPromise;
    this.clientPromise = (async () => {
      const createClient = await this.loadSdk();
      const client = createClient(this.config.url, this.config.publicKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        global: { fetch: timeoutFetch(this.fetchImpl) },
      });
      if (!client?.auth?.getSession || !client?.auth?.signInWithPassword || !client?.auth?.signUp || !client?.auth?.signOut) throw new Error('sdk');
      this.client = client;
      client.auth.onAuthStateChange?.((_event, session) => this.applySession(session));
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (data?.session) this.applySession(data.session);
      else this.publish({ guestChoice: true, signedIn: false, email: '', error: '' });
      return client;
    })();
    try { return await this.clientPromise; }
    catch (error) { this.clientPromise = null; this.client = null; throw error; }
  }

  applySession(session) {
    if (this.state.guestChoice) return;
    this.publish({ signedIn: Boolean(session?.access_token), accountId: String(session?.user?.id || ''), email: String(session?.user?.email || ''), error: '' });
  }

  useGuest() {
    this.publish({ guestChoice: true, signedIn: false, email: '', error: '' });
    return true;
  }

  dismissError() { this.publish({ error: '' }); }

  async withBusy(failKey, operation, action) {
    if (this.state.busy) return { ok: false };
    this.publish({ busy: true, error: '' });
    try {
      const client = await this.ensureClient();
      const result = await action(client);
      if (result?.error) throw result.error;
      return { ok: true, ...operation(result) };
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : '';
      const message = code === 'user_already_exists' && failKey === 'signup' ? ERRORS.signup : (PROVIDER_ERRORS[code] || ERRORS[failKey]);
      this.publish({ error: message });
      return { ok: false };
    } finally {
      this.publish({ busy: false });
    }
  }

  login(email, password) {
    return this.withBusy('credentials', (result) => {
      const session = result?.data?.session;
      if (typeof session?.access_token !== 'string' || !session.access_token) throw new Error('session');
      this.publish({ guestChoice: false });
      this.applySession(session);
      return {};
    }, (client) => client.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') }));
  }

  signup(email, password) {
    return this.withBusy('signup', (result) => {
      const session = result?.data?.session || null;
      const hasUser = result?.data?.user && typeof result.data.user === 'object';
      const hasSession = typeof session?.access_token === 'string' && Boolean(session.access_token);
      if (!hasUser && !hasSession) throw new Error('signup');
      this.publish({ guestChoice: false });
      this.applySession(session);
      return { confirmationPending: !session };
    }, (client) => client.auth.signUp({
      email: String(email || '').trim(),
      password: String(password || ''),
      options: { emailRedirectTo: this.httpBase },
    }));
  }

  resend(email) {
    return this.withBusy('resend', () => ({}), (client) => {
      if (typeof client.auth.resend !== 'function') throw new Error('resend');
      return client.auth.resend({
        type: 'signup',
        email: String(email || '').trim(),
        options: { emailRedirectTo: this.httpBase },
      });
    });
  }

  async logout() {
    if (this.state.busy) return { ok: false };
    this.publish({ busy: true, error: '' });
    try {
      const client = await this.ensureClient();
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      this.publish({ signedIn: false, email: '', guestChoice: true, error: '' });
      return { ok: true };
    } catch {
      this.publish({ error: ERRORS.logout });
      return { ok: false };
    } finally {
      this.publish({ busy: false });
    }
  }

  // Return a matched identity/token pair without publishing the bearer or applying a stale session.
  async sessionIdentity() {
    const accountId = this.state.accountId;
    if (!this.state.enabled || !this.state.signedIn || this.state.guestChoice || !accountId) throw new Error(ERRORS.session);
    const client = await this.ensureClient();
    const { data, error } = await client.auth.getSession();
    const session = data?.session;
    if (error || !this.state.signedIn || this.state.guestChoice || this.state.accountId !== accountId
      || session?.user?.id !== accountId || typeof session?.access_token !== 'string' || !session.access_token) throw new Error(ERRORS.session);
    return { accountId, token: session.access_token };
  }

  async token() {
    if (this.state.guestChoice) return null;
    if (!this.state.enabled) {
      this.publish({ error: ERRORS.session });
      throw new Error(ERRORS.session);
    }
    try {
      const client = await this.ensureClient();
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      const session = data?.session;
      if (!session || typeof session.access_token !== 'string' || !session.access_token) throw new Error('session');
      this.applySession(session || null);
      return session?.access_token || null;
    } catch {
      this.publish({ error: ERRORS.session });
      throw new Error(ERRORS.session);
    }
  }
}
