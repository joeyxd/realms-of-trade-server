# L03c — metas revisables desde feedback

Implementado y verificado como software local con modelos simulados. La mente puede revisar el
archivo real de objetivos dentro de la autoridad y presupuesto vigentes. El cuerpo continúa durante
la inferencia y una decisión posterior lee las metas recién guardadas. Proveedor real, calidad táctica
y el encuentro/aceptación humana acordados mantienen su evidencia pendiente. Sin publicación ni despliegue.

## Resultado

`AgentMind.reviseGoals()` comparte una consulta en curso y ledger con cuerpo/conversación, fija
feedback entregado y exige razón/referencias de procedencia. La respuesta solo elige metas o espera;
no cambia capacidades, rutas, scope, presupuesto ni órdenes del dueño. Objetivos `active`, `paused`
o `blocked` se pueden actualizar; `completed` solo se conserva sin cambios. ACK, swing parcial o
objetivo desaparecido no se convierten en una declaración nueva de cumplimiento.

`createObjectiveStore` conserva v1, incrementa una revisión, verifica hashes de los tres archivos,
autoridad/frescura/tarea y usa lock cooperativo, temporal exclusivo y rename atómico. Solo cambia
`objectives.json`. Conflictos y prioridades del dueño rechazan el commit. Un resultado ambiguo
bloquea nuevas revisiones; un recibo tardío conocido sigue visible después de cancelación.

La CLI habilita escritura únicamente con `--mind simulated --mind-goals`; `revise_goals` genera
el turno y `files` muestra el archivo actualizado. Su política es una fixture de salud confirmada,
no un modelo que demuestre comprensión táctica. El contrato completo y sus límites están en
[goals-runner](../agents/goals-runner.md); diseño/reutilización en el [brief](../briefs/l03c-agent-goals.md).

## Verificación local

La captura raíz ejecuta todas las suites de agentes y la regresión de host/cuentas/naval/chat/combate.
Sus conteos, comandos, tiempos y hashes antes/después están en el
[manifiesto](l03c-agent-goals-verification.json), [agentes](l03c-agent-goals/agents-tests.json),
[TAP de agentes](l03c-agent-goals/agents-tests.tap), [regresión](l03c-agent-goals/regression-tests.json)
y [TAP de regresión](l03c-agent-goals/regression-tests.tap). Dos pruebas de symlink se omiten
porque Windows devuelve `EPERM`; las demás pruebas de tipo/ruta/hash/temporal se ejecutan.

Captura final: **521 aprobadas / 2 omitidas**: 315 de agentes y 206 de regresión. Hay 50 casos nuevos
en cuatro archivos (49 aprobados / 1 symlink omitido). No hubo cambios en las dependencias durante
las suites aceptadas; el manifiesto también comprueba los hashes vigentes después de las pruebas.

Las cuatro suites nuevas comprueban propuesta y campos estrictos, feedback fijado, contexto
obligatorio/presupuesto, uso nativo y desconocido, capacidad, cancelación, recibos tardíos,
ediciones/revisiones del dueño, bloqueo y manipulación del temporal. WebSocket/CLI locales
verifican revisiones reales 1→2→3, cuerpo activo durante espera y stop autenticado durante
preparación del commit que conserva los archivos originales. Las credenciales de la fixture
no aparecen en contexto ni salida. Las 22 direcciones/demostraciones y D-A3 permanecen iguales
a la [base capturada](l03c-agent-goals/baseline.json).

El ensayo PvE usa host localhost real e inputs WebSocket normales en dos escenarios controlados:
un ciclo con cuatro consultas scripted y un cuerpo sin `AgentMind`. El ciclo recibe salud confirmada,
daña un NPC, recibe efectos parciales, cambia metas por salud baja y después elige un cuerpo defensivo
desde el archivo fresco. El cuerpo existente ya puede retirarse por su reflejo de salud mientras
la mente espera. La prueba no atribuye esa primera retirada al modelo ni demuestra que este mejore
al cuerpo. El baseline produce daño/retirada sin llamadas ni tokens.

Las posiciones, mapa, enemigo y bajada de salud son estímulos explícitos del laboratorio. Hay un
segundo cliente ordinario con nombre humano fuera del radio de seguridad de ataque; ninguna persona
real participa en ese recorrido. No se completa el encuentro ni se marca la meta `completed`.
El TAP registra daño, distancia, ticks, revisiones, pulsos durante la espera, latencias de consulta,
uso nativo y tiempos de cada escenario. Esos tiempos incluyen preparación local e inferencia
retenida por la fixture; no son un benchmark comparable, un SLA ni rendimiento físico aceptado.

| Dato de la captura | Ciclo scripted | Cuerpo sin modelo |
|---|---:|---:|
| Consultas / unidades nativas simuladas | 4 / 28.272 | 0 / 0 |
| Daño autoritativo al NPC | 13 HP | 13 HP |
| Distancia final observada de retirada | 2,99 | 2,70 |
| Revisiones de objetivos | 1→2→3 | Sin archivo revisado |
| Pulsos del cuerpo durante inferencia retenida | 19 | Sin inferencia |
| Latencia de revisiones de metas | 25 / 472 ms | Sin consulta |

La segunda consulta se retiene deliberadamente; ninguna cifra prueba ventaja táctica o de rendimiento.

## Límites y continuidad

El lock coordina escritores locales que respetan el contrato. Un editor externo no cooperativo
puede competir entre comparación y rename; no es CAS del sistema operativo, escritura multi-host
ni durabilidad certificada ante caída. Los checks finales son síncronos y acotados; pueden ocupar
brevemente el event loop del runner. No se rompen locks abandonados automáticamente.

La razón y fuentes de cada revisión son inspeccionables en registros acotados del proceso;
no se han añadido memoria persistente, auditoría durable, calendario autónomo de inferencia ni
presupuesto durable. L03c no introduce cambios de protocolo ni capacidades; la captura usa el protocolo
vigente 31 del checkout compartido. No se eligieron proveedor,
tarifas, custodia, operación D-A3 ni se tocaron servicios externos. La regresión SQL embebida
existente se ejecuta localmente; no se aplican migraciones externas.

Unreal/FAB: comprobadas las rutas y tamaños de `AIBehaviorTree.uasset` (111.879 bytes) y
`AIBlackboard.uasset` (10.661 bytes). Sirven de referencia conceptual; no son componentes
portables a Node/C01. No se abrieron grafos, exportaron assets ni modificaron fuentes Unreal.

Siguiente tramo de software: **L04a**, memoria persistente con scope, fuentes/vigencia y recuperación
pertinente. Proveedor real y encuentro/aceptación humana siguen abiertos y separados de estos ensayos.
