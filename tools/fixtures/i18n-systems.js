import { CommunityPanel } from '../../src/ui/community.js';
import { WorkbenchPanel } from '../../src/ui/workbench.js';
import { CommercePanel } from '../../src/ui/commerce.js';
import { createLanguagePicker, initI18n } from '../../src/core/i18n.js';

initI18n();
document.querySelector('#fixture-language').append(createLanguagePicker());

const profile = {
  gold: 250,
  tools: { axe: 0, pickaxe: 0 },
  eco: { tradeRev: 7, pack: { cap: 200, goods: { tronco: 12, madera: 5, piedra: 8 } } },
};
const player = { x: 0, y: 0, z: 0, dead: false };
const bench = { x: 0, y: 0, z: 0 };
const sent = [];
const recordCommand = (command) => {
  const copy = structuredClone(command);
  sent.push(Object.freeze(copy));
  return true;
};
const stage = document.querySelector('#fixture-stage');
const enabled = () => true;

const community = new CommunityPanel({
  parent: stage, profile: () => profile,
  context: () => ({ profile, player, bench }), enabled,
  submit: recordCommand,
});
const workbench = new WorkbenchPanel({
  parent: stage, profile: () => profile, player: () => player, bench: () => bench,
  enabled, blocked: () => false, submit: recordCommand,
});
const commerce = new CommercePanel({
  parent: stage, profile: () => profile, player: () => null, rafts: () => [], youServer: () => '',
  enabled, send: recordCommand,
});

function seedCommerceMarket() {
  commerce.town = 'aldea';
  commerce.clearResult();
  commerce.activate('market');
  commerce.market = {
    town: 'aldea', gold: profile.gold,
    pack: { cap: profile.eco.pack.cap, goods: { ...profile.eco.pack.goods } },
    used: 40,
  };
  commerce.rows = [{ g: 'tronco', stock: 24, buy: 4, sell: 2, trend: 0, illegal: false }];
  commerce.selected = 'tronco'; commerce.side = 'buy'; commerce.qty = 1;
  commerce.quote = { signature: JSON.stringify(['aldea', 'tronco', 1, 'buy']), total: 4, avg: 4, law: 'allowed' };
  commerce.render();
}

document.querySelector('#show-community').addEventListener('click', () => community.open());
document.querySelector('#show-workbench').addEventListener('click', () => workbench.open({ recipe: 'madera' }));
document.querySelector('#show-commerce').addEventListener('click', seedCommerceMarket);

window.systemsQA = { community, workbench, commerce, profile, player, bench, sent, seedCommerceMarket };
