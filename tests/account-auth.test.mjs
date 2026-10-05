import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountAuth } from '../src/client/accountAuth.js';

function authHarness({ config = { enabled: true, url: 'https://auth.example.test', publicKey: 'public-test-key' }, fetchFailure = false, sdkFailure = false } = {}) {
  const calls = { config: 0, session: 0, signIn: [], signUp: [], signOut: [], clientOptions: null, created: 0 };
  let session = null;
  const authApi = {
    onAuthStateChange(callback) { this.listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { calls.session++; return { data: { session }, error: null }; },
    async signInWithPassword(credentials) {
      calls.signIn.push(credentials);
      session = { access_token: `fresh-token-${calls.signIn.length}`, user: { email: credentials.email } };
      this.listener?.('SIGNED_IN', session);
      return { data: { session }, error: null };
    },
    async signUp(credentials) { calls.signUp.push(credentials); return { data: { session: null, user: { email: credentials.email } }, error: null }; },
    async signOut(options) { calls.signOut.push(options); session = null; this.listener?.('SIGNED_OUT', null); return { error: null }; },
  };
  const fetchImpl = async (url, options) => {
    calls.config++;
    calls.configUrl = url;
    calls.configSignal = options.signal;
    if (url !== 'https://game.example.test/auth/config') calls.authSignal = options.signal;
    if (fetchFailure) throw new Error('provider response contains private details');
    return { ok: true, async json() { return config; } };
  };
  const controller = new AccountAuth({
    httpBase: 'https://game.example.test/',
    fetchImpl,
    createClient: (_url, _key, options) => { calls.created++; calls.clientOptions = options; if (sdkFailure) throw new Error('private SDK response'); return { auth: authApi }; },
  });
  return { controller, calls };
}

test('offline bootstrap makes no request and disabled config keeps guest mode available', async () => {
  const offline = authHarness();
  assert.equal(await offline.controller.bootstrap({ online: false }), false);
  assert.equal(offline.calls.config, 0);
  assert.equal(offline.controller.state.error, 'Las cuentas solo están disponibles en línea.');
  assert.equal(offline.controller.state.enabled, false);
  assert.equal(offline.controller.state.guestChoice, true);

  const disabled = authHarness({ config: { enabled: false } });
  assert.equal(await disabled.controller.bootstrap({ online: true }), false);
  assert.equal(disabled.calls.config, 1);
  assert.equal(disabled.calls.created, 0);
  assert.equal(disabled.controller.state.error, '');
  assert.equal(disabled.controller.state.enabled, false);
  assert.equal(disabled.controller.state.guestChoice, true);
});

test('public config initializes persistent SDK lazily and token reads the refreshed session without exposing it in state', async () => {
  const { controller, calls } = authHarness();
  assert.equal(await controller.bootstrap({ online: true }), true);
  assert.equal(calls.configUrl, 'https://game.example.test/auth/config');
  assert.equal(calls.created, 1);
  assert.equal(controller.state.guestChoice, true);
  assert.equal(await controller.token(), null);
  assert.deepEqual(calls.clientOptions.auth, { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true });
  assert.equal(typeof calls.clientOptions.global.fetch, 'function');
  await calls.clientOptions.global.fetch('https://auth.example.test/auth/v1/user', {});
  assert.ok(calls.configSignal);
  assert.ok(calls.authSignal instanceof AbortSignal);

  assert.deepEqual(await controller.login(' pirate@example.test ', 'secret-password'), { ok: true });
  assert.equal(calls.signIn[0].email, 'pirate@example.test');
  assert.equal(calls.signIn[0].password, 'secret-password');
  assert.equal(await controller.token(), 'fresh-token-1');
  assert.equal(calls.session, 2);
  assert.equal(controller.state.signedIn, true);
  assert.equal(controller.state.email, 'pirate@example.test');
  assert.equal(Object.hasOwn(controller.state, 'access_token'), false);
});

test('signup reports confirmation safely and logout only ends this browser session', async () => {
  const { controller, calls } = authHarness();
  await controller.bootstrap({ online: true });
  assert.deepEqual(await controller.signup('new@example.test', 'temporary-password'), { ok: true, confirmationPending: true });
  assert.equal(controller.state.signedIn, false);
  assert.equal(calls.signUp[0].password, 'temporary-password');
  await controller.login('new@example.test', 'temporary-password');
  assert.deepEqual(await controller.logout(), { ok: true });
  assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
  assert.equal(controller.state.signedIn, false);
  assert.equal(controller.state.email, '');
});

test('token fails closed when a known session disappears or the SDK cannot validate it', async () => {
  const { controller } = authHarness();
  await controller.bootstrap({ online: true });
  await controller.login('pirate@example.test', 'password');
  controller.client.auth.getSession = async () => ({ data: { session: null }, error: null });
  await assert.rejects(controller.token(), /^Error: No se pudo validar la sesión\. Inténtalo de nuevo\.$/);
  assert.equal(controller.state.error, 'No se pudo validar la sesión. Inténtalo de nuevo.');
});

test('SDK startup failure remains fail closed until the player explicitly chooses guest', async () => {
  const { controller, calls } = authHarness({ sdkFailure: true });
  assert.equal(await controller.bootstrap({ online: true }), true);
  assert.equal(controller.state.enabled, true);
  assert.equal(controller.state.error, 'No se pudo iniciar el servicio de cuentas. Puedes jugar como invitado.');
  assert.equal(controller.state.guestChoice, false);
  await assert.rejects(controller.token(), /^Error: No se pudo validar la sesión\. Inténtalo de nuevo\.$/);
  assert.equal(calls.created, 2);
  controller.useGuest();
  assert.equal(await controller.token(), null);
  assert.equal(calls.created, 2);
  assert.equal(controller.state.guestChoice, true);
});

test('background Auth events cannot undo an explicit guest choice; a new login can', async () => {
  const { controller } = authHarness();
  await controller.bootstrap({ online: true });
  await controller.login('pirate@example.test', 'password');
  const providerAuth = controller.client.auth;
  controller.useGuest();
  providerAuth.listener('TOKEN_REFRESHED', { access_token: 'stored-session-token', user: { email: 'pirate@example.test' } });
  assert.equal(controller.state.guestChoice, true);
  assert.equal(controller.state.signedIn, false);
  assert.equal(controller.state.email, '');
  assert.equal(await controller.token(), null);
  assert.deepEqual(await controller.login('pirate@example.test', 'password'), { ok: true });
  assert.equal(controller.state.guestChoice, false);
  assert.equal(controller.state.signedIn, true);
});

test('configuration and provider failures expose only fixed Spanish errors', async () => {
  const configFailure = authHarness({ fetchFailure: true });
  assert.equal(await configFailure.controller.bootstrap({ online: true }), false);
  assert.equal(configFailure.controller.state.error, 'No se pudo cargar la configuración de cuentas. Puedes jugar como invitado.');
  assert.equal(configFailure.controller.state.guestChoice, false);
  assert.equal(JSON.stringify(configFailure.controller.state).includes('private details'), false);

  const providerFailure = authHarness();
  await providerFailure.controller.bootstrap({ online: true });
  const { controller } = providerFailure;
  controller.client.auth.signInWithPassword = async () => ({ error: new Error('raw provider secret') });
  assert.deepEqual(await controller.login('x@example.test', 'bad'), { ok: false });
  assert.equal(controller.state.error, 'No se pudo iniciar sesión. Revisa el correo y la contraseña.');
  assert.equal(JSON.stringify(controller.state).includes('raw provider secret'), false);
});
