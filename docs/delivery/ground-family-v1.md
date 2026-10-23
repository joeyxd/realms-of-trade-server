# S03 — hierba, tierra y transiciones aplicadas localmente

Fecha del autor: 2026-10-06. Cuatro pares suministrados en `materials/`, revisados visualmente,
preparados e integrados en el mapa real. Ajuste artístico final y publicación pendientes.
[Brief y decisión de reutilización](../briefs/visual-s03-ground-family.md).

| Material | Lugar en el mapa |
|---|---|
| Transición arena–pastizal | Borde entre playa y hierba, localizado por el peso de hierba existente |
| Arena y tierra compactada | Bordes de caminos y suelo transitado del pueblo |
| Hierba tropical | Superficie de hierba con matas y claros pintados |
| Tierra seca con piedras y conchas | Centro de senderos y suelo alrededor de la plaza |

Color/normal de cada par se conserva por separado para descargar y revisar. El juego usa dos
atlas compartidos: albedo sRGB y normal lineal. Los ocho PNG originales 1254×1254 están intactos;
las ocho copias exactas quedan en `docs/art/source/ground-family-v1/`. No se genera arte nuevo.
El emparejamiento sigue los nombres y contenido visual de las imágenes suministradas; no se
afirma una derivación física ni una validación de normal horneada desde geometría.

Los degradados se mezclan con las máscaras, conservando proyección mundial de 8 unidades y un
desplazamiento suave de hasta 0.15 del tile. La primera proyección estirada producía franjas;
la versión entregada conserva la escala del detalle y limita la influencia al borde.
Color/normal comparten UV; las derivadas de la proyección orientan las normales de transición.
Intensidad normal 0.22 y desvanecimiento de relieve a 35–70 unidades. El contorno sigue geométrico.

Se mantienen los cuatro canales de máscara, posiciones, índices y alturas del terreno. La pequeña
plaza de piedra queda dentro de radio 4 alrededor de Aldea Coralina, mezclada hasta radio 7;
los senderos y el suelo circundante usan tierra. Taludes, volcán, lava y arena de combate
conservan su precedencia. La hierba dibujada es un material de superficie, sin hojas 3D nuevas;
las conchas/guijarros del bitmap tampoco añaden obstáculos. Huellas dinámicas y rocas S02 conservadas.

## Preparación y presupuesto

[Recibo de fuentes y derivados](../art/ground/ground-family-v1-receipt.json): SHA-256, receta,
dimensiones, orden de atlas y bytes. `tools/prepare-ground-materials.mjs --check` pasó y la
comprobación independiente confirmó ocho originales y los 28 archivos copiados/derivados.
El script protege fuentes/derivados contra sobrescritura con contenido diferente.

| Dispositivo | Atlas cargados | Contenido por material | Descarga nueva conjunta |
|---|---|---|---:|
| PC | Albedo + normal 2048×2048 | 960×960; gutter 32 | 8.366.608 B |
| Móvil con puntero coarse | Albedo + normal 1024×1024 | 480×480; gutter 16 | 2.231.340 B |

Los 16 previews completos 1024/512 están en `docs/art/ground/ground-family-v1/`, fuera del bundle
de peticiones del juego. Solo dos entradas nuevas en manifiesto; una variante por dispositivo.
Normales WebP RGB sin pérdida, Lanczos por canal sin transformación gamma; colores WebP q85/q82.
Gutters replican el píxel de borde y la lectura limita derivadas a mips seguros para reducir contaminación
entre cuadrantes. Las fuentes suministradas aún pueden mostrar repetición: no se acredita tiling perfecto.
Estimación RGBA8+mips para estos dos atlas: 42.7 MiB PC/10.7 MiB móvil; no es una medida de VRAM ni FPS.

## Verificación local

**46/46 pruebas pertinentes**: ground-terrain, sand-terrain, coast-rocks, footprints, assets,
raft-materials y art-catalog. Cubren límites de UV, pérdida de color/normal, geometría idéntica,
fuentes por dispositivo y conservación de las entregas anteriores.

[Evidencia de navegador](../art/ground/browser-evidence-v1.json): PC 1280×720/high,
móvil emulado 844×390/medium y móvil/low, además de fallos de color/normal y `noassets`.
Shader enlazado en los seis casos; **14 samplers activos de un límite de 16**, GL error 0,
sin errores JS/juego. Ambos atlas cargados con resolución/colorSpace esperados; peticiones
solo de la variante elegida. En consola queda un 404 auxiliar en casos normales; los fallos
inyectados registran además el asset ausente esperado. No se confunde ese aviso con un shader roto.

| Vista real | PC | Móvil emulado |
|---|---|---|
| Playa y hierba | [Sin HUD](../art/ground/desktop-beach-clean-v1.png) | [En juego](../art/ground/mobile-beach-v1.png) |
| Sendero | [Sin HUD](../art/ground/desktop-road-clean-v1.png) | [En juego](../art/ground/mobile-road-v1.png) |
| Pueblo y plaza | [Sin HUD](../art/ground/desktop-town-clean-v1.png) | [En juego](../art/ground/mobile-town-v1.png) |
| Arena de combate | [En juego](../art/ground/desktop-arena-v1.png) | [En juego](../art/ground/mobile-arena-v1.png) |

[Pueblo en calidad baja](../art/ground/low-town-clean-v1.png) y fallbacks
[sin albedo](../art/ground/missing-color-beach-v1.png)/[sin normal](../art/ground/missing-normal-beach-v1.png)
también inspeccionados. La cámara de QA recorre el mapa con la simulación pausada; algunas etiquetas
de NPC/HUD permanecen de la playa. Las vistas sin HUD solo ocultan la interfaz durante la captura.

Si falta color, se conserva el terreno anterior. Si falta normal, se aplica el color sin el relieve nuevo.
`?noassets` conserva todo procedural. Las capturas se produjeron con navegador de software/emulación;
la aceptación de GPU física, teléfono y FPS sigue pendiente.

Catálogo: cuatro filas aplicadas — `arena-compactada` actualizada y tres nuevas para transición,
hierba y tierra. Revisión 7, 80 filas; fuentes, previews, atlas, recibo y aplicación descargables.
Abrir **http://127.0.0.1:5190**. Mapa local: **http://127.0.0.1:5192/?solo&debug&q=high&tod=day**,
pulsar Jugar y caminar desde la playa al pueblo/sendero. Fuera de este corte quedan conchas/cantos
como objetos independientes y palmeras; sin commit/push ni publicación nueva.
