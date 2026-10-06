# D09f-2b.1 — bag→swallowed con un dueño y recibo durable

Base `0ec0b9d`, 2026-10-05. [Brief/reutilización](../briefs/m5-pearl-same-holder.md).
Extiende el contrato de storage/sesiones/diario, sin conectar gameplay. [Evidencia aislada](d09f-same-holder-evidence.json).

## Resultado

La familia `ground` admite `from === to !== null` exclusivamente para mover un UID gestionado de bag
a swallowed vacío. Usa **un** endpoint CAS; no reemplaza otra perla, no mueve otros UIDs ni cambia oro,
progreso, contenido u orden del resto de la mochila. DTO rechaza clamping/duplicados/shape inválido.
Storage comprueba dueño/kind/generación actuales y el delta completo contra el perfil CAS anterior.

```js
sessions.commitPearlGround({ operationId, uid, kind,
  from: accountId, to: accountId, expectedVersion,
  world: stableScope, ground: null }, (rows) => [{ id: accountId, data: after }], reservation)
```

Cuenta, UID/generación y UUID vienen de la autoridad del servidor. El ejemplo es interfaz interna;
storage no comprueba calma/rango/vida ni acepta comandos de cliente. El UUID queda en el request congelado.

SQL **006** amplía la función 004 y el validador de diario 005, conservando las otras ramas. Perfil,
generación de ledger, tombstone de ubicación y recibo ground se confirman en una transacción. Avanzan
una vez; dueño, kind, `since` y mundo se conservan. Para un UID 003 gestionado/held sin ubicación se crea
el tombstone held con ground=null en el scope estable; no registra ni adopta un UID desconocido.
No hay recibo hijo 003 para from=to. El lock de UUID y guards existentes mantienen exclusión entre familias.
006 es reaplicable; 003/004/005 originales no se editan y 003 sigue rechazando from=to.

`PearlQueue` usa cuentas únicas ordenadas en admisión, reserva, recuperación y release. El builder recibe
una sola fila tras drenar saves previos; los snapshots posteriores conservan progreso y reciben el delta
de slot una vez. Se reutiliza la reserva común con permiso opaco, prepare/resolve de diario, recibo exacto,
reintento congelado y comparación de perfil/ledger/ubicación actuales. Prepare y cierre de diario son
transacciones separadas del commit, como antes; un fallo ambiguo retiene autoridad hasta recuperar.

Un replay devuelve historia sin modificar el presente. Recover/read-only reconcile nunca aplica el efecto
al World ni publica eventos; resume explícito manda el request guardado solo tras recibo ausente confirmado.
Close durante prepare evita el primer RPC; un permiso gameplay invalidado sigue cercado tras ese cierre.
`saveProfile` ordinario conserva su contrato anterior de CAS/propiedad y sigue permitiendo layout sin recibo.
La garantía idempotente aquí corresponde a la operación gestionada, no a toda escritura service arbitraria.

## Evidencia y límites

**306/306** pruebas pertinentes, **80 nuevas**, 21 archivos de tests con concurrencia 2. Git archive de
base más catorce archivos propios de código/SQL/tests; dependencia local por junction, sin copiar env.
Las regresiones SQL de ground/diario ahora ejecutan también 006, además de tests específicos de memoria,
DTO, SDK/SQL, sesiones y procesos. Comando/hashes LF/counts están en el JSON; log completo ignorado.

- CAS de perfil/UID, conflicto de dueño/kind/world, delta exacto y orden, no-op/replacement rechazados,
  cuenta única, permisos internos y sesiones cerradas, guardados previos/posteriores y respuestas perdidas.
- Replay/collision 003↔ground, recibo ground sin hijo 003, UIDs gestionados históricos/tracked,
  `since` conservado y sin adopción de UID desconocido. Fallo de ubicación posterior a las escrituras
  revierte perfil/ledger/location/recibo íntegros; prepare del diario permanece pendiente aparte.
- RLS/funciones service-only, READ COMMITTED, versiones enteras/rango, reapplication y guards diferidos.
- **Seis procesos Node independientes** sobre dos bases PGlite de disco aisladas: commit antes de recovery
  se lee sin send; request preparado sin dispatch se retiene y resume exactamente una vez. Un tercer
  proceso en cada caso verifica terminal/versiones/oro/slot y cero nuevos sends. No es restart de GameHost
  ni prueba de concurrencia PostgreSQL de conexiones independientes/leases.

Revisión GPT-6 Luna de solo lectura, decisiones/evidencia aceptadas por principal. Sintaxis/diff comprobados.
Sin nueva prueba Supabase live, escritura a jugadores reales, cambios en env, host/reinicio o navegador.
No cambia versión/protocolo ni archivos de D08; no valida ni acepta el trabajo concurrente de su dueño.

## Aplicación y siguiente corte

**Aplicar [006_pearl_same_holder.sql](../../server/migrations/006_pearl_same_holder.sql) después de 005**.
La aplicación/verificación en Supabase está pendiente; no repetir las migraciones anteriores ni añadir env.
No activa gameplay al aplicarse: el host aún no usa staging/journal de perlas ni los hooks completos.

Próximo: staging de elegibilidad real y efecto ECS (`refreshStats`, cooldowns/agua) para swallow en tick,
lote atómico de varios UIDs death/reemplazo y [hooks completos](../briefs/m5-pearl-common-gate.md) con dueño
de sim/LocalServer. Luego hidratación/reinicio de World y decisiones de scope/reloj/adopción/invitados;
leases/naval aparte. Una reserva multi-UID o este CAS de un perfil no sustituyen ese lote. P4/P6 parciales.
