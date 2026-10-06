# D09d — cola de suelo y verificación real de 004 (M5 P4/P6)

Base `018a177`. El autor confirmó 004 aplicada. Principal conserva arquitectura, canarios, integración,
`server/pearlQueue.mjs`, `profileSessions.mjs`, `pearlGround.mjs` y documentación M5. Luna recibe un nuevo
archivo de tests y revisión de solo lectura. D06 mantiene LocalServer/cliente/sim/protocolo/editor y host.
Este corte no cambia SQL, variables, protocolo ni activa comandos del juego.

## Reutilización

Revisar el inventario/candidatos Unreal existente para esta necesidad de almacenamiento. El corte requiere
coordinar transacciones CAS Node/Postgres, recibos y reservas; reutilizar la cola D09b y DTOs/RPCs D09c.
Blueprints/UMG o assets de arte no sustituyen esas garantías ni aportan un recurso integrable a esta tarea.
No importar arte ni modificar fuentes Unreal. Registrar la comprobación concreta en el informe.

## Contrato

`ProfileSessions.commitPearlGround(meta, build)` y `reconcilePearlGround(operationId)` comparten reservas
de UID/UUID/cuentas con la familia antigua. Metadata: UUID, UID/kind, from/to, expectedVersion, world y ground.
Builder síncrono recibe copias `{id,version,data}` tras drenar guardados previos y devuelve `{id,data}`;
mint/relocación sin cuentas usa `() => []`. La autoridad futura elige precio, geometría y tiempos.

Validar fuente antes del builder: kind/generación/dueño del ledger, mundo/generación/ground coherente si existe
ubicación. Mint nuevo permite generación cero; nullholder histórico sin ubicación no se adopta. Movimiento
desde dueño 003 validado puede empezar a rastrear posición. El builder solo mueve ese UID y acredita oro
entero a origen cuando el destino es suelo, con los mismos límites D09b. Sin cambios de otros bienes/progreso.

Intento/solicitud separados y congelados; builder una vez, dos envíos idénticos como máximo. Replay o recibo
recuperado requieren leer perfiles, ledger **y ubicación** actuales antes de devolver el resultado. Recibo
ausente/malformado/diferente o lectura fallida mantiene reservas; reconcile solo lee y exige familia correcta.
Estado posterior confirmado rechaza el recibo histórico. No publicar posición ni modificar sim desde la cola.

Ground-only participa en tasks/flush aunque no tenga sesión. Su fallo de ejecución se contabiliza una vez;
el contador de errores de flush es persistente durante esa instancia, incluso tras reconciliar, como D09b.
Reservas/contexto siguen en memoria: el diario durable de intenciones/UUIDs tras restart es el siguiente corte.

## Aceptación

- Probe real RPC/RLS 004 con IDs aleatorios ausentes. Canario SDK mint/pickup/transfer/sale/relocate/replay,
  contención HTTP, fallo de mundo revierte perfil/ledger/ubicación/ambos recibos y guardias raw/003.
- Canario de cola real con CAS anterior, progreso buffer, respuestas perdidas, ubicación fallida y
  reconciliación de solo lectura. Datos temporales exactos limpiados y ausencia verificada.
- Pruebas locales nuevas de cola y regresión de cuentas/almacenamiento/perlas; archivo exclusivo por worker.
  Verificar también en árbol confirmado `018a177` con los cuatro archivos propios superpuestos para aislar D06.
- No consulta de jugadores existentes, host iniciado/reiniciado, publicación ni promesa de leases/solapamiento
  forzado de backends. Siguiente: diario durable, staging previo a efectos/acks y reloj/restauración/adopción.
