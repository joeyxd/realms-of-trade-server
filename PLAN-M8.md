# PLAN M8 — «Ladrillo y brea»: construcción

> Comprar un solar en un pueblo, levantar un edificio, y que trabaje para ti: un taller que convierte mercancías
> (caña → ron), un almacén, un puesto que vende solo, una casa. Se apoya en M7 (mercancías) y M6 (traerlas).

## 0. Qué hay ya

| Pieza | Dónde |
|---|---|
| Edificios (casa, puesto, almacén, destilería, horno, polvorín, fundición, astillero, taberna, fortín), coste en oro + mercancías, tiempo, mantenimiento, almacén | `src/data/buildings.js` |
| Recetas por lotes | `src/data/buildings.js` (`RECIPES`) |
| Solares por pueblo, `canBuild` / `startBuild` / `stock` / `take` / `stepPlot` (construir, producir, mantenimiento con deuda) | `src/sim/economy/plots.js` |
| Solares en la economía del mundo, mantenimiento cobrado al dueño conectado | `economy.js`, `trade.js` (`installTrade`) |
| Escrituras en el perfil (`p.eco.deeds`) | `trade.js` |

## 1. Decisiones (a confirmar)

- Cada pueblo tiene unos pocos solares (`TOWNS[t].plots`), **los mismos para todos**: si tu amigo compra el último
  de la Aldea, ya no hay. Precio: `PLOTS.price` (sube con los que ya hay vendidos).
- El dueño es `p.eco.id` (se crea al comprar el primero). Sin entrar en días (M5), el mantenimiento se acumula y
  la producción se para; tras N días de deuda, el solar vuelve a la venta.
- El polvorín no se permite bajo la Corona.

## 2. Pasos

- [ ] **P1 Solares en el mundo.** En la Aldea, `worldgen.js` marca 6 solares (parcelas con estacas y cartel «SE
  VENDE»); su render, procedural o `build:<tipo>` del manifiesto de assets. Comando `build` `{op: 'buyPlot',
  town, i}`. Test.
- [ ] **P2 Construir.** `{op: 'start', town, i, kind}` (paga con oro y la mochila / bodega), andamio mientras
  dura (`done`), edificio al terminar. Evento público `plot` para que todos lo vean crecer. Test.
- [ ] **P3 Producir.** Panel del edificio: receta, entradas, salidas, almacén, mantenimiento, deuda. `{op: 'stock'
  | 'take', town, i, g, n}`. El puesto vende su almacén al mercado del pueblo a precio de mercado (comisión).
- [ ] **P4 Casa y almacén.** La casa es un punto de reaparición y un baúl; el almacén, espacio para mercancía.
- [ ] **P5 Astillero y taberna.** El astillero vende cascos y módulos (M6); la taberna, tripulación y rumores (M7
  P5).
- [ ] **P6 Fortín** (más adelante): defensa del pueblo, ligado al PvP de la Cala.

## 3. Notas

- Todo pasa en el servidor y en el reloj del juego; el cliente solo pide y dibuja.
- M5 guarda los solares con la economía (`Economy.serialize()`).
