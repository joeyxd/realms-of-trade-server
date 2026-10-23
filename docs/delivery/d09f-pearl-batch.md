# D09f-2b.4 — muerte/reemplazo atómico de perlas en storage

2026-10-06. Base `4414665ed21cc12d8e23b2596fde67a6d32b8e5a`; conserva la extracción
del efecto ECS común y el trabajo naval de los otros commits. [Brief/contrato](../briefs/m5-pearl-batch.md).

## Resultado

`commitPearlBatch` y `loadPearlBatchOperation` disponibles en memoria y Supabase SDK;
[SQL007](../../server/migrations/007_pearl_batch.sql) nueva, sin editar 001–006 aplicadas.
Una transacción confirma la parte de perlas de muerte (todas, 1–9 UIDs) o reemplazo
confirmado (dos UIDs), junto al perfil CAS, cada ledger/ubicación y un recibo único.
No hay commits secuenciales por UID ni recibos 003/004 hijos. Preserva progreso externo
al inventario y orden de slots no afectados; rechaza adopción y cambios ajenos al delta.

Reintentar exactamente el UUID devuelve el recibo histórico, incluso después de progreso
posterior o de recoger una perla caída. Nunca revierte ese estado avanzado. Payload distinto
o UUID de otro recibo se rechaza; SQL007 también excluye los UUIDs del diario 005 existente.
READ COMMITTED, locks compatibles con 003/raw save,
guards de propiedad/ubicación y acceso de servicio conservados. Migración reaplicable.

## Verificación

**125/125 pruebas nuevas**: memoria, SDK con transporte SQL local y cuatro procesos Node
nuevos (prepare/recover en dos escenarios con PGlite persistido en disco). Lectura del recibo
desde un proceso nuevo sin enviar una mutación; replay posterior sin duplicar generaciones.
No representa reinicio de GameHost ni aplicación de efectos/eventos del juego.

- Muerte de una perla y de bolsa/tragada completas; los cuatro tipos; nueve UIDs con generaciones
  distintas tras reemplazo/recogida legítimos. Perfil avanza una vez, cada UID/ubicación una vez.
- CAS de cuenta y de un solo UID, holder/kind/world erróneos, metadatos/límites malformados,
  conjuntos incompletos/duplicados/extra y reordenación de bolsa restantes rechazados.
- Oro/XP/maestrías/quests y campos ajenos conservados. Prueba SQL directa conserva un campo
  futuro de afinidad en reemplazo y muerte; **el DTO actual no admite ese campo desconocido**.
  Esto prueba conservación de JSON SQL, no una afinidad implementada o visible en el cliente.
- Errores inyectados en perfil, último ledger, última ubicación y escritura final de recibo
  dejan las tablas iguales y el UUID disponible para retry. Recibo provisional también revierte.
- Denegación anon/authenticated, UUID compartido simétrico con 003/004/005, replay cambiado
  rechazado, respuesta SDK perdida y recibo malformado detectados. `since` conservado al quedarse
  con el dueño y eliminado al caer al suelo; no cambia UIDs restantes.

**481/481 regresión pertinente**, 26 archivos, cero fallos/canceladas/omitidas; hashes fijados en
[evidencia](d09f-pearl-batch-evidence.json), sobre archive de la
base más nueve archivos propios, dependencia local por junction, sin env ni red externa.
Log ignorado `shots/review/m5-pearl-batch-accept.log`. Revisión Luna de contrato/implementación,
comprobada por el principal; no se aceptó una conclusión sin pruebas propias.

## Alcance y siguiente

**007 pendiente de aplicar y verificar en Supabase real.** No hubo acceso a `.env`, cuentas,
jugadores o mundos existentes, SQL remoto, auth users, host/navegador/restart/despliegue.
No se editó sim, ECS común, LocalServer, cliente ni protocolo. No se atribuye aceptación visual.

Los nuevos métodos son una primitiva dormant de storage. Diario/cola/reservas de lote,
recuperación de intención sin recibo, staging/tick de muerte/reemplazo y hooks/restauración
siguen pendientes. La muerte completa también modifica equipo/oro/mundo fuera de este contrato.
Afinidad permanente está confirmada; defaults/saneado, crédito y escala de poder siguen abiertos.
P4/P6 permanecen parciales; carreras entre backends PostgreSQL independientes y leases no aceptados.

Reutilización: `BP_InventoryComponent`, `ServerSlotInfoArray`, `BP_JigServerSave` verificados en
ActionRPG de `C:\Unreal`, fuentes intactas. Paquetes Blueprint útiles como referencia, sin código
Node de transacción portable; se reutilizan DTO/guards/profile/SDK propios. Sin exportación/arte nuevo.

Siguiente corte: verificar 007 real y conectar lote al diario/cola con recuperación y reservas
completas; después staging de tick y hooks con único dueño de sim/host. No activar rutas parciales.
