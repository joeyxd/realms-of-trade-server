# Taller visual de habilidades y perlas

Dirección del autor, 2026-10-11. Diseño previo a implementación. El corte de recursos
GM04d está publicado en alpha.63; este documento conserva la visión y fija la siguiente fase.

## Experiencia deseada

Un taller dentro de las herramientas del juego: biblioteca de habilidades a la izquierda,
personaje y escenario de prueba en el centro, parámetros a la derecha. Elegir personaje,
arma, habilidad y variante; reproducir, pausar, ralentizar y repetir. Ver origen, trayectoria,
área e impacto sobre un muñeco. Comparar original y borrador con la misma cámara y semilla.

Cada habilidad tiene nombre, descripción, icono propio y una secuencia visual de preparación,
lanzamiento, viaje/área, impacto y final. Elegir animaciones y efectos de una biblioteca con
miniaturas animadas; colocar efectos en manos, arma, cuerpo, objetivo o suelo. Ajustar el
momento de cada evento sin tener que editar código para cada variante.

Controles iniciales: cantidad/densidad de partículas, tamaño, duración, velocidad, dispersión,
color, brillo, grosor de estelas, anillos de impacto, sonido y sacudida de cámara. Un control
de intensidad puede combinar varios parámetros, con límites y una opción de restaurar.
La vista previa muestra coste y variantes escritorio/móvil, con un máximo de partículas;
"más dramático" puede usar silueta, ritmo, estela y anticipación además de más partículas.

Iconos: elegir existentes, subir una imagen o generar una candidata con la herramienta de
imágenes conectada. Revisar recorte, transparencia y lectura a tamaño de HUD antes de aceptar.
Generar arte no concede automáticamente identidad, publicación ni propiedades de combate.

## Reutilización y límites actuales

El motor ya tiene efectos en `src/render/vfx/skillfx.js`, `effects.js`, `particles.js`, eventos
de combate y herramientas de revisión en `tools/pearl-review.mjs`. Los efectos actuales
tienen bastante lógica y parámetros en código: hace falta exponer descriptores declarativos
acotados y usar el mismo renderer en taller y partida. No basta con poner sliders sobre una
demo independiente. Las animaciones procedurales y el rig nativo del Bucanero requieren
adaptadores propios; disponer de su idle/nado no demuestra retargeting de cualquier clip.

Fuentes Unreal de solo lectura: inventario en `docs/research/unreal-assets/`. Hay familias
NiagaraExamples, BigNiagaraBundle y _SplineVFX; los candidatos documentados incluyen impacto
de madera, humo y salpicadura. Las rutas/miniaturas no aceptan su animación, calidad ni coste.
No se ha seleccionado ni convertido un efecto nuevo para este taller.

Niagara ejecuta sistemas, emisores, scripts y renderers de Unreal. Nuestro runtime Three.js
necesita una adaptación: seleccionar un sistema concreto y revisar su comportamiento en
Unreal; extraer texturas, mallas, sonidos o flipbooks útiles; recrear su secuencia con nuestros
emisores/shaders. Mantener referencia, procedencia y comparación visual. Un flipbook sirve
para ciertos efectos, pero no conserva toda la profundidad, interacción ni parametrización.
No se promete cargar `.uasset`, Blueprints o grafos Niagara directamente en el navegador.

Referencias técnicas: [estructura de Niagara](https://dev.epicgames.com/documentation/unreal-engine/overview-of-niagara-effects-for-unreal-engine?lang=en-US),
[parámetros externos](https://dev.epicgames.com/documentation/en-us/unreal-engine/system-settings-reference-for-niagara-effects-in-unreal-engine)
y [escalabilidad](https://dev.epicgames.com/documentation/en-us/unreal-engine/scalability-and-best-practices-for-niagara).

## Contrato propuesto

Una definición versionada contiene identidad estable, textos/icono, referencias de animación,
capas de efectos, enlaces a huesos/puntos y eventos temporales. Solo acepta tipos de efecto
registrados y parámetros numéricos/colores/referencias validados; nunca JavaScript, GLSL,
URLs arbitrarias ni scripts importados del autor. Recursos visuales conservan hash y dependencias.

La presentación y las reglas jugables se revisan por separado. Daño, alcance, cooldown,
coste, estados y autoridad de impactos siguen en la simulación del servidor. Hacer una
explosión más grande no aumenta silenciosamente su radio de daño. El taller muestra el
radio real y avisa si la presentación lo oculta. Las reglas nuevas requieren una plantilla
de comportamiento aceptada; una perla referencia una habilidad/variante y su asignación
existente, sin inventar otra autoridad de inventario o recompensas.

Borrador privado, guardar/duplicar/exportar, comparación y aprobación explícita. Revisiones
publicadas inmutables y rollback; clientes y servidor fijan la misma revisión compatible.
El laboratorio no consume perlas, entrega botín ni escribe progreso. La forma de guardado,
publicación y SQL se decide al cerrar el contrato; este diseño no instala tablas ni flags.

## Entrega por cortes

1. **ST01 — ajustar lo existente.** Una habilidad representativa completa y después las
   actuales: personaje real, controles de reproducción, sliders seguros, comparación,
   guardar/recuperar borrador y presupuesto visual. Validar primero el flujo con Tromba
   u otro efecto que el autor prefiera. **Incluir la adaptación real de un primer efecto
   Niagara**, solicitada explícitamente por el autor: revisión en Unreal, conversión,
   biblioteca seleccionable y parámetros editables. No migrar todos los efectos de golpe.
2. **ST02 — biblioteca e iconos.** Variantes reutilizables, miniaturas, subir/generar/revisar
   iconos y ampliar los efectos concretos de Unreal convertidos y comparados. Clips solo con rig
   compatible o retargeting aceptado; sincronización con marcadores de animación.
3. **ST03 — componer habilidades/perlas nuevas.** Plantillas de proyectil, área, golpe,
   movilidad y buff; secuencia visual, comportamiento servidor validado y publicación.
   Añadir tipos gradualmente, conservando compatibilidad y balance revisable.

## Aceptación antes de publicarlo

- Cambiar un efecto actual en el taller y observar la misma variante en partida privada.
- Play/pausa/repetición/velocidad y anclajes correctos con el personaje real; sin clips rígidos
  o retargeting supuesto. Original y borrador se comparan en condiciones equivalentes.
- Límite de partículas y calidad móvil; liberación de recursos al cambiar/cerrar; medir GPU
  y overdraw, además de bytes. Emulación móvil no sustituye rendimiento en teléfono físico.
- Icono legible en HUD; errores de imagen/asset no pierden el borrador.
- Cambios visuales no alteran daño/rango/cooldown; secuencia e impacto coinciden con eventos.
- Guardado y rollback, autenticación GM, validación servidor y rechazo de parámetros/refs
  inválidos. Sin ganancias persistidas durante la prueba.

El autor eligió **ajustar las habilidades actuales primero**, 2026-10-11. ST01 es el siguiente
corte después de cerrar GM04d; la elección de su primera habilidad sigue abierta.
El taller todavía no está implementado ni desplegado.
