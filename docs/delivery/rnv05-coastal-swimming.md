# RNV05 — natación costera y reembarque propio

**Estado: implementado localmente en `area07-pilot`; aceptación de publicación pendiente.**
El servidor sigue siendo autoridad de movimiento, resistencia, daño y transiciones de la balsa.
El corte reutiliza M5/GameHost para las consecuencias normales de muerte. No añade tablas,
migraciones SQL ni un escritor de guardado.

## Resultado implementado

Los jugadores pueden nadar cuando el movimiento compartido los lleva a agua más profunda que el
límite de vadeo. El estado de nado, posición corporal, movimiento y gasto de resistencia avanzan
por ticks fijos en el mismo sistema que ejecuta la autoridad y la predicción del cliente. La
reconciliación añade `swim`, `swimStamina`, `swimDrown` y `swimLoad` al estado `you`; el protocolo
sube a la versión 45. Salir a tierra firme o cubierta seca detiene el ahogamiento y recupera
resistencia.

Los valores iniciales viven en `tuning.swim` y siguen siendo ajustables:

| Regla | Valor inicial |
|---|---:|
| Reserva | 30 segundos |
| Velocidad sin carga | 3.2 u/s |
| Masa de carga para alcanzar el máximo efecto | 20 |
| Reducción máxima de velocidad por carga | 40 % (1.92 u/s con carga máxima) |
| Consumo mientras se mueve / flota | 1 / 0.5 s de reserva por segundo |
| Velocidad agotado | 1.2 u/s |
| Gracia tras agotarse | 5 segundos |
| Daño tras la gracia | 10 % de vida máxima por segundo |
| Recuperación en tierra firme o cubierta seca | 6 s de reserva por segundo |

El indicador ES/EN muestra la reserva, poca resistencia, agotamiento y gracia restante, el estado
de ahogamiento al terminar la gracia, la carga y el peligro de Brasa. Recomienda alcanzar la costa
o el propio barco. La pose usa el rig existente y movimiento procedural; no se añadió una animación
externa. El paso de natación no emite los callbacks de pisada terrestre.

Desde el timón o la cubierta, **G** ofrece nadar únicamente si el viaje activo es propio, la balsa
está casi detenida, no hay invitados y existe una salida abierta y accesible por una base expuesta
de nivel cero. En el agua, **F** solo ofrece reembarcar cuando el servidor confirma proximidad y
un trayecto libre a esa misma balsa. La transición conserva identidad de dueño, revisión del
plano, permisos, geometría y época del piloto; subir desde el agua devuelve al jugador a la
tripulación caminante. Desembarcar a una playa y reembarcar desde tierra conservan su flujo
anterior.

## Autoridad y límites

El ahogamiento aplica daño por `hurtPlayer`, por lo que una muerte usa `killPlayer` y el flujo M5
existente de recibos, drops y respawn. No se crea una pérdida adicional, precio de rescate,
recompensa, persistencia de reserva ni política nueva para barcos desconectados. La maldición de
Brasa en agua sigue activa junto al nuevo ahogamiento.

El alcance de este corte es agua costera y la balsa propia de un viaje vivo. No permite bucear,
subir a barcos ajenos ni salir al agua desde una entidad de balsa simplemente amarrada sin viaje
activo. No añade una mecánica general de rescate.

## Reutilización revisada

Se revisó el candidato concreto de MyProject
`Content/_SplineVFX/NS/NS_Spline_WaterSplash.uasset`, catalogado en
[`CANDIDATES.csv`](../research/unreal-assets/CANDIDATES.csv). El registro solo confirma nombre,
ruta y miniatura; dependencias, materiales y comportamiento no están verificados y el runtime no
tiene puente Niagara. Se conserva la superficie de agua, el rig procedural y los efectos de
ripples/splash que ya pertenecen al juego. No se exportó ni modificó contenido de Unreal.

## Verificación y publicación

Conteos locales comunicados durante la integración: **104 pruebas de regresión**, **15 pruebas de
presentación**, incluidas **6 de natación**. Los grupos se solapan y no deben sumarse como pruebas
independientes. La corrida de presentación de este corte pasó **15/15** (`swim-presentation`,
`characters` y `raft-lantern-ui`), con `git diff --check` limpio para sus archivos.

La revisión visual del HUD y las capturas finales, la aceptación completa del recorrido, la
revisión activa del VPS, la salud pública y la entrada autenticada quedan pendientes de completar
por la integración principal. Este informe no declara el cambio publicado ni desplegado.

Registro final de aceptación, a completar por la integración principal:

- Revisión/commit integrado y versión de protocolo activa: **pendiente**.
- Conteos finales y comandos exactos de regresión: **pendiente de consolidación**.
- Capturas PC/touch ES/EN inspeccionadas y evidencia del recorrido: **pendiente**.
- Revisión activa, salud pública y entrada autenticada: **pendiente**.

## Siguiente corte

RNV06 debe entregar un módulo útil de provisiones, con el purificador de agua como primera opción.
El catálogo ya describe un purificador y el mundo ya contiene agua como bien, pero el editor solo
habilita red y parrilla en la primera cadena de producción montada. El siguiente corte debe
conectar un purificador a la economía y al porte existentes, sin activar en bloque los helpers
antiguos de huerto y alambique.
