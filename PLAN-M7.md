# PLAN M7 — «Mercaderes»: comercio entre pueblos

> El corazón de la estructura (DESIGN, «El chiste del juego»). El **motor ya existe y está probado**
> (`tests/economy.test.mjs`). Lo que falta es lo que se ve y se juega: la UI del mercado, los mercaderes, la mochila
> y la bodega, y el contenido.

## 0. Qué hay ya en el código

| Pieza | Dónde | Estado |
|---|---|---|
| Mercancías, leyes, impuestos, contrabando | `src/data/goods.js` | ✅ 17 mercancías, 4 leyes |
| Pueblos, islas, rutas | `src/data/towns.js` | ✅ 6 pueblos (Aldea y Cala caminables), 9 rutas |
| Mercado: precio por escasez, deslizamiento, margen, impuesto, equilibrio por pueblo, recuperación | `src/sim/economy/market.js` | ✅ |
| Bodegas por peso, pudrición | `src/sim/economy/cargo.js` | ✅ |
| Reloj y economía del mundo (serializable) | `src/sim/economy/economy.js` | ✅ 1 día = 960 s |
| Comando `market` (`list` / `buy` / `sell`) y eventos `market` / `traded` / `tradeDenied` | `src/sim/systems/trade.js`, `localServer.js` | ✅ |
| Mochila en el perfil (`p.eco.pack`, 10 de espacio) | `inventory.js` (`newProfile` / `sanitizeProfile`) | ✅ |

La regla que hace divertido el comercio: cada pueblo **asienta** su stock donde produce o consume
(`equilibrium()`). Lo que un pueblo fabrica está barato allí y caro donde se come (pescado: Aldea ~3 → Puerto
Sol ~12). Tus compras y ventas mueven el precio sobre la marcha y el mercado vuelve a su sitio en unos días
(`MARKET.relax`).

## 1. Decisiones (del autor, a confirmar al empezar)

- Se comercia **en el pueblo donde estás**: a pie, en la Aldea y la Cala. En los demás puertos, al llegar en barco
  (M6; hasta entonces, un viaje con tiempo, ver `PLAN-M6.md`).
- Precios **compartidos** por todos los jugadores del servidor: si tu amigo vacía el ron de la Cala, tú lo pagas
  más caro.
- El oro y la mochila son tuyos; si mueres, la mochila **se cae** como el botín de la Cala (piénsalo: ¿solo en zonas
  sin ley?).
- Contrabando: la Corona lo confisca (en sus aguas y en su puerto); la Cala lo paga × 1.5.

### 1.1 Dirección acordada con el autor, 2026-10-04

- Comercio/crafting regionales extensos: recursos por tier/región, harvesting terrestre con combate y cadenas
  de refinado/componentes/productos. Ampliar desde unas pocas cadenas completas; catálogo grande después.
- Especialidades de comercio abren mercancías/contratos, cantidades o mejores condiciones. Bonus limitados,
  stock real y precios del servidor; evitar aprendizaje/descuentos explotables mediante comprar y revender.
- Rutas protegidas frente a PvP con ganancia modesta o mayor distancia/bienes raros; PvE vencible y peligros
  con aviso/respuesta. Atajos disputados por NPC/jugadores, sin obligar PvP para progresar en vivienda.
- Rendición por carga, notoriedad y patrullas; precios/acceso a ciudades dependen de hechos/facción. Bandera
  voluntaria y marca criminal son capas distintas. Bounty y treguas necesitan reglas concretas antes de pago.
- Reservas depositadas en puerto seguras localmente; retirar/transportar expone mercancías, incluso en casa-nave.
- Ciudades demandan/consumen bienes; entregas/caravanas escoltadas y asaltables alimentan obras visibles (M8).

Diseño y alternativas: `docs/NAVAL-ROADMAP.md` §§5–8. Las reglas de mochila/equipo personal al morir, curvas,
legalidad por zona y pérdidas finales siguen por decidir. La UI inicial P1–P6 no entrega toda esta ampliación.

## 2. Pasos

- [ ] **P1 Mercaderes en el mundo.** Un NPC mercader por pueblo caminable (`worldgen.js`: `npcs`, como la
  Vendedora). En la Aldea, «Don Bacalao» junto a los puestos; en la Cala, «La Tuerta». Hablarle abre el mercado
  (`dialog.js` → botón «Comerciar» → `{type:'market', op:'list', town}`). Test: `talk` + `market list` desde
  `TOWNS[t].r`.
- [ ] **P2 Panel del mercado** (`src/ui/market.js`, estilo de `charpanel.js` / `vendor`). Una fila por
  mercancía: icono, nombre, stock, precio de compra y venta, flecha de tendencia (`trend`), insignia de
  contrabando. Selector de cantidad (1 / 5 / 10 / máx) con el **total cotizado** antes de confirmar (pedir `quote`:
  añadir `op: 'quote'` al comando, que devuelve `{type:'quote', total, avg}`). Muestra la mochila (`pack`, `used` /
  `cap`) y el oro. Responde a `traded` (monedas por Bézier al HUD, como el botín) y a `tradeDenied` (texto en
  español por `why`: «No te alcanza», «No cabe en la mochila», «Aquí no se vende eso», «La Corona lo prohíbe»,
  «Acércate al mercado», «No en plena pelea»).
- [ ] **P3 Iconos de mercancías.** Procedurales (canvas, como los de objetos en `itemui.js`), o `tex:good-<id>` en
  el manifiesto de assets si el autor los trae.
- [ ] **P4 La mochila en el HUD y la muerte.** Contador pequeño junto al oro. Morir en la Cala tira la mochila al
  suelo (`spillPlayer` en `inventory.js` ya lo hace con el botín: añadir la mochila como `kind: 'goods'`).
- [ ] **P5 Rumores.** La taberna (M8) o el mercader cuenta un rumor por día: «Falta ron en Puerto Sol». Eventos de
  mercado: `Economy` elige uno al cambiar de día, mueve el equilibrio de un pueblo × 0.4 (escasez) o × 2.5 (exceso)
  durante 1–2 días y lo anuncia (evento público `rumor`). Test determinista con semilla.
- [ ] **P6 Equilibrio.** `tools/econsim.mjs`: un comerciante bot compra barato y vende caro durante 30 días de
  juego; medir oro por hora contra el oro por hora de pelear (M4: `tools/progress.mjs`). Ajustar `MARKET`,
  producciones y consumos para que comerciar sea tan rentable como pelear, no más, al principio.
- [ ] **P7 Red regional inicial.** Pocas cadenas/talleres y nodos de harvesting; especialidades con progreso
  acreditado por acciones válidas. Separar masa/volumen de mercancía si el prototipo naval lo requiere.
- [ ] **P8 Rutas y reglas legales.** Elegir ruta por duración, coste, riesgos y acceso; NPC interactivo con M6 B,
  rendición, marca/notoriedad y patrulla básica. Bounty monetario posterior a fuente y liquidación verificadas.
- [ ] **P9 Reservas y remesas.** Depósito/retirada local, carga expulsada/saqueada/entregada con recibos M5;
  pedidos de ciudad y una caravana escoltable que mueve bienes reales para M8.
- [ ] **P10 Balance ampliado.** Oro neto/hora, supervivencia tras derrotas, stock y sinks; comparar solos/coops,
  novatos/expertos y seguro/disputado. Ningún bucle de rescate, bounty, entrega o negociación crea riqueza gratis.

## 3. Notas

- La UI nunca calcula precios: siempre los pide al servidor (`list` / `quote`).
- `p.eco.pack` se guarda con el perfil (partidas firmadas). Los mercados viven en el servidor y en solo duran lo
  que la sesión; M5 los guarda (`Economy.serialize()`).
