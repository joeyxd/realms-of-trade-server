# AREA15 — tragar una perla con el recibo común

Contrato previo a implementación, 2026-10-13. Continúa [M5](../../PLAN-M5.md),
[give común](m5-ground-pearl-give.md), [swallow aislado](m5-pearl-swallow-staging.md)
y la [decisión de perla ligada hasta morir](m5-pearl-release-staging.md).

Estado: **código publicado y aceptado localmente bajo montaje común explícito; piloto público apagado**.
[Entrega y evidencia](../delivery/m5-ground-pearl-swallow.md).

Una cuenta autenticada puede tragar un UID de `pearls.bag` solamente si su ranura
tragada está vacía y cumple la calma actual. Conservar el helper `swallowPearl`
y los cuatro poderes existentes. No reemplazar, escupir, transferir afinidad,
crear drops o modificar balance. La muerte mantiene su contrato independiente.

El socket admite únicamente `t,type,op,uid`. La autoridad deriva sesión/cuenta,
kind, generación y versiones; rechaza campos de reemplazo, perfiles, holder,
UUID o versiones del cliente. Reserva cuenta y todos los UIDs capturados antes
del primer await. Asienta progreso ECS y autosaves anteriores dentro de esa
reserva; luego contrasta el UID actual y su ubicación bajo el mismo dueño M5.
La ubicación previa puede faltar para un UID legacy registrado, pero si existe
debe ser del mundo actual, sin suelo y con la misma generación.

Reutilizar familia `ground`: `from=to=cuenta`, `ground:null`, un perfil CAS,
SQL006/018/019 y el diario exacto. Perfil, generación, tombstone, mundo y reloj
se confirman juntos. No se necesita migración, protocolo ni flag nuevo.
Preparar no altera perfil, poder ECS, ledger, eventos ni inputs vivos.

Apply síncrono tras recibo, bajo el límite de tick común: revalidar baseline,
sesión, callbacks, perfil, todo ECS/ledger/drop/RNG y contenedores. Instalar
bolsa→tragada y metadatos confirmados con el efecto compartido de stats, cooldown
y agua. Limpiar buffers de acción y comandos ya recibidos con
`preparePearlInputs`, conservando movimiento, secuencia y acciones de un input
nuevo posterior. Un solo `pearlChanged(swallow)`; ninguna publicación antes de
commit/drain. Fallo local restaura perfil/ECS/inputs/eventos/sesión y cerca el
host; no revierte SQL. Cierre, desconexión, muerte, reciclaje o deriva impiden
aplicar sobre otra identidad.

Recuperación reenvía la misma intención/UUID y carga filas actuales. Al reingresar
se deriva el poder del perfil tragado actual; no ejecutar el callback ni repetir
eventos históricos. Los recibos de reemplazo antiguos siguen legibles, pero no
habilitan comandos nuevos. El montaje común público continúa apagado: siguen
composición GM/compañeros/control/bots/antorchas, adopción detenida y canario VPS.

Aceptación: planner separado y cuatro poderes; auth/propiedad/ranura/calma;
autosave y límites de versión antes de IO; reserva, commit retenido, reintento
exacto y conflicto; filtrado de inputs; rollback y pérdida de identidad/hooks;
dos SIGKILL de proceso después de preparar journal y después de SQL antes de
apply, PGlite reabierto sin migraciones, un holder/copia/generación/perfil/recibo
y reentrada con poder actual sin eventos históricos. Regresión pertinente de
give/leave/mint/muerte, SQL común y efectos/input existentes; conteos separados.

Reutilización: simulación/efecto/input, GroundHostAuthority, ProfileSessions y
recibos existentes. [ActionRPG](../research/unreal-assets/actionrpg/FINDINGS.md)
documenta `BP_InventoryComponent`/`BP_JigServerSave`: Blueprint sin runtime
Node/Postgres ni ahorro de CAS portable demostrado. Sin arte nuevo, fuentes
Unreal intactas. Stat directo del 2026-10-13 conserva los candidatos de 24.878.603 B
y 580.554 B respectivamente. Este corte del servidor conserva UI/snapshots existentes.
