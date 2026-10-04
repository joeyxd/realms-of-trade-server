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

### 1.1 Dirección acordada con el autor, 2026-10-04

- Casa terrestre y nave habitable son construcción central; compartir piezas/recetas/propiedad donde corresponda.
  El núcleo actual de solares/edificios no equivale todavía a un editor libre de vivienda.
- Talleres regionales, tiers de materiales y cadenas extensas; oficio/estación/entradas/salidas/tiempo explícitos.
  Producción a bordo tiene compromisos para conservar la utilidad de ciudades y talleres terrestres.
- Reservas locales de puerto/almacén; sacarlas no permite mover bienes invulnerables entre regiones.
- Consumo y pedidos de ciudades reciben entregas de jugadores/caravanas; milestones crean edificios/servicios
  visibles. Intercepciones cambian suministros/progreso, sin borrar hogares ajenos offline en la primera versión.
- Regiones con vela, motores/vapor, estética victoriana/steampunk y alta tecnología/robots. Ampliación posterior,
  con logística y roles propios; no exige implementar todas las eras ni barcos aéreos en este milestone.

Hoja de ruta y decisiones pendientes: `docs/NAVAL-ROADMAP.md` §§6–8. M5 debe cerrar propiedad/aportes y M7
las remesas antes de publicar desarrollo compartido persistente; el prototipo inicial puede usar memoria.

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
- [ ] **P7 Vivienda modular terrestre.** Reutilizar lenguaje/editor de piezas de M6 con cimientos y reglas
  terrestres; colisión, decoración y almacenamiento local. Resolver permisos y solares antes de liberar construcción.
- [ ] **P8 Primera obra compartida.** Pedido de cantidades concretas → entrega validada → andamios → edificio
  y servicio nuevos. Créditos únicos, progreso serializable, límites/ayuda NPC por población aún por diseñar.
- [ ] **P9 Talleres y caravanas.** Una cadena regional y una remesa escoltable/interceptable con M7; mostrar
  consecuencias en oferta/rumores/obra. No acreditar la misma carga como saqueada y entregada.

## 3. Notas

- Todo pasa en el servidor y en el reloj del juego; el cliente solo pide y dibuja.
- M5 guarda los solares con la economía (`Economy.serialize()`).
