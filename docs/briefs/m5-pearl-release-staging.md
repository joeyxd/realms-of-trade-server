# D09f-2b.19 — perla ligada y dejar desde bolsa durable

Decisión del autor del 2026-10-07: una perla tragada permanece hasta morir. No se permite escupirla
ni reemplazarla. La muerte quita EXP y lo llevado en la bolsa. Este contrato sustituye la propuesta
spit/leave de este corte y la creación de reemplazos de .7/.18; conserva recibos/recuperación históricos.

La simulación rechaza spit y cualquier swallow con una perla dentro, incluso una confirmación exacta
antigua. UI elimina escupir/confirmación de reemplazo, explica el compromiso y deshabilita tragar otra.
Staging rechaza nuevos spit/replace antes de IO/reserva; no elimina tablas, UIDs, journal ni recibos.
El dispatch existente sigue usando helpers autoritativos: no necesita un cliente actualizado para rechazar.

Continúa [las generaciones consultadas](m5-pearl-managed-request.md) con request de give/swallow/leave.
Leave retira exclusivamente una perla de la bolsa y conserva poder, maestría, stats y acciones pendientes.
El método trusted leave requiere expectedVersion; request solo admite action/uid/source, sin autoridad,
versión, perfil, destino, reloj ni UUID aportados por el caller. La fuente pública deberá derivarse de sesión.

Usa leavePearl real en perfil/ECS/drop/ledger/eventos separados: calma, scatter, terreno/cubierta y
checkpoint existentes, sin RNG. Congela posición/tiempos antes de IO; reserva cuenta/UID síncronamente,
consulta generación bajo esa reserva y captura progreso fresco como .18. SQL003/004 y diario005/008
confirman perfil, holder:null, ubicación y recibo exactos. No replanifica CAS ni adopta UIDs ausentes.

Solo drain síncrono asigna un ID libre y aplica perfil/drop/ledger/eventos juntos. Drops ajenos permanecen;
loot y ledger reciben el mismo ID local. Fallo antes de commit conserva el mundo; fallo tras SQL revierte
solo la tentativa local y mantiene fence. Reconstrucción con sesiones/mundo nuevos lee suelo actual
sin repetir eventos: misma instancia de backend, no prueba de reinicio real de proceso en este corte.

Muerte actual: killPlayer descuenta tuning.combat.deathXpLoss del XP del nivel actual (default provisional
0.1), sin bajar niveles. Spill retira bolsa de objetos y todas las perlas en cualquier zona; equipo y
pociones siguen cayendo solo en Cala, con arma inicial/oro protegidos. SyncProfile refleja XP/pociones
actuales para el guardado ordinario. Maestría/tatuajes no se descuentan ni viajan con las perlas.
10 % es una elección temporal ajustable hasta confirmación del autor; no aceptación de balance.

Aceptación: SQL001–008 local/memoria, helpers reales, reintento exacto, reconstrucción, CAS externo,
progreso/IO, geometría/checkpoint/cubierta/drop ajeno, lifecycle, rollback, host y comandos viejos.
Muerte con cuatro elementos, fracciones/XP cero, una sola penalización, pickup y perfil guardado/reingreso.
UI real en Chrome aislado: desktop 1280×1000 y móvil emulado 390×844, imágenes inspeccionadas, sin red externa.

Unreal/FAB: stat de BP_JigServerSave (580.554 B) y BP_InventoryComponent (24.878.603 B), en
ActionRPGMultiplayerStart/Content/ActionRPGStarterSystem/InventorySystem. Blueprints sin runtime Node/CAS
portable; se reutilizan helpers/gate/cola/diario/efectos existentes. [Portabilidad](../research/unreal-assets/PORTABILITY.md).
Fuentes intactas, sin assets nuevos.

Sigue conectar pickup/retorno/mint/venta y muerte como operación durable completa (perlas + EXP + bolsa +
equipo según zona). Este corte cambia reglas en la simulación/guardado actuales y agrega leave trusted;
no activa dispatch durable automático. SQL pearl-only no prueba atomicidad de la muerte completa.
Finalizador posterior al recibo, afinidad permanente por personaje/tipo, scope/reloj/adopción,
epoch/leases y publicación abiertos. Una autoridad por scope. Sin SQL/env/protocolo nuevo ni deploy.
