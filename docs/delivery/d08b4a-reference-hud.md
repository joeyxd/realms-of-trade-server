# D08b.4a — HUD más cercano a la referencia

2026-10-06. Fuente final: `825e96e4496418b0142c72d2e63cc6653a362b6e`, sobre
`84d464c12a1b1b2314cef992de7dce66c8bd8a67`. [Brief](../briefs/d08b4a-reference-hud.md).
Bahía local: <http://127.0.0.1:5180/>. Refinamiento del HUD B4 tras feedback favorable del autor.

## Resultado

El mar ocupa la pantalla al entrar. Ajustes despliega las opciones existentes; Volver a navegar devuelve
el espacio a la balsa. Tarjetas negras translúcidas, marcos finos gastados, iconos marfil de viento/caja
y teclas en la esquina acercan el HUD al lenguaje de la nueva referencia. El dial ahora tiene cristal
oscuro, segmentos amarillo/naranja/rojo y una pequeña llama durante el boost. La brújula conserva
datos reales con proa blanca, viento dorado y flujo cyan. Los avisos usan placas oblicuas y texto blanco
inclinado. No requiere imagen alpha, fuente web ni descarga de textura adicional.

La velocidad sigue en u/s y la brújula usa 0° = +Z. Carga/lastre, timing y acciones siguen los contratos
de B4; no hay barras de enemigo, persecución, combo ni ancla ficticios. Manejo, fuerzas, cámara, audio,
iluminación y posprocesado no cambian. Q1 conserva su propuesta independiente.

El panel cerrado es `inert`. Al abrir se limpian entradas, se enfoca el botón de retorno y, en móvil,
se lleva el panel a la vista. Al cerrar o reanudar se enfoca el canvas. Los controles marcados del
laboratorio conservan su Espacio nativo sin lanzar captura ni soltar lastre; Escape y la liberación de
teclas siguen funcionando. Si falla el arranque/render, se abren Ajustes para mostrar el error real.

## Pruebas y capturas

**89/89 pertinentes en 15 archivos**, Node v24.14.0, exit 0; duración 917,7225 ms, chunk `faba5d`.
La prueba nueva cubre foco en controles/descendientes, Espacio nativo, bloqueo de W/R/J, liberación
al cambiar foco, Escape y captura por clic una sola vez. No se repitió la suite global M5.

Chrome y capturas inspeccionadas:

| Vista | Canvas útil | Menor ancho/alto de controles medidos |
|---|---|---|
| Escritorio 1280×800 | 1280×800 | 58×44 px |
| Vertical 390×844 | 390×679 | 45×44 px |
| Horizontal 844×390 | 844×290 | 45×44 px |
| Vertical 320×740 | 320×575 | 44×44 px |
| Nativo 1707×825, DPR 1,5 | 1707,33×825,33 | 58×44 px |

Sin solapes entre los controles medidos en esas cinco vistas. En vertical, el pilotaje ocupa una sola
fila bajo las tarjetas. En horizontal corto se reserva un pie de 100 px. Se revisó la casa 4×4 en móvil.
Abrir Ajustes en 390×844 deja el retorno visible arriba mediante scroll; la captura final muestra
el panel, no un recorte del inicio del documento. Viewport nativo restaurado al terminar.

La captura perfecta se ejecutó con UI real: tick 420, velocidad 8,59584 u/s, `perfect` y 5,25 s de boost;
dial 8,6 y aviso correcto. En la casa pausada, soltar el bulto de 48 pasó lastre 48→0, carga 64%→42%
y conteo 1→0, sin avanzar tick 0. La tarjeta queda deshabilitada. Con foco en Volver a navegar, J
conservó ese lastre y Espacio cerró Ajustes sin capturar: `lastAttempt` siguió en −1.

Hay cinco SVG fijos en la bahía, incluida la tinta previa; sin creación de nodos por frame. Las URLs
reales conservan madera 1024² y normal de escritorio; móvil emulado solo color 512², sin normal runtime.
Logs de errores vacíos en las revisiones. Esto no mide FPS/GPU en un teléfono físico.

[Evidencia estructurada](d08b4a-reference-hud-evidence.json) registra hashes de las seis fuentes y seis
JPEG originales. Capturas/snapshots locales ignorados por Git: `shots/naval-hud-ref-20261006/`.
Las cinco vistas del HUD corresponden a `84d464c`; su arte/input no cambió en `825e96e`. Esta última
solo corrige la entrada en pantalla del panel apilado; `portrait-settings.jpg` prueba esa versión final.
Las mediciones de teclado, lastre y perfecto corresponden a `84d464c`, con los mismos contratos finales.

## Reutilización, continuidad y límites

Luna confirmó los candidatos Unreal `T_SlotFrame` / `T_SlotBackG` antes del dibujo. Sin exportación
ni preview portable revisado, no se integran ni se modifican las fuentes. Los iconos de viento/caja
son SVG manuales fijos; el mastbolt histórico de B4 se sustituyó en esta pasada. Luna realizó inventario,
revisión/input/prueba y registro mecánico; el principal diseñó, integró y comprobó las capturas.

El checkout contiene trabajo concurrente de arena, manifest y render fuera de esta misión. Los hashes
comparan los seis paths HUD con su commit, no un árbol completo aislado. Se conservaron los cambios
ajenos y se commiteó únicamente este corte. Sin push ni despliegue público en esta pasada.

El autor acepta el aspecto de B4a en esta conversación: «es cierto quedó muy bien sigamos man que falta?»
(2026-10-06). Cierra su revisión visual del HUD, no teléfono/mando físicos, FPS ni normal/mipmaps de B2.
B5 requiere encuentros y autoridad reales;
M5/D09/D10 y la ruta visual del puerto mantienen su trabajo y gates independientes.
