# AREA15 — adopción explícita del mundo de recursos

Continúa el [dueño común GameHost](m5-ground-host-authority.md). Base final integrada `9266c40`,
alpha.34/protocolo 43; regresión inicial en `c9d3bbf`. SQL022 pertenece al combustible RNV04; esta entrega añade SQL023,
después de 001–022. Instalar SQL023 no adopta mundos ni activa features.

## Contrato aceptado de este corte

`mn_adopt_ground_world(operation_id, {world, expectedWorldVersion, worldData})` comprueba el
snapshot JSONB y versión exactos. Exige recursos válidos ya presentes. Crea el reloj inicial en
`worldData.resources.tick`, versión uno, con el UUID de adopción. No modifica el mundo, sus nodos,
cooldowns, ledger cooperativo, comunidad, economía o versión. No añade tiempo real de apagado.
El recibo inmutable permite recuperar una respuesta perdida y repetir exactamente el candidato,
incluso después de avanzar mundo/reloj. Un UUID nunca puede adoptar otro candidato o mundo.

Esta primera adopción exige cero filas `mn_pearl_locations`, `mn_death_drops` y
`mn_death_drop_states` del mundo, incluso ubicaciones de perlas en posesión y drops terminales.
Exige ausencia de reloj, transacciones/intenciones comunes previas y pendientes del diario legacy.
Los recibos económicos legacy válidos se conservan. Un dominio de suelo existente requiere su
propio manifiesto y mapeo de plazos; este RPC lo rechaza y no intenta convertirlo silenciosamente.

Las barreras SQL incluyen los escritores directos e intentos en vuelo sobre esas tablas. El RPC
tiene timeout de locks de cinco segundos: conflicto/deadlock deshace el intento entero. Debe
ejecutarse con el servidor anterior detenido; no es un mecanismo de transición en caliente.
Toda escritura en las tablas protegidas exige `READ COMMITTED`, incluso en mundos legacy: una
transacción con snapshot repetible anterior a la adopción podría no ver su marcador. El runtime
actual usa ese aislamiento por defecto; no se admiten writers con snapshot antiguo.

Después de adoptar, triggers persistentes rechazan cambios legacy de mundo/reloj/ubicaciones/
drops y el diario antiguo de perlas. Sólo `mn_commit_ground_transaction` puede autorizar las
escrituras de esas filas durante su llamada interna. La capacidad vive en una tabla privada
vinculada a la transacción, inaccesible al servicio, sin un GUC manipulable. Se elimina antes
de retornar; también se revierte si hay excepción. Los mundos sin marcador siguen su ruta actual.

`createSupabaseGroundWorldAdoption(client)` expone `ready()`, `load(world)` y
`adopt({operationId,request})`. Valida datos/recibos exactos, rechaza getters/proxies y limita
el tamaño. Ante transporte desconocido consulta el recibo y reintenta como máximo una vez el
mismo candidato; una respuesta malformada cerca la operación. No carga `.env`, elige mundo,
detiene servidores ni monta gameplay automáticamente.

## Límites operativos

El marcador cerca el dominio de mundo/suelo, no concede un lease exclusivo entre dos procesos
que usen ambos el sobre común. Tampoco migra escritores de perfiles sin mundo, agentes, bots,
perlas/muerte/botín en GameHost ni el resto del editor de construcción. La API común anterior
conserva sus gates accounts-only/cero bots. No adoptar el mundo de amigos mientras siga el
runtime normal: sus próximos guardados serían rechazados y aún falta el montaje completo.

Siguiente: componer perlas/muerte/botín bajo el mismo dueño y preparar una transición detenida,
con exclusión operativa del updater/writer anterior, recuperación y canario autenticado real.
La aceptación local no activa ese camino en el VPS.

Reutilización: SQL013/018/019, GameHost y los fixtures SDK/PGlite existentes. El candidato
Unreal `InventorySystem/SaveSystem/BP_JigServerSave.uasset` (580.554 bytes, fuente verificada)
sirve de referencia de guardado; Blueprint no ejecuta una autoridad JS/PostgreSQL. Inventario
existente en [CANDIDATES.csv](../research/unreal-assets/CANDIDATES.csv); no se crea arte ni se
modifican fuentes Unreal, UI, snapshots o protocolo.
