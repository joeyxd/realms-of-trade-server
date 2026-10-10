// Admission to the editor is separate from admission to a gameplay body.
export class GmEntry {
  constructor({ parent, auth, online, httpBase, available, onOpen, onRevoke, fetchImpl = globalThis.fetch.bind(globalThis) }) {
    Object.assign(this, { auth, online, httpBase, available, onOpen, onRevoke, fetchImpl });
    this.ready = false;
    this.allowed = !online;
    this.accountId = '';
    this.epoch = 0;
    this.busy = false;
    this.active = false;
    this.button = document.createElement('button');
    this.button.id = 'btn-gm-editor';
    this.button.className = 'btn secondary interactive';
    parent.append(this.button);
    this.button.addEventListener('click', () => void this.open());
    this.unsubscribe = auth.subscribe((state) => {
      if (this.accountId && (!state.signedIn || state.accountId !== this.accountId)) this.revoke();
      this.epoch++;
      this.allowed = !online;
      this.render();
      if (online && state.signedIn) void this.check();
    });
    this.timer = setInterval(() => { if (this.active && this.online) void this.check(); }, 30000);
  }

  render() {
    this.button.hidden = this.online && !this.auth.state.signedIn;
    this.button.disabled = !this.ready || !this.allowed || this.busy || !this.available();
    this.button.textContent = this.busy ? 'Abriendo… / Opening…' : this.online ? 'Editor GM / GM editor' : 'Editor GM local / Local GM editor';
    this.button.title = this.allowed ? 'Borrador privado / Private draft' : 'Esta cuenta no tiene permiso GM / This account has no GM permission';
  }

  async check() {
    const epoch = ++this.epoch;
    try {
      const identity = await this.auth.sessionIdentity();
      const response = await this.fetchImpl(new URL('api/gm/session', this.httpBase), {
        headers: { authorization: `Bearer ${identity.token}` }, cache: 'no-store', signal: AbortSignal.timeout(12000),
      });
      const result = response.ok ? await response.json() : null;
      if (epoch !== this.epoch) return false;
      const allowed = result?.ok === true && result.accountId === identity.accountId
        && result.capabilities?.includes('gm-editor') && this.auth.state.accountId === identity.accountId && this.auth.state.signedIn;
      if (!allowed) { this.revoke(); return false; }
      this.allowed = true;
      this.accountId = identity.accountId;
      this.render();
      return true;
    } catch {
      if (epoch === this.epoch) this.revoke();
      return false;
    }
  }

  revoke() {
    this.allowed = !this.online;
    this.accountId = '';
    this.epoch++;
    if (this.active) { this.active = false; this.onRevoke(); }
    this.render();
  }

  async open() {
    if (this.busy || !this.ready || !this.available()) return;
    this.busy = true;
    this.render();
    try {
      if (this.online && !(await this.check())) return;
      if (!this.available()) return;
      const epoch = this.epoch;
      await this.onOpen(this.accountId);
      // A sign-out while the lazy module is loading cannot leave an admitted editor behind.
      if (this.online && (epoch !== this.epoch || !this.allowed)) { this.onRevoke(); return; }
      this.active = true;
    } catch (error) { console.error('[gm-editor]', error); }
    finally { this.busy = false; this.render(); }
  }

  closed() { this.active = false; this.render(); }
  dispose() { clearInterval(this.timer); this.unsubscribe(); this.button.remove(); }
}
