# A1b2b3 — peticiones durables y recuperación antes de admitir

2026-10-09. [Contrato y límites](../briefs/a1b2b3-operation-journal.md).

## Cambio

Los guardados y aportes opcionales pueden conservar ahora su petición exacta antes del commit.
El nuevo diario completa **mutación y resultado juntos**: repetir una operación terminada devuelve
su evidencia original, sin otro débito ni guardado. Si falla el cierre del diario, tampoco se
confirma el perfil/proyecto/recibo del aporte.

La migración opcional comunitaria 005 se aplica después de comunitarias 001–004; no es SQL005
legacy de perlas. Añade una tabla con un pendiente por personaje/mundo/época, índice de scan,
validación estricta, ACLs de servicio, inmutabilidad y cuatro RPCs. Reutiliza los locks/CAS de
guardado y aporte; protege el UUID de colisiones entre ambas familias y recibos previos.

`CommunityOperationRecovery` comienza cerrado y escanea todos los personajes del scope. Lecturas
fallidas, páginas inválidas, pendiente visible o prepare local incierto sin evidencia mantienen
su barrera cerrada. La recuperación normal solo lee. El reintento masivo explícito conserva
UUID y request, y cierra también los rechazos terminales. El coordinador exige persistencia
por defecto; la implementación en memoria se identifica como volátil y solo sirve para ensayos.

El coordinador no publica perfiles. Un recibo histórico no reemplaza una fila actual más nueva.
En el siguiente adaptador, las sesiones tendrán que recargar el estado actual y publicar desde
`drain` síncrono, conservando identidad y reservas hasta completar esa fase.

## Verificación local

La aceptación y hashes de los archivos están en
[`a1b2b3-operation-journal-evidence.json`](a1b2b3-operation-journal-evidence.json).

**131 casos pertinentes únicos pasaron**, incluidos **27 nuevos**, sin fallos/cancelaciones/skips.
Primera ejecución: 26/26 de contrato/memoria/controlador y SDK/PostgreSQL local (16,029 s).
Después se añadió un caso de rechazos terminales y se verificó su archivo 6/6 (5,609 s);
cinco de esos casos ya estaban en el primer grupo y no se cuentan dos veces. Comandos:

```powershell
node --test --test-concurrency=1 tests/community-operation-recovery.test.mjs tests/community-operation-sql.test.mjs tests/community-operation-startup-sql.test.mjs
node --test --test-concurrency=1 tests/community-operation-startup-sql.test.mjs
```

Regresión pertinente de los contratos anteriores: **104/104**, 50,913 s, ejecutada serialmente en
los doce archivos comunitarios previos. No es la suite total del juego. Ocho módulos pasan
`node --check`; whitespace de los archivos de misión comprobado. Comando de regresión:

```powershell
node --test --test-concurrency=1 tests/community-contribution.test.mjs tests/community-contribution-sql.test.mjs tests/community-contribution-boundaries.test.mjs tests/community-contribution-coexistence.test.mjs tests/community-character-saves.test.mjs tests/community-scoped-sessions.test.mjs tests/community-scoped-sessions-sql.test.mjs tests/community-character-bindings.test.mjs tests/community-bound-sessions.test.mjs tests/community-bound-auth-sql.test.mjs tests/community-identity.test.mjs tests/community-identity-sql.test.mjs
```

Casos nuevos principales: respuesta perdida antes/después del commit; petición original preservada
ante cambios del caller; reserva de personaje durante I/O; reconstrucción desde otro controlador;
rollback inyectado al cerrar guardado y aporte; reapply con filas presentes; pending tras cerrar y
reabrir PGlite; UUIDs entre familias; pertenencia/épocas; páginas múltiples; ACLs de anon,
authenticated y servicio; resultado/mirrors inválidos; argumentos NULL y números enteros `1.0`.

SDK Supabase real con transporte de fixture hacia PGlite. Sus consultas se serializan; no prueba
scheduling de conexiones PostgreSQL independientes, caída abrupta del proceso o cuentas Auth live.
La reapertura de disco es limpia. No cambia UI, por lo que no requiere capturas.

## Estado y continuidad

Implementado y verificado localmente; **sin aplicar SQL live, desplegar ni montar en la partida**.
Configuración privada intacta; alpha.16/protocolo 32 conservados. No se modificaron fuentes Unreal.

A1b2 permanece parcial. La barrera es de un propietario; no es un lease entre hosts ni un cierre
distribuido de admisión. Los writers ordinarios anteriores pueden adelantar la revisión y provocar
`conflict`; su coordinación no queda resuelta por añadir una tabla de intenciones.

Sigue A1b2b4: conectar diario/barrera con las sesiones autenticadas y su publicación actual,
sin permitir que un cierre/respuesta tardía reabra una conexión revocada. Después, transición
completa de una sola autoridad en GameHost/M5, con mutaciones de gameplay, perlas/muerte y autosave
coordinadas. Entonces receptor/tablero de Carpintería, artesano y aprendizaje para la balsa.
