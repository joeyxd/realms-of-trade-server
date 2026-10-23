# D09f-2b.24 — muerte completa en el límite del host

GameHost ahora puede montar explícitamente DeathStaging junto a PearlStaging antes de admitir jugadores. requestDeath es una entrada trusted entre ticks: la reserva detiene el mundo mientras espera el recibo, y beforeTick aplica muerte e inputs juntos antes de publicar. El respawn usa el helper actual. Base 78b49a8. [Contrato y límites](../briefs/m5-death-host-mount.md).

## Resultado

El mount exige scope coincidente, autoridad vacía autenticada, cero bots y owner beforeTick intacto. No introduce mensajes ni configuración CLI/env/index. requestDeath admite únicamente selectors de conexión/personaje y secuencia; el caller interno decide cuándo corresponde morir, incluso si HP sigue positivo. Se rechaza durante check/apply/step sin envenenar el tick por la petición rechazada.

El gate compartido mantiene todas las reservas hasta apply/fence. La pausa es global y no convierte latencia en catch-up. Heartbeats conservan ACK previo; no se adelantan eventos de muerte, perfiles ni saves. El drain combinado procesa muerte antes de perlas y mantiene la ventana de teardown diferido para ambos coordinadores.

DeathStaging prepara un efecto de inputs sin writes; después del efecto de muerte neutraliza mx/mz/btn/prs/w de cola y last, limpia carry y conserva secuencia/tiempo/ACK y contadores. Métodos síncronos data-only, sin promesas/accessors/reentrada. Los buffered comandos neutrales se consumen después, sin acciones previas al reaparecer. ECS sigue el plan real: muerto cancela cast y decrece buffers durante la cuenta regresiva, conservando la política actual de poderes ya comprometidos. Rollback revierte inputs y efectos locales antes de cerrar sockets; SQL confirmado permanece. Close espera ambos settle, no aplica desde shutdown y reporta flush incompleto si quedan operaciones o snapshots bloqueados.

Reglas intactas: perla ligada hasta morir; EXP configurada, bolsa y todas las perlas perdidas globalmente; Cala agrega equipo no starter/pociones y crédito PK. Oro, nivel y maestría conservados. 10 % EXP provisional. Afinidad permanente, animales y legendarias siguen pendientes.

## Verificación

**1354/1354**, cero fail/cancelled/skipped/todo, **106 archivos y 350 fuentes fijas**, **18 checks nuevos** sobre 1336. Node v24.14.0. Git archive 78b49a8 + cinco overlays propios. Hashes SHA256/LF antes/después de cada cohorte; fuentes restantes idénticas al artefacto aceptado previo. Salida normal de Node. Red 2/2 en 6589.1944 ms (concurrencia 1); núcleo 1352/1352 en 102951.4919 ms (concurrencia 2); total 109540.6863 ms.

Host real con sockets de prueba y memoria/SDK Supabase contra SQL001–010 local: hold de mundo/ECS/perfiles/ledger/RNG/inputs/ACK, receipt sin apply async, apply durante pausa, pérdida/PK una vez, IDs ordinarios operationId/ordinal, respawn sin swing/cast buffered, journal recuperado compartido, muerte exterior cero perlas sin PK, cierre lento sin publicación, fallo después de input apply con rollback antes del detach, timer/admisión cerrados, reentrada de tick, rechazo guest/wire/accessor/callback async y montaje estricto.

- shots/review/m5-death-host-network-accepted.log: SHA256 f3c361671732701b855b90cc56e6deadec25ef3f702cfde8edfb3a79e516b0d0.
- shots/review/m5-death-host-core-accepted.log: SHA256 fe51908ee31041d17823f611f806cb937e64a68b24469b439115ff8e108d6adb.

Tras el merge de hunks propios se ejecutaron además las 18 pruebas del montaje en el checkout compartido: 18/18, salida normal, 3892.6473 ms. Es una comprobación enfocada de integración con los cambios navales/chat presentes; no aceptación de todo el checkout.

La primera preparación de regresión usó una junction de Three al artefacto previo: el laboratorio naval bloqueó ese realpath externo y recibió 404. Se corrigió solo el entorno de pruebas con copia privada de Three, se verificaron los 954 hashes y se repitió el núcleo. La red ya completada se conserva; los resultados anteriores fallidos no se presentan como aceptación. No se cambiaron reglas para pasar pruebas.

Three 0.160.0: 954 archivos copiados, hashes idénticos y digest f9dbb546718d88a8769a0038ad28aee787eaf29ec7a84995557c00da5f6ff9fe; PGlite 0.5.8 y SDK 2.117.2 verificados por versión. Resto de dependencias enlazadas, sin hash completo. Protocolo fijo 19; paralelo 22 no aceptado por esta cohorte. [Evidencia estructurada](d09f-death-host-mount-evidence.json).

## Revisión y preservación

GPT-6 Luna death_host_hook_review auditó solo lectura montaje, pausa, inputs y lifecycle. El principal implementó y aceptó. Se cerraron la validación de símbolos anidados y la identidad del owner beforeTick. La confianza del caller con HP positivo queda explícita; no existe ruta por wire.

Inventario Unreal/FAB cruzado; BP_JigServerSave (580554 B) y BP_InventoryComponent (24878603 B) reverificados en ActionRPGMultiplayerStart. Se reutilizan gate/coordinador/sessions/LocalServer/input boundary y helpers reales. Blueprints no ejecutables en Node/CAS; Unreal intacto.

Host y LocalServer ya contienen cambios ajenos. Se construyó un patch propio contra HEAD para el índice y otro contra el contenido compartido, conservando chat/naval/resources. Al retirar nuestro delta del merge se obtiene byte por byte, con LF normalizado, el contenido ajeno previo. Solo los paths y hunks propios se incluyen; los blobs runtime/test del commit deben coincidir con la copia aceptada. No se acepta el checkout paralelo completo.

## Lo que sigue

SQL010 confirmada aplicada por el autor el 2026-10-07; no hubo canario Supabase independiente. No hace falta SQL nueva. Sin env/credenciales, push, deploy ni reinicio.

Conectar golpes fatales exige conservar el tick parcial: otros actores, RNG y comandos pueden haber cambiado antes de matar. Este corte no aborta/repite ese tick ni activa automáticamente muertes durables en la partida. Sigue ese contrato, después suelo ordinario actual durable con hidratación/pickup/consumo/expiry. listDeathDrops sigue siendo historia de creación. Epoch/reloj/políticas/finalizador/leases, RNG definitivo, rebuild tras fence y afinidad permanente abiertos; P4/P6 parciales.
