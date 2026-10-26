# A1b2b4 — diario conectado a las sesiones del personaje

2026-10-09. [Contrato](../briefs/a1b2b4-journal-sessions.md).

## Cambio

Las sesiones autenticadas opcionales del banco comunitario ya pueden guardar y aportar mediante
su diario. La barrera controla admisión, permisos de mutación, tokens y publicación; inicia
cerrada y bloquea el scope mientras exista una petición incierta. Sus tablas son distintas de M5
y permanecen aisladas; no crean una segunda mochila activa en la partida.

La activación es explícita al construir `BoundProfileSessions` con `operationStore`. El camino
sin esa opción conserva sus writers y API anteriores. Ambos stores deben usar la misma base
comunitaria. **Revisión posterior del autor:** M5 conserva la autoridad jugable; A1 no continúa
otro montaje de sesiones ni exige sustituirla por este controlador. Se preservan reglas/pruebas
útiles y se integran los aportes contra la misma mochila M5. [Frontera y aceptación](../briefs/a1-m5-authority-boundary.md).

```js
const sessions = new BoundProfileSessions(characterStore, {
  worldId, worldEpoch, resolveIdentity, operationStore,
});
await sessions.recoverWorld(); // Read-only; inspect recoveryView().ready before admission.
const opened = await sessions.open(clientId);
await sessions.save(clientId, opened.token, nextProfile);
sessions.drain(publishAtTick); // Synchronous and atomic; never an async callback.
```

El servidor genera el UUID de guardado. Aportes repetidos conservan el UUID/request/CAS original
y no descuentan dos veces. El diario prepara antes de confirmar, y la publicación recarga filas
actuales de personaje/proyecto, incluso si el recibo acredita una revisión antigua.

Una conexión cerrada o reemplazada no puede iniciar la siguiente fase después de un await.
Si prepare ya fue almacenado, conserva el pendiente y no despacha commit hasta una recuperación
explícita. Si commit ya salió, puede terminar; se oculta la respuesta tardía al cliente anterior.
El cierre incierto retiene la cuenta hasta que la evidencia exacta se reconcilia.

`recoverWorld()` no escribe por defecto. Su variante interna `{retry:true}` reintenta de forma
masiva con peticiones originales; no es una acción de jugador ni un reintento por sesión.
Después, `recover(clientId)` lee la operación exacta y vuelve a preparar estado actual para drain.
Evidencia ausente vuelve a cerrar la barrera y conserva el intent. Cerrar durante publicación
síncrona se difiere hasta terminarla; un publisher fallido no entrega un token nuevo.

## Verificación local

**34 casos nuevos y 165 pertinentes únicos pasaron**, sin fallos, cancelaciones ni skips.
No es la suite completa del juego. Evidencia y hashes en
[`a1b2b4-journal-sessions-evidence.json`](a1b2b4-journal-sessions-evidence.json).

- Regresión comunitaria anterior: **131/131**, 71,250 s, en sus quince archivos.
- Tras cerrar la última ventana de revocación: **73/73**, 18,054 s. Incluye 26 casos nuevos
  de sesión/límites y 47 anteriores afectados; estos últimos no se cuentan dos veces.
- SDK Supabase real/PostgreSQL local: **8/8 nuevos**, 13,870 s, con la versión final de la integración.

```powershell
$previous = @(rg --files tests -g 'community*.test.mjs' | Where-Object { $_ -notmatch 'community-journal-session' })
node --test --test-concurrency=1 @previous
node --test --test-concurrency=1 tests/community-operation-recovery.test.mjs tests/community-bound-sessions.test.mjs tests/community-bound-auth-sql.test.mjs tests/community-scoped-sessions.test.mjs tests/community-scoped-sessions-sql.test.mjs tests/community-journal-sessions.test.mjs tests/community-journal-session-boundaries.test.mjs
node --test --test-concurrency=1 tests/community-journal-sessions-sql.test.mjs
```

Casos principales: crear/vincular → abrir → guardar → drain → aportar → drain → cerrar → reabrir
PostgreSQL en disco y cargar el mismo personaje; respuesta perdida en prepare/commit; retry exacto;
rollback SQL inyectado al cerrar el diario; CAS terminal; replay sin writers ordinarios;
estado actual más nuevo que el recibo; preflight interrumpido por otra operación; admisión que
termina después de cerrarse la barrera; close/auth reemplazada en preflight, prepare y recarga;
evidencia ausente; UUID generado inválido; publisher async/throw y close reentrante.

PGlite serializa las consultas del fixture. La reapertura de disco es limpia, sin acreditar caída
abrupta, concurrencia entre conexiones PostgreSQL independientes o cuentas Auth/Supabase live.
Seis módulos pasan `node --check`; whitespace comprobado. No hay cambio visual para capturar.

## Estado y siguiente corte

Implementado y probado localmente. **No montado en GameHost ni activado en la partida**; no se
aplicó SQL live, leyó `.env`, reinició host ni cambió protocolo, versión, costes o arte.
La barrera pertenece a un propietario de proceso: no aporta lease ni failover distribuido.
El publisher conserva la responsabilidad de rollback atómico de sus propias escrituras.

Continuidad/M5 conserva admisión/cierre, autosave, mutaciones ordinarias, comercio/fabricación,
perlas y muerte, con una sola mochila. Esta línea deja de ampliar controladores de continuidad;
después de acordar su seam confirmado con M5 sigue receptor/tablero de Carpintería, artesano y aprendizaje.
La recuperación administrativa cerrada debe quedar interna; el host debe cerrar reservas al
revocar conexiones. No se anuncian todavía pueblos/recetas desbloqueados o persistencia jugable.

Cruce Unreal acotado registrado en el brief: banco y caja existentes son candidatos visuales,
sin lógica portable para esta integración. Fuentes intactas y sin assets nuevos.
