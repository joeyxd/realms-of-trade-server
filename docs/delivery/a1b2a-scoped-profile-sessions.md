# A1b2a — guardados y aportes sobre una autoridad delimitada

2026-10-09. Implementado y verificado localmente; subcorte de A1b2, todavía sin montaje en partida. [Contrato y límites](../briefs/a1b2a-scoped-profile-sessions.md).

## Cambio

El guardado ordinario y el aporte comunitario comparten fila, lock y CAS del personaje por mundo/época. Si aportar consume madera y avanza la revisión, un autosave capturado antes pierde sin devolver esa madera. La nueva sesión exige token de captura actual, retiene cuenta/personaje durante writes inciertos y publica solo desde `drain` síncrono. Consulta el estado actual antes de preparar publicación; un recibo antiguo reconoce el aporte sin restaurar su mochila histórica.

Migración opcional comunitaria 002, métodos de store/SDK, controlador de sesión y pruebas. Conserva SQL001–013 y migración comunitaria 001; alpha.16/protocolo 32, campos y costes actuales. No aplica SQL live, modifica `.env`, inicia/reinicia el juego ni cambia UI/terreno/arte.

## Evidencia

**62/62 pertinentes pasaron**, 0 fallos/cancelaciones/skips, 33,031 s. Comando de aceptación:

```powershell
node --test --test-concurrency=1 tests/community-contribution.test.mjs tests/community-contribution-sql.test.mjs tests/community-contribution-boundaries.test.mjs tests/community-contribution-coexistence.test.mjs tests/community-character-saves.test.mjs tests/community-scoped-sessions.test.mjs tests/community-scoped-sessions-sql.test.mjs
```

- 31 casos previos de contribución, rollback, proceso nuevo y convivencia conservados.
- 7 casos de guardado sobre la misma autoridad, CAS/alcance/revisión máxima, validación/ACLs y reaplicación.
- 18 casos de sesión: identidad confiable, admisión exclusiva, tokens atrasados, busy/drain, recuperación, cierre/carga tardíos, publicación reentrante y callback inválido.
- 6 casos SDK/SQL de sesión: respuestas perdidas de aporte/guardado, filas actuales más nuevas que el recibo, rollback con reintento exacto, reapertura de disco, UUID ajeno y carrera guardado/aporte.

No equivale a la regresión total del repositorio. El backend PostgreSQL local es PGlite con llamadas serializadas y transporte SDK de fixture; no es Supabase live o prueba de conexiones independientes. Sintaxis de los siete módulos/tests tocados y whitespace de la entrega comprobados.

## Continuidad

Este módulo tiene una sola autoridad **dentro de su circuito opcional**. No sustituye todavía el guardado M5 de GameHost: conectarlos ambos sin transición seguiría creando dos mochilas. Reservas/intenciones son de proceso; no se acredita crash recovery de un write pendiente, lease o publicación ECS real. El callback futuro debe ser síncrono/atómico; detectar un thenable no cancela su ejecución. Conflicto terminal de save/publicación exige cierre y admisión nueva.

Sigue A1b2b: identidad y admisión durables, transición de autoridad M5 y coordinación completa del host/lifecycle/recuperación; después receptor y tablero/artesano/aprendizaje. Inventario Unreal contrastado en el brief, sin nuevos assets.
