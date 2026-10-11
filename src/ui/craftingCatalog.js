// Crafting panel presentation: ES/EN text by stable key, recipe categories/descriptions and line icons.
// Gameplay (inputs, outputs, bench rules) stays in data/resources.js; this file only decides how it reads.
import { CRAFT_RECIPES, RESOURCE_KINDS, HARVEST } from '../data/resources.js';
import { FIRE_FUEL, FIRE_SECONDS } from '../data/fire.js';
import { GOODS } from '../data/goods.js';
import { DT } from '../data/tuning.js';
import { formatNumber } from '../core/i18n.js';
import { LINE_ICONS, UI_LANGS, atlasIcon, uiLang } from './kit.js';

export const CRAFT_LANGS = UI_LANGS;
export const craftLang = uiLang;

export const CRAFT_TEXT = {
  es: {
    title: 'Fabricación', subtitle: 'Convierte recursos en un mañana mejor', dialog: 'Menú de fabricación',
    tabs: { tools: 'Herramientas', weapons: 'Armas', building: 'Construcción', survival: 'Supervivencia', food: 'Comida' },
    recipes: 'Recetas', inventory: 'Inventario', required: 'Materiales necesarios', craftsInto: 'Se convierte en',
    stats: 'Estadísticas (base)', craft: 'Fabricar objeto', craftLight: 'Fabricar y encender', prepare: 'Preparar', waiting: 'Fabricando…',
    close: 'Cerrar', closeLabel: 'Cerrar fabricación', map: 'Mapa', quantity: 'Cantidad', max: 'Máx.',
    qtyLabel: 'Cantidad a preparar', perBatch: 'máx. {n} por tanda', locked: 'Por descubrir',
    emptyTab: 'Aún no conoces recetas de esta categoría.', emptyHint: 'Explora la isla y habla con su gente para aprender nuevas recetas.',
    hand: 'A mano · sin banco', benchNear: 'Banco de materiales · cerca', benchFar: 'Requiere el banco de materiales',
    belt: 'Cinturón', beltOwned: 'En tu cinturón', beltMissing: 'Sin fabricar', torchOn: 'Antorcha · {time}', volume: 'Volumen de mochila', weight: 'Peso',
    quote: '«Cosas simples.\nLugares extraordinarios.»', retry: 'Reintentar', inventoryClose: 'Cerrar inventario',
    unit: (n) => n === 1 ? 'unidad' : 'unidades', tool: 'herramienta',
    feedback: {
      ready: 'Todo listo para fabricar.', far: 'Acércate al banco de materiales para esta receta.',
      owned: 'Ya llevas esta herramienta en el cinturón.', pack: 'La mochila no está disponible.',
      qty: 'Elige una cantidad entre 1 y {max}.', materials: 'Te faltan materiales para esta receta.',
      space: 'La mochila no tiene espacio para el resultado.', mass: 'El resultado superaría el peso que puedes cargar.',
      pending: 'Esperando confirmación…',
      received: 'Recibido; actualizando tu mochila…', sendFailed: 'No se pudo enviar. Inténtalo otra vez.',
      madeTool: '{name} fabricada. Ya está en tu cinturón.', madeGood: 'Preparaste {n} {name}.',
      torchLit: 'Antorcha encendida: {min} min de luz. Pulsa N para apagarla o volver a encenderla.',
      torchBurning: 'Tu antorcha aún arde ({time}). Cuando se consuma podrás fabricar otra.',
      torchPlank: 'Te falta 1 tabla básica. Prepárala en el banco de materiales con 2 troncos.',
      torchOff: 'El fuego todavía no está disponible en este mundo.',
      torchAccount: 'Entra con una cuenta para guardar tu antorcha.',
      unknown: 'No se pudo completar la receta. Revisa tu mochila e inténtalo otra vez.',
    },
  },
  en: {
    title: 'Crafting', subtitle: 'Turn resources into a brighter tomorrow', dialog: 'Crafting menu',
    tabs: { tools: 'Tools', weapons: 'Weapons', building: 'Building', survival: 'Survival', food: 'Food' },
    recipes: 'Recipes', inventory: 'Inventory', required: 'Required materials', craftsInto: 'Crafts into',
    stats: 'Stats (base)', craft: 'Craft item', craftLight: 'Craft & light', prepare: 'Prepare', waiting: 'Crafting…',
    close: 'Close', closeLabel: 'Close crafting', map: 'Map', quantity: 'Quantity', max: 'Max',
    qtyLabel: 'Quantity to prepare', perBatch: 'max {n} per batch', locked: 'Undiscovered',
    emptyTab: 'You do not know any recipes in this category yet.', emptyHint: 'Explore the island and talk to its people to learn new recipes.',
    hand: 'By hand · no bench', benchNear: 'Materials bench · nearby', benchFar: 'Requires the materials bench',
    belt: 'Belt', beltOwned: 'On your belt', beltMissing: 'Not crafted', torchOn: 'Torch · {time}', volume: 'Backpack volume', weight: 'Weight',
    quote: '“Simple things.\nExtraordinary places.”', retry: 'Retry', inventoryClose: 'Close inventory',
    unit: (n) => n === 1 ? 'unit' : 'units', tool: 'tool',
    feedback: {
      ready: 'Ready to craft.', far: 'Get closer to the materials bench for this recipe.',
      owned: 'This tool is already on your belt.', pack: 'Your backpack is unavailable.',
      qty: 'Choose a quantity between 1 and {max}.', materials: 'You are missing materials for this recipe.',
      space: 'Your backpack has no room for the result.', mass: 'The result would exceed the weight you can carry.',
      pending: 'Waiting for confirmation…',
      received: 'Received; updating your backpack…', sendFailed: 'Could not send. Try again.',
      madeTool: '{name} crafted. It is now on your belt.', madeGood: 'You prepared {n} {name}.',
      torchLit: 'Torch lit: {min} min of light. Press N to put it out or light it again.',
      torchBurning: 'Your torch is still burning ({time}). Craft another once it burns out.',
      torchPlank: 'You need 1 basic plank. Prepare it at the materials bench from 2 logs.',
      torchOff: 'Fire is not available in this world yet.',
      torchAccount: 'Sign in to keep your torch.',
      unknown: 'The recipe could not be completed. Check your backpack and try again.',
    },
  },
};

// Server rejection codes → localized text (codes stay stable; see resources.js deny()).
export const CRAFT_REASONS = {
  es: {
    schema: 'La solicitud no es válida. Ajusta la cantidad e inténtalo otra vez.', n: 'Elige una cantidad válida para preparar.',
    command: 'La solicitud no es válida. Revisa la receta e inténtalo otra vez.',
    account_required: 'Entra con una cuenta para fabricar en este servidor.',
    storage: 'No se pudo confirmar el guardado. Vuelve a entrar para consultar tu progreso.',
    materials: 'No llevas suficientes materiales para esa receta.', full: 'La mochila no tiene espacio para el resultado.',
    room: 'La mochila no tiene espacio para el resultado.', far: 'Acércate al banco para preparar materiales.',
    bench: 'El banco no está disponible en esta partida.', dead: 'No puedes fabricar mientras estás derrotado.',
    busy: 'Detente y termina tu acción antes de fabricar.', combat: 'Espera tres segundos en calma antes de fabricar.',
    cooldown: 'Espera un momento antes de fabricar otra vez.', calm: 'Espera tres segundos en calma antes de fabricar.',
    land: 'Pisa tierra firme para fabricar.', aboard: 'Desembarca para fabricar.', navigation: 'Vuelve a atracar antes de fabricar.',
    revision: 'La mochila cambió. Revisa los materiales e inténtalo otra vez.', revisionLimit: 'La revisión llegó a su límite; vuelve a entrar.',
    saveSize: 'La partida supera el límite de guardado.', duplicate: 'La solicitud ya corresponde a otra acción.',
    opIdReuse: 'La solicitud ya corresponde a otra acción.', receiptLimit: 'No se pudo registrar la solicitud; vuelve a entrar.',
    pack: 'La mochila no está disponible.', alreadyOwned: 'Ya llevas esa herramienta en el cinturón.',
  },
  en: {
    schema: 'The request is not valid. Adjust the quantity and try again.', n: 'Choose a valid quantity to prepare.',
    command: 'The request is not valid. Check the recipe and try again.',
    account_required: 'Sign in to craft on this server.',
    storage: 'The save could not be confirmed. Rejoin to check your progress.',
    materials: 'You do not carry enough materials for that recipe.', full: 'Your backpack has no room for the result.',
    room: 'Your backpack has no room for the result.', far: 'Get closer to the bench to prepare materials.',
    bench: 'The bench is not available in this session.', dead: 'You cannot craft while defeated.',
    busy: 'Stop and finish your action before crafting.', combat: 'Stay calm for three seconds before crafting.',
    cooldown: 'Wait a moment before crafting again.', calm: 'Stay calm for three seconds before crafting.',
    land: 'Stand on solid ground to craft.', aboard: 'Disembark to craft.', navigation: 'Dock again before crafting.',
    revision: 'Your backpack changed. Check the materials and try again.', revisionLimit: 'The revision limit was reached; rejoin.',
    saveSize: 'The save exceeds its size limit.', duplicate: 'That request already belongs to another action.',
    opIdReuse: 'That request already belongs to another action.', receiptLimit: 'The request could not be recorded; rejoin.',
    pack: 'Your backpack is unavailable.', alreadyOwned: 'That tool is already on your belt.',
  },
};

// English display names for goods; Spanish uses the catalog name in data/goods.js.
const GOOD_EN = {
  pescado: 'Salted fish', fruta: 'Tropical fruit', harina: 'Flour', galleta: 'Ship biscuit', ron: 'Rum', agua: 'Fresh water',
  cana: 'Sugarcane', madera: 'Basic plank', tronco: 'Log', piedra: 'Rough stone', hierro: 'Iron', mineral_hierro: 'Iron ore',
  azufre: 'Sulfur', lona: 'Canvas', polvora: 'Gunpowder', balas: 'Cannonballs', tabaco: 'Tobacco', especias: 'Spices',
  seda: 'Silk', coral: 'Red coral', perlas: 'White pearls',
};
// Short Spanish labels where the catalog name is too long for a material card.
const GOOD_ES_SHORT = { tronco: 'Tronco', madera: 'Tabla básica' };
export const goodName = (good, lang = craftLang()) => (lang === 'en' ? GOOD_EN[good] : GOOD_ES_SHORT[good]) || GOODS[good]?.name || good;

export const CRAFT_CATEGORIES = ['tools', 'weapons', 'building', 'survival', 'food'];
const seconds = (ticks) => `${formatNumber(ticks * DT, { maximumFractionDigits: 1 })} s`;
const palm = RESOURCE_KINDS.palm, rock = RESOURCE_KINDS.rock, ore = RESOURCE_KINDS.iron_ore;

// Category, copy and real base numbers for each implemented recipe. Stats read the live tuning tables.
export const RECIPE_UI = {
  hacha_piedra: {
    cat: 'tools', order: 1,
    es: { name: 'Hacha de piedra', desc: 'Una herramienta básica para talar madera y sobrevivir.',
      flavor: 'Tosca en los bordes, pero cumple.\nTodo viaje empieza con herramientas sencillas.', motto: 'Tala. Construye. Sobrevive.' },
    en: { name: 'Stone Axe', desc: 'A basic tool for chopping wood and survival.',
      flavor: 'Rough around the edges, but it gets the job done.\nEvery journey starts with simpler tools.', motto: 'Chop wood. Build shelter. Survive.' },
    stats: () => [
      // Timed logging (PRG01d) pays 3–6 logs by aim; the untimed rule pays palm.yield.
      { icon: 'logs', es: 'Troncos por palmera', en: 'Logs per palm', value: 6, max: 6, text: `${palm.yield}–6` },
      { icon: 'hit', es: 'Golpes por palmera', en: 'Hits per palm', value: palm.hits, max: 6, text: `${palm.hits}` },
      { icon: 'clock', es: 'Ritmo de tala', en: 'Chop pace', value: palm.actionTicks, max: 120, text: seconds(palm.actionTicks) },
    ],
  },
  pico_piedra: {
    cat: 'tools', order: 2,
    es: { name: 'Pico de piedra', desc: 'Parte rocas grandes y abre vetas de hierro.',
      flavor: 'Una piedra afilada atada con fuerza.\nLa isla guarda más de lo que muestra.', motto: 'Pica. Reúne. Prospera.' },
    en: { name: 'Stone Pickaxe', desc: 'Breaks large rocks and opens iron veins.',
      flavor: 'A sharpened stone, lashed tight.\nThe island keeps more than it shows.', motto: 'Mine stone. Gather. Thrive.' },
    stats: () => [
      { icon: 'stone', es: 'Piedra por roca', en: 'Stone per rock', value: rock.yield, max: 4, text: `${rock.yield}` },
      { icon: 'hit', es: 'Golpes por roca', en: 'Hits per rock', value: rock.hits, max: 6, text: `${rock.hits}` },
      { icon: 'ore', es: 'Golpes por veta', en: 'Hits per iron vein', value: ore.hits, max: 6, text: `${ore.hits}` },
    ],
  },
  // The hand torch is a fire load (data/fire.js), not a resource craft: one plank, 20 minutes of light, by hand.
  antorcha: {
    cat: 'tools', order: 3,
    es: { name: 'Antorcha', desc: 'Una tabla untada de brea que arde y alumbra a tu alrededor.',
      flavor: 'La noche en la isla es oscura de verdad.\nLleva el fuego contigo.', motto: 'Enciende. Explora. Regresa.' },
    en: { name: 'Torch', desc: 'A tar-coated plank that burns and lights up your surroundings.',
      flavor: 'Night on the island is truly dark.\nCarry the fire with you.', motto: 'Light up. Explore. Come back.' },
    stats: () => [
      { icon: 'clock', es: 'Minutos de luz', en: 'Minutes of light', value: FIRE_SECONDS.handTorch / 60, max: 60, text: `${FIRE_SECONDS.handTorch / 60} min` },
      { icon: 'stack', es: 'Tablas por carga', en: 'Planks per load', value: FIRE_FUEL.count, max: 4, text: `${FIRE_FUEL.count}` },
      { icon: 'logs', es: 'Troncos por tabla', en: 'Logs per plank', value: CRAFT_RECIPES.madera.inputs.tronco, max: 4, text: `${CRAFT_RECIPES.madera.inputs.tronco}` },
    ],
  },
  madera: {
    cat: 'building', order: 1,
    es: { name: 'Tabla básica', desc: 'Dos troncos limpios y cortados en una tabla, lista para construir.',
      flavor: 'Llévala a tu balsa para construir o reparar.', motto: 'Corta. Apila. Zarpa.' },
    en: { name: 'Basic plank', desc: 'Two clean logs cut into one plank, ready for building.',
      flavor: 'Take it to your raft to build or repair.', motto: 'Cut. Stack. Set sail.' },
    stats: () => [
      { icon: 'box', es: 'Volumen por unidad', en: 'Volume per unit', value: GOODS.madera.volume, max: 4, text: `${GOODS.madera.volume}` },
      { icon: 'coin', es: 'Valor base', en: 'Base value', value: GOODS.madera.base, max: 20, text: `${GOODS.madera.base}` },
      { icon: 'stack', es: 'Máximo por tanda', en: 'Max per batch', value: CRAFT_RECIPES.madera.max, max: HARVEST.craftMax, text: `${CRAFT_RECIPES.madera.max}` },
    ],
  },
};
// Rows a category always shows; undiscovered recipes fill the rest as locked entries.
export const RECIPE_ROWS = 9;

const svg = (body, view = '0 0 24 24') => `<svg viewBox="${view}" aria-hidden="true" focusable="false">${body}</svg>`;
// Line icons in currentColor (tabs, headers, stats); filled art for the brand mark. Shared with the UI kit.
export const CRAFT_ICONS = LINE_ICONS;

// Recipes the author named for later (the crafting reference): listed as undiscovered, with no materials or numbers
// until their rules exist. Painted icons come from the kit's misc atlas.
export const UPCOMING_RECIPES = {
  tools: [['arpon', 'Arpón de pesca', 'Fishing Spear'], ['cuerda', 'Cuerda', 'Rope']],
  weapons: [['lanza', 'Lanza tosca', 'Crude Spear'], ['arco', 'Arco de madera', 'Wooden Bow'], ['flechas', 'Flechas (×5)', 'Arrows (×5)']],
  survival: [['fogata', 'Fogata', 'Campfire']],
};

export const HERO_ART = new Set(['hacha_piedra', 'pico_piedra', 'madera']);
/** Markup for one item icon: the painted kit atlas cell when it exists, otherwise the drawn glyph. */
export function itemIcon(id, cls = 'cr-item') {
  return atlasIcon(id, cls) || `<span class="${cls} is-glyph" aria-hidden="true">${itemGlyph(id)}</span>`;
}
const ITEM_GLYPH = {
  hacha_piedra: svg('<path fill="#9a6232" d="m6.4 22.3-1.7-1 9.6-15.6 1.7 1z"/><path fill="#c7ccd2" d="M13.4 2.2c3.3.3 6.6 2.4 8 5.8l-3.2 2.4-6.6-4.2z"/><path fill="#8e979f" d="m11.6 6.2 6.6 4.2-1.4 2.2c-2.2-.3-4.6-1.8-6.4-4.4z"/><path fill="none" stroke="#e1b56b" stroke-width="1.1" d="m13 6.1 3.4 2.2m-4 .2 2.8 1.8"/>'),
  pico_piedra: svg('<path fill="#9a6232" d="m6.2 22.4-1.8-1.1 8.7-13.8 1.8 1.1z"/><path fill="#b9c0c7" d="M2.6 6.6C7 3 13.7 2 19.5 4.1c1.8.6 2.4 2.1 1.9 3.6C18.8 5.8 14.6 5.4 11 6.3 8.1 7 5.4 8.2 2.6 6.6z"/>'),
  madera: svg('<path fill="#b67a3c" d="M2.5 7.2h17l2 2.6-2 2.6h-17z"/><path fill="#d39a55" d="M2.5 13.6h17l2 2.6-2 2.6h-17z"/><path fill="none" stroke="#6e4220" stroke-width=".9" d="M5 9.8h11m-9 6.4h12"/>'),
  tronco: svg('<path fill="#8d5a2c" d="M4.2 9.4 16.6 4c1.8-.8 3.8.2 4.5 2s-.2 3.9-2 4.6L6.8 16z"/><ellipse cx="5.6" cy="12.7" rx="2.7" ry="3.6" transform="rotate(-23 5.6 12.7)" fill="#e2b27a"/><path fill="none" stroke="#a5713b" stroke-width=".8" d="M4.8 12.2a1 1.4-23 1 0 1.4.9"/>'),
  piedra: CRAFT_ICONS.stone.replace('currentColor', '#aab3bc'),
};
export const itemGlyph = (id) => ITEM_GLYPH[id] || svg('<path fill="#8fa3b6" d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path fill="#0d1b2b" opacity=".35" d="m12 12 8-4.5v9L12 21z"/>');
