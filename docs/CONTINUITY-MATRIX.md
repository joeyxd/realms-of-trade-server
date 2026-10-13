# AREA15 — cobertura de continuidad por sistema

Revisión 2026-10-12, base `8fa8f58478310d9c39fa06e39bbabaf81a6ed9d3`;
integra también ST01a de `7b34381dc8318ad83dcd5b48acfcfa68b5736931`.
Give común continúa desde `1417975`; [entrega y aceptación](delivery/m5-ground-pearl-give.md).
[Swallow común](delivery/m5-ground-pearl-swallow.md) continúa desde `a19f5e1`: cuatro poderes, input reversible y dos SIGKILL locales.
Deriva de los planes y contratos enlazados; organiza sus dependencias de guardado,
sin sustituir sus decisiones de producto. [Revisión y evidencia](delivery/m5-continuity-review.md).

## Cómo leer el estado

AREA15 conserva lo confirmado por el servidor entre reintentos, reconexión y reinicios,
dentro del alcance probado de cada operación. Hay tres estados distintos: datos que
entran en un perfil/snapshot, una operación con recibo y recuperación probados, y esa
operación aceptada en el mundo público. Un estado no acredita automáticamente el siguiente.
Los checkpoints antiguos conservan su fecha/base; para el estado actual prevalecen las
entregas más recientes del mismo sistema. No se suman sus conteos solapados.

La [lectura tras publicar el código give](delivery/m5-ground-pearl-give/final-status.json)
observa `e237768`, alpha.65/protocolo 60, con Supabase y las operaciones económicas
actuales activas. El código de antorchas está integrado y su flag continúa apagado.
**El piloto común de reloj/perlas/muerte/botín sigue apagado.**
P4/P6 de [M5](../PLAN-M5.md) siguen parciales; no se acepta todavía «todo sobrevive a cualquier caída».

## Mapa derivado de los planes

| Sistema y fuente de producto | Base y cobertura acreditada | Integración o aceptación que falta |
| --- | --- | --- |
| Cuentas, perfiles y economía — [M5 P1–P3](../PLAN-M5.md#3-pasos) | Perfiles CAS y mundo Supabase; [operaciones económicas](delivery/m5-economic-authority.md) con recibo conjunto. | Un snapshot periódico conserva su ventana de pérdida; no prueba todas las recompensas ni todos los writers. Invitados conservan blob firmado, con alcance distinto de cuentas. |
| Recursos, fabricación y aportes — [M6](../PLAN-M6.md), [Tala/taller](briefs/prg01d-starter-workshop.md) | [SQL015](delivery/m5-resource-authority.md): nodos, consumo/recompensa, reloj y perfil; pausa offline y reinicio/SIGKILL VPS de ese flujo. Tala cooperativa y taller tienen [aceptación propia](delivery/prg01d-starter-workshop.md). | Preservar beneficiarios, ciclos, recetas y revisiones al componer con el dueño común. Los proyectos de ciudad futuros requieren su contrato; no se heredan del taller personal. |
| Mochila, Carga y puntos — decisiones locales `PLAN-PROGRESSION.md` §15, [INV02b](briefs/inv02b-durable-attributes.md), [INV03](briefs/inv03-existing-backpacks.md) | [Carga SQL029](delivery/inv02b-durable-attributes.md), [controles](delivery/inv02c-attribute-controls.md) y [sobrepeso](delivery/inv02-survival.md) conservan el modelo existente. INV03 verifica SQL001–036 y mejora 30→42. | [INV03](delivery/inv03-existing-backpacks/README.md) aún debe aceptar ambos tiers por botones públicos/reentrada. Huecos/pilas y bolsas equipables no se dan por implementados; sigue el volumen actual. |
| Necesidades, agua, fuego y comida — [RNV07b](briefs/RNV07b-canteen-survival.md), [SRV02](briefs/srv02-special-meals.md) | [Cantimplora/supervivencia SQL032](delivery/rnv07b-canteen.md) y [comidas SQL035](delivery/srv02-special-meals/README.md): consumo/efecto con recibo, pausa offline y limpieza al respawn. Grog aceptado en público. | Aceptación pública de platos calientes con fuego propio pendiente. Al componer, conservar medidores y duración actuales en muerte, carga y recuperación; no crear una segunda sed ni otro temporizador. |
| Progresión, XP, misiones y afinidad — [M5](../PLAN-M5.md#ampliación-de-contratos-para-el-mundo-naval-2026-10-04-diseño-pendiente-de-implementación), [Pilotaje](delivery/prg02b-pilot-learning.md), [afinidad](briefs/m48-pearl-affinity.md) | Aprendizajes concretos tienen su operación/entrega; la muerte compuesta incluye pérdidas de XP. | El candidato completo kill/cofre debe confirmar recompensa, cursor RNG y progreso. Misiones futuras y afinidad permanente por tipo/personaje siguen aparte; el UID no lleva el aprendizaje al receptor. |
| Perlas, muerte y botín — [M4.8](../PLAN-M4.8.md), [M5](../PLAN-M5.md), [SQL018](briefs/m5-ground-transactions.md) | Diario SQL019, hidratación actual, pickup/retorno, muerte/botín, mint, [leave](delivery/m5-ground-pearl-leave.md) [give gratuito](delivery/m5-ground-pearl-give.md) y [swallow](delivery/m5-ground-pearl-swallow.md) probados bajo montaje común explícito, con SIGKILL locales. Give confirma ambos perfiles y UID sin pago. | Sobre completo kill/cofre; luego composición y adopción pública. Perla tragada ligada hasta morir. Venta entre jugadores aprobada como dirección, con precio/pago/recibo propios pendientes; NPC no compra perlas. |
| Balsa, construcción, bodega y producción — [M6](../PLAN-M6.md), [D09/M5](../PLAN-DELIVERY.md) | Plano/bodega y [condición/pose](briefs/d08c11-raft-recovery.md) se guardan; operaciones económicas cubren movimientos concretos. [Producción D06b](delivery/d06b-production.md) conserva fracciones/lotes en su alcance. | Operaciones autónomas, daño/pérdida/reparación/recuperación y transferencias de riesgo necesitan cobertura transaccional específica. Tripulación, velocidad y proyectiles no se restauran por guardar pose; [ruta de práctica](briefs/d08c12-naval-route.md) es de sesión. |
| Edición GM, terreno, recursos y talleres — [plan GM](../PLAN-GM-EDITOR.md), [GM03b2](briefs/gm03b2-content-activation.md), [GM04d](briefs/gm04d-functional-resources.md), [habilidades](briefs/skill-studio-vision.md) | Borradores de mapa SQL020/031/033, revisión/puntero durable y rollback; SQL036 admite recursos append-only y conserva agotamiento/ledger por ID. [GM04d público](delivery/gm04d/DELIVERY.md) valida el editor privado. [ST01a](delivery/st01a/DELIVERY.md) añade borrador de Tromba local por cuenta/servidor y exportación JSON; no escribe progreso. | Recursos GM activos y su admisión **excluyen el piloto común**. Falta componer admisión/reloj/puntero y recuperación bajo un solo dueño. GM04d público no publicó ni recogió recursos compartidos. Variantes compartidas de habilidades y [taller UI futuro](briefs/ui-workshop-vision.md) necesitan contratos propios; el save local de ST01a no equivale al borrador SQL del mapa. |
| Compañeros, control y memoria — [plan LLM](../PLAN-EXTRA-LLM.md), [L03e](briefs/l03e-companion-creation.md), [L03f](briefs/l03f-local-pairing.md), [L04c](briefs/l04c-companion-continuity.md) | Identidad/configuración/stop SQL025/027/034; perfil de personaje separado. [Emparejamiento](delivery/l03f-local-pairing/README.md) publicado, solo chat; journal/memoria/presupuesto de inferencia permanecen en la PC. | El host rechaza emparejamiento con `groundTransactions`; falta composición deliberada. Reiniciar invalida permisos efímeros, no debe reanudar órdenes recordadas. Modelo real y memoria local no equivalen a gameplay M5 ni a inferencia verificada. |
| Comercio y presupuestos de agentes — [L06b](briefs/l06b-agent-trade.md), [M5/SQL018](briefs/m5-ground-transactions.md) | [SQL017](delivery/l06b-agent-trade.md) confirma consumo de mandato, perfil, mercado y recibo juntos en el corte implementado. | Conserva su aceptación/activación independiente pendiente. El piloto común excluye `agentTrade`/`agentControl`; la futura composición debe mantener el presupuesto, sin desviar gastos a un recibo humano. |
| Propiedad opcional Web3 — [plan Web3](../PLAN-WEB3.md), [reglas de equipo](briefs/w00-equipment-rules.md) | Registro y herramientas tienen contratos/ensayos separados del inventario jugable. | Vincular wallet o observar titular no concede derechos de juego. Proyección, finalidad, custodia y pagos requieren sus contratos/aceptaciones; no bloquear la continuidad del alfa por esa rama futura. |
| Zonas, custodia y recuperación operativa — [M5 P5/P6 y notas](../PLAN-M5.md#3-pasos), [adopción](briefs/m5-ground-world-adoption.md), [VPS](DEPLOY-VPS.md) | Una autoridad de mundo, CAS, cerco ante error e idle updater. SQL023 prepara adopción explícita y cerca writers legacy. | Leases entre procesos, transferencias entre zonas, custodia offline, backup y restauración de disco verificados siguen abiertos. SIGKILL de proceso no demuestra pérdida eléctrica/disco ni dos backends concurrentes. |

`PLAN-PROGRESSION.md` y `PLAN-MASTER.md` son guías locales del checkout compartido;
los briefs publicados enlazados conservan los contratos ejecutables de esos acuerdos.
La matriz no copia sus parámetros para evitar balances divergentes.

## Orden de cierre de AREA15

1. **Give gratuito de bolsa entre cuentas aceptado localmente**, según el [brief concreto](briefs/m5-ground-pearl-give.md)
   y su [entrega](delivery/m5-ground-pearl-give.md). Dos perfiles/sesiones y UID juntos; montaje público apagado.
2. **Swallow aceptado localmente** sin reemplazo ni expulsión voluntaria,
   [recibo/evidencia](delivery/m5-ground-pearl-swallow.md). Sigue **candidato completo kill/cofre**:
   recompensa, XP/misión aplicable y RNG, incluido el intervalo anterior a la intención durable.
3. **Composición con features activas**, antes de adoptar el mundo público. Resolver recursos GM,
   emparejamiento/control/presupuesto de agentes y rutas autónomas que sigan excluidas. El corte
   [antorchas/resina/coco](briefs/torch-resin-coconut.md), integrado desde `5338538`, añade SQL037
   y también rechaza `torchResinCoconutOperations` junto con `groundTransactions`. Componer sus
   costes, extras de tala y consumo antes de quitar ese guard; publicar código no activa su flag.
   Mantener los guards mientras falte aceptación; activar el piloto no debe apagar features silenciosamente.
   El piloto actual es accounts-only/cero bots y el VPS observado tiene tres bots: la transición
   necesita política explícita de admisión y configuración, no copiar los flags de una fixture.
4. **Transición detenida/adopción y canario autenticado VPS**, con exclusión del writer anterior y
   actualizador, una autoridad, reinicio/caída y reentrada sin duplicados. SQL023 v1 rechaza suelo
   legacy no vacío; convertirlo requiere otro contrato si aparece al preflight.
5. Cerrar **autonomía, operaciones navales de riesgo, custodia y restauración** por cortes de sus
   planes. No se exige terminar features futuras para aceptar un corte acotado; sus límites quedan visibles.

## Incorporar una feature sin perder continuidad

El dueño de cada área mantiene su decisión de producto y entrega. Antes de activar una mutación
persistente, su brief y esta fila deben identificar:

- Fuente de la decisión y corte; estado propio frente a parámetros aún abiertos.
- Dueño de escritura y ámbito cuenta/personaje/mundo; defaults, saneado y compatibilidad histórica.
- Qué cambia junto: coste, recompensa, propiedad, versiones y recibo; UUID estable ante reintento.
- Reloj, pausa offline, cierre/muerte/reconexión y ventana de pérdida que se acepta.
- Recuperación antes del envío, tras commit y antes de apply; cargar filas actuales sin eventos históricos.
- Composición con gates/colas actuales y prueba de regresión de los sistemas afectados.
- Evidencia separada de implementación, SQL instalado, tests locales, montaje y aceptación pública.

Un CHECK/readiness nominal no sustituye la comprobación del contrato SQL instalado: SQL036 mostró
ese caso. Publicar código tampoco activa migraciones o montajes. Cada cierre actualiza esta matriz,
M5 y HANDOFF con el siguiente paso; los informes fechados conservan la evidencia original.
