# ST01a — laboratorio privado de Tromba

2026-10-12. Primer corte del [taller de habilidades](../../briefs/skill-studio-vision.md).
El [taller de UI](../../briefs/ui-workshop-vision.md) queda planificado y diferido.

## Uso y alcance

Portada → **Taller de habilidades**, con la cuenta GM habitual; también disponible en solo local.
Tromba utiliza el mismo `SkillFx.spout` del juego, con el personaje real y su lanzamiento procedural
compatible. Reproducir/pausar/repetir, velocidad, deslizador temporal y cámara orbital/zoom.
Original y borrador se reconstruyen con la misma semilla, reloj y cámara.

Tamaño, altura, duración, densidad, dispersión, velocidad, brillo y colores de agua/espuma.
El radio real permanece señalado en amarillo; radio, recarga y retardo se leen del catálogo de combate.
El escenario usa materiales compartidos y luz neutral, sin el postprocesado/contorno del mundo:
esta comparación permite ajustar la presentación, pero no acredita su lectura final en todos los biomas.

Deshacer/rehacer, restaurar, guardar/cargar en este dispositivo y exportar/importar JSON de hasta 16 KiB.
El almacenamiento se separa por cuenta y servidor; documentos desconocidos o fuera de límites se rechazan.
Los cambios sin guardar ofrecen recuperación al cerrar; una revocación intenta conservarla automáticamente.
Si el navegador impide guardar, el taller informa el fallo y mantiene el borrador abierto para exportarlo.
La recuperación local no sustituye una copia exportada ni un guardado remoto.

Este corte no publica variantes, ingresa un cuerpo, consume perlas ni escribe progreso.
No requiere SQL ni flags nuevos. ST01 permanece abierto para variantes compartidas y la adaptación Niagara.

## Verificación

Las [regresiones](regression.json) pasan 29/29: descriptor, renderer compartido,
reproducción privada, liberación/restauración de recursos, acceso GM y personaje/rig existente.
La [comparación con el renderer anterior](tromba-baseline.json) coincide en 25/25 casos
de elementos y pasos temporales; la presentación por defecto conserva Tromba en gameplay.

Chrome comprueba el flujo con el Bucanero nativo, parámetros/undo/redo/comparación,
pausa/tiempo/velocidad, JSON inválido/exportación/guardar/cargar, recuperación por cuenta,
almacenamiento denegado/cuota, revocación y rechazo de cuenta sin rol GM. Se revisan el
foco de teclado y ES/EN a 1440×1000, 844×390 y 390×844 (el juego rota este último).
Los CDN de Three.js/GSAP se sirven desde dependencias locales durante QA: esta prueba
no acredita la disponibilidad externa de esos CDN. El escenario no emite escrituras
GM remotas ni comandos de ingreso/movimiento/combate.

La [aceptación local](local/accepted-keyboard/browser.json) registra 9/9 comprobaciones,
incluido foco circular en el taller y en el diálogo de cierre, con cero errores de render,
escrituras GM remotas y comandos de juego. Capturas inspeccionadas:
[original](local/accepted-keyboard/tromba-original-es-desktop.png),
[borrador](local/accepted-keyboard/tromba-draft-es-desktop.png),
[móvil EN](local/accepted-keyboard/tromba-en-844x390.png) y
[vertical rotado ES](local/accepted-keyboard/tromba-es-390x844.png).
La publicación en el VPS habitual queda pendiente de comprobar revisión, salud y entrada real.
La emulación móvil comprueba distribución y límites de partículas (128 frente a 256 en escritorio),
sin demostrar FPS, overdraw o rendimiento en un teléfono físico.

## Niagara

Se inspeccionó una copia acotada de `NS_Spline_WaterSplash` en Unreal 5.8 y se exportaron texturas
a scratch. Las fuentes originales permanecen intactas. El estado exacto de la referencia animada,
dependencias y siguientes pasos está en [el informe de intake](../../research/unreal-assets/st01-niagara-intake.md).
Cargar un sistema/exportar texturas no acepta una conversión ejecutable en Three.js.
