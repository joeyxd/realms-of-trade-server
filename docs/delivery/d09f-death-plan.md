# D09f-2b.20 — preparación completa de muerte

Base `5b6fd1c48f6b024d2b7f1c65cb1989ca267cdfba`. [Contrato](../briefs/m5-death-plan.md).

## Resultado

La preparación de una muerte reúne las pérdidas y el botín en un solo resultado congelado. Usa los
helpers reales del juego sobre perfiles/ECS separados: EXP actual, bolsa/perlas, equipo/pociones de
Cala, contador de muertes y PK del atacante cuando corresponde. Mantiene nivel, oro, maestría,
tatuajes y economía; no implementa afinidad nueva. Captura progreso ECS actual de ambas cuentas.

El mundo vivo permanece intacto: perfil/ECS, ledger, eventos, dirty, RNG y allocator de drops.
La geometría proviene de un RNG separado y de las lecturas reales de terreno/cubierta/checkpoint;
los IDs del resultado son ordinales temporales, incluso cuando el mismo número existe ya en vivo.
No es un recibo, ni reserva la autoridad, ni licencia para aplicar o rebobinar el RNG.

`killPlayer` se comparte ahora como helper exportado y rechaza una segunda muerte o entidad retirada.
La captura exige un jugador de servidor todavía vivo; rechaza getters/selectores desconocidos,
perfiles/progreso inválidos, propiedad local contradictoria y UIDs huérfanos del titular. No invoca
callbacks custom del mundo, no publica y no realiza IO.

## Verificación

**1166/1166**, 93 archivos y **324 fuentes SHA256 LF**: red 2/2 serial y resto 1164/1164 con
concurrencia 2, sin fail/cancelled/skipped/todo. Duración total 72.740,3254 ms. Mismos tres overlays
y fuentes antes/después de ambas cohortes; resto coincide con el artefacto aceptado anterior.
[JSON de evidencia](d09f-death-plan-evidence.json).
Dirigida: **57/57**, cinco archivos, 20.681,4 ms. Una aserción adicional de captura dead/retired se
incorpora después a la regresión completa. Node v24.14.0, concurrencia 2, archivo Git fijo con tres
overlays propios; fuentes ajenas de naval/chat/arte excluidas.

Quince casos nuevos cubren muerte exterior/Cala, botín sin perlas y perfil sin bolsa, RNG congelado,
IDs ajenos, serialización/freeze sin alias, guardas de actor/perfil/ledger y muerte repetida. Comparación
exacta con `killPlayer` real para perfiles, drops, ledger, eventos decorados, fila numérica y RNG final.
Incluye progreso atrasado del atacante, agua hacia checkpoint, cubierta y fallo de consulta de terreno
sin mutación viva. La regresión anterior mantiene los cuatro elementos, fracciones/cero de XP y SAVE real.

La primera regresión paralela falló en la medida RTT (363 ms fuera de 80–160) y dejó abierto el
worker de red. Se retuvo el log y se terminó únicamente ese árbol de ensayo. La misma prueba pasó
separada sin relajar aserciones. Un intento con salida forzada añadió dos crashes de cierre de Node
Windows, aunque las aserciones habían pasado; se retiró ese flag y se repitió con cierre normal.
El síntoma coincide con [reportes primarios de Node sobre salida y handles en Windows](https://github.com/nodejs/node/issues/58091);
la causa exacta no se auditó. La aceptación final separa únicamente la red temporal y conserva todos
los casos. Logs rechazados retenidos; no se cuenta ninguno como aceptación. Protocolo 19 del archivo
base; cambios paralelos de protocolo 21 excluidos.

La revisión GPT-6 Luna detectó y se corrigieron dos fronteras: bit PLAYER del atacante y ledger huérfano.
Propuso capturar progreso actual del atacante; adoptado. Escribió las pruebas acotadas; el principal
revisó el código y la evidencia. Primeras dirigidas detectaron errores en expectativas de fixture
(evento spawn previo, PK +1 y orden de inserción de Map), corregidos antes de aceptar la paridad.

Unreal/FAB revisado antes de implementar: inventario/portabilidad y stat de BP_JigServerSave 580.554 B
y BP_InventoryComponent 24.878.603 B. Blueprint sin ejecución Node/CAS portable; se reutilizan muerte,
spill, syncProfile y draft ECS del juego. Fuentes Unreal intactas, sin assets nuevos. Cambio sin interfaz
visual nueva; no se atribuye una aceptación de juego completo, dispositivo físico o FPS.

## Continuidad y límites

**Todavía no hay transacción durable de muerte completa.** SQL007/008, store, cola y journal históricos
permanecen intactos: su batch solo cambia perlas. El siguiente corte debe confirmar juntos perfiles CAS,
perlas y suelo de objetos/pociones con identidad persistente por operación/ordinal, incluso con cero perlas.
Después necesita reserva previa al await, ciclo death/respawn, apply síncrono y recuperación actual tras
reinicio, sin repetir EXP, PK o eventos históricos. No conectar este plan directamente al batch antiguo.

La pérdida de EXP del 10 % sigue siendo provisional; no se decidió balance nuevo. Perla tragada ligada
hasta morir, sin escupir/reemplazar. Finalizador, epoch/políticas/leases y afinidad siguen pendientes.
Sin SQL nueva, env/secrets, Supabase real, hooks/activación del host, protocolo nuevo, push, deploy o
reinicio del servidor del PC. P4/P6 parciales; este corte no convierte la demo en persistencia completa.
