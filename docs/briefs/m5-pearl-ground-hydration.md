# D09f-2b.8 — reconstrucción de perlas en suelo antes de admisión

2026-10-06. Continúa el reemplazo aceptado en `e3168db`. Dueño M5: gate, adaptador server-only,
pruebas/evidencia. Host, LocalServer, sim, entrypoints y trabajo naval/arte permanecen con sus dueños.

## Resultado buscado

Leer las ubicaciones gestionadas actuales de un mundo y preparar su ledger/drop local sin recrear
eventos históricos, acuñar UIDs, acreditar progreso ni repetir el reemplazo. Instalar únicamente
en una frontera síncrona antes de abrir sesiones o avanzar la simulación. Una Promise no muta World.

`PearlGroundHydration({sessions,world,worldId,mapClock,pageSize,maxRows})` requiere una función
síncrona explícita `mapClock(ground,{worldId,tick}) -> {availableAt,returnAt}`. Coordenadas confirmadas
se conservan. El adaptador no elige reloj offline, reubica terreno ni borra/devuelve filas vencidas.
La integración del host deberá decidir esa política y mantener la simulación detenida.

## Autoridad y fallos

La recuperación del diario precede `start()`. Diario configurado debe compartir el scope del mundo.
La barrera opaca común solo empieza con autoridad vacía: cero sesiones, tasks, reservas gameplay y
operaciones/UIDs pendientes. Bloquea admisión, commits y snapshots de todas las lanes antes del primer
await; cubrir solo UIDs conocidos permitiría operaciones detrás de un cursor todavía no leído.
Un pendiente sin recibo exige resolución explícita antes de continuar; no se descarta su reserva.

Validar todas las páginas ordenadas por UID y su límite; comparar cada unique holder:null/kind/generación
con ubicación/mundo/ground y repetir el scan completo. Cambios detectados, respuestas inválidas,
capacidad excedida o reloj inválido cercan startup sin instalar parcialmente. Esto protege la instancia
de autoridad, no proporciona snapshot SQL/lease entre hosts ni elimina carreras de escritores externos.
No sustituye las reglas de un host por mundo y los hooks completos pendientes.

`start()` prepara; `drain()` valida tick, identidad/contenido de maps, perfiles vacíos y contador.
Plan completo sin colisiones de UID/ID, IDs locales desde nextDrop, sin nombres/entidades históricas.
Conservar drops/ledger ajenos. Instalar juntos drop/ledger/counter, rollback de escrituras propias ante
fallo y mantener barrera cercada. Repetir drain exitoso no crea otros drops. No mutar DB, eventos,
RNG, perfiles, afinidad ni contadores de mint.

## Reutilización comprobada

Candidatos exactos leídos sin modificar en
`C:\Unreal\ActionRPGMultiplayerStart\Content\ActionRPGStarterSystem\InventorySystem`:
`Components\BP_InventoryComponent.uasset` (24,878,603 bytes),
`SaveSystem\BP_JigServerSave.uasset` (580,554 bytes). Son Blueprints sin autoridad Node/CAS portable.
Reutilizar listado/DTO SQL004, recuperación SQL008, gate, inventory/World y adaptadores SDK/PGlite propios.
Sin exportación ni arte nuevo.

## Aceptación y límite

Contrato idéntico memoria/SQL001–008: paginación, tombstones/otro mundo excluidos, generación y
propiedad, cambios de scan, slow IO, admisión/commits bloqueados, perfiles/maps/tick alterados,
reloj explícito, overflow, rollback y una sola instalación sin efectos históricos/RNG.
Proceso Node fresco debe reconstruir una imagen SQL exportada, suelo y permitir attach del perfil actual sin recuperar un UID
que ya no posee. Eso prueba reconstrucción de datos, no durabilidad del filesystem; la apertura NodeFS
local superó 45/120 s antes de invocar el adaptador. Regresión del gate/cola/staging vigente sobre archivo
aislado y hashes comprobados.

Adaptador dormant: no habilitar parcialmente el host ni reiniciar/publicar servicio. No SQL/env nueva.
Faltan hooks de comandos/efectos autónomos, muerte completa equipo/oro/mundo, política de scope/reloj,
adopción/invitados y leases. Afinidad permanente por personaje/tipo mantiene su contrato propio abierto.
