# AREA15 — regalar perlas con el recibo común

Continúa [leave](m5-ground-pearl-leave.md) y la
[matriz derivada de los planes](../CONTINUITY-MATRIX.md), desde `1417975`.
[Contrato](../briefs/m5-ground-pearl-give.md). Sin migración, flag, UI ni protocolo nuevos.

## Resultado y autoridad

El montaje explícito `mountGroundPearls()` admite ahora `pearl/give` gratuito entre
dos cuentas autenticadas. Solo una perla de `pearls.bag`; la tragada sigue ligada
hasta morir. Conserva calma, vida, alcance y límite de bolsa mediante `transferPearl`
sobre una vista separada. No mueve afinidad ni dinero. Venta con pago queda para
su propio contrato; NPC no compra perlas y swallow sigue cerrado en este piloto.

El comando solo selecciona UID y entidad receptora. Resuelve la sesión/identidad
actual del receptor, rechaza campos extra de autoridad y reserva ambas cuentas y
todos sus UIDs antes de IO. Asienta progreso previo de ambos, incluidos autosaves
en curso; un guardado de la otra cuenta puede finalizar mientras se asienta la
primera. Solo admite ese avance acotado con el mismo conjunto de perlas y exige
el snapshot final capturado antes de construir la transacción. Rechaza agotamiento
del contador de versión antes de reservar o iniciar esos guardados.

Consulta holder/generación actuales y la ubicación del UID. Una ubicación existente
debe ser del mismo mundo, de la misma generación y con `ground:null`. Un UID legacy
registrado en SQL003 sin fila de ubicación puede adquirir su primer tombstone;
no se asume generación 1 para entregar. Familia `ground` SQL004/018/019 confirma
ambos perfiles CAS, nuevo dueño/generación, ubicación, mundo/reloj y petición exacta.

Durante IO no cambia bolsas, ledger ni eventos. El drain síncrono aplica ambas
sesiones/perfiles, ledger, dirty y eventos `pearlChanged(give)`/`pickup` juntos.
Verifica identidades, callbacks, baseline, ECS, RNG, drops y asignadores. Un fallo
en segunda sesión o append parcial revierte la proyección local y cerca el host;
SQL confirmado permanece autoritativo para recuperación. Desconexión, muerte,
reciclado de entidad, cierre y sustitución de hooks tampoco aplican sobre otro cuerpo.

## Aceptación local

[Manifiesto y fuentes](m5-ground-pearl-give/acceptance.json),
[TAP](m5-ground-pearl-give/acceptance.tap): **38/38 en cuatro archivos**. Adaptador separado, comando real,
reserva previa de ambas cuentas y UIDs del receptor, progreso de ambos, commit
retenido, competencia, respuesta perdida con petición idéntica, límites de versión,
rollback y cerco del host. La ruta sin montaje conserva el helper existente.

Dos procesos reales se terminan con SIGKILL tras preparar la intención SQL019 y
tras commit antes de apply. Se reabre PGlite persistido **sin ejecutar migraciones**:
petición/UUID exactos, diario confirmado, ambos CAS y mundo/reloj coherentes, una
copia y un dueño, tombstone de generación nueva y cero callbacks/eventos históricos.
Una entrega posterior desde el receptor prueba otra generación; no restaura perfiles
históricos del recibo anterior.

[Regresiones pertinentes](m5-ground-pearl-give/regression.json) y
[TAP](m5-ground-pearl-give/regression.tap) cubren las rutas comunes anteriores,
economía/recursos/Tala/taller, Carga, agua/cantimplora/comidas y exclusiones GM/compañeros.
El único fallo de la cohorte fue la expectativa HTML antigua del aviso `commandDenied`:
la traducción añadió el wrapper fijo `data-l10n-html`, manteniendo texto, destinatario y privacidad.
Se reprodujo sin cambios en upstream `6f997ce` ([control](m5-ground-pearl-give/upstream-toast.json),
[TAP](m5-ground-pearl-give/upstream-toast.tap)). Se actualizó solo la expectativa exacta del test,
sin cambiar el componente ni relajar la comprobación de UID/perfil/recibo. El archivo completo y
la ruta compatible repiten **27/27 en dos archivos** ([seguimiento](m5-ground-pearl-give/regression-followup.json),
[TAP](m5-ground-pearl-give/regression-followup.tap)). El seguimiento acredita que ese test es la única
fuente distinta de la cohorte; no se repitieron sus 51 archivos ni se declara verde su resultado original.
Implementación `3862a7c`, integración/regresión `3de3b53`; las fuentes de aceptación give siguen iguales.

Tras integrar compañeros y el corte antorchas/resina/coco hasta `5338538`,
la revisión `e237768` repite **60/60 en siete archivos**, con fuentes congeladas
([manifiesto](m5-ground-pearl-give/upstream-integration.json),
[TAP](m5-ground-pearl-give/upstream-integration.tap)). Incluye los cuatro archivos
de give y, por separado, catálogo/host/SQL037 de antorchas. Los SIGKILL usan la
fixture SQL018/019/023; no acredita un montaje conjunto con antorchas ni migra
sus perfiles. El guard de composición se conserva. Los conteos se solapan con 38/38.

Las fuentes se congelan durante cada cohorte. Los conteos incluyen subtests y se
solapan con entregas anteriores; esta cohorte no representa la suite general completa.

## Publicación y límites

[Lectura previa VPS](m5-ground-pearl-give/initial-status.json) y
[dominio previo](m5-ground-pearl-give/initial-domain.json): `1417975`, alpha.64 sano,
Supabase/cuentas, tres bots, base de contenido generación 8; montajes comunes nulos,
sin reloj adoptado ni filas/intenciones de suelo. Son lecturas separadas y fechadas.

Código publicado y observado el 2026-10-12 a las 17:20 UTC en `e237768aa53e0df31e35e44cae66ec4e0ce65879`,
alpha.65/protocolo 60. Imagen activa `sha256:8ff6d3af76c60606bcfd4373520f67524ff1c689f34190772fec0625a8f11c8b`:
[actualizador 197/197](m5-ground-pearl-give/updater-validation.json),
[23 hashes de runtime/SQL iguales a Git y 74/74 pruebas de imagen](m5-ground-pearl-give/exact-image-tests.json).
Estas últimas corren en un contenedor separado de esa imagen, sin red ni credenciales;
prueban adapters/fronteras en memoria y no sustituyen los SIGKILL locales con SQL.

[Entrada pública 6/6](m5-ground-pearl-give/public-smoke.json): salud, protocolo y
conexión guest WSS con identidad de contenido, snapshot y perfil; desconexión acotada.
[Estado final](m5-ground-pearl-give/final-status.json): saludable, cero errores,
guardados/escrituras pendientes, tres bots y contenido generación 8 conservados.
[Lectura del dominio](m5-ground-pearl-give/final-domain.json): SQL023 readiness 1,
sin reloj adoptado ni filas/intenciones de suelo. Son lecturas separadas y fechadas.
Los cuatro montajes comunes siguen nulos; `foraging.enabled=false` mantiene el flag
de antorchas nuevo sin activar. No se aplicó SQL ni se cambió la configuración del VPS.
Esto acredita publicación del código y entrada ordinaria, no gameplay durable público de give.

El piloto común permanece apagado. Siguen swallow sin reemplazo/expulsión, candidato
completo kill/cofre (recompensas/XP/misión/RNG antes de intención), composición con
recursos GM/compañeros/control/bots, adopción detenida y canario autenticado VPS.
El corte concurrente [antorchas/resina/coco](../briefs/torch-resin-coconut.md)
añade SQL037 y excluye explícitamente su flag junto con `groundTransactions`.
Su composición se añade a la cola; ese guard y la configuración pública se conservan.
Las exclusiones actuales se conservan. SIGKILL local no prueba pérdida eléctrica,
disco, PostgreSQL con dos backends ni lease entre procesos. Antes de la intención
durable aún puede perderse un comando sin confirmar; no se entrega éxito anticipado.

Reutilización concreta revisada en el [inventario ActionRPG](../research/unreal-assets/actionrpg/FINDINGS.md):
`BP_InventoryComponent` tiene UID/transferencias/distancia y `BP_JigServerSave`
referencia guardado Blueprint. No ejecutan Node/Postgres ni prueban CAS/durabilidad.
Se reutilizan los helpers/coordinadores JS y SQL existentes; fuentes Unreal intactas,
sin assets, arte o cambios visuales propios de este corte.
