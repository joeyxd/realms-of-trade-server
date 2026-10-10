# RNV05 — natación costera y reembarque propio

**Estado: publicado y aceptado en el VPS, alpha.36/protocolo 45, 2026-10-10.**
El servidor sigue siendo autoridad de movimiento, resistencia, daño y transiciones de la balsa.
El corte conserva las consecuencias normales de muerte y es compatible con su montaje M5/GameHost.
No añade tablas, migraciones SQL ni un escritor de guardado.

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
| Consumo mientras se mueve / flota | 1 / 0.5 s de reserva por segundo; hasta ×2 por carga |
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
de nivel cero a no más de 1.5 unidades. En el agua, **F** solo ofrece reembarcar dentro de ese mismo
alcance cuando el servidor confirma proximidad y
un trayecto libre a esa misma balsa. La transición conserva identidad de dueño, revisión del
plano, permisos, geometría y época del piloto; subir desde el agua devuelve al jugador a la
tripulación caminante. Desembarcar a una playa y reembarcar desde tierra conservan su flujo
anterior.

## Autoridad y límites

El ahogamiento aplica daño por `hurtPlayer`, por lo que una muerte usa `killPlayer` y su flujo
existente de drops y respawn; cuando está montado el coordinador M5 también usa sus recibos.
La prueba local verifica ese montaje durable. El VPS conserva `combatDeaths`, `deathDrops` y
`groundTransactions` sin montar: publicar este corte no los activa ni acredita su durabilidad pública.
No se crea una pérdida adicional, precio de rescate,
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

Integración final: **121/121 en 17 archivos**, incluyendo seis casos de natación, nueve de
transiciones/rollback de balsa, muerte M5 montada, movimiento/soporte, presentación y reconciliación
naval/cliente/touch. [Log completo](rnv05-coastal-swimming/local-acceptance.tap).
La regresión previa de combate/Brasa/perlas/persistencia pasó 104/104; se solapa con esta selección.
`git diff --check` limpio. No se suman los conteos de distintas corridas.

PC 1280×720 ES y móvil 390×844 EN emulado completan el recorrido de costa, natación con carga,
aviso de agotamiento, regreso a tierra y recuperación; también pilotar la balsa propia a agua
abierta, detenerse, G para entrar al agua y F para volver caminando a cubierta. La partida usa
`/ws` real contra un GameHost desechable en memoria. Solo la posición inicial de costa y el
agotamiento se preparan en el servidor de prueba; movimiento y navegación usan teclado/joystick
y acciones normales. No hubo errores de navegador ni solicitudes externas. Los prompts terrestres
se ocultan mientras se nada, conservando F cuando se puede reembarcar. Capturas inspeccionadas;
la prueba móvil no acredita rendimiento en un teléfono físico.

[Evidencia local](rnv05-coastal-swimming/evidence-2026-10-10T23-48-36-233Z.json),
[nado PC](rnv05-coastal-swimming/swim-desktop-es-low-2026-10-10T23-48-36-233Z-02-swimming-loaded.jpg),
[balsa PC](rnv05-coastal-swimming/swim-desktop-es-low-2026-10-10T23-48-36-233Z-06-own-raft-water-exit.jpg)
y [agotamiento móvil](rnv05-coastal-swimming/swim-mobile-en-low-2026-10-10T23-48-36-233Z-03-exhaustion-warning.jpg).

El VPS activó `56155bbe990f8c1ec4f2072ac907318b5a42a678` con imagen
`sha256:d7c9b49bd25cf8c5f87d4c2b3a49d83861b433f7460cd4e1f57e4f7679ef634c`.
[Evidencia de despliegue](rnv05-coastal-swimming/deployment.json): una sola autoridad sana,
Supabase/accounts activos, recursos/Tala/fuego listos, cero errores/pendientes/guardados sucios,
contenido gen4/base conservado, página y health 200, timer activo. El actualizador aprobó 109/109;
su configuración y las activaciones M5 se conservaron.

La misma imagen ejecutó **34/34** pruebas de natación, reembarque, movimiento y navegación
en un contenedor de pruebas sin red, con los tests del release montados de solo lectura:
[log](rnv05-coastal-swimming/image-swimming.tap). La muerte M5 montada se verifica en la selección
local de 121; requiere PGlite de desarrollo y no se atribuye a la imagen de producción.

La [entrada pública](rnv05-coastal-swimming/public/evidence.json) pasó sus diez comprobaciones:
WSS real, alpha.36/protocolo 45, cuatro campos de natación, reserva 30 en tierra, HUD oculto en seco,
partida conectada, minimapa y mapa M, sin errores. Se inspeccionaron las capturas de
[partida](rnv05-coastal-swimming/public/public-gameplay.jpg) y
[mapa](rnv05-coastal-swimming/public/public-map.jpg). Esta entrada fue de invitado; el recorrido
completo de nado/agotar/volver y G/F pertenece a la prueba local aislada. No se acredita muerte
autenticada ni persistencia pública de ese montaje opcional.

Después de aceptar el runtime se incorporó por avance directo la continuidad `f04cd7d` de
compañeros/i18n. No cambia la simulación de natación ni las transiciones de balsa. La comprobación
conjunta de los cuatro archivos anteriores y companion-config client/network/store pasó **51/51**.
Los conteos se solapan y no se suman. Los menús conservan el mundo vivo; abrirlos no pausa la reserva.

## Siguiente corte

RNV06 debe entregar un módulo útil de provisiones, con el purificador de agua como primera opción.
El catálogo ya describe un purificador y el mundo ya contiene agua como bien, pero el editor solo
habilita red y parrilla en la primera cadena de producción montada. El siguiente corte debe
conectar un purificador a la economía y al porte existentes, sin activar en bloque los helpers
antiguos de huerto y alambique.
