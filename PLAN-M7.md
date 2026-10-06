# PLAN M7 — «Mercaderes»: comercio entre pueblos

Entregas/UI/recursos y dependencias: [PLAN-DELIVERY.md](PLAN-DELIVERY.md), D06, D10–D11 y D13–D14.

> El corazón de la estructura (DESIGN, «El chiste del juego»). El **motor ya existe y está probado**
> (`tests/economy.test.mjs`). D06a conecta mercaderes, cotización, compra/venta y bodega:
> **aceptado localmente en software**, `0.6.0-alpha.3` / protocolo 15. Iconos por bien, muerte, rumores,
> balance regional y publicación siguen pendientes. [Informe](docs/delivery/d06a-cargo-market.md).

## 0. Qué hay ya en el código

| Pieza | Dónde | Estado |
|---|---|---|
| Mercancías, leyes, impuestos, contrabando | `src/data/goods.js` | ✅ 18 mercancías, 4 leyes |
| Pueblos, islas, rutas | `src/data/towns.js` | ✅ 6 pueblos (Aldea y Cala caminables), 9 rutas |
| Mercado: precio por escasez, deslizamiento, margen, impuesto, equilibrio por pueblo, recuperación | `src/sim/economy/market.js` | ✅ |
| Bodegas por peso, pudrición | `src/sim/economy/cargo.js` | ✅ |
| Reloj y economía del mundo (serializable) | `src/sim/economy/economy.js` | ✅ 1 día = 960 s |
| Comando `market` (`list` / `buy` / `sell`) y eventos `market` / `traded` / `tradeDenied` | `src/sim/systems/trade.js`, `localServer.js` | ✅ |
| Mercaderes y panel privado `commerce`: list/quote/buy/sell/cargo/transfer, correlación, total vigente y recibos exitosos de sesión | `src/ui/commerce.js`, `src/sim/systems/commerce.js` | ✅ D06a local |
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

- [x] **P1 Mercaderes en el mundo.** Don Bacalao en Aldea y La Tuerta en Cala, looks existentes y botón
  «Comerciar mercancías» en diálogo → panel `commerce`. Posiciones comprobadas fuera de agua/colliders
  y dentro del radio real del mercado; habla y controles táctiles probados en Worker local.
- [x] **P2 Panel del mercado** (`src/ui/commerce.js`, `styles/commerce.css`). Lista con marcador de categoría,
  nombre, stock, precios, tendencia y contrabando; selector 1/5/10/máx y **total/medio cotizados por servidor**.
  Oro y espacio de mochila, errores en español y confirmación al precio vigente. La UI espera acuse+perfil,
  conserva pendiente al cerrar y reintenta con el mismo ID sin repetir cobro dentro de los recibos de sesión.
  Regresión 493/493 sobre commit `bcd0886`, 8 pruebas nuevas y 45 capturas PC/móvil horizontal/vertical.
  P1/P2 aceptados localmente en software; animación de monedas adicional y publicación pendientes.
- [ ] **P3 Iconos de mercancías.** Procedurales (canvas, como los de objetos en `itemui.js`), o `tex:good-<id>` en
  el manifiesto de assets si el autor los trae.
  D06a usa marcadores por categoría; no entrega un icono propio por mercancía. Inventario Unreal/FAB revisado
  antes de implementar: iconos empaquetados, sin export listo; no hay nueva textura/descarga en este corte.
- [ ] **P4 La mochila en el HUD y la muerte.** Contador pequeño junto al oro. Morir en la Cala tira la mochila al
  suelo (`spillPlayer` en `inventory.js` ya lo hace con el botín: añadir la mochila como `kind: 'goods'`).
  Esa pérdida es propuesta pendiente de política, no comportamiento activado por D06a. El panel muestra
  capacidad de mochila/bodega; no añade contador permanente ni decide pérdidas personales.
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
