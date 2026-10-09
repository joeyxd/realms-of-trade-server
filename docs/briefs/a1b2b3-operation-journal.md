# A1b2b3 — diario de guardados/aportes y barrera de recuperación

2026-10-09. Continúa A1b2b2 sobre la fila comunitaria de personaje y su vínculo inmutable.

## Resultado acotado

Conservar la intención exacta **antes** de enviar una mutación. Completar guardado o aporte y
su resultado en la misma transacción. Al reconstruir el controlador, descubrir todos los
pendientes del mundo/época mediante páginas ordenadas y mantener cerrada su barrera hasta
resolverlos. Este corte entrega almacenamiento y coordinador opcionales; no monta sesiones
en GameHost ni sustituye el perfil M5.

La intención es `{operationId,binding,kind,request}`. `binding` reutiliza A1b2b1; `kind` admite
`save` o `contribution`; `request` es la fila/CAS completa o el contrato existente de aporte.
El UUID del aporte coincide con el de la intención. Cuenta, mundo, época y personaje son
datos de autoridad confiable del servidor, nunca claims del protocolo.

## Invariantes

- `prepareOperation` valida propiedad/personaje existentes, persiste el request y reserva
  como máximo un pendiente por personaje/mundo/época. No debita materiales ni crea personajes.
- `commitOperation` requiere esa intención exacta. Ejecuta el CAS existente y escribe el resultado
  juntos; un fallo en cierre revierte perfil, proyecto y recibo del aporte. Un rechazo terminal
  queda registrado y un replay no vuelve a ejecutar la operación.
- El UUID comparte namespace con los recibos comunitarios de aporte, en ambas direcciones.
  Un recibo previo solo puede incorporarse si coincide exactamente; no importa su snapshot al mundo.
- Requests y resultados completos son inmutables. No borrar entradas para resolver incertidumbre.
  ACLs impiden DML de servicio/clientes; solo cuatro RPCs de servicio pueden operar el diario.
- Orden de locks: UUID → personaje → proyecto. Reutilizar namespaces/CAS existentes.
- `CommunityOperationRecovery` comienza cerrado. `recover()` solo lee: scan completo,
  comprobación de cada pendiente y rescan final. Fallo, página inválida, límite excedido o
  intención local incierta sin evidencia conservan el cierre.
- `recover({retry:true})` es una orden **explícita y masiva** del servidor para reintentar los
  pendientes conocidos del scope, con requests originales. No hay reintentos automáticos ni
  un endpoint de jugador para invocarla. El resultado puede ser un rechazo CAS terminal.
- `execute` exige barrera abierta, recuerda el request antes de I/O y hace prepare → commit.
  Un timeout/respuesta perdida vuelve a cerrar la barrera; abortar HTTP no prueba rollback SQL.
- El coordinador exige store durable por defecto. Memoria solo con `allowVolatile:true`,
  opción de ensayo que no demuestra recuperación tras terminar el proceso.

## Límites para el montaje posterior

La barrera pertenece a **un propietario de proceso**. Un scan por cursor no es un lease ni una
exclusividad distribuida: exige arranque sin otro host escritor y secuenciar admisión/mutaciones
en el futuro adaptador. Un prepare tardío del proceso anterior puede introducir un pendiente;
no autoriza por sí solo una mutación. No anunciar failover concurrente ni fencing entre hosts.

Los RPCs ordinarios de guardado/aporte siguen disponibles para compatibilidad y pueden adelantar
la revisión entre prepare y commit. El CAS evita sobrescribir; el diario cerrará entonces con
`conflict`. Antes de montar, enrutar y bloquear **todas** las mutaciones de la misma mochila
por una sola autoridad, incluidas autosave, comercio, fabricación, perlas, muerte y close/reconnect.
No usar tablas comunitarias y `mn_profiles` como dos mochilas activas del mismo personaje.

Un resultado completo acredita una operación histórica. Para publicar después de recuperarla,
las sesiones deben recargar filas **actuales** y aplicar en `drain` síncrono con identidad viva.
Este coordinador no publica ECS, no ofrece admission/open y no activa `BoundProfileSessions`.
Esa integración es el siguiente corte A1b2b4, antes del montaje completo de GameHost.

No aplicar SQL live, leer `.env`, migrar perfiles M5, añadir leases/relojes, cambiar
protocolo/defaults/costes/arte ni activar gameplay en este corte. Conserva alpha.16/protocolo 32.

## Verificación y reutilización

Pruebas con memoria y SDK Supabase real contra PostgreSQL local PGlite: lost reply en prepare/commit,
colisiones/propiedad, páginas de varios personajes, scope/época, rollback al cerrar guardado/aporte,
ACLs y argumentos raw SQL, reapply y reapertura de disco con pendiente. Recuperación sin escribir
por defecto y fila actual posterior a recibo histórico; regresión de bootstrap/admisión/aportes.

Cruce acotado con `docs/research/unreal-assets/survival/FINDINGS.md`: `BP_Building_Bench`/
`SM_RepairBench` y `BP_LootBox`/`SM_StoragePart_03` son candidatos visuales, sin lógica portable de
autoridad/journal. No aportan esta dependencia; se reutilizan contratos, UUID locks, CAS y RPCs
del repositorio. Fuentes Unreal intactas y ningún asset nuevo.
