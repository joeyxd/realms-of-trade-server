# PRG01b1 — aprendizaje conservado en el perfil

2026-10-10. Implementado y comprobado localmente. Publicación se registra separadamente al verificarla.

El saneado anterior descartaba un bloque de aprendizaje. Ahora los personajes nuevos incluyen progreso
vacío y los guardados conservan práctica, hitos y conocimientos válidos. Los perfiles históricos mantienen
su forma exacta: su ausencia representa cero sin alterar recibos inmutables. Corrupción o una versión
desconocida rechazan el perfil, evitando borrar progreso al intentar repararlo con defaults.

[Contrato y siguiente integración](../briefs/prg01b1-profile-continuity.md).

## Cambios

- [inventory](../../src/sim/systems/inventory.js): default de personaje nuevo, saneado estricto y default
  histórico diferido. Perfil exterior v1; muerte y combate conservan sus reglas.
- Se reutilizan [catálogo](../../src/data/progression.js) y [cálculo de Tala](../../src/sim/systems/progression.js).
  El handler de recursos todavía no concede práctica ni usa la reducción de intervalo.
- Dos suites nuevas de perfil/continuidad y fixture legacy explícita en la suite pura existente.
  No hay cambios de UI, assets, SQL, secretos o configuración por este corte.

## Verificación

**13 pruebas nuevas:** 8 de perfil y 5 de continuidad. Cubren firma y serialización, ausencia histórica,
datos inválidos/accesores, attach/sync/detach/reentrada y conservación durante el plan real de muerte.
Los lectores de recibos económico, de perlas y de muerte aceptan los perfiles históricos sin reescribirlos.

PostgreSQL/PGlite con SQL001–014 y adaptador Supabase: un recibo económico escrito sin `progression`
sigue siendo legible/repetible después de guardar práctica 60 en una fila más reciente. El replay conserva
el perfil actual y su versión. Un comando M5 posterior conserva también el bloque. Es SQL local, no Supabase live.

GameHost ejecuta una compra cotizada real, publica `PROFILE`, guarda, cierra/reabre con el mismo store de
memoria y repite la compra original sin duplicarla. Acredita integración y reentrada; memoria no durable,
sin proceso terminado ni prueba de crash. Los hitos de fixtures se siembran explícitamente, no se ganan jugando.

**Regresión seleccionada:** cálculo de Tala, saves, operaciones de perlas/batch, muerte, botín y economía.
**140/140** en total: 135/135 de las suites seleccionadas y 5/5 de continuidad GameHost/SQL.
Comandos ejecutados:

```sh
node --test tests/progression-logging.test.mjs tests/progression-profile.test.mjs tests/save.test.mjs tests/pearl-operations.test.mjs tests/pearl-batch.test.mjs tests/death-storage.test.mjs tests/death-drop-storage.test.mjs tests/economic-store.test.mjs
node --test tests/progression-continuity.test.mjs
```

**Preparación de publicación:** checkout aislado `codex/prg01b1-profile`, con los tres módulos de
perfil/cálculo, tres suites y documentación propia. Las 140 pruebas focales pasan también contra
el runtime remoto; además pasan **107/107** de las 14 suites que ejecuta el actualizador VPS.
No se incluyen cambios concurrentes de recursos, UI, SQL, secretos o configuración.
Se mantienen protocolo 32 de la rama publicada y 34 del checkout compartido, ambos revisados.
Sintaxis, whitespace y enlaces de documentación comprobados. Estado live se añade tras verificarlo.

## Frontera

PRG01b completo sigue pendiente: contribuyentes/ciclos en nodos, transacción M5 de varios perfiles,
reloj coordinado con AREA15, cadencia real, ficha ES/EN y recuperación alrededor del commit.
La propuesta antigua de golpes parciales tentativos debe sustituirse por el contrato durable de recursos
SQL015 al integrar. PRG01c enseñará bodega después; no hay una receta aprendida automáticamente aquí.

No hace falta aplicar SQL nuevo por la compatibilidad de este bloque. SQL015 y su activación pertenecen
al corte paralelo de recursos; este informe no acredita que estén publicadas ni aplicadas.
