// Shared, presentation-only descriptions for provision and cooking UI.
import { GOODS } from '../data/goods.js';
import { FOODS, SURVIVAL } from '../data/survival.js';
import { MEALS, MEAL_TICKS } from '../data/meals.js';
import { FIRE_SECONDS, fuelForKind } from '../data/fire.js';
import { RAFT_PARTS } from '../data/raftparts.js';
import { CRAFT_RECIPES } from '../data/resources.js';
import { DT } from '../data/tuning.js';
import { goodName } from './craftingCatalog.js';
import { atlasIcon, escHtml } from './kit.js';

const SCOPE = new Set(['pescado', 'fruta', 'harina', 'galleta', 'ron', 'agua', 'cana', 'especias',
  'coco', 'resina', 'tronco', 'madera']);
const languageOf = lang => lang === 'en' ? 'en' : 'es';
const number = (value, lang, digits = 0) => value.toLocaleString(lang === 'en' ? 'en-US' : 'es-MX', {
  maximumFractionDigits: digits, minimumFractionDigits: 0,
});
const percentDelta = multiplier => Math.round((multiplier - 1) * 100);
const durationText = (seconds, lang) => `${number(seconds / 60, lang, 1)} min`;

const COPY = {
  es: {
    nutrition: { sat: 'saciedad', hyd: 'hidrataci\u00f3n', cap: max => `Los medidores no superan ${max}.` },
    noNutrition: 'No restaura saciedad ni hidrataci\u00f3n.',
    dimensions: (volume, mass, base) => `Volumen ${volume} uV \u00b7 masa ${mass} uM (por unidad) \u00b7 valor base ${base} oro; el precio de mercado var\u00eda.`,
    items: {
      pescado: ['Pescado curado para guardar en la mochila.', 'C\u00f3melo para recuperar saciedad.'],
      fruta: ['Fruta de cultivo que aporta alimento y algo de agua.', 'C\u00f3mela para recuperar saciedad e hidrataci\u00f3n. Tambi\u00e9n sirve para plantar un huerto en la balsa.'],
      harina: ['Ingrediente seco para cocinar.', 'Se usa en recetas de cocina.'],
      galleta: ['Raci\u00f3n seca de larga traves\u00eda.', 'C\u00f3mela para recuperar saciedad; tambi\u00e9n se usa en recetas de cocina.'],
      ron: ['Bebida comerciable y producto del alambique.', 'Beberlo restaura algo de saciedad e hidrataci\u00f3n.'],
      agua: ['Agua dulce para beber y cocinar.', 'B\u00e9bela para recuperar hidrataci\u00f3n.'],
      cana: ['Cultivo de la balsa y materia prima del alambique.', 'El ca\u00f1averal produce ca\u00f1a en una balsa activa y requiere agua.'],
      especias: ['Bien de lujo que circula entre los puertos.', 'Se vende como mercanc\u00eda de lujo en los puertos que la demandan.'],
      coco: ['Fruto de palmera que tambi\u00e9n sirve como bebida.', 'Cons\u00famelo para recuperar hidrataci\u00f3n.'],
      resina: ['Resina obtenida al talar palmeras.', 'Se usa para fabricar una antorcha port\u00e1til.'],
      tronco: ['Madera recogida en la isla.', 'Se transforma en tablas y se usa para fabricar herramientas.'],
      madera: ['Tabla preparada para construir y mantener la balsa.', 'Se usa en piezas de balsa y como combustible de estaciones.'],
    },
    meal: {
      names: { roastFish: 'Pescado asado', grog: 'Grog', heartyBiscuit: 'Galleta reforzada' },
      descriptions: { roastFish: 'Una comida caliente de pescado.', grog: 'Una bebida preparada con ron y agua.', heartyBiscuit: 'Una raci\u00f3n compacta de galleta y harina.' },
      healthEffect: 'de vida m\u00e1xima', staminaEffect: 'de recuperaci\u00f3n de aguante',
      comfortEffect: 'unidades de carga c\u00f3moda; no cambia la masa m\u00e1xima',
      rules: ['Se prepara y consume al instante; gasta los ingredientes indicados.',
        'Todas las comidas restauran hasta {heal} de tu vida m\u00e1xima al prepararlas.',
        'El efecto dura {duration} de tiempo conectado; el contador se pausa sin conexi\u00f3n.',
        'Preparar otra comida reemplaza la activa. Al reaparecer, se pierde el efecto restante.'],
      heat: 'Pescado asado y galleta reforzada requieren una fogata o parrilla propia, cercana y encendida.',
    },
    guide: { summary: 'Provisiones: usos y valores', title: 'Usos y valores de provisiones' },
    fire: { hand: 'antorcha port\u00e1til', kinds: { campfire: 'fogata', grill: 'parrilla', lantern: 'farol', torchFloor: 'antorcha de piso', torchWall: 'antorcha de pared' },
      list: values => values.join(', ') },
  },
  en: {
    nutrition: { sat: 'satiety', hyd: 'hydration', cap: max => `Meters cannot exceed ${max}.` },
    noNutrition: 'Does not restore satiety or hydration.',
    dimensions: (volume, mass, base) => `Volume ${volume} vU \u00b7 mass ${mass} mU (per item) \u00b7 base value ${base} gold; market prices vary.`,
    items: {
      pescado: ['Cured fish that keeps in your backpack.', 'Eat it to restore satiety.'],
      fruta: ['Grown fruit that provides food and some water.', 'Eat it to restore satiety and hydration. It is also used to plant a raft crop plot.'],
      harina: ['A dry cooking ingredient.', 'Used in cooking recipes.'],
      galleta: ['A dry ration for a long voyage.', 'Eat it to restore satiety; it is also used in cooking recipes.'],
      ron: ['A trade drink and still product.', 'Drinking it restores some satiety and hydration.'],
      agua: ['Fresh water for drinking and cooking.', 'Drink it to restore hydration.'],
      cana: ['A raft crop and still ingredient.', 'The cane plot produces cane on an active raft and requires water.'],
      especias: ['A luxury good traded between ports.', 'Sell it as a luxury good at ports that demand it.'],
      coco: ['A palm fruit that can also be consumed as a drink.', 'Consume it to restore hydration.'],
      resina: ['Resin gathered while felling palms.', 'Used to craft a hand torch.'],
      tronco: ['Wood gathered on the island.', 'Turn it into planks or use it to craft tools.'],
      madera: ['A prepared plank for building and maintaining a raft.', 'Used in raft parts and as station fuel.'],
    },
    meal: {
      names: { roastFish: 'Roast fish', grog: 'Grog', heartyBiscuit: 'Reinforced biscuit' },
      descriptions: { roastFish: 'A hot meal made from fish.', grog: 'A drink prepared from rum and water.', heartyBiscuit: 'A compact ration made from a biscuit and flour.' },
      healthEffect: 'maximum health', staminaEffect: 'stamina recovery',
      comfortEffect: 'units of comfortable load; maximum mass is unchanged',
      rules: ['Prepared and consumed immediately; the listed ingredients are spent.',
        'Every meal restores up to {heal} of your maximum health when prepared.',
        'The effect lasts {duration} of connected time; its timer pauses while offline.',
        'Preparing another meal replaces the active one. Respawning removes the remaining effect.'],
      heat: 'Roast fish and reinforced biscuit require your own nearby, lit campfire or grill.',
    },
    guide: { summary: 'Provisions: uses and values', title: 'Provisions uses and values' },
    fire: { hand: 'hand torch', kinds: { campfire: 'campfire', grill: 'grill', lantern: 'lantern', torchFloor: 'floor torch', torchWall: 'wall torch' },
      list: values => values.join(', ') },
  },
};

export function nutritionText({ sat = 0, hyd = 0 } = {}, language = 'es') {
  const lang = languageOf(language), c = COPY[lang].nutrition;
  const gains = [];
  if (Number.isFinite(sat) && sat > 0) gains.push(`+${number(sat, lang)} ${c.sat}`);
  if (Number.isFinite(hyd) && hyd > 0) gains.push(`+${number(hyd, lang)} ${c.hyd}`);
  if (!gains.length) return COPY[lang].noNutrition;
  return gains.join(' \u00b7 ');
}

const fireUse = (id, lang) => {
  const c = COPY[lang].fire, fuel = fuelForKind('handTorch'), stationKinds = Object.keys(FIRE_SECONDS)
    .filter(kind => kind !== 'handTorch' && fuelForKind(kind)?.[id]);
  const phrases = [];
  if (fuel?.[id]) {
    const recipe = Object.entries(fuel).map(([good, count]) => `${count} × ${goodName(good, lang)}`).join(' + ');
    phrases.push(`${recipe}: ${c.hand} (${durationText(FIRE_SECONDS.handTorch, lang)} ${lang === 'en' ? 'of active game time' : 'de tiempo activo de juego'}).`);
  }
  if (stationKinds.length) {
    const units = stationKinds.map(kind => `${c.kinds[kind] || kind} (${durationText(FIRE_SECONDS[kind], lang)})`);
    const count = fuelForKind(stationKinds[0])[id];
    phrases.push(`${count} \u00d7 ${goodName(id, lang)} ${lang === 'en' ? 'fuels' : 'alimenta'} ${c.list(units)} ${lang === 'en' ? 'of active game time per unit.' : 'de tiempo activo de juego por unidad.'}`);
  }
  return phrases;
};

export function goodInfo(id, language = 'es') {
  if (!SCOPE.has(id) || !GOODS[id]) return null;
  const lang = languageOf(language), copy = COPY[lang], good = GOODS[id], food = FOODS[id];
  const mealUses = Object.entries(MEALS).flatMap(([kind, recipe]) => recipe.cost[id]
    ? [`${recipe.cost[id]} \u00d7 ${goodName(id, lang)} ${lang === 'en' ? 'for' : 'para'} ${copy.meal.names[kind]}.`]
    : []);
  const still = RAFT_PARTS.still?.recipe;
  const stillUse = still?.in?.[id]
    ? [`${still.in[id]} \u00d7 ${goodName(id, lang)} ${lang === 'en' ? 'makes' : 'produce'} ${still.out.ron} \u00d7 ${goodName('ron', lang)} ${lang === 'en' ? 'in the raft still (up to' : 'en el alambique de la balsa (hasta'} ${still.perDay} ${lang === 'en' ? 'batches per day).' : 'tandas al d\u00eda).'}`]
    : [];
  const plank = CRAFT_RECIPES.madera;
  const plankRecipe = plank.inputs[id]
    ? [`${plank.inputs[id]} \u00d7 ${goodName(id, lang)} ${lang === 'en' ? 'make' : 'producen'} ${plank.count} \u00d7 ${goodName(plank.output, lang)}.`]
    : [];
  const canePlot = RAFT_PARTS.canePlot;
  const caneUse = id === 'cana' && canePlot
    ? [`${number(canePlot.makes.cana, lang)} ${lang === 'en' ? 'cane per day; uses' : 'cañas al día; consume'} ${number(canePlot.needs.agua, lang)} × ${goodName('agua', lang)} ${lang === 'en' ? 'per day.' : 'al día.'}`]
    : [];
  const healUse = food?.sat > 0
    ? [`${lang === 'en' ? 'Consuming it also restores' : 'Al consumirlo también restaura'} ${number(SURVIVAL.foodHeal * 100, lang)}% ${lang === 'en' ? 'maximum health.' : 'de vida máxima.'}`]
    : [];
  const uses = [copy.items[id][1], ...healUse, ...mealUses, ...stillUse, ...plankRecipe, ...caneUse, ...fireUse(id, lang)];
  return {
    name: goodName(id, lang),
    description: copy.items[id][0],
    use: uses.join(' '),
    dimensions: copy.dimensions(number(good.volume, lang, 2), number(good.mass, lang, 2), number(good.base, lang)),
    nutrition: food ? nutritionText(food, lang) : null,
  };
}

export function mealInfo(kind, language = 'es') {
  if (!Object.hasOwn(MEALS, kind)) return null;
  const lang = languageOf(language), c = COPY[lang].meal, recipe = MEALS[kind];
  const duration = durationText(MEAL_TICKS * DT, lang);
  let effect;
  if (recipe.hp > 1) {
    const bonus = percentDelta(recipe.hp);
    effect = `${bonus > 0 ? '+' : ''}${number(bonus, lang)}${lang === 'es' ? ' %' : '%'} ${c.healthEffect}`;
  } else if (recipe.regen > 1) {
    const bonus = percentDelta(recipe.regen);
    effect = `${bonus > 0 ? '+' : ''}${number(bonus, lang)}${lang === 'es' ? ' %' : '%'} ${c.staminaEffect}`;
  } else {
    effect = `${recipe.comfort > 0 ? '+' : ''}${number(recipe.comfort, lang)} ${c.comfortEffect}`;
  }
  const rules = c.rules.map(line => line.replace('{duration}', duration)
    .replace('{heal}', `${number(SURVIVAL.foodHeal * 100, lang)}${lang === 'es' ? ' %' : '%'}`));
  rules.push(COPY[lang].nutrition.cap(SURVIVAL.max));
  return { description: c.descriptions[kind], nutrition: nutritionText(recipe, lang), effect, duration, rules: rules.join(' ') };
}

export function provisionsGuideHtml(ids, language = 'es') {
  const lang = languageOf(language), c = COPY[lang].guide;
  const entries = [...new Set(Array.isArray(ids) ? ids : [])]
    .map(id => ({ id, info: goodInfo(id, lang) })).filter(row => row.info);
  if (!entries.length) return '';
  const rows = entries.map(({ id, info }) => {
    const nutrition = info.nutrition ? `<p>${escHtml(info.nutrition)}</p>` : '';
    return `<li><article>${atlasIcon(id, 'provision-guide__icon')}<div><h4>${escHtml(info.name)}</h4><p>${escHtml(info.description)}</p><p>${escHtml(info.use)}</p><p>${escHtml(info.dimensions)}</p>${nutrition}</div></article></li>`;
  }).join('');
  return `<details class="provision-guide"><summary>${escHtml(c.summary)}</summary><section aria-label="${escHtml(c.title)}"><ul>${rows}</ul></section></details>`;
}
