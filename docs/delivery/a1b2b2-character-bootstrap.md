# A1b2b2 — personaje inicial y propiedad en una transacción

2026-10-09. Implementación opcional de servidor sobre el vínculo A1b2b1; [contrato y límites](../briefs/a1b2b2-character-bootstrap.md).

## Cambio

Antes se podía preparar una fila y vincularla con dos llamadas independientes. El nuevo RPC crea
**personaje inicial y vínculo juntos**: si falla la inserción del vínculo, tampoco queda una mochila
huérfana. Si la cuenta ya tiene personaje en ese mundo/época, devuelve su fila actual. Una petición
repetida con otro UUID candidato o con el perfil inicial no reinicia materiales ni progreso.

`CharacterProvisioning` usa un contexto de cuenta verificada creado por el servidor. Su fábrica
por defecto parte de `newProfile`, con mochila de materiales vacía e identidad del personaje.
No importa guardados del navegador o M5. Una referencia autenticada reemplazada, incluso para la
misma cuenta, invalida la operación; la revocación observada queda fija aunque vuelva la referencia
anterior. El controlador solo prepara identidad; no admite gameplay ni publica un cuerpo.

Una respuesta perdida retiene la reserva local del intento. `recover` consulta primero la identidad
persistida; si falta evidencia, sigue pendiente. El reintento explícito usa el request congelado,
sin otro UUID ni otro perfil inicial. Cerrar una conexión no convierte un resultado incierto en
rechazo ni permite devolverle una admisión tardía.

## Archivos y compatibilidad

- `server/community/identityContract.mjs`: alcance, asignación y respuesta estrictos; reutiliza
  `characterBindingContract.mjs`, sin otro modelo de propiedad.
- `server/community/characterProvisioning.mjs`: creación y recuperación desde identidad confiable.
- `server/community/supabaseIdentityStore.mjs`: RPCs con timeout, respuesta validada y sin reintento automático.
- `memoryContributionStore.mjs`: las mismas operaciones sobre el mapa de vínculos existente.
- `server/migrations/community/004_character_bootstrap.sql`: aplicar opcionalmente después de
  comunitarias 001–003. Reutiliza tabla/FK/trigger/ACLs de 003; locks compatibles y RPCs de servicio
  con `search_path=''`. No modifica SQL001–013 de gameplay.

El corte concurrente A1b2b1 aporta vínculo inmutable y `BoundProfileSessions`. Aquí se reutilizan:
crear → admitir → guardar → aportar → publicar desde `drain` → cerrar → volver a cargar, todos
sobre la misma fila comunitaria. Eso **no sustituye todavía `ProfileSessions` M5 de GameHost**.

## Verificación local

**104 casos pertinentes únicos pasaron**, sin fallos/cancelaciones/skips. El agente principal ejecutó
cuatro grupos seriales; ocho casos de admisión se repitieron después de endurecer su revocación,
por lo que no se cuentan dos veces:

| Grupo | Resultado | Duración |
|---|---|---|
| Contribución en memoria, saves, scoped sessions, vínculos y admisión | 57/57 | 68,349 s |
| SQL de contribución, boundaries, convivencia y scoped sessions | 20/20 | 83,503 s |
| Bootstrap en memoria/SQL y admisión actual | 30/30 | 37,456 s |
| Contexto Auth/admisión SQL, ACLs y cierre dentro de publicación | 5/5 | 12,216 s |

Comandos reproducibles:

```powershell
node --test --test-concurrency=1 tests/community-contribution.test.mjs tests/community-character-saves.test.mjs tests/community-scoped-sessions.test.mjs tests/community-character-bindings.test.mjs tests/community-bound-sessions.test.mjs
node --test --test-concurrency=1 tests/community-contribution-sql.test.mjs tests/community-contribution-boundaries.test.mjs tests/community-contribution-coexistence.test.mjs tests/community-scoped-sessions-sql.test.mjs
node --test --test-concurrency=1 tests/community-identity.test.mjs tests/community-identity-sql.test.mjs tests/community-bound-sessions.test.mjs
node --test --test-concurrency=1 tests/community-bound-auth-sql.test.mjs
```

Los 22 casos nuevos de bootstrap cubren 15 de contrato/controlador en memoria y siete del
SDK/PostgreSQL local. Sintaxis de los módulos y whitespace comprobados. No es la suite total del repo.

Casos principales: cuenta inválida/reemplazada, mundo/época separados, candidato ocupado,
replay con fila actual, rollback inyectado, respuesta perdida, reintento exacto, cierre tardío,
creación con `newProfile` y reapertura limpia de disco tras guardar/aportar.

SDK Supabase real contra transporte de fixture y PostgreSQL local PGlite. Sus consultas se
serializan; la carrera de candidatos prueba conservación/unicidad, no scheduling de conexiones
PostgreSQL independientes. Las identidades autenticadas son fixtures confiables, no cuentas live.
Reapertura limpia no demuestra failover de un host con operaciones de gameplay aún pendientes.

No cambia UI y no requiere capturas. Los candidatos de arte Unreal y decisión de reutilización
quedan en el brief; no se exportaron assets ni modificaron fuentes.

## Continuidad

Conserva alpha.16/protocolo 32. Implementado y probado localmente: aún sin aplicar migraciones
live, montar en la partida o desplegar. Configuración privada intacta.

A1b2 sigue parcial. Próximo corte: diario/startup y transición a una sola autoridad de perfil en
el host, coordinando todas las mutaciones, perlas/muerte, autosave y publicación ECS. Después,
receptor y tablero de Carpintería de Salty Shore, artesano y primera receta aprendida utilizada
en la balsa. Este bootstrap no concede exclusividad de gameplay entre hosts ni desbloquea recetas.
