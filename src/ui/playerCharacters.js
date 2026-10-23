import { getLocale, onLocaleChange } from '../core/locale.js';
import { t } from '../core/i18n.js';

let panelSequence = 0;

const COPY = {
  es: {
    title: 'Tus personajes', close: 'Cerrar', intro: 'Elige con quién quieres continuar.',
    accountSave: 'Guardados en tu cuenta. Cada personaje tiene su propio progreso.',
    guestSave: 'Guardados solo en este navegador y servidor. Inicia sesión para guardarlos en tu cuenta.',
    saved: 'Personajes guardados', empty: 'Aún no hay personajes en esta cuenta.',
    continue: 'Jugar con este personaje', new: 'Crear personaje', legacy: 'Conservar partida guardada',
    import: 'Importar guardado local', slot: 'Plaza {n}', level: 'Nivel {n}',
    sword: 'Sable', pistols: 'Pistolas', starterKit: 'Kit inicial: {name}', lastPlayed: 'Última partida',
    createTitle: 'Un nuevo comienzo', legacyTitle: 'Conservar tu partida', importTitle: 'Importar partida local',
    name: 'Nombre', look: 'Aspecto', nameHint: 'Elige un nombre para este personaje.',
    newHint: 'Este personaje empieza con su propio inventario y progreso.',
    legacyHint: 'El guardado conserva inventario y progreso, pero no recuerda nombre ni aspecto. Confirma los que quieres usar ahora.',
    importHint: 'Se copiará tu guardado local a una plaza nueva. El archivo local original se conservará sin cambios.',
    confirmLegacy: 'Entiendo: conservaré la partida y usaré este nombre y aspecto.',
    confirmImport: 'Entiendo: importaré una copia del guardado local a esta cuenta.',
    create: 'Crear y continuar', cancel: 'Volver', limit: 'Ya están ocupadas las tres plazas.',
    legacyFirst: 'Confirma o importa la partida antigua antes de crear otra plaza.',
    noCharacter: 'Selecciona o crea un personaje para continuar.', loading: 'Cargando personajes…',
    loadError: 'No se pudieron cargar los personajes. Tu guardado sigue intacto.',
    createError: 'No se pudo crear el personaje. Tu guardado sigue intacto.',
    selected: 'Seleccionado', created: 'Personaje listo.', signIn: 'Inicia sesión para usar plazas permanentes.',
  },
  en: {
    title: 'Your characters', close: 'Close', intro: 'Choose who you want to continue with.',
    accountSave: 'Saved to your account. Each character has its own progress.',
    guestSave: 'Saved only in this browser and server. Sign in to save them to your account.',
    saved: 'Saved characters', empty: 'There are no characters in this account yet.',
    continue: 'Play as this character', new: 'Create character', legacy: 'Keep saved character',
    import: 'Import local save', slot: 'Slot {n}', level: 'Level {n}',
    sword: 'Saber', pistols: 'Pistols', starterKit: 'Starter kit: {name}', lastPlayed: 'Last played',
    createTitle: 'A new beginning', legacyTitle: 'Keep your saved game', importTitle: 'Import local game',
    name: 'Name', look: 'Appearance', nameHint: 'Choose a name for this character.',
    newHint: 'This character starts with its own inventory and progress.',
    legacyHint: 'Your save keeps inventory and progress, but not its name or appearance. Confirm what you want to use now.',
    importHint: 'A copy of your local save will be placed in a new slot. The original local file stays unchanged.',
    confirmLegacy: 'I understand: keep the saved game and use this name and appearance.',
    confirmImport: 'I understand: import a copy of my local save into this account.',
    create: 'Create and continue', cancel: 'Back', limit: 'All three slots are occupied.',
    legacyFirst: 'Confirm or import the old game before creating another slot.',
    noCharacter: 'Select or create a character to continue.', loading: 'Loading characters…',
    loadError: 'Characters could not be loaded. Your save is still intact.',
    createError: 'The character could not be created. Your save is still intact.',
    selected: 'Selected', created: 'Character ready.', signIn: 'Sign in to use permanent slots.',
  },
};

const node = (tag, className = '', text = '') => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};
const button = (className, text, action) => {
  const element = node('button', className, text); element.type = 'button';
  if (action) element.addEventListener('click', action);
  return element;
};
const fill = (value, params = {}) => String(value).replace(/\{([a-z]+)\}/gi, (_, key) => String(params[key] ?? ''));
const validSkin = value => Number.isInteger(value) && value >= 0 && value <= 4;
const errorMessage = (error, fallbackCopy) => typeof error?.l10nKey === 'string' && error.l10nKey
  ? { key: error.l10nKey, params: error.l10nParams } : { copy: fallbackCopy };

export class PlayerCharactersPanel {
  constructor({ parent = document.body, looks = [], onSelect = null, onCreate = null,
    onContinue = null, onChange = null, onClose = null } = {}) {
    if (!parent?.append || !Array.isArray(looks)) throw new TypeError('PlayerCharactersPanel requiere parent y looks.');
    Object.assign(this, { looks: looks.slice(0, 5), onSelect, onCreate, onContinue, onChange, onClose });
    this.roster = { mode: 'guest', characters: [], selected: null, legacy: false, legacySave: '', limit: 3 };
    this.selectedId = null; this.createMode = null; this.portraits = new Map(); this.busy = false; this.error = ''; this.notice = '';
    this.restoreFocus = null; this.lang = getLocale() === 'en' ? 'en' : 'es';
    this._build(parent);
    this.unsubscribeLocale = onLocaleChange(() => { this.lang = getLocale() === 'en' ? 'en' : 'es'; this.render(); });
  }

  _build(parent) {
    this.root = node('div', 'player-characters-overlay'); this.root.hidden = true;
    this.dialog = node('section', 'player-characters-dialog'); this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-modal', 'true'); this.dialog.tabIndex = -1;
    this.dialog.addEventListener('keydown', event => this.onKeydown(event));
    this.heading = node('h2', 'player-characters-title'); this.heading.id = `player-characters-title-${++panelSequence}`;
    this.dialog.setAttribute('aria-labelledby', this.heading.id);
    const header = node('header', 'player-characters-header');
    this.closeButton = button('player-characters-close', '×', () => this.close());
    this.closeButton.setAttribute('aria-label', this.copy().close);
    header.append(this.heading, this.closeButton);
    this.intro = node('p', 'player-characters-intro'); this.status = node('p', 'player-characters-status');
    this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.rosterHeading = node('h3', 'player-characters-subtitle');
    this.list = node('div', 'player-characters-list'); this.empty = node('p', 'player-characters-empty');
    this.legacyNotice = node('p', 'player-characters-legacy-note');
    this.rosterView = node('section', 'player-characters-roster');
    this.rosterView.append(this.rosterHeading, this.list, this.empty, this.legacyNotice);
    this.createView = node('section', 'player-characters-create'); this.createView.hidden = true;
    this.createHeading = node('h3', 'player-characters-subtitle');
    this.createHint = node('p', 'player-characters-hint');
    this.nameLabel = node('label', 'player-characters-name-label'); this.nameInput = node('input', 'player-characters-name');
    this.nameInput.type = 'text'; this.nameInput.maxLength = 16; this.nameInput.autocomplete = 'off'; this.nameInput.spellcheck = false;
    this.nameText = node('span'); this.nameLabel.append(this.nameText, this.nameInput);
    this.nameInput.addEventListener('input', () => { this.onChange?.({ name: this.nameInput.value, skin: this.skin }); this.render(); });
    this.lookLegend = node('span', 'player-characters-look-legend'); this.lookGrid = node('div', 'player-characters-look-grid');
    this.skin = 0; this.confirmLabel = node('label', 'player-characters-confirm'); this.confirmInput = node('input'); this.confirmInput.type = 'checkbox';
    this.confirmText = node('span'); this.confirmLabel.append(this.confirmInput, this.confirmText);
    this.confirmInput.addEventListener('change', () => this.render());
    this.createError = node('p', 'player-characters-error'); this.createError.setAttribute('role', 'alert');
    this.createButton = button('player-characters-primary', '', () => this.submitCreate());
    this.backButton = button('player-characters-secondary', '', () => this.showRoster());
    const createActions = node('footer', 'player-characters-actions'); createActions.append(this.backButton, this.createButton);
    this.createView.append(this.createHeading, this.createHint, this.nameLabel, this.lookLegend, this.lookGrid,
      this.confirmLabel, this.createError, createActions);
    this.actions = node('footer', 'player-characters-actions');
    this.continueButton = button('player-characters-primary', '', () => this.continueSelected());
    this.newButton = button('player-characters-secondary', '', () => this.showCreate('new'));
    this.legacyButton = button('player-characters-secondary', '', () => this.showCreate('legacy'));
    this.importButton = button('player-characters-secondary', '', () => this.showCreate('import'));
    this.actions.append(this.continueButton, this.newButton, this.legacyButton, this.importButton);
    this.dialog.append(header, this.intro, this.status, this.rosterView, this.createView, this.actions);
    this.root.append(this.dialog); parent.append(this.root);
    this._buildLookGrid(); this.render();
  }

  copy() { return COPY[this.lang] || COPY.es; }
  // Resolve a stored message descriptor ({ key, params } catalog entry or { copy } table entry) in the current locale.
  _message(descriptor) {
    if (!descriptor) return '';
    if (descriptor.key) return t(descriptor.key, descriptor.params);
    return this.copy()[descriptor.copy] || '';
  }
  _buildLookGrid() {
    this.lookGrid.replaceChildren();
    this.lookButtons = [];
    for (const look of this.looks) {
      const entry = button('player-characters-look', '', () => this.chooseSkin(look.id));
      entry.dataset.skin = String(look.id); entry.setAttribute('aria-pressed', 'false');
      entry.setAttribute('aria-label', String(look.name ?? `Look ${look.id + 1}`));
      const art = node('span', 'player-characters-look-art');
      if (look.color) art.style.setProperty('--look-color', String(look.color));
      const image = node('img'); image.alt = ''; image.hidden = true; art.append(image);
      const name = node('span', 'player-characters-look-name', look.label || look.name || `Look ${look.id + 1}`);
      entry.append(art, name); this.lookGrid.append(entry); this.lookButtons.push({ entry, image, name, look });
    }
  }

  setPortraits(render) {
    if (typeof render !== 'function') return;
    for (const { look, image } of this.lookButtons) {
      const canvas = render(look.id); if (!canvas?.toDataURL) continue;
      try { const src = canvas.toDataURL(); this.portraits.set(look.id, src); image.src = src; image.hidden = false; }
      catch { /* Portrait rendering is decorative; text choices stay available. */ }
    }
    this.render();
  }

  open(roster = {}) {
    this.restoreFocus = document.activeElement;
    this.setRoster(roster);
    this.root.hidden = false;
    this.createMode = null; this.error = ''; this.render();
    this.closeButton.focus({ preventScroll: true });
  }

  setRoster(roster = {}) {
    const raw = Array.isArray(roster) ? { characters: roster } : roster;
    this.roster = { mode: raw.mode === 'account' ? 'account' : 'guest',
      characters: Array.isArray(raw.characters) ? raw.characters.slice(0, 3) : [],
      selected: raw.selected || null, legacy: raw.legacy === true, legacySave: typeof raw.legacySave === 'string' ? raw.legacySave : '',
      current: raw.current && typeof raw.current === 'object' ? raw.current : {},
      limit: Number.isInteger(raw.limit) && raw.limit >= 0 && raw.limit <= 3 ? raw.limit : 3 };
    const selected = this.roster.selected;
    this.selectedId = this.roster.characters.some(character => character.id === selected?.id)
      ? selected.id : this.roster.characters[0]?.id ?? null;
    this.render();
  }

  selected() { return this.roster.characters.find(character => character.id === this.selectedId) || null; }

  close(force = false) {
    if ((this.busy && !force) || this.root.hidden) return;
    this.root.hidden = true; this.createMode = null; this.error = ''; this.notice = '';
    if (this.restoreFocus?.isConnected) this.restoreFocus.focus({ preventScroll: true });
    this.onClose?.();
  }

  onKeydown(event) {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...this.dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
      .filter(element => !element.hidden && element.getClientRects().length);
    if (!focusable.length) { event.preventDefault(); this.dialog.focus(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  choose(id) {
    const character = this.roster.characters.find(item => item.id === id);
    if (!character) return;
    this.selectedId = id; this.error = ''; this.notice = '';
    try { this.onSelect?.(id, character); } catch { this.error = { copy: 'loadError' }; }
    this.render();
  }

  chooseSkin(id) {
    if (!validSkin(id) || !this.looks.some(look => look.id === id)) return;
    this.skin = id;
    this.lookButtons.forEach(({ entry }) => entry.setAttribute('aria-pressed', String(Number(entry.dataset.skin) === id)));
    this.onChange?.({ name: this.nameInput.value, skin: id });
  }

  showCreate(mode) {
    if (this.busy) return;
    if (!['new', 'legacy', 'import'].includes(mode)) return;
    if (mode === 'new' && this.roster.legacy) { this.error = { copy: 'legacyFirst' }; this.render(); return; }
    if (mode === 'legacy' && !this.roster.legacy) return;
    if (mode === 'import' && (this.roster.mode !== 'account' || this.roster.characters.length || !this.roster.legacySave)) return;
    if (mode === 'new' && this.roster.characters.length >= this.roster.limit) { this.error = { copy: 'limit' }; this.render(); return; }
    this.createMode = mode; this.error = ''; this.notice = ''; this.createError.textContent = '';
    this.confirmInput.checked = false;
    this.nameInput.value = this.roster.current?.name || this.roster.selected?.name || 'Grumete';
    this.skin = validSkin(this.roster.current?.skin) ? this.roster.current.skin
      : validSkin(this.roster.selected?.skin) ? this.roster.selected.skin : 0;
    this.onChange?.({ name: this.nameInput.value, skin: this.skin });
    this.render(); this.nameInput.focus({ preventScroll: true });
  }

  showRoster() { if (!this.busy) { this.createMode = null; this.error = ''; this.render(); this.continueButton.focus({ preventScroll: true }); } }

  async submitCreate() {
    if (this.busy || !this.createMode || typeof this.onCreate !== 'function') return;
    const mode = this.createMode, name = this.nameInput.value.trim();
    if (!name || name.length > 16 || ((mode === 'legacy' || mode === 'import') && !this.confirmInput.checked)) return;
    const payload = { name, skin: this.skin, mode,
      ...(mode === 'import' ? { save: this.roster.legacySave } : {}) };
    this.busy = true; this.error = ''; this.render();
    try {
      const result = await this.onCreate(payload);
      if (result && Array.isArray(result.characters)) this.setRoster(result);
      else if (result?.id) {
        const exists = this.roster.characters.some(character => character.id === result.id);
        if (!exists) this.roster.characters = [...this.roster.characters, result].slice(0, 3);
        this.selectedId = result.id; this.roster.selected = result;
        this.roster.legacy = false;
      }
      this.createMode = null; this.error = ''; this.render();
      if (this.selected()) this.onSelect?.(this.selected().id, this.selected());
      this.notice = { copy: 'created' };
      this.status.textContent = this._message(this.notice);
      this.continueButton.focus({ preventScroll: true });
    } catch (error) {
      // Never show error.message: it may be Spanish prose or external text. Store the key so a locale change re-renders it.
      this.error = errorMessage(error, 'createError');
      this.createError.textContent = this._message(this.error);
      this.status.textContent = this._message(this.error);
    } finally { this.busy = false; this.render(); }
  }

  async continueSelected() {
    const character = this.selected();
    if (!character || this.busy || typeof this.onContinue !== 'function') return;
    this.busy = true; this.error = ''; this.render();
    try { await this.onContinue(character); }
    catch (error) { this.notice = errorMessage(error, 'loadError'); this.status.textContent = this._message(this.notice); }
    finally { this.busy = false; this.render(); }
  }

  render() {
    const T = this.copy();
    if (!this.dialog) return;
    this.heading.textContent = T.title; this.closeButton.setAttribute('aria-label', T.close);
    this.intro.textContent = `${T.intro} ${this.roster.mode === 'account' ? T.accountSave : T.guestSave}`; this.rosterHeading.textContent = T.saved;
    this.empty.textContent = T.empty; this.empty.hidden = this.roster.characters.length !== 0;
    this.list.replaceChildren();
    for (const character of this.roster.characters) {
      const entry = button('player-character-card', '', () => this.choose(character.id));
      entry.disabled = this.busy;
      entry.setAttribute('aria-pressed', String(character.id === this.selectedId));
      const portrait = node('span', 'player-character-portrait');
      const src = this.portraits.get(character.skin), image = node('img'); image.alt = ''; image.hidden = !src;
      if (src) image.src = src; portrait.append(image);
      const copy = node('span', 'player-character-copy');
      const name = node('strong', 'player-character-name', character.name);
      const meta = node('span', 'player-character-meta', `${fill(T.slot, { n: character.slot + 1 })} · ${fill(T.starterKit, { name: T[character.weapon === 1 ? 'pistols' : 'sword'] })}`);
      copy.append(name, meta);
      if (character.lastPlayed) copy.append(node('span', 'player-character-last', T.lastPlayed));
      entry.append(portrait, copy); this.list.append(entry);
    }
    this.legacyNotice.hidden = !this.roster.legacy;
    this.legacyNotice.textContent = T.legacyFirst;
    const isCreating = !!this.createMode;
    this.rosterView.hidden = isCreating; this.createView.hidden = !isCreating; this.actions.hidden = isCreating;
    if (isCreating) {
      this.createHeading.textContent = this.createMode === 'legacy' ? T.legacyTitle : this.createMode === 'import' ? T.importTitle : T.createTitle;
      this.createHint.textContent = this.createMode === 'legacy' ? T.legacyHint : this.createMode === 'import' ? T.importHint : T.newHint;
      this.nameText.textContent = `${T.name}: `;
      this.nameInput.setAttribute('aria-label', T.name); this.lookLegend.textContent = T.look;
      this.confirmLabel.hidden = !['legacy', 'import'].includes(this.createMode);
      this.confirmText.textContent = this.createMode === 'legacy' ? T.confirmLegacy : T.confirmImport;
      this.createError.textContent = this._message(this.error);
      this.createButton.textContent = T.create; this.backButton.textContent = T.cancel;
      this.createButton.disabled = this.busy || !this.nameInput.value.trim() || this.nameInput.value.trim().length > 16 ||
        (this.confirmLabel.hidden === false && !this.confirmInput.checked);
      for (const { entry, name, look } of this.lookButtons) {
        const translatedName = t(`look.${look.name}`);
        name.textContent = look.label || (translatedName !== `look.${look.name}` ? translatedName : '') || `${T.look} ${Number(entry.dataset.skin) + 1}`;
        entry.setAttribute('aria-pressed', String(Number(entry.dataset.skin) === this.skin)); entry.disabled = this.busy;
      }
    }
    this.continueButton.textContent = T.continue; this.newButton.textContent = T.new;
    this.legacyButton.textContent = T.legacy; this.importButton.textContent = T.import;
    this.continueButton.disabled = this.busy || !this.selected();
    this.newButton.disabled = this.busy || this.roster.characters.length >= this.roster.limit || this.roster.legacy;
    this.legacyButton.hidden = !this.roster.legacy;
    this.importButton.hidden = !(this.roster.mode === 'account' && this.roster.characters.length === 0 && !this.roster.legacy && !!this.roster.legacySave);
    if (this.roster.mode === 'guest') this.importButton.hidden = true;
    this.status.textContent = this._message(this.error) || this._message(this.notice) || (!this.selected() && !this.roster.legacy ? T.noCharacter : '');
    this.closeButton.disabled = this.busy;
    this.nameInput.disabled = this.busy; this.confirmInput.disabled = this.busy;
    this.backButton.disabled = this.busy;
    this.legacyButton.disabled = this.busy;
    this.importButton.disabled = this.busy;
  }

  destroy() {
    this.unsubscribeLocale?.(); this.root.remove(); this.roster.characters = []; this.selectedId = null;
  }
}
