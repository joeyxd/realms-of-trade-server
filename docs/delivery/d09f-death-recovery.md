# D09f-2b.22 — recuperación de muerte completa

La muerte completa ya puede guardar una intención exacta, compartir reservas con perlas y recuperarse tras respuestas perdidas/reinicio. Es un coordinador server-only; el host de la partida continúa usando su ruta actual. Base a762dac. [Contrato](../briefs/m5-death-recovery.md).

## Resultado

ProfileSessions expone commitDeath(concrete, reservation), reconcileDeath y resumeDeath. La familia death se integra en el journal/PearlQueue existentes y en recoverPearls: UUID, cuentas de víctima/PK y todos los UIDs anteriores/posteriores están reservados antes del primer await. Incluye las perlas conservadas por el atacante. El capability común del caller sobrevive al cierre del recibo/journal hasta apply o fence.

No existe builder de muerte ni recaptura en recovery. La versión y el perfil anterior completos deben coincidir después de esperar guardados previos. El caller tiene que asentar progreso bajo reserva antes del capture; una EXP/bolsa/PK/progreso distinto después del capture produce conflicto. Solo un snapshot tardío idéntico al baseline puede cambiarse por el post-state exacto. Confirmación SQL y fallo local dejan storage intacto y exigen reconstrucción de autoridad.

Prepare persiste request/scope/UUID antes del commit. Startup pagina/valida todo el backlog antes de instalar reservas y solo lee. Resume explícito reenvía la misma solicitud después de una lectura autoritativa de recibo null. Recibo histórico + lecturas actuales completas distinguen committed, conflict o pending; ni ausencia de respuesta ni provider error demuestran rollback. Una respuesta terminal perdida conserva el audit committed ya escrito incluso si el estado después avanzó.

SQL010 amplía la validación y el guard de namespace, conservando las reglas 003/004/008 y completion/drops de 009. Solo el intent death pendiente e idéntico puede acompañar su recibo nuevo. Legacy receipts/journal ajeno, inserts y updates de UUID se rechazan en ambos sentidos. No añade tablas; acceso exclusivamente service_role. Memoria ligada al store reproduce el namespace. SQL001–009 no fueron editadas.

## Verificación

**1286/1286** pruebas, cero fail/cancelled/skipped/todo, en **102 archivos y 342 fuentes fijas**. Base a762dac + 14 overlays propios; todos los hashes SHA256/LF antes/después de cada cohorte y los overlays actuales coinciden. 59 checks nuevos sobre 1227 previos. Node v24.14.0. Duración total **134.554,2767 ms**: red 2/2 en 6.561,6913 ms (concurrencia 1), núcleo 1284/1284 en 127.992,5854 ms (concurrencia 2). Salida normal de Node, sin force-exit. No equivale a aceptación del checkout compartido completo.

Casos nuevos: muerte exterior/Cala con cero/nueve perlas y botín/PK; payload separado; progreso anterior/tardío de ambos endpoints; token incompleto; UID del atacante conservado; exact retry; prepare/commit/terminal perdidos; provider corrupto/no disponible; avance de perfil/generación; resume stale sin recalcular pérdidas; close durante prepare y fence sticky. Tres procesos nuevos con PGlite persistido en disco prueban lost prepare → resume → startup sin duplicar EXP, bolsa, perlas o drops. Inserts/updates directos de servicio y roles anon/authenticated cubiertos. Migraciones 001–010 y reapply010 ejecutadas localmente por SDK Supabase.

- shots/review/m5-death-recovery-network-accepted.log: SHA256 a55e8b24f28e1f5cb398fef1c91665e9bb3a12c3f40998e8410a244b7c84699c.
- shots/review/m5-death-recovery-core-accepted.log: SHA256 0e7d64bdb031ba41c3e423ff12a6e42b6d6211540497059a55fb1c5c026b7454.

La copia fija usa protocolo 19 de la base aceptada, frente a cambios paralelos de protocolo 21 en el checkout compartido. Ese trabajo paralelo no se acepta por este resultado. Solo 14 archivos runtime/test se superponen a la base; ningún env se copia o lee. Three 0.160.0 tiene 954 archivos copiados y reverificados con SHA256; PGlite 0.5.8 y SDK Supabase 2.117.2 por versión. El resto de node_modules enlazado no tiene hash completo.

Durante preparación se corrigieron: sustitución literal del generador SQL que duplicaba un RETURN; acceso a NEW.family desde triggers de tablas sin esa columna (42703); dos expectativas de test que usaban una operación single-UID inválida o esperaban excepción donde el SDK devuelve ok:false. No se relajaron las reglas de pérdida/rollback. La ejecución dirigida anterior pasó 207/207 en 49.068,9339 ms, pero quedó superada al añadir un caso raw-SQL y colisión inversa; su log está retenido y no es la aceptación de los bytes finales.

## Revisión y reutilización

AGENTS pide delegación GPT-6 Luna: death_queue_review escribió solo death-journal-sql.test.mjs y revisó SQL010/cola/reservas. Detectó el fallo inicial de generación SQL; el principal corrigió, revisó expectativas y código y ejecutó la aceptación independiente. La revisión final no encontró otro blocker y no ejecutó tests. Decisiones/arquitectura, integración y aceptación son del principal.

CANDIDATES.csv/FINDINGS e inventarios Unreal cruzados; candidatos concretos BP_JigServerSave (580.554 B) y BP_InventoryComponent (24.878.603 B) reverificados por stat en ActionRPGMultiplayerStart. Blueprints no ejecutables en Node/CAS. Se reutilizan journal, cola/gate, DTO de muerte, captureDeathPlan y saneado; fuentes Unreal intactas y sin assets nuevos.

## Estado real y siguiente corte

El autor confirmó el 2026-10-07 que SQL009 corrió sin error. No hicimos canario Supabase real ni leímos credenciales. **Aplicar [SQL010](../../server/migrations/010_death_journal.sql) después de 001–009**; su aceptación aquí es PostgreSQL local. No hay push/deploy/reinicio ni cambio de protocolo o configuración.

Faltan staging/captura bajo reserva, apply síncrono en tick, eventos/snapshot, respawn y guards de recycle/close; luego lifecycle durable del botín ordinario (hidratación, pickup/consumo/expiry). listDeathDrops aún lista creación histórica, no suelo actual recogible. Afinidad permanente del jugador, epoch/reloj/políticas definitivas, leases y finalizador siguen abiertos. Sigue la regla de perla ligada hasta morir y el 10 % de EXP provisional, conservando nivel/oro/maestría; este corte no decide balance ni activa muerte durable en gameplay.

Se mantuvieron fuera del commit los cambios navales/visuales/chat/LLM ajenos. Durante el corte otros agentes actualizaron DESIGN, PLAN-DELIVERY, PLAN-EXTRA-LLM, HANDOFF y NAVAL-ROADMAP; no se escribieron esos archivos. El commit solo incluye paths propios y se verifica la huella ajena inmediatamente antes/después.
