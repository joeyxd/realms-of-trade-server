# AREA15: muerte y botín con la autoridad común

Continuación de [perlas actuales](m5-ground-pearl-lifecycle.md).
[Contrato](../briefs/m5-ground-death-lifecycle.md). No añade migración, flag ni protocolo.
Conserva las entregas concurrentes de Carga, agua, terreno y compañeros.

## Comportamiento implementado

`mountGroundPearls(); mountGroundDeaths();` compone la muerte real de combate y el botín
ordinario con el mismo dueño de tick, mundo, reloj y diario SQL018/019/023. Es un montaje
explícito con host vacío y detenido, antes de `prepare()`; no adopta el mundo público.

El tick terminal termina una vez y retiene la publicación. El coordinador captura sus
perfiles/ECS y las reglas existentes de muerte, reserva cuentas/UIDs/fuentes antes de
esperar, asienta el último progreso y lee las generaciones actuales. La transacción común
confirma perfiles, pérdida de XP, crédito PK, perlas y botín junto con mundo/reloj. Las muertes
del mismo tick se procesan en orden, usando las versiones confirmadas de la muerte anterior.

Solo el drain síncrono aplica perfiles, ECS, metadatos de sesión, comandos neutralizados,
fuentes y eventos. El RNG vivo avanza al cursor capturado al aplicar; no se reproduce el tick
al recuperar. Un fallo revierte las escrituras tentativas y cerca el host, conservando el
recibo SQL confirmado. Desconexión o cierre ambiguo no aplican efectos a una entidad retirada.

El arranque recupera primero el diario y después instala filas actuales de perlas y botín
ordinario, en una sola frontera detenida. Conserva el epoch y la pausa offline acordada.
Objetos y pociones pueden recogerse o expirar bajo el mismo dueño, con ventana, rango,
capacidad, identidad de fuente y perfil comprobados. La recogida asienta el progreso vivo
antes del recibo y actualiza `version/confirmed/last` al aplicar. Cada fuente termina una vez.

## Evidencia

**1015/1015 en 100 archivos**, cero fallos/omisiones y fuentes congeladas
antes/después, base `97d32a1`: [manifiesto](m5-ground-death-lifecycle/acceptance.json),
[TAP](m5-ground-death-lifecycle/acceptance.tap). Incluye muerte fatal real en Cala/exterior,
muertes simultáneas, roles de atacante/víctima, guardado anterior pendiente, cola de inputs,
desconexión/cierre y rollback antes del cerco. SQL001–032 y supervivencia activada en la fixture:
captura de los últimos medidores fraccionales y snapshot durable después de reaparecer.
La selección automática recoge objetos y expira todas las fuentes vencidas sin conceder inventario.

Integración concurrente posterior **278/278 en 43 archivos**,
base `58a097b`, fuentes congeladas: [manifiesto](m5-ground-death-lifecycle/concurrent-integration.json),
[TAP](m5-ground-death-lifecycle/concurrent-integration.tap). Conserva INV02d (columna ECS de carga,
predicción y fabricación manual), SQL033/materiales GM con recibos v2/v3, cantimplora/supervivencia
y Companion Studio. El host preparado con ambas autoridades de muerte rechaza la activación GM
con `gm_content_busy`, sin bloquear ni alterar el mundo. Conteos solapados con la aceptación principal.

Integración RNV08a/costa **74/74 en 14 archivos**,
base `cd2a97b` y fuentes congeladas: [manifiesto](m5-ground-death-lifecycle/shore-integration.json),
[TAP](m5-ground-death-lifecycle/shore-integration.tap). Conserva identidad de mochila/bodega,
servicios durables en parada seca y masa al reembarcar junto a muerte, botín, diario y recuperación.

Cuatro pruebas nuevas interrumpen procesos reales con SIGKILL: muerte y recogida de objetos,
cada una después de preparar el diario y después del commit SQL, antes de aplicar localmente.
Se reabre PGlite persistente sin migraciones, recupera el diario y solo hidrata filas actuales:
una muerte/PK, inventario y fuentes una vez, cero efectos históricos. Hay más pruebas previas de
proceso en la selección; los conteos se solapan con entregas anteriores.

**Código publicado y comprobado, montaje común apagado:** runtime `cd2a97b0f08e37b17620feef3fa9efcb3baf0594`,
0.6.0-alpha.50/protocolo 55, imagen `sha256:46aea25c1066b6cdf7caaeeef9c40dbdee4519037f10d9c7255ac2cedc5b3ae4`, una autoridad sana y timer activo.
Actualizador **176/176**, pruebas aisladas sin red/credenciales en la imagen exacta
**63/63** y diez módulos comparados con Git:
[imagen](m5-ground-death-lifecycle/exact-image-tests.json),
[actualizador](m5-ground-death-lifecycle/updater-validation.json),
[fuentes](m5-ground-death-lifecycle/published-source-check.json).
Las pruebas de imagen usan memoria; la durabilidad SQL corresponde a las pruebas locales.

Entrada WSS pública normal **6/6**, identidad de contenido, snapshot/perfil y salud:
[smoke](m5-ground-death-lifecycle/public-smoke.json), [estado VPS](m5-ground-death-lifecycle/final-status.json).
Supabase durable conserva economía, recursos y cantimplora; `groundTransactions`, `groundPearls`
y `groundDeaths` permanecen `null`. [Lectura del dominio](m5-ground-death-lifecycle/final-domain.json):
SQL023 listo, mundo sin adopción/reloj común y sin filas de suelo/diarios de este piloto.
No se ejecutó SQL ni gameplay durable de QA en el VPS por este corte.

La primera regresión congelada detectó fixtures antiguas incompatibles con contratos actuales:
el ECS mínimo de atributos omitía las columnas de supervivencia; el perfil de la prueba del plan
de muerte subía de nivel sin recalcular sus límites de Carga. Se usan el ECS real y límites
derivados canónicos en esas fixtures, conservando los rechazos estrictos del servidor.
[Ensayo previo](m5-ground-death-lifecycle/before-fixture-fix.json) y
[TAP diagnóstico](m5-ground-death-lifecycle/before-fixture-fix.tap) conservan esos fallos;
la aceptación corresponde al manifiesto final.

La primera integración posterior detectó una expectativa incorrecta de la nueva fixture GM:
el flag inicial de cambio de contenido es `undefined`, no `false`. La prueba exige ahora
conservar su valor previo al rechazo. [Diagnóstico](m5-ground-death-lifecycle/before-gm-fixture-fix.json)
y [TAP](m5-ground-death-lifecycle/before-gm-fixture-fix.tap); no exigió cambiar runtime.

## Límites y continuación

El código está publicado con el montaje común apagado. No se activa este piloto sobre el
mundo público ni se ejecuta SQL nuevo. Falta componer mint de loot nuevo y comandos restantes
de perlas; después corresponde transición detenida con exclusión del escritor anterior y
del actualizador, adopción explícita y canario autenticado de caída/reinicio en el VPS.

La activación GM con el piloto montado conserva su exclusión vigente. La geometría confirmada
es la fuente durable de los drops; no se promete conservar el cursor RNG entre procesos.
SIGKILL local no acredita pérdida eléctrica/disco, concurrencia entre backends ni lease
entre procesos. No completa XP/misiones, producción autónoma, custodia offline o backups.

Se reutilizan CombatDeath, planes/efectos reversibles, sesiones, hidratación y SQL existentes.
El candidato Unreal `BP_JigServerSave.uasset` se verificó físicamente (580554 bytes); los
Blueprints de guardado/loot no ejecutan el contrato Node/Postgres. Las fuentes Unreal permanecen
intactas y no se añade arte/UI. Trabajo aislado en `area15-resource-live`; el checkout IDE
recibe documentación acotada, conservando su runtime, migraciones, entorno y trabajo concurrente.
