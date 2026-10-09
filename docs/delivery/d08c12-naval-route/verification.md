# D08c.12 — verificación y artefacto local

2026-10-08, alpha.12/protocolo 27. **15/15 pruebas nuevas**, **371 casos previos seleccionados** y
**9/9 de host aislado** verificados: 395 casos únicos, sin sumar repeticiones. Navegador 3/3,
capturas finales inspeccionadas por root y cero errores/overflow en esas pasadas; [detalle](README.md).

- [Selección de regresión](regression-selected-files.json), [primer pase seleccionado](regression-selected.log):
  386 casos, 385 pasan y uno falla preparando el quinto capitán. `NavalPilot` admite cuatro montajes;
  no se podía montar cinco para probar el límite independiente de rutas. Se corrigió exclusivamente
  la fixture: cuatro capitanes reales y contexto confiable simulado para el quinto jugador conectado.
  Los 371 casos previos pasaron. No se cambió el límite del producto.
- [Pase final focal](route-final.log): 15/15. Incluye los nueve casos de autoridad con fixture corregida,
  cinco de UI y un recorrido por `SHIP_INPUT` real que nunca recoloca el casco. La colocación inicial
  del personaje en su timón es la única fixture de ese recorrido. Las pruebas de estado/salvas usan
  recolocación declarada; el límite de ruta usa el contexto sintético descrito arriba.
- [Host aislado](host-isolated.log): 9/9, launcher PC, guardado/conflictos, salud HTTP, arranque y cierre.
  Los casos que antes fallaron por EPERM/timeout pasan sin modificar su implementación o sus tests.
- [Primer pase amplio](regression-first-pass.log): 649 casos, 646 pasan, uno falla por bloqueo Windows
  al eliminar la carpeta del launcher y dos se cancelan por timeout del host. Se conserva como fallo,
  no como aceptación. [El segundo intento amplio](regression-final.log) fue interrumpido por root
  durante una espera SQL extremadamente lenta para liberar la máquina; su nombre no acredita un pase final.
  Solo se detuvo el árbol de procesos de ese runner propio; el resto del trabajo compartido se conservó.

`git diff --check` focal y ocho comprobaciones `node --check` pasan. La simulación nueva usa ticks,
sin reloj ni `Math.random`. No se aplicó SQL, no se activó persistencia M5 nueva ni se publicó el juego.

[Artefacto](artifact.html), [lista de archivos](build.log), [metadatos](artifact-metadata.json): página
de 162344 bytes, SHA-256 `978d50fc6ada9854bb96517dc416f9da0b62f7470deac2ca55c8e3b0eeb2df94`,
283 archivos acompañantes, incluidos los tres módulos nuevos de ruta. Es un artefacto de varios
archivos desde el checkout compartido actual, con otros cambios concurrentes; no es bundle autónomo,
release aislado, commit/push o despliegue. `published: false`.
