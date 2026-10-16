# RNV05 — natación costera y reembarque propio

AREA07 continúa después de RNV04. Decisión del autor: al agotarse la resistencia hay aviso,
ahogamiento gradual y las consecuencias de muerte actuales. M5/GameHost conserva la autoridad.

Entrar desde una playa pasa de caminar/vadear a nadar; volver a terreno accesible permite salir.
La balsa propia detenida permite bajar al agua y subir por una base cercana y libre. La cubierta,
paredes, propiedad, identidad y revisión siguen siendo las existentes. No hay buceo ni abordaje
de barcos ajenos en este corte. Los permisos de invitados y la recuperación actual se conservan.

Valores iniciales ajustables: 30 segundos de resistencia, velocidad 3.2 u/s; la masa de mochila
(20 unidades para carga máxima de natación) reduce hasta 40% la velocidad y duplica el consumo.
En movimiento consume 1 s/s; flotando 0.5 s/s, sin regeneración en el agua. Tierra o cubierta
recuperan 6 s/s. Agotado conserva 1.2 u/s, dispone de 5 segundos de aviso y después pierde 10%
de vida máxima por segundo. Brasa conserva su maldición de agua. No se crean otras pérdidas,
precios de rescate ni cambios a la exposición de barcos desconectados.

Movimiento, reserva y daño son simulación compartida con predicción y reconciliación. El cliente
muestra reserva, carga, peligro y controles ES/EN en PC/touch. Ataques, guardia, habilidades y dash
no se inician nadando; peligros y muerte siguen activos. La reserva es estado de sesión predicho,
sin una nueva tabla o autoridad de persistencia.

Reutilización: comprobado el candidato concreto de solo lectura
`C:\Unreal\MyProject\Content\_SplineVFX\NS\NS_Spline_WaterSplash.uasset` (5,381,446 bytes).
Es Niagara sin puente portable/dependencias verificadas; se conserva el agua, rig procedural y
efectos agrupados propios. No se exporta ni modifica Unreal ni se añade una descarga de arte.

Aceptación: playa/agua/playa, carga vacía y pesada, flotación y agotamiento, muerte actual una vez,
Brasa y cubierta seca, reconciliación determinista, bordes/obstáculos/propiedad/revisiones de balsa,
PC/touch ES/EN, capturas inspeccionadas, regresiones pertinentes y revisión activa del VPS.
La implementación, pruebas y despliegue se registran por separado en el informe de entrega.
