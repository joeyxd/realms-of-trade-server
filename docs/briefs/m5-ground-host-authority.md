# AREA15 — economía y checkpoints bajo el mismo reloj

Base integrada `6e6f421`, 2026-10-10. Continúa [SQL019](m5-ground-transaction-journal.md).

El siguiente montaje usa una sola frontera `beforeTick` de GameHost para confirmar economía,
recursos, Tala cooperativa, artesano/Bodega y checkpoints de mundo junto al reloj SQL018 y al
diario SQL019. La preparación SQL no publica gameplay: el resultado se aplica de forma síncrona
en la frontera del host antes de liberar la reserva o enviar ACK.

## Contrato

`new GameHost({ economicOperations: true, resourceOperations: true, groundTransactions: { journal },
bots: 0, store, worldId, resolvePlayer })` es una API de ensamblaje de confianza. La misma opción
está disponible en `createGameServer`. No tiene flag de entorno ni activación automática.
Los flags existentes de Tala y artesano siguen siendo necesarios para esas features.

- Exige storage durable, cuenta autenticada, mundo y reloj existentes, y ticks de recursos/reloj
  iguales. Startup resuelve intenciones pendientes antes de abrir WorldState y verifica su fila
  actual contra la sesión transaccional. No inicializa reloj ni adopta datos legacy.
- `GroundHostAuthority` posee el callback de tick, el epoch y la sesión SQL018/019. Recursos usa
  ese epoch: solamente los pasos de simulación avanzan el tiempo; nunca el apagado real.
- `EconomicAuthority` conserva construcción del candidato, reservas, validación de gameplay,
  beneficiarios cooperativos y aplicación existente. Cambia su commit por la familia `economic`
  del sobre común. Una lectura del recibo económico hijo no sustituye confirmación del sobre.
- WorldState conserva su cola/CAS y encamina cada escritura por la familia `checkpoint`; no
  escribe mundo y reloj por separado. Tick, comandos y admisión esperan la escritura y su drain.
- Durante cierre se detiene el pump, se esperan los trabajos y se drena sólo el checkpoint
  preparado o la operación económica ya confirmada con sus adaptadores existentes. Un resultado
  desconocido cerca la autoridad; el próximo startup recupera el diario, sin autosave obsoleto.
- El montaje rechaza bots, invitados, importación legacy, diario antiguo de perlas y control/trade
  de agentes. SQL017 conserva su camino y presupuesto atómicos en el runtime normal.
- El supervisor no toma este montaje como un fallo de autosave legacy; su startup debe recuperar
  el diario común con las verificaciones detenidas antes de admitir jugadores.

El runtime normal conserva sus opciones y escritores existentes. No combinar las dos modalidades
contra el mismo mundo. Preparar SQL019 no concede un lease entre procesos.

## Límites y siguiente entrega

Este corte monta economía/checkpoints en una opción explícita de GameHost; todavía no compone los
coordinadores de perlas, muerte y botín ni certifica su dominio legacy. No habilitar el mundo real
con un flag inventado o creando un reloj a cero. La adopción debe ligar el snapshot actual, el
reloj inicial y las filas de suelo en una transición auditable; después se conecta esa familia al
mismo dueño y se acepta el canario autenticado con reinicio/caída del VPS.

Reutilización: GameHost, WorldState, EconomicAuthority, GroundTransactionSession y SQL001–021.
El [inventario Unreal](../research/unreal-assets/CANDIDATES.csv) incluye `BP_InventoryComponent`
y `SM_Potion`, referencias de inventario/arte que no aportan una autoridad JS/PostgreSQL compatible. Este cambio no crea
arte ni modifica fuentes Unreal, UI, snapshots o protocolo.
