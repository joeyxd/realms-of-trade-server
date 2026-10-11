# D09f-2b.28 — botín ordinario aplicado en tick

Recogida y expiración ahora tienen coordinador server-only dormant: el recibo durable precede a cualquier cambio de inventario, ECS, suelo o eventos. La reserva permanece hasta apply o fence. [Contrato](../briefs/m5-death-drop-staging.md). [Evidencia fija](d09f-death-drop-staging-evidence.json).

## Comportamiento

DeathDropStaging acepta selectors de drop local y receptor autenticado. Valida fuente durable, distancia/capacidad, baseline actual y ventanas; captura tick/progreso/objeto antes de IO y conserva las perlas del receptor. Asienta guardados previos y envía la petición exacta por ProfileSessions y journal/cola drop existentes.

El tick completo debe permanecer retenido: avanzar world.tick o modificar/reemplazar perfil, actor, source o ledger impide aplicar y conserva fence. Este coordinador comprueba la obligación; el hook que detiene stepDrops en GameHost será el siguiente corte.

Solo drain síncrono cambia campos del perfil y potions ECS, borra el objeto original, marca dirty y publica pickup/unloot. UID del objeto se asigna desde el receptor y la metadata del source permanece intacta; back usa la cuenta durable víctima. Expiry no ocupa una cuenta ni altera inventario. Eventos y contenedores se escriben sin callbacks live emit/onPickup. Otros drops/eventos/RNG no se rebobinan.

Fallo de aplicación revierte solo el efecto local tentativo y cerca la autoridad. El recibo SQL confirmado permanece; reconcile/settle no repiten efectos históricos. Perla ligada hasta muerte y pérdidas de muerte existentes conservadas; afinidad permanente continúa pendiente como implementación propia.

## Verificación

Contrato completo en memoria y SDK/Supabase real contra PGlite local SQL001–012 + reaplicación012. EXP Float64 sin sync previo, nivel/pociones, saves en vuelo, perlas managed bag/swallowed, capacidad, proximidad, ventanas, respuesta perdida, lanes, cierre/drift/tick y source exacto.

La prueba de integración usa DeathStaging y DeathApply reales para producir fuentes consumidas por DeathDropStaging en ambos backends; no recrea el botín terminal ni repite pérdidas de EXP. Pruebas independientes comprueban rollback, colecciones/proxies/iterators, callbacks/accesores, own-account recovery, identidad duplicada y source corrupto. Revisión Luna final sin defecto concreto pendiente; el principal verificó fuentes/resultados y ambos candidatos Unreal por stat.


Regresión aceptada en Git archive fijo de base 60a88ca + siete fuentes runtime/test propias:
**1531/1531**, **120 archivos**, **378 hashes de fuente**, **45 checks nuevos**. Node v24.14.0.
Red: 2/2, concurrencia1, 6521.6553 ms. Core: 1529/1529, concurrencia2, 138180.8208 ms.
Total 144702.4761 ms; fail/cancelled/skipped/todo cero. Hashes comprobados antes/después de cada cohorte.
Three0.160.0 físico privado, 954 archivos revalidados; SDK2.117.2 y PGlite0.5.8 por junction,
no completamente hasheados. Sin .env en la copia. PGlite no prueba backends Postgres solapados.

Primer intento: 1528/1529 core + 2/2 red; un 404 del servidor de laboratorio naval por junction
Three fuera de la raíz aislada. Copia física interna corrige el entorno: prueba del servidor 7/7 y
regresión íntegra repetida aceptada, sin modificar fuente de juego para ese fallo. Logs finales:
shots/review/m5-drop-apply-network-accepted.log y shots/review/m5-drop-apply-core-accepted.log.

Comprobación compartida: **45/45**, 19447.5849 ms; las siete fuentes propias conservan sus hashes.
La ventana conservadora de 510 fuentes desde preparación previa a completar la regresión aislada
hasta finalizar el focused detectó cambio ajeno en src/ui/wallet.js. No se afirma aceptación estable
del checkout compartido completo ni se detuvo/pisó ese trabajo.

## Límites y siguiente

No nueva migración/schema/protocolo/env ni activación CLI/host. SQL010 aplicada según el autor; SQL011/012 sin confirmación adicional ni canario live en este corte. Aplicar011 si falta y después012 antes de montar la cola drop en proveedor real.

Sigue montaje de pickup/expiry en host con pausa/publicación del tick, suelo actual restaurado con reloj estable, luego aceptación restart/reconexión/WAN. P4/P6, epoch/offline/políticas/leases/finalizador y afinidad abiertos. No publicación, push/deploy ni reinicio del servidor. Aceptación fija no incluye trabajo paralelo dirty de naval/arte/chat/agentes/Web3.
