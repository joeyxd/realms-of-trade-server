import { AccountPanel } from '../../src/ui/account.js';
import { PauseMenu } from '../../src/ui/pause.js';
import { initI18n } from '../../src/core/i18n.js';

initI18n();

const counts = {
  login: 0, signup: 0, resend: 0, logout: 0, guest: 0,
  accountChange: 0, characterChange: 0, ready: 0,
  walletInit: 0, walletRefresh: 0, walletConnect: 0, walletSign: 0,
  pauseChange: 0, resume: 0, newGame: 0,
};
let finishLogin;
const auth = {
  state: { enabled: true, busy: false, signedIn: false, guestChoice: false, email: '', error: '', errorKey: '' },
  listeners: new Set(),
  subscribe(callback) { this.listeners.add(callback); callback({ ...this.state }); return () => this.listeners.delete(callback); },
  publish(patch) { this.state = { ...this.state, ...patch }; for (const callback of this.listeners) callback({ ...this.state }); },
  dismissError() { this.publish({ error: '', errorKey: '' }); },
  login() { counts.login++; this.publish({ busy: true }); return new Promise((resolve) => { finishLogin = resolve; }); },
  signup() { counts.signup++; return Promise.resolve({ ok: false }); },
  resend() { counts.resend++; return Promise.resolve({ ok: false }); },
  logout() { counts.logout++; return Promise.resolve({ ok: false }); },
  useGuest() { counts.guest++; this.publish({ guestChoice: true }); },
};
const wallet = {
  state: { enabled: false, phase: 'ready', address: '', chainId: null, review: null, error: '' },
  subscribe(callback) { callback({ ...this.state }); return () => {}; },
  async init() { counts.walletInit++; return false; },
  async refresh() { counts.walletRefresh++; },
  async connect() { counts.walletConnect++; },
  async sign() { counts.walletSign++; },
  async cancel() {}, setBlocked() {}, destroy() {},
};

const account = new AccountPanel(document.querySelector('.title-actions'), auth, {
  wallet,
  onChange: () => { counts.accountChange++; },
  onCharacterChange: () => { counts.characterChange++; },
  onReady: () => { counts.ready++; },
});
const settings = {
  master: 0.8, sfx: 0.7, music: 0.6, ambience: 0.5, muted: false,
  quality: 'medium', timeOfDay: 'cycle', shake: 0.5, reducedMotion: false,
  camRotate: true, uiScale: 1, highContrast: false, landscape: true,
  touchSize: 1, haptics: true, comicFx: true, launch: 'indicator',
};
const pause = new PauseMenu(document.querySelector('#pause'), settings, {
  onChange: () => { counts.pauseChange++; },
  onResume: () => { counts.resume++; },
  onNewGame: () => { counts.newGame++; },
});
document.querySelector('#show-pause').addEventListener('click', () => pause.show('settings'));

window.entryQA = {
  account, auth, pause, wallet, settings, counts,
  resolveLogin(result = { ok: false }) {
    const resolve = finishLogin; finishLogin = null;
    auth.publish({ busy: false, errorKey: result.ok ? '' : 'auth.error.credentials' });
    resolve?.(result);
  },
};
