# D07d — M5 P3, mundo económico persistente

Base: `f0b74a7`, `0.6.0-alpha.1`, protocolo 13. Corte autorizado al continuar M5 después del acceso D07c.

## Dueños y límites

- Principal: contrato, `server/worldState.mjs`, `server/host.mjs`, `server/index.mjs`,
  `src/sim/economy/economy.js`, integración y aceptación. Documentación compartida solo en hunks de M5.
- Luna `m5_world_contract_review`: lectura/revisión del contrato; sin escrituras ni navegador.
- Luna `m5_world_tests`: `tests/world-state.test.mjs` y `tests/world-host.test.mjs`; pruebas de estado/lifecycle
  con memoria y HTTP local aislado. Ningún worker modifica los entrypoints.
- Trabajo ajeno reservado: balsas/materiales/render/assets, manifiesto, herramientas de importación/release,
  host del PC, paquete/scripts, reglas generales y planes M6. No reiniciar servidores del otro trabajo.

## Entrega

Cargar la economía antes de escuchar o simular, guardar cada 60 s y al cerrar. Persistir reloj, acumulador,
RNG, mercados y solares con snapshot aislado y CAS serializado. Mantener la función de cobro de mantenimiento
del host. Memoria verifica el mismo contrato; Supabase usa las RPCs existentes de 001, sin nueva migración.

Un registro ausente crea el mundo antes de admitir jugadores. Un registro incompatible o un error de carga
impide arrancar; no sustituirlo por un mundo vacío. Conflicto/error de guardado detiene la autoridad de ese
mundo y sus admisiones, deja health no disponible y comunica fallo de cierre sin sobrescribir otro estado.
`WORLD_ID` identifica el mundo; solo un proceso por ID hasta leases P5. No avanzar el reloj durante el apagado.

## Aceptación

- Reiniciar conserva reloj/mercados/solar y la siguiente evolución determinista; hora cero válida.
- No escuchar ni arrancar ticks hasta completar carga/creación; fallo o seed/formato distintos no guardan encima.
- Autosave y cierre serializados/coalescidos, sin referencias mutables atravesando awaits ni escrituras paralelas.
- Fallo CAS/proveedor impide nuevos jugadores/ticks; el estado más reciente de la base prevalece.
- Pruebas de host/SQL/perfiles y regresión económica pertinentes; probe real solo con un WORLD_ID temporal aislado.

P3 guarda el estado económico del mundo, no el ECS completo. No añade navegación, nuevos solares/UI,
progresión durante downtime, cobro a perfiles offline, leases multiproceso ni transacciones entre perfil/mundo
(P6). No activa riesgo público persistente ni despliega.
