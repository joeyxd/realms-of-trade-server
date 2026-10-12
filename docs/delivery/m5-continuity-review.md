# AREA15 — revisión del plan y dependencias concurrentes

2026-10-12. Corte documental sobre `8fa8f58478310d9c39fa06e39bbabaf81a6ed9d3`.
Continúa la petición del autor de mantener AREA15 derivada de los planes mientras
otras áreas añaden features. No implementa give ni cambia gameplay/SQL/configuración.

Integra después el cambio concurrente `7b34381` sin alterar su runtime: ST01a añade
el laboratorio privado de Tromba, con guardado local por cuenta/servidor y JSON.
Su [entrega](st01a/DELIVERY.md) conserva aceptación local/publicación pendiente y
variantes compartidas sin implementar. La matriz lo añade al dominio de edición;
el taller UI futuro permanece diferido. Ese delta tampoco cambia `server/**`,
`src/sim/**`, `src/net/**`, `deploy/**` o migraciones. Su renderer/editor y versión
alpha.64 se conservan; no se atribuyen a AREA15 ni a la lectura VPS alpha.63 anterior.

## Resultado

- [Matriz de continuidad](../CONTINUITY-MATRIX.md): relaciona los planes de producto
  con operaciones, aceptación y huecos pendientes en doce dominios.
- [Brief de give](../briefs/m5-ground-pearl-give.md): siguiente corte gratuito, bag-only,
  dos cuentas/perfiles y UID bajo SQL004/018/019; aceptación de caída/reinicio definida.
- Mantiene la cola existente: give, swallow, candidato completo kill/cofre,
  composición de features activas, adopción detenida y canario autenticado VPS.
  Venta entre jugadores, afinidad, autonomía, custodia/zonas/backups conservan sus contratos propios.

La revisión de `63d2231..8fa8f58` incorpora cierres de GM04d, emparejamiento,
comidas/mochila y Bucanero. Cambia `src/client/companionPairing.js` y herramientas
de compañeros/QA, además de informes; no cambia `server/**`, `src/sim/**`,
`src/net/**`, `deploy/**` ni migraciones. Por ese delta no se repite ni se declara
verde la suite histórica de AREA15. Los fallos heredados y bases de sus entregas
se conservan.

Se contrastaron los contratos contra el código: `transferPearl` ya exige bolsa,
calma/distancia/capacidad; `GroundPearlLifecycle` aún cerca give. El staging
aislado anterior no acredita el montaje común. SQL018 acepta la familia ground
y SQL004 ya representa dos cuentas y `ground:null`; se reutilizará esa frontera.

Se verificaron también exclusiones concretas en `server/host.mjs`: piloto común
requiere cero bots y excluye control/comercio de agentes; emparejamiento excluye
`groundTransactions`; recursos GM/admisión rechazan la autoridad común. Son
trabajo de composición previo a activar, no una razón para retirar features
durables actuales o quitar guards sin pruebas.

## Observación actual del VPS, solo lectura

[Estado/imagen](m5-continuity-review/live-status.json) y
[dominio](m5-continuity-review/live-domain.json), 2026-10-12 15:47–15:48 UTC:

- Revisión activa `8fa8f58478310d9c39fa06e39bbabaf81a6ed9d3`,
  alpha.63, imagen `sha256:989f480a32688d54d8e3527c6e72c0c4e13307fe544dcc4e147f9e4c21910cab`.
- Contenedor saludable; timer activo, updater inactivo. Cero jugadores/sockets,
  errores y escrituras pendientes. Supabase durable/cuentas, tres bots.
- Recursos/Tala, fuego, agua/cantimplora/comidas, artesano/taller, atributos,
  creación/emparejamiento de compañeros habilitados/listos según status.
- `groundTransactions`, `groundPearls`, `groundDeaths`, `groundPearlMints` nulos;
  reloj común ausente y tablas de suelo/intenciones consultadas vacías.
  SQL023 readiness 1; recursos v3, tick 9399091 en la lectura del dominio.

Las dos lecturas no son una transacción conjunta: el mundo pasó de versión 4358
en status a 4359 en el dominio. No se utiliza esa diferencia como conflicto ni
como prueba de adopción. El readiness informa disponibilidad, no aceptación de
un flujo. Esta observación no hace transferencia, QA autenticado, reinicio,
admisión GM, adopción, migración ni activación.

Verificación de este corte: revisión independiente de fuentes, [enlaces locales
válidos y HTTP público health/status 200](m5-continuity-review/review.json),
codificación UTF-8/LF y `git diff --check`. Runtime sin cambios. No se
añaden tests de runtime a un cambio documental. Las aceptaciones de recursos,
comidas, compañeros y editor siguen enlazadas en sus entregas, con bases y límites propios.
