# A1b1 — aportes guardados y recuperables

2026-10-09 · backend opcional aislado, verificado localmente.

Un aporte aceptado guarda el débito de mochila, el crédito a la obra y su recibo dentro de una transacción PostgreSQL. Si se pierde la respuesta, el mismo UUID/request recupera el resultado sin cobrar de nuevo. El recibo y los estados sobreviven al cierre de PGlite y se recuperan desde un proceso Node nuevo.

## Cambios

- `server/migrations/community/001_contributions.sql`: personajes y proyectos delimitados por mundo/época, CAS, recibos terminales, locks de operación/recursos y RPC de servidor. Requisitos de obra e inicialización existentes no se sobrescriben. Tablas con RLS; `service_role` solo lee directamente.
- `server/community/supabaseContributionStore.mjs`: RPC acotados, comprobación de respuestas/cargas/recibos y error ambiguo de transporte. Recuperación mediante consulta o replay exacto, sin reintento automático.
- `server/community/contributionContract.mjs`: protege el perfil en el techo de 128 KiB cuando aumentar `tradeRev` añade un dígito. Se registra conflicto terminal y conserva mochila/proyecto.
- Fixtures SQL/SDK, fallos inyectados en dos puntos de escritura, recuperación en otro proceso y convivencia con el backend M5 existente.

## Verificación

**31/31 pruebas pertinentes**, sin fallos, canceladas ni omitidas: 17 del contrato A1a, 10 SQL/SDK, tres fronteras adicionales y una de convivencia SQL001–013. Conservación del perfil completo, remanente, replay histórico, denegaciones terminales, scope, inicialización, catálogo, validación directa, permisos, timeout y recuperación. La inyección al insertar el recibo demuestra rollback de ambas filas; retirar el fallo permite aceptar el mismo ID una vez.

```powershell
node --test --test-concurrency=1 tests/community-contribution.test.mjs tests/community-contribution-sql.test.mjs tests/community-contribution-boundaries.test.mjs tests/community-contribution-coexistence.test.mjs
node --check server/community/contributionContract.mjs
node --check server/community/supabaseContributionStore.mjs
```

Las llamadas concurrentes de PGlite son serializadas. El proceso nuevo se abre después de un cierre limpio: no demuestra failover, scheduling entre conexiones PostgreSQL reales ni corte eléctrico. La prueba de respuesta perdida sí ejecuta el commit antes de ocultar la respuesta y confirma recibo/replay sin segundo débito.

## Estado y continuación

Es un subcorte durable de A1b; **A1 y su recorrido jugable siguen abiertos**. Las tablas aisladas no importan ni reemplazan los perfiles actuales. No hay conexión con host/M5, tablero, artesano o aprendizaje; no cambia alpha.16/protocolo 32 ni costes finales, terreno, materiales, configuración o cupo. La migración opcional se aplicó exclusivamente en fixtures locales; Supabase live no se verificó.

Sigue **A1b2: autoridad de perfil y recuperación dentro de la sesión**. Necesita resolver cuenta/personaje por mundo/época, coordinar guardados ordinarios, reservar/fencear el inventario y recuperar confirmaciones sin publicar snapshots viejos. Después se conectan receptor/tablero de Carpintería, artesano, aprendizaje persistido y primera pieza nueva en la balsa.

El [brief](../briefs/a1b1-community-postgres.md) documenta la frontera con M5, el namespace independiente de operaciones, la limitación del conteo JSONB cerca del límite de bytes y la decisión de reutilización Unreal/runtime. No se produjo arte nuevo.
