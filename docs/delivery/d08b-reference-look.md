# D08b.1 — cámara, mar y horizonte de la referencia naval

2026-10-06. Fuente local: `32a866ea6bf711b0dd05cd54c0c7376ceba1fe53`.
Bahía: <http://127.0.0.1:5180/>. [Referencia y fases B1–B5](../briefs/d08b-reference-look.md).

El autor confirmó el tacto y el peso de D08a.1, y pidió trabajar el aspecto de su imagen por capas.
Este primer corte entrega la composición y atmósfera; madera/lona, espuma dramática, tinta negra,
HUD y persecución siguen abiertos. No afirmar que ya reproduce la imagen completa.

## Cambios

- Cámara de persecución trasera 3/4 por defecto, seguimiento suave del rumbo tomando la ruta corta
  al cruzar ±π y ajuste por tamaño/aspecto. El centro geométrico del casco evita un salto lateral al
  soltar lastre. Horizonte neutro proyectado alrededor del 25% superior; FOV efectivo 50–56°.
  La vista isométrica se puede seleccionar para comparar. Pausa y reduced motion respetadas.
- Mar verde pizarra, luz/cielo gris azul, reflejos y destellos más contenidos, crestas fragmentadas
  usando muestras de ruido/ola que ya existían. Variantes SSR y simple comparten los valores nuevos.
  Los cambios viven en materiales del laboratorio: no alteran los presets globales de la isla.
- Nueve formaciones rocosas asimétricas, inmóviles en el mundo, entre z=92–344; bruma de 85–570 u.
  Un mesh, 2.835 vértices / 945 triángulos, sin sombras, texturas ni colliders. El corredor inicial
  |x|<60 está despejado hasta z=120. Son referencias de una bahía finita, no terreno navegable infinito.
- Avisos de mar a la izquierda para liberar la vela; encuadre elevado en pantalla para separar casco
  y controles. La línea de encabezado usa altura explícita para no desbordar el modo horizontal corto.
  El tamaño proyectado del spray se actualiza con el FOV real, sin cambiar pools/emisión.

Sin cambios en fuerzas, carga, timón, viento, corrientes, timing o audio. Sin cambios de simulación,
protocolo, perfiles, SQL, assets publicados ni fuentes Unreal. El corte sigue aislado en 5180.

## Reutilización y equipo

Luna contrastó inventarios/catálogo y candidatos puntuales; raíz revalidó existencia y tamaño de
`SM_Rock.uasset` (22.059 B, Dreamrise) y `S_Rock_shopk.uasset` (31.254 B, NiagaraExamples).
Sin preview/GLB comprobados, su integración requiere exportar y revisar. Se reutilizaron `ico/lumpy/part`
y la receta procedural existente de roca. Balsa, atlas 1024/512, caja/aparejo, cielo, agua y pipeline
existentes continúan. Atlas 308.536 / 82.878 B; ninguna nueva descarga de textura o audio.

Principal: guía de referencia, cámara/look, integración y revisión. GPT-6 Luna: selección de assets,
scenery y pruebas independientes de cámara/aislamiento. Un escritor por archivo y revisión GPU exclusiva.
Cambios concurrentes M5 y catálogo/puerto preservados; HANDOFF y PLAN-DELIVERY no se editaron aquí.

## Evidencia y aceptación

**60/60 pruebas pertinentes**, Node v24.14.0, exit 0; incluye simulación/manejo, entrada, reloj,
servidor aislado, corrientes/ráfagas, feedback/audio/cómic, scenery, cámara y aislamiento del look.
La repetición posterior al commit verificó que todos los paths usados por estas pruebas seguían
idénticos a `32a866e`. TAP y resumen locales:
`.scratch/naval-reference-tests-32a866e.{tap,json}`. No se repitió la suite global de M5.

Revisión visual en Chrome antes de guardar la fuente: escritorio ancho 1280×800, vertical 390×844
y horizontal 844×390; balsa inicial y casa 4×4. Casco/vela completos, avisos apartados y mar/horizonte
visibles. Se observó atlas móvil `textures/raft/comic-materials-v1-mobile.webp`, atlas desktop estándar,
ausencia de overflow horizontal y cero errores de consola en las vistas revisadas. Las imágenes
se inspeccionaron en la sesión, **no quedaron PNG finales persistidos**.

Al intentar guardarlas tras el commit, la conexión de Chrome se perdió: timeout, recuperación del
tab fallida (`Browser is not available: 1`) y lista de navegadores vacía. No sustituir esa evidencia
con capturas antiguas ni afirmar aceptación visual final del commit. La última revisión precedía
los ajustes pequeños de altura del encabezado y escala de sprite con FOV; cámara/paleta/rocas eran
las mismas. Sintaxis/pruebas posteriores verificadas, nueva captura de esa fuente pendiente.

Último viewport temporal conocido: 844×390. Su reset y la marca de pestaña entregable tampoco pudieron
confirmarse después de la desconexión. Se solicitó reconexión al autor; al retomar, recuperar Chrome,
recargar la fuente y guardar desktop/vertical/horizontal, casa y un giro/boost; restablecer viewport.
No presentar la emulación, capacidades del pool o bytes del atlas como FPS de un teléfono físico.

Aceptación humana del nuevo look y rendimiento físico pendientes. Siguiente corte **B2**: madera
envejecida más neutra, vela gris verdosa remendada y aparejo/accesorios revisando FAB antes de añadir arte.
