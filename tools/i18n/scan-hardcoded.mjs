#!/usr/bin/env node
// Regression guard for "all visible text exists in English and Spanish".
//
// Finds hardcoded single-language player-visible strings in the client code and checks that local
// { es: {...}, en: {...} } copy tables have matching keys. Offenders already known live in
// tools/i18n/baseline.json (a ratchet: it may only shrink, never grow).
//
// Usage:
//   node tools/i18n/scan-hardcoded.mjs                   summary + full offender list
//   node tools/i18n/scan-hardcoded.mjs --json            the same as JSON
//   node tools/i18n/scan-hardcoded.mjs --write-baseline  rewrite tools/i18n/baseline.json from the current tree
//
// Escape hatch: an inline `// i18n-ok: <reason>` comment (or `<!-- i18n-ok: <reason> -->` in index.html)
// on the same line as the string exempts that line. A template literal is exempt when the marker is
// on any line it spans. The reason is required: a bare `i18n-ok:` with nothing after it exempts nothing.
//
// No parser is installed (acorn, babel and typescript are not dependencies), so this file carries a small
// tokenizer (strings, template literals, comments, regex literals) and a bracket tree, in plain Node.
// Limits: English is only detected where the sink is visible in the same statement (textContent,
// innerHTML, title, placeholder, aria-label, alt, toast()/flash()/setStatus()/notice() arguments,
// HTML template literals, label/title/text/message style object keys). A string first stored in a
// variable and shown later is only caught when it is Spanish.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogs, dataCatalog } from '../../src/core/i18n.js';

// Spanish source phrases that already have an English translation in the catalog (ES side of the pairs) or in the
// data dictionary. Such a literal outside a visible sink is a lookup source ("messageKey(value)", translateData), not a gap.
const KNOWN_SPANISH = new Set();
for (const pair of Object.values(catalogs)) if (Array.isArray(pair) && typeof pair[0] === 'string') KNOWN_SPANISH.add(pair[0].trim());
for (const source of Object.keys(dataCatalog)) KNOWN_SPANISH.add(source.trim());

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE_PATH = path.join(ROOT, 'tools', 'i18n', 'baseline.json');
const SCAN_DIRS = ['src/ui', 'src/client', 'src/editor', 'src/net', 'src/render'];
// Whole files that are skipped on purpose, each with its reason. Prefer an inline `// i18n-ok:` marker for single lines.
export const ALLOWED_FILES = {
  'src/net/companionTemplates.js': 'Spanish source templates stored in companion documents and prompts (never shown as such); the EN display copy lives in ROLE_DISPLAY_EN and companionTemplateText().',
};
const SCAN_FILES = ['src/main.js', 'index.html'];

// ---------------------------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------------------------

// Calls whose arguments are catalog keys or source phrases, never prose to translate.
const I18N_CALLS = new Set(['t', 'text', 'rich', 'attr', 'setText', 'setAttributeText', 'dataText', 'translateData', 'setDataText', 'dataParam', 'messageKey']);
// Calls whose string arguments are selectors, keys, event names, paths or lookups, not display text.
const NON_TEXT_CALLS = new Set([
  'querySelector', 'querySelectorAll', 'closest', 'matches', 'getElementById', 'getElementsByClassName', 'getElementsByTagName',
  'getAttribute', 'hasAttribute', 'removeAttribute', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'CustomEvent', 'Event',
  'add', 'remove', 'toggle', 'contains', 'replace', 'replaceAll', 'includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'split',
  'match', 'matchAll', 'test', 'exec', 'has', 'get', 'set', 'delete', 'hasOwn', 'getItem', 'setItem', 'removeItem', 'fetch', 'URL',
  'createElement', 'createElementNS', 'setProperty', 'getPropertyValue', 'removeProperty', 'Symbol', 'require', 'import', 'emit', 'on', 'off',
  'once', 'postMessage', 'RegExp', 'parse', 'stringify', 'assert', 'equal', 'ok', 'deepEqual', 'send', 'sendJson', 'send_', 'padStart', 'padEnd',
  'localeCompare', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'DateTimeFormat', 'NumberFormat',
  'defineProperty', 'getOwnPropertyDescriptor', 'dispatch', 'subscribe', 'registerProcessor', 'register', 'define',
  'toBlob', 'toDataURL', 'getContext', 'getParameter', 'getExtension', 'loadAsync', 'Audio', 'Worker', 'WebSocket', 'XMLHttpRequest',
  'ListFormat', 'PluralRules', 'RelativeTimeFormat', 'groupBy', 'charAt', 'fromCharCode',
]);
// Developer-facing exceptions: constructor assertions are not shown to players (constructor names ending in Error count, e.g. PlayerCharactersError; showError and similar helpers do not).
const ERROR_CTORS = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError']);
const LOG_RECEIVERS = new Set(['console', 'logger', 'log', 'Logger']);
// Calls that put their string arguments on screen.
const SINK_CALLS = new Set(['toast', 'flash', 'setStatus', 'notice', 'notifyContext', 'announce', 'showToast', 'alert', 'say', 'setNotice', 'showNotice', 'insertAdjacentHTML']);
const SINK_PROPS = new Set(['textContent', 'innerHTML', 'innerText', 'title', 'placeholder', 'ariaLabel', 'alt', 'outerHTML']);
const SINK_ATTRS = new Set(['title', 'placeholder', 'aria-label', 'alt', 'aria-description', 'aria-valuetext']);
const SINK_OBJECT_KEYS = new Set(['text', 'title', 'label', 'message', 'hint', 'description', 'placeholder', 'tooltip', 'caption', 'subtitle', 'heading', 'tip', 'prompt', 'verb']);
const LOCALE_IDS = /(locale|lang|english|spanish|l10n)|^(isEn|isEs|loc|lng|en|es)$/i;
const NO_CALLEE = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'await', 'in', 'of', 'else', 'case', 'new', 'do', 'async', 'void', 'yield', 'delete']);
const VALUE_KEYWORDS = new Set(['return', 'in', 'of', 'typeof', 'case', 'yield', 'await', 'default', 'else', 'void', 'delete', 'new', 'instanceof', 'throw']);
const HTML_VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr', 'area', 'base', 'col', 'embed', 'param', 'track']);
// The escape-hatch marker needs a reason: `i18n-ok:` followed by at least one non-space character (not just a comment closer).
const OK_MARKER = /i18n-ok:\s*(?!-->|\*\/)\S/;
const L10N_ELEMENT_ATTRS = ['data-l10n-key', 'data-l10n-html', 'data-l10n-source'];

// Personal names and brand stay verbatim in both languages: never offenders by themselves.
const VERBATIM = /Don Bacalao|La Tuerta|Tía Perla|Capitana Brea|MAREA NEGRA|Salty Shore|La Caldera|Español|English/gi;

// Spanish function words that are not English words, plus common UI and game vocabulary.
const ES_WORDS = new Set(`de la el los las un una unos unas para con por que del al tu tus su sus se les más como esta está este esto estos
hay sin sobre entre desde hasta cuando donde cuanto nada todo todos todas muy pero porque tambien también ya aqui aquí ahi ahí eres
tiene tienes tengo puedes puede quieres quiere necesitas necesita falta faltan usa usar abre abrir cierra cerrar pulsa pulsar haz elige elegir
cargando guardar guardado guardada guardando aceptar cancelar volver continuar nombre inventario madera piedra hacha pico cuerda cuerdas antorcha
isla barco balsa mar mapa misión mision misiones tienda comprar vender precio oro monedas perlas perla vida energía energia hambre tala tiempo agua comida
bebida fuego hoguera cabaña cabana taller artesano oficio nivel experiencia daño dano ataque defensa arma armas herramienta herramientas recoger
recolectar talar picar construir reparar salir entrar iniciar inicio jugar partida pausa ajustes opciones idioma sonido música musica ayuda
cerrado abierto vacío vacio lleno llena sí si nueva nuevo nuevos nuevas ninguno ninguna ver mostrar ocultar siguiente anterior listo lista
correo contraseña usuario entrar registrarse cuenta invitado conectar conectando desconectado fallo reintentar enviar recibir
aliado compañero compañera tripulación tripulacion capitán capitan pirata piratas bucanero timón timon vela velas ancla casco carga
día noche tarde mañana hoy ayer ahora luego después antes siempre nunca todavía aún mejor peor mayor menor poco poca mucho mucha`.split(/\s+/).filter(Boolean));
// Spanish words that never collide with an English word, usable on their own as a one-word string.
const ES_SINGLE = new Set(`cargando guardar guardado guardada guardando aceptar cancelar volver continuar nombre inventario madera piedra hacha cuerda cuerdas
antorcha isla barco balsa mapa misión misiones tienda comprar vender precio oro monedas perlas perla vida energía hambre agua comida bebida fuego
hoguera cabaña taller artesano oficio nivel experiencia daño ataque defensa arma armas herramienta herramientas recoger recolectar talar picar
construir reparar salir entrar iniciar inicio jugar partida pausa ajustes opciones idioma sonido música ayuda cerrado abierto vacío lleno sí nueva
nuevo ninguno ninguna mostrar ocultar siguiente anterior listo contraseña usuario cuenta invitado conectando desconectado reintentar enviar
aliado compañero compañera tripulación capitán pirata piratas bucanero timón vela velas ancla carga día noche mañana hoy ahora`.split(/\s+/).filter(Boolean));

// ---------------------------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------------------------

const PUNCTS = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];
const isIdStart = (c) => /[A-Za-z_$¡-￿]/.test(c);
const isIdPart = (c) => /[\w$¡-￿]/.test(c);

function lexTokens(st, untilBrace) {
  const { src } = st;
  const tokens = [];
  let braceDepth = 0;
  const prevSignificant = () => tokens[tokens.length - 1];
  const regexAllowed = () => {
    const p = prevSignificant();
    if (!p) return true;
    if (p.t === 'punct') return !(p.v === ')' || p.v === ']' || p.v === '}');
    if (p.t === 'id') return VALUE_KEYWORDS.has(p.v);
    return false;
  };
  while (st.i < src.length) {
    const c = src[st.i];
    if (c === '\n') { st.line++; st.i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '﻿') { st.i++; continue; }
    if (c === '/' && src[st.i + 1] === '/') {
      let j = src.indexOf('\n', st.i); if (j < 0) j = src.length;
      if (OK_MARKER.test(src.slice(st.i, j))) st.ok.add(st.line);
      st.i = j; continue;
    }
    if (c === '/' && src[st.i + 1] === '*') {
      let j = src.indexOf('*/', st.i + 2); j = j < 0 ? src.length : j + 2;
      const body = src.slice(st.i, j);
      let line = st.line;
      for (const part of body.split('\n')) { if (OK_MARKER.test(part)) st.ok.add(line); line++; }
      st.line = line - 1; st.i = j; continue;
    }
    if (c === '"' || c === "'") {
      const startLine = st.line; let v = ''; st.i++;
      while (st.i < src.length && src[st.i] !== c && src[st.i] !== '\n') {
        if (src[st.i] === '\\') {
          const n = src[st.i + 1];
          if (n === '\n') { st.line++; st.i += 2; continue; }
          if (n === 'n') v += '\n'; else if (n === 't') v += '\t';
          else if (n === 'u' && src[st.i + 2] === '{') { const e = src.indexOf('}', st.i); v += String.fromCodePoint(parseInt(src.slice(st.i + 3, e), 16) || 63); st.i = e + 1; continue; }
          else if (n === 'u') { v += String.fromCharCode(parseInt(src.slice(st.i + 2, st.i + 6), 16) || 63); st.i += 6; continue; }
          else if (n === 'x') { v += String.fromCharCode(parseInt(src.slice(st.i + 2, st.i + 4), 16) || 63); st.i += 4; continue; }
          else v += n;
          st.i += 2; continue;
        }
        v += src[st.i++];
      }
      st.i++;
      tokens.push({ t: 'str', v, line: startLine, endLine: st.line });
      continue;
    }
    if (c === '`') { tokens.push(lexTemplate(st)); continue; }
    if (/[0-9]/.test(c)) {
      let j = st.i + 1;
      while (j < src.length && /[0-9a-zA-Z_]/.test(src[j])) j++;
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] || '')) { j++; while (j < src.length && /[0-9a-zA-Z_]/.test(src[j])) j++; }
      tokens.push({ t: 'num', v: src.slice(st.i, j), line: st.line }); st.i = j; continue;
    }
    if (isIdStart(c) || (c === '#' && isIdStart(src[st.i + 1] || ''))) {
      let j = st.i + 1; while (j < src.length && isIdPart(src[j])) j++;
      tokens.push({ t: 'id', v: src.slice(st.i, j), line: st.line }); st.i = j; continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = st.i + 1, inClass = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      j++; while (j < src.length && /[a-z]/.test(src[j])) j++;
      tokens.push({ t: 'regex', v: src.slice(st.i, j), line: st.line }); st.i = j; continue;
    }
    if (untilBrace) {
      if (c === '{') braceDepth++;
      else if (c === '}') { if (braceDepth === 0) { st.i++; return tokens; } braceDepth--; }
    }
    let p = c;
    for (const cand of PUNCTS) if (src.startsWith(cand, st.i)) { p = cand; break; }
    if (p === '?.' && /[0-9]/.test(src[st.i + 2] || '')) p = '?';
    tokens.push({ t: 'punct', v: p, line: st.line }); st.i += p.length;
  }
  return tokens;
}

function lexTemplate(st) {
  const { src } = st;
  const startLine = st.line; st.i++;
  const quasis = []; const exprs = []; let cur = '';
  while (st.i < src.length) {
    const c = src[st.i];
    if (c === '`') { st.i++; break; }
    if (c === '\\') { const n = src[st.i + 1]; cur += n === 'n' ? '\n' : n === 't' ? '\t' : n; if (n === '\n') st.line++; st.i += 2; continue; }
    if (c === '$' && src[st.i + 1] === '{') {
      st.i += 2; quasis.push(cur); cur = '';
      exprs.push(buildTree(lexTokens(st, true)));
      continue;
    }
    if (c === '\n') st.line++;
    cur += c; st.i++;
  }
  quasis.push(cur);
  return { t: 'tpl', quasis, exprs, line: startLine, endLine: st.line };
}

const CLOSERS = { '(': ')', '[': ']', '{': '}' };
function buildTree(tokens) {
  const root = []; const stack = [{ children: root }];
  for (const tok of tokens) {
    const top = stack[stack.length - 1];
    if (tok.t === 'punct' && CLOSERS[tok.v]) {
      const g = { t: 'group', open: tok.v, children: [], line: tok.line };
      top.children.push(g); stack.push(g);
    } else if (tok.t === 'punct' && (tok.v === ')' || tok.v === ']' || tok.v === '}')) {
      if (stack.length > 1) { const g = stack.pop(); g.endLine = tok.line; }
    } else top.children.push(tok);
  }
  return root;
}

// ---------------------------------------------------------------------------------------------
// String classification
// ---------------------------------------------------------------------------------------------

const PLACEHOLDER = '\u0000';
const wordsOf = (s) => s.match(/\p{L}+/gu) || [];

function looksSpanish(s) {
  const clean = s.replace(VERBATIM, ' ').replace(/\{[A-Za-z0-9_.]+\}|\u0000/g, ' ');
  const words = wordsOf(clean);
  if (!words.length) return false;
  if (/[áéíóúñüÁÉÍÓÚÑÜ¿¡]/.test(clean)) return true;
  const low = words.map((w) => w.toLowerCase());
  if (low.length === 1) return low[0].length > 2 && ES_SINGLE.has(low[0]);
  return low.some((w) => ES_WORDS.has(w));
}

function looksEnglish(s) {
  const clean = s.replace(VERBATIM, ' ').replace(/\{[A-Za-z0-9_.]+\}|\u0000/g, ' ');
  if (/[#.=;{}<>_\\@[\]|~^]|:\/\/|[a-z][A-Z]/.test(clean)) return false;
  const words = clean.match(/[A-Za-z]+(?:['’][a-z]+)?/g) || [];
  if (words.length < 2 || !words.some((w) => w.length >= 3)) return false;
  const letters = (clean.match(/[A-Za-z]/g) || []).length;
  const visible = clean.replace(/\s/g, '').length;
  return letters / Math.max(visible, 1) >= 0.6;
}

// The English half of a bilingual pair: English prose (several words), not Spanish, not a one-word id such as 'warn' or 'aria-label'.
const looksEnglishProse = (s) => /\s/.test(s.trim()) && looksEnglish(s.replace(/[.!?…]+(?=\s|$)/g, '')) && !looksSpanish(s);

const normalizeText = (s) => s.replace(/\u0000/g, '{}').replace(/\s+/g, ' ').trim().slice(0, 160);

function classifyPlain(raw, sink, found) {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (/data-l10n-/.test(s)) return; // markup fragment that is retranslated through its own data-l10n-* attribute
  if ((s.match(/;/g) || []).length >= 2 && /[(){}=]/.test(s)) return; // code, not prose
  if (/(uniform|varying|attribute|precision|float|vec[234]|mat[234]|sampler2D|gl_FragColor|gl_Position)|#(ifdef|ifndef|define|include|endif)/.test(s)) return; // shader source
  if (!s || !/\p{L}{2}/u.test(s)) return;
  if (!/\s/.test(s) && /[._:/-]/.test(s)) return; // key-like token (catalog key, id, path)
  const parts = s.split(' / ');
  // "Entrar / Enter": one string that already carries both languages (not when both halves are Spanish).
  if (parts.length === 2 && parts.every((x) => /\p{L}{2}/u.test(x)) && !parts.every(looksSpanish)) return;
  if (looksSpanish(s) && (sink || /\s/.test(s) || /^[A-ZÁÉÍÓÚÑ]/.test(s) || /[áéíóúñ¿¡]/.test(s))) found.push({ kind: 'es', text: normalizeText(s) });
  else if (sink && looksEnglish(s)) found.push({ kind: 'en', text: normalizeText(s) });
}

const decodeEntities = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));

// Extract visible text nodes and visible attributes from an HTML fragment (placeholders already substituted).
function htmlTexts(html) {
  const out = []; const stack = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+)|</g;
  let m;
  while ((m = re.exec(html))) {
    const index = m.index;
    if (m[0].startsWith('<!--') || m[0] === '<') continue;
    if (m[4] !== undefined) {
      if (stack.some((e) => e.exempt || e.raw)) continue;
      const text = decodeEntities(m[4]);
      if (/\p{L}/u.test(text)) out.push({ text, index });
      continue;
    }
    const closing = m[1] === '/'; const name = m[2].toLowerCase();
    if (closing) {
      for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === name) { stack.length = k; break; }
      continue;
    }
    const attrs = {}; const are = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g; let a;
    while ((a = are.exec(m[3]))) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    const exempt = L10N_ELEMENT_ATTRS.some((k) => k in attrs);
    const visible = [];
    for (const k of SINK_ATTRS) visible.push(k);
    if (name === 'meta' && /^(description|og:title|og:description|twitter:title|twitter:description)$/i.test(attrs.name || attrs.property || '')) visible.push('content');
    if (name === 'button' || (name === 'input' && /^(button|submit|reset)$/i.test(attrs.type || ''))) visible.push('value');
    for (const k of visible) {
      if (attrs[k] === undefined || ('data-l10n-' + k) in attrs) continue;
      const text = decodeEntities(attrs[k]);
      if (/\p{L}/u.test(text)) out.push({ text, index });
    }
    if (!HTML_VOID.has(name) && !m[3].trimEnd().endsWith('/')) stack.push({ name, exempt, raw: name === 'script' || name === 'style' });
  }
  return out;
}

const looksLikeHtml = (s) => /<\/?[a-zA-Z][\w:-]*[\s>/]/.test(s);

// ---------------------------------------------------------------------------------------------
// Tree analysis
// ---------------------------------------------------------------------------------------------

const isPunct = (tok, v) => tok && tok.t === 'punct' && tok.v === v;
const isId = (tok, v) => tok && tok.t === 'id' && (v === undefined || tok.v === v);

function splitTop(seq, sep) {
  const parts = [[]];
  for (const tok of seq) { if (isPunct(tok, sep)) parts.push([]); else parts[parts.length - 1].push(tok); }
  return parts.filter((p) => p.length);
}

function keyOf(tok) {
  if (!tok) return null;
  if (tok.t === 'id' || tok.t === 'num') return tok.v;
  if (tok.t === 'str') return tok.v;
  return null;
}

// Flatten an object literal group into a set of dotted key paths; null when a spread or computed key makes it unknowable.
function flattenKeys(group, prefix = '') {
  const keys = new Set();
  for (const entry of splitTop(group.children, ',')) {
    if (isPunct(entry[0], '...')) return null;
    if (isPunct(entry[0], '[') || (entry[0].t === 'group' && entry[0].open === '[')) return null;
    const key = keyOf(entry[0]);
    if (key === null) return null;
    const path = prefix ? `${prefix}.${key}` : key;
    const value = entry.slice(2);
    if (isPunct(entry[1], ':') && value.length === 1 && value[0].t === 'group' && value[0].open === '{') {
      const nested = flattenKeys(value[0], path);
      if (nested === null) return null;
      keys.add(path); for (const k of nested) keys.add(k);
    } else keys.add(path);
  }
  return keys;
}

function objectProps(group) {
  const props = [];
  for (const entry of splitTop(group.children, ',')) {
    const key = keyOf(entry[0]);
    if (key !== null && isPunct(entry[1], ':')) props.push({ key, keyTok: entry[0], value: entry.slice(2), entry });
    else props.push({ key: null, entry });
  }
  return props;
}

function analyze(tree, st, file) {
  const found = [];
  const lineOk = (a, b) => { for (let l = a; l <= (b ?? a); l++) if (st.ok.has(l)) return true; return false; };
  const add = (items, line, endLine, extra = {}) => {
    if (lineOk(line, endLine)) return;
    for (const it of items) found.push({ file, line, ...it, ...extra });
  };

  function classifyToken(tok, ctx) {
    const items = [];
    if (tok.t === 'str') {
      if (looksLikeHtml(tok.v)) for (const n of htmlTexts(tok.v)) classifyPlain(n.text, true, items);
      else if (ctx.sink || !KNOWN_SPANISH.has(tok.v.trim())) classifyPlain(tok.v, ctx.sink, items);
    } else {
      let joined = '';
      tok.quasis.forEach((q, k) => { joined += q + (k < tok.exprs.length ? PLACEHOLDER : ''); });
      if (looksLikeHtml(joined)) for (const n of htmlTexts(joined)) classifyPlain(n.text, true, items);
      else classifyPlain(joined, ctx.sink, items);
    }
    add(items, tok.line, tok.endLine);
  }

  // f('English', 'Español') helpers: two literal arguments where one is Spanish and the other is not, or a known pair helper.
  const PAIR_HELPERS = /^(_t|tr|localized|editorMessage|bi|pair|both|dual|pick|choose|l10n|localize|translate)$/;
  function isPairCall(callee, group) {
    const parts = splitTop(group.children, ',');
    if (parts.length !== 2 || !parts.every((p) => p.length === 1 && (p[0].t === 'str' || p[0].t === 'tpl'))) return false;
    if (callee && PAIR_HELPERS.test(callee)) return true;
    const text = (tok) => (tok.t === 'str' ? tok.v : tok.quasis.join(PLACEHOLDER));
    const a = text(parts[0][0]); const b = text(parts[1][0]);
    return (looksSpanish(a) && looksEnglishProse(b)) || (looksEnglishProse(a) && looksSpanish(b));
  }

  // A call that also receives a catalog key ("a.b.c") carries its prose as a fallback: the key is the translation path.
  const CATALOG_KEY = /^[a-z][A-Za-z0-9_]*(\.[A-Za-z0-9_-]+)+$/;
  const hasCatalogKeyArg = (group) => splitTop(group.children, ',').some((p) => p.length === 1 && p[0].t === 'str' && CATALOG_KEY.test(p[0].v) && Object.hasOwn(catalogs, p[0].v));

  function isPairArray(group) {
    const parts = splitTop(group.children, ',');
    const literal = (p) => p.length === 1 && (p[0].t === 'str' || p[0].t === 'tpl');
    if (parts.length >= 2 && parts.length <= 4 && parts.every(literal)) {
      // ['en', 'es'] pairs and ['id', 'es', 'en'] tuples: one Spanish-looking and one other-language string.
      const texts = parts.map((p) => (p[0].t === 'str' ? p[0].v : p[0].quasis.join(PLACEHOLDER)));
      const spanish = texts.map(looksSpanish);
      // A 2-element array is a pair unless it is Spanish twice or its non-Spanish half is an id-like token (['chop', 'Talar el árbol']).
      if (parts.length === 2) return !spanish.every(Boolean) && !texts.some((x, k) => !spanish[k] && /^[a-z0-9_.:\/-]*$/.test(x.trim()));
      // 3-4 element tuples: at least two prose elements, exactly one of them Spanish (['cuerda', 'Cuerda', 'Rope']).
      const prose = texts.filter((x) => !/^[a-z0-9_.:\/-]*$/.test(x.trim()));
      return prose.length >= 2 && prose.filter(looksSpanish).length === 1;
    }
    // [cond ? 'en' : 'es', cond ? 'en' : 'es'] pairs of locale expressions.
    const hasLiteral = (p) => p.some((tok) => tok.t === 'str' || tok.t === 'tpl');
    return parts.length === 2 && parts.every(hasLiteral) && parts.every((p) => p.some((tok) => isPunct(tok, '?')));
  }

  function isObjectGroup(seq, i, parentOpen) {
    const prev = seq[i - 1];
    if (!prev) return parentOpen === '(' || parentOpen === '[' || parentOpen === '${' || parentOpen === ':';
    if (prev.t === 'punct') return ['=', ':', ',', '(', '[', '?', '||', '&&', '??', '...', '+', '||=', '??='].includes(prev.v);
    if (prev.t === 'id') return prev.v === 'return' || prev.v === 'default' || prev.v === 'yield';
    return false;
  }

  function tableLabel(seq, i) {
    const p = seq[i - 1]; const q = seq[i - 2];
    if ((isPunct(p, '=') || isPunct(p, ':')) && q && (q.t === 'id' || q.t === 'str')) return q.v;
    return '';
  }

  function checkParity(props, label, line) {
    const es = props.find((p) => p.key === 'es'); const en = props.find((p) => p.key === 'en');
    const single = (p) => p.value.length === 1 && p.value[0].t === 'group' && p.value[0].open === '{';
    if (!single(es) || !single(en)) return;
    const a = flattenKeys(es.value[0]); const b = flattenKeys(en.value[0]);
    if (!a || !b) return;
    const items = [];
    for (const k of [...a].sort()) if (!b.has(k)) items.push({ kind: 'parity', text: `${label || 'table'}: en lacks "${k}"` });
    for (const k of [...b].sort()) if (!a.has(k)) items.push({ kind: 'parity', text: `${label || 'table'}: es lacks "${k}"` });
    add(items, line, line);
  }

  function walkObject(group, ctx, label) {
    const props = objectProps(group);
    const keys = new Set(props.map((p) => p.key));
    if (keys.has('es') && keys.has('en')) { checkParity(props, label, group.line); return; }
    for (const p of props) {
      if (p.key === null) { walkSeq(p.entry, ctx, '{'); continue; }
      walkSeq(p.value, { ...ctx, callArg: false, sink: ctx.sink || SINK_OBJECT_KEYS.has(p.key) }, ':');
    }
  }

  function walkSeq(seq, ctx, parentOpen) {
    const n = seq.length;
    const exemptAt = new Array(n).fill(false); const sinkAt = new Array(n).fill(false);
    const stmtEnd = (from) => { let e = from; while (e < n && !isPunct(seq[e], ';')) e++; return e; };
    for (let q = 0; q < n; q++) {
      const tok = seq[q];
      if (isPunct(tok, '?')) {
        // Locale ternary: both branches are exempt when the condition mentions the locale.
        let s = q - 1;
        while (s >= 0 && !(seq[s].t === 'punct' && [',', ';', '=', '=>', '+=', ':', '?'].includes(seq[s].v)) && !isId(seq[s], 'return')) s--;
        const mentions = (function scan(nodes) {
          return nodes.some((nd) => (nd.t === 'id' && LOCALE_IDS.test(nd.v)) || (nd.t === 'str' && /^(en|es)$/i.test(nd.v)) || (nd.t === 'group' && scan(nd.children)));
        })(seq.slice(s + 1, q));
        if (!mentions) continue;
        let e = q + 1, colon = false;
        while (e < n && !isPunct(seq[e], ',') && !isPunct(seq[e], ';')) { if (isPunct(seq[e], ':')) colon = true; e++; }
        if (colon) for (let k = q + 1; k < e; k++) exemptAt[k] = true;
      }
      if ((isPunct(tok, '=') || isPunct(tok, '+=')) && q >= 2 && isId(seq[q - 1]) && SINK_PROPS.has(seq[q - 1].v) && (isPunct(seq[q - 2], '.') || isPunct(seq[q - 2], '?.'))) {
        const e = stmtEnd(q + 1);
        for (let k = q + 1; k < e; k++) sinkAt[k] = true;
      }
    }
    for (let i = 0; i < n; i++) {
      const tok = seq[i];
      const c = { exempt: ctx.exempt || exemptAt[i], sink: ctx.sink || sinkAt[i], callArg: ctx.callArg };
      if (c.exempt) continue;
      if (tok.t === 'str') {
        const prev = seq[i - 1]; const next = seq[i + 1];
        if (prev && prev.t === 'punct' && ['===', '!==', '==', '!='].includes(prev.v)) continue;
        if (next && next.t === 'punct' && ['===', '!==', '==', '!='].includes(next.v)) continue;
        if (prev && prev.t === 'id' && (prev.v === 'case' || prev.v === 'from' || prev.v === 'import' || prev.v === 'in')) continue;
        if (ctx.callArg && /^\p{Ll}+$/u.test(tok.v)) continue; // lowercase one-word argument of an unknown call: an id, not prose
        classifyToken(tok, c);
      } else if (tok.t === 'tpl') {
        classifyToken(tok, c);
        for (const expr of tok.exprs) walkSeq(expr, c, '${');
      } else if (tok.t === 'group') {
        const prev = seq[i - 1];
        if (tok.open === '(') {
          const callee = prev && prev.t === 'id' && !NO_CALLEE.has(prev.v) ? prev.v : null;
          const receiver = callee && isPunct(seq[i - 2], '.') && isId(seq[i - 3]) ? seq[i - 3].v : null;
          let cc = c;
          if (callee) {
            // Visible sinks always win: toast('Sin madera', 'warn') and setAttribute('title', 'Cerrar') are not pairs.
            if (!SINK_CALLS.has(callee) && callee !== 'setAttribute' && (isPairCall(callee, tok) || hasCatalogKeyArg(tok))) cc = { exempt: true, sink: false };
            else if (I18N_CALLS.has(callee) || NON_TEXT_CALLS.has(callee) || (receiver && LOG_RECEIVERS.has(receiver)) || LOG_RECEIVERS.has(callee) || ERROR_CTORS.has(callee) || /^[A-Z]\w*Error$/.test(callee)) cc = { exempt: true, sink: false };
            else if (SINK_CALLS.has(callee)) cc = { ...c, sink: true };
            else if (c.sink) cc = { ...c, callArg: true }; // arguments of an unknown call inside a visible expression: ids such as itemIcon('madera') are not text
            else if (callee === 'setAttribute') {
              const first = tok.children[0];
              const visible = first && first.t === 'str' && SINK_ATTRS.has(first.v);
              cc = visible ? { ...c, sink: true } : { exempt: true, sink: false };
              if (visible) { const args = splitTop(tok.children, ','); if (args[1]) walkSeq(args[1], cc, '('); continue; }
            }
          }
          if (!cc.exempt) walkSeq(tok.children, cc, '(');
        } else if (tok.open === '[') {
          const member = prev && (prev.t === 'str' || prev.t === 'group' || prev.t === 'tpl' || (prev.t === 'id' && !VALUE_KEYWORDS.has(prev.v)));
          if (member || isPairArray(tok)) continue;
          walkSeq(tok.children, c, '[');
        } else if (tok.open === '{') {
          if (isObjectGroup(seq, i, parentOpen)) walkObject(tok, c, tableLabel(seq, i));
          else walkSeq(tok.children, c, '{');
        }
      }
    }
  }

  walkSeq(tree, { exempt: false, sink: false }, null);
  return found;
}

// ---------------------------------------------------------------------------------------------
// Public scanning API
// ---------------------------------------------------------------------------------------------

/** Scan JavaScript source. Returns offenders { file, line, kind: 'es'|'en'|'parity', text }. */
export function scanJs(source, { file = '<snippet>', line = 1 } = {}) {
  const st = { src: source, i: 0, line, ok: new Set() };
  const tree = buildTree(lexTokens(st, false));
  return analyze(tree, st, file);
}

/** Scan an HTML document: static text nodes and attributes, plus inline <script> bodies. */
export function scanHtml(source, { file = '<snippet>' } = {}) {
  const found = [];
  const lines = source.split('\n');
  const okLines = new Set(); lines.forEach((l, k) => { if (OK_MARKER.test(l)) okLines.add(k + 1); });
  let markup = source;
  const scripts = [];
  markup = markup.replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, (all, body, offset) => {
    const startLine = source.slice(0, offset + all.indexOf(body)).split('\n').length;
    scripts.push({ body, startLine });
    return all.replace(body, body.replace(/[^\n]/g, ' '));
  });
  const lineAt = (index) => source.slice(0, index).split('\n').length;
  for (const node of htmlTexts(markup)) {
    const line = lineAt(node.index);
    if (okLines.has(line)) continue;
    const items = []; classifyPlain(node.text, true, items);
    for (const it of items) found.push({ file, line, ...it });
  }
  for (const s of scripts) found.push(...scanJs(s.body, { file, line: s.startLine }));
  return found;
}

export function scanSource(source, { file = '<snippet>', html = file.endsWith('.html') } = {}) {
  return html ? scanHtml(source, { file }) : scanJs(source, { file });
}

function listFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/\.(m?js)$/.test(ent.name)) files.push(full);
    }
  };
  for (const d of SCAN_DIRS) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
  for (const f of SCAN_FILES) if (fs.existsSync(path.join(root, f))) files.push(path.join(root, f));
  return files.map((f) => path.relative(root, f).split(path.sep).join('/')).sort();
}

/** Scan the whole tree. Returns { files, offenders }. */
export function scanTree(root = ROOT) {
  const files = listFiles(root);
  const offenders = [];
  for (const rel of files) {
    if (ALLOWED_FILES[rel]) continue;
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    offenders.push(...scanSource(source, { file: rel }));
  }
  return { files, offenders };
}

// ---------------------------------------------------------------------------------------------
// Baseline (ratchet): identity = file + kind + normalized text, with an occurrence count; no line numbers.
// ---------------------------------------------------------------------------------------------

const idOf = (o) => JSON.stringify([o.file, o.kind, o.text]);

export function countOffenders(offenders) {
  const counts = new Map();
  for (const o of offenders) counts.set(idOf(o), (counts.get(idOf(o)) || 0) + 1);
  return counts;
}

export function buildBaseline(offenders) {
  const entries = [...countOffenders(offenders)].map(([id, count]) => { const [file, kind, text] = JSON.parse(id); return { file, kind, text, count }; });
  entries.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  return {
    note: 'Known hardcoded single-language strings and es/en table mismatches. It may only shrink: fix an offender, then run `node tools/i18n/scan-hardcoded.mjs --write-baseline`. Never add entries by hand. Kinds: es (Spanish literal), en (English literal), parity (es/en copy table key mismatch). Exempt a line on purpose with an inline `// i18n-ok: <reason>` comment.',
    entries,
  };
}

export function serializeBaseline(baseline) {
  const rows = baseline.entries.map((e) => '    ' + JSON.stringify(e));
  const body = rows.length ? `\n${rows.join(',\n')}\n  ` : '';
  return `{\n  "note": ${JSON.stringify(baseline.note)},\n  "entries": [${body}]\n}\n`;
}

export function loadBaseline(file = BASELINE_PATH) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { entries: [] };
}

/** Compare offenders with a baseline: `added` are new (fail), `stale` are baseline entries that no longer occur (fail: shrink it). */
export function diffBaseline(offenders, baseline) {
  const current = countOffenders(offenders);
  const known = new Map(baseline.entries.map((e) => [idOf(e), e.count || 1]));
  const added = []; const stale = [];
  for (const [id, count] of current) {
    const have = known.get(id) || 0;
    if (count > have) { const [file, kind, text] = JSON.parse(id); added.push({ file, kind, text, count: count - have }); }
  }
  for (const [id, have] of known) {
    const count = current.get(id) || 0;
    if (count < have) { const [file, kind, text] = JSON.parse(id); stale.push({ file, kind, text, count: have - count }); }
  }
  return { added, stale };
}

export function summarize(offenders) {
  const perFile = new Map();
  for (const o of offenders) {
    const row = perFile.get(o.file) || { es: 0, en: 0, parity: 0 };
    row[o.kind]++; perFile.set(o.file, row);
  }
  return [...perFile].map(([file, row]) => ({ file, ...row, total: row.es + row.en + row.parity })).sort((a, b) => b.total - a.total || (a.file < b.file ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const { files, offenders } = scanTree();
  if (args.includes('--write-baseline')) {
    fs.writeFileSync(BASELINE_PATH, serializeBaseline(buildBaseline(offenders)));
    console.log(`baseline written: ${offenders.length} offenders (${countOffenders(offenders).size} unique) in ${path.relative(ROOT, BASELINE_PATH).split(path.sep).join('/')}`);
  } else if (args.includes('--json')) {
    console.log(JSON.stringify({ files: files.length, total: offenders.length, summary: summarize(offenders), offenders }, null, 2));
  } else {
    const summary = summarize(offenders);
    const kinds = { es: 0, en: 0, parity: 0 };
    for (const o of offenders) kinds[o.kind]++;
    console.log(`i18n hardcoded scan: ${files.length} files, ${offenders.length} offenders (es ${kinds.es}, en ${kinds.en}, parity ${kinds.parity})`);
    console.log('\nper file (es / en / parity):');
    for (const r of summary) console.log(`  ${String(r.total).padStart(4)}  ${r.file}  (${r.es} / ${r.en} / ${r.parity})`);
    console.log('\noffenders:');
    for (const o of offenders) console.log(`  ${o.file}:${o.line}  [${o.kind}]  ${o.text}`);
  }
}
