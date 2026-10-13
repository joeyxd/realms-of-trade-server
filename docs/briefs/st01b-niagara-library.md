# ST01b — biblioteca Niagara del taller

Dirección del autor, 2026-10-12: incorporar la colección de efectos de los tres proyectos
de `C:\Unreal` al Taller de habilidades. Amplía el intake inicial de un efecto a una
biblioteca completa; el taller de UI permanece en planificación.

## Resultado y flujo

Biblioteca buscable por nombre, proyecto, familia y categoría, con todas las identidades
NiagaraSystem comprobadas y duplicados exactos agrupados. Seleccionar una fuente permite
ver su procedencia y estado. Solo un derivado convertido y revisado activa la reproducción;
una ruta de Unreal, miniatura o efecto parecido no cuenta como conversión.

El personaje real, cámara, reproducción y comparación existentes se conservan. Cada efecto
listo tiene borrador local independiente, undo/redo, recuperación e importación/exportación
estricta. Cambiar de selección conserva los borradores de la sesión. Buscar y cambiar
categoría también funciona en el escenario compacto de móvil, donde la biblioteca actual
está oculta. Abrir, reproducir y guardar no crea cuerpo, comandos ni escritura de progreso.

## Conversión

Fuentes inmutables, inventario basado en clase y hash, aliases de proyectos conservados.
Copias aisladas para ejecutar Unreal. Obtener primero una referencia animada verificable,
dependencias y encuadre. Usar recursos exportados y adaptación Three.js cuando sean útiles;
para sistemas compatibles, generar secuencias/atlas con transparencia mediante captura
real de Unreal. No cargar uasset, Blueprints ni scripts en el navegador.

Dirección reforzada por el autor: conservar el aspecto y comportamiento del original tanto
como permita el motor del navegador. Registrar una fuente no equivale a haberla convertido.
No aceptar una aproximación genérica por ser más fácil ni presentar una miniatura como efecto.
La referencia ejecutada en Unreal es la base para comparar color, silueta, tiempos y capas.

Un atlas conserva la animación de una cámara, no la simulación Niagara 3D ni sus parámetros.
Su editor ofrece solo tamaño, proporción, duración/velocidad, opacidad/brillo y tinte de
presentación; nunca promete modificar el número original de partículas. Efectos con spline,
eventos de Blueprint, colisión o interfaces externas necesitan su fixture y pueden quedar
identificados como pendientes con una causa concreta. No sustituirlos por presets inventados.
Para efectos que exijan volumen, vista libre o cambios reales de densidad, preparar un adaptador
de partículas/materiales/meshes a partir de las dependencias originales, con comparación desde
varios ángulos. Esa adaptación requiere su propia aceptación; un atlas no la sustituye.
Las texturas de componentes se muestran como componentes, con mapeo de canales y tiempo de
reproducción editorial declarados. Una captura de sistema requiere una secuencia continua:
una sola activación, pasos de simulación registrados y pausa durante la lectura de cada frame.
Cada componente tiene una identidad propia en la biblioteca. Compartir una textura entre
dieciocho sistemas no convierte esos dieciocho sistemas ni aumenta el número de animaciones
distintas. Sus sistemas conservan el estado pendiente hasta obtener su propia adaptación;
la procedencia del componente enlaza los renderers exactos que lo usan.

Registro cerrado de adaptadores y recursos versionados. Mantener el documento Tromba v1
exacto, añadir un contrato separado para derivados; parámetros numéricos finitos y rangos,
colores, IDs del registro, máximo 16 KiB. Sin URLs, código, GLSL ni campos desconocidos.
Los presets visuales no asignan habilidades nuevas, daño, alcance, costes o cooldown.

## Presupuesto y aceptación

Carga diferida de una sola variante por dispositivo (atlas escritorio/móvil), original fuera
del bundle; cancelar cambios de selección y liberar texturas/materiales propios. Referencia,
hash, dimensiones, frames, duración, alpha y límites conocidos acompañan cada conversión.
Comparar secuencia real y derivado; comprobar movimiento, encuadre, ausencia de fondo negro,
carga/fallo/recuperación y vista en ES/EN, escritorio y móvil emulado. No aceptar FPS físicos
por emulación ni deducir fidelidad 3D de un flipbook.

Pruebas de catálogo/deduplicación, descriptores, reloj determinista, borradores separados,
cambios rápidos/carga fallida/disposición y conservación del renderer. Repetir las regresiones
de Tromba y los guards GM, y verificar cero comandos/escrituras durante la prueba. Publicar
solo el corte revisado mediante el actualizador habitual y comprobar revisión/salud/entrada.

Estado: biblioteca implementada y revisada localmente en alpha.66/protocolo 60. Censo completo
de 993 fuentes/916 identidades, 15 componentes originales y un extracto de Firework aceptados;
17 vistas con Tromba. Adaptación 3D de sistemas y publicación verificadas por sus gates propios.
Ver [entrega y límites](../delivery/st01b/DELIVERY.md). El taller de UI permanece planificado.
