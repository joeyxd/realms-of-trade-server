# S06 — bases de palmera, entrega local

2026-10-07. Dos variantes de raíces y plantas bajas aplicadas alrededor de palmeras existentes.
Referencia y alcance: [brief S06](../briefs/visual-s06-palm-bases.md). Se conserva la dirección ilustrada
del autor: hojas verdes pintadas, nervaduras/tinta, corteza cálida y arena visible entre piezas.

## Arte y presupuesto

| Variante | Partes | Triángulos | GLB |
|---|---|---:|---:|
| Abierta | cinco raíces, dos rosetas de cinco hojas | 410 | 54.728 B |
| Frondosa | seis raíces, tres rosetas de cinco hojas | 540 | 70.952 B |

Dos modelos, **125.680 B** juntos; sin imágenes embebidas, rig ni transformaciones de nodos. Presupuesto
600 tri / 80 KiB por modelo. Posiciones/normales float32, color/flex/paint UNORM8 y UV UNORM16, vértices
idénticos compartidos mediante índices. Cada atributo tiene elementos/offsets alineados a cuatro bytes,
con padding en los atributos compactos; se siguió la [especificación glTF de Khronos](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#data-alignment).
El recibo distingue vértices fuente y compactos. Los borradores previos permanecen fuera del manifiesto.

Raíces 3D con UV del cuadrante de corteza **S05 v2 ya cargado**: no añaden texturas de madera. Las bases
no incluyen el dibujo de arena/piedras de la lámina. Plantas: dos hojas individuales recortadas del atlas
1254×1254 del autor, con su normal y fondo convertido a alpha. Copias exactas de originales en
[palm-base-textures-v1](../art/source/palm-base-textures-v1/receipt.json); receta y hashes registrados.

| Variante por dispositivo | Dimensiones color y normal | Color | Normal | Par nuevo |
|---|---:|---:|---:|---:|
| PC | 512×256 | 11.216 B | 63.728 B | **74.944 B** |
| Puntero táctil | 256×128 | 4.892 B | 25.114 B | **30.006 B** |

Las cuatro texturas ocupan 104.950 B en disco; cada cliente descarga un solo par. Modelos + par nuevo:
**200.624 B PC / 155.686 B táctil**, adicionales a S05. Color WebP con pérdida 88/85, normal WebP sin
pérdida y dato lineal. Crops `[384,746,76,137]` / `[680,1024,48,117]`, dos tiles horizontales con
gutter 8/4 px. Máscara por componente de color y dilatación 2 px; alpha binaria después del resize.
Los ocho probes de fondo y ocho de seed, entre los cuatro archivos, dieron 0/255 respectivamente.
Coincidencia normal/color revisada visualmente; no certifica un bake tangente sobre estos meshes.

## Integración

La semilla local **99282957** mantiene sus 234 palmas y añade **144 bases** (74 abiertas / 70 frondosas),
con límite global 144 y selección por hash de coordenadas/semilla. No depende del orden de props ni
consume RNG. Raíces rígidas (flex cero); hojas con flex de nacimiento cero a 0,62 — 0,6196 en el GLB
UNORM8. Se reutiliza S05 `palmMaterials`: alpha 0,35, doble cara y normal suave 0,16. El recorte y el
viento coinciden en color, contorno y MeshDepth; padding en el culling de las hojas.

Bases inclinadas al terreno y hundidas 0,1 u desde la posición de palma. La huella completa requiere
arena/hierba suave y casi plana; excluye agua, muelle, camino, volcanismo, props próximos y acceso al
tutorial/NPC. No modifica las alturas del mapa, las palmas, los arbustos, colisiones ni persistencia.
Son detalles cosméticos; sus raíces exteriores no agregan obstáculos físicos.

Archivos de runtime: `palmBaseGeometry.js`, `palmBaseMaterials.js`, integración en `vegetation.js`.
El shader de palmas y la iluminación S05 no cambian en S06. Seis fuentes descargables nuevas y hashes
en [source-snapshot.json](../art/source/palm-bases-v1/source-snapshot.json). Las seis copias históricas
S05 conservan sus hashes, aunque su antigua `vegetation.source.js` describe la versión anterior.

## Verificación

**62/62 pruebas, sin omisiones**, en once archivos de arte: geometría no degenerada, normales/UV,
flex/clones, modelos/atributos/presupuesto, exclusiones de huella, colocación estable sin mutar props ni
acceder a `map.rng`, fallback, arena/terreno/rocas/huellas/assets/balsa/catálogo. El test adicional de
worldgen usa otra semilla, 20261007: 239 palmas y 144 bases; no debe confundirse con la preview actual.
Generadores de modelos, texturas y snapshots pasan `--check`, sin regenerar históricos.

Ocho casos del juego local en Chromium: PC high, táctil medium y low; modelos 404, GLB inválido,
albedo perdido, normal perdido y `noassets`. En todos: sin errores JS de página/juego, GL error cero,
programas enlazados. PC carga realmente 512×256 y táctil/low 256×128. 404/GLB inválido usan geometría
nativa con pintura; sin albedo usan hojas geométricas sin rectángulos opacos; sin normal conservan
pintura; `noassets` usa ambas partes procedurales y no solicita los cuatro assets S06.
Los fallos de assets esperados se registran en sus casos. Hay mensajes auxiliares 404 en la consola
sin fallos de assets de juego en los casos positivos; no se afirma consola totalmente vacía.

Evidencia cruda: [ocho casos](../art/palm-bases/browser-evidence-v1.json). Capturas inspeccionadas:
[mapa PC](../art/palm-bases/desktop-map-v1.png), [contacto real PC](../art/palm-bases/desktop-contact-v1.png),
[contacto táctil](../art/palm-bases/mobile-contact-v1.png), [low](../art/palm-bases/low-gallery-v1.png),
[fallback sin color](../art/palm-bases/missing-color-contact-v1.png),
[dos bases en muestrario](../art/palm-bases/desktop-gallery-v1.png),
[viento 0](../art/palm-bases/desktop-wind-0-v1.png) / [2,1](../art/palm-bases/desktop-wind-2-v1.png).
Pintura y luz se leen en la cámara de juego; raíces discretas, hojas recortadas y cambio de hojas/sombra
con viento. Los contornos de tinta son más discretos en low. Las copas S05 pueden tapar la base según
la cámara; la captura cercana conserva su dither existente, sin fingir una escena libre de copas.

El muestrario añade dos bases temporales a **escala de modelo 1×**, oculta vegetación/personajes solo para
esa captura y los restaura después. No son las bases colocadas en el mapa ni una escena publicada.
El juego se pausa y se congela cámara/reloj para comparar; emulación no prueba FPS físicos.

Registro: dos filas específicas `raices-palma` y `plantas-base-palma`, con modelos, normales,
previews, fuentes y capturas; **revisión 11, 82 filas y 26 aplicadas**. **47 enlaces exactos por bytes**
verificados por HTTP real; registro idempotente conserva revisión 11. La ficha de plantas se abrió en
el HTML, mostró 21 archivos y cargó previews/originales/atlas: [captura del catálogo](../art/palm-bases/catalog-bases-v1.png).
Los conjuntos anteriores S01/S03/S02/S04/S05 también pasan (47/44/13/33/52 enlaces). El arbusto tropical
independiente sigue pendiente. Servicio local 5190;
juego solo 5192. Sin commit, push ni publicación. Arte fino (densidad, tamaño, repetición de corteza),
FPS/coste físico y publicación siguen pendientes. Siguiente pieza propuesta: arbusto tropical independiente.
