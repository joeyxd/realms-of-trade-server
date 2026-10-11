# S04 — conchas y cantos aplicados en la costa local

Fecha: 2026-10-06. Dos filas completadas técnicamente en el catálogo: `conchas-playa` y `cantos-guijarros`.
Primera versión de arte, pendiente de ajuste con el autor. [Alcance y reutilización](../briefs/visual-s04-beach-details.md).

| Pieza | Archivo portable | Triángulos | Bytes |
|---|---|---:|---:|
| Concha abanico | `assets/models/beach-shell-fan-v1.glb` | 80 | 9.700 |
| Concha ovalada | `assets/models/beach-shell-oval-v1.glb` | 96 | 11.432 |
| Fragmento de concha | `assets/models/beach-shell-chip-v1.glb` | 48 | 6.248 |
| Grupo de tres cantos | `assets/models/beach-pebbles-v1.glb` | 192 | 21.796 |

Total de descarga nueva: **49.176 B**, los mismos cuatro modelos para PC y móvil. Sin imágenes, rigs,
animaciones ni texturas nuevas. Cada modelo contiene posición, normales geométricas y color por vértice.
No son PNG de normales ni una simulación de conchas recogibles. El GLB usa un material blanco como soporte
del color pintado; las nervaduras antialias en coral oscuro son un acabado del shader del juego y no se
exportan como shader portátil en el GLB.

Fuente editable y distribución: `src/render/beachDetails.js`. Material/toon e instancias:
`src/render/vegetation.js`. Generación reproducible: `tools/prepare-beach-details.mjs`; fuentes/hash/bounds
en `docs/art/source/beach-details-v1/receipt.json`. Copias exactas del código para descarga por el catálogo,
con hashes propios, en `docs/art/source/beach-details-v1/source-snapshot.json`; el catálogo conserva su
allowlist de `assets`/`docs`, sin abrir el resto de `src`/`tools`. El grupo de piedras deriva del mismo SM_Rock de S02,
sin volver a exportar ni modificar Unreal. La ausencia de conchas utilizables se revisó en el inventario.
La primera forma demasiado plana se corrigió a volumen convexo antes de aceptar este corte; el borrador
y su recibo se conservaron en `docs/art/source/beach-details-v1/draft-flat/`. El generador protege las
salidas registradas: una siguiente revisión artística necesita otro corte/versionado.

En la semilla real actual `99282957` aparecen **100 conchas y 58 grupos de cantos**. El límite global es
144/96; otras semillas pueden producir cantidades distintas. Se distribuyen por hash espacial independiente
del RNG del mundo, en arena expuesta entre 0,22 y 1,38 u, con pendiente suave. El apoyo se inclina a la
normal del suelo y hunde la base 0,008 u. Se mantienen libres caminos, muelle, tutorial, spawn y proximidad
de NPC/props. Son decoración del renderer; no se modifica el mapa compartido, sus props ni colisiones.

Instancias en chunks de 48 u: 64 batches en toda esta isla y 18.624 triángulos base si se dibujara todo.
El frustum selecciona los chunks visibles; esas cifras **no son llamadas de un frame medido ni FPS**.
Se omiten sombra proyectada y contorno por postproceso para estas piezas pequeñas; borde pintado y luz
toon conservan su lectura. Reciben las sombras existentes. Las nervaduras se suavizan por tamaño de píxel
y distancia (18–38 u), y permanecen como pintura de superficie también en low.

Comprobaciones realizadas:

- **50/50 pruebas pertinentes**: cuatro nuevas de elegibilidad/pendientes/accesos, distribución determinista,
  invariancia de props/colisiones, geometría finita sin triángulos degenerados y budgets del GLB/manifiesto;
  más las pruebas previas de terreno, arenas, rocas, huellas, assets, balsa y catálogo.
- `prepare-beach-details.mjs --check`: receta, cuatro GLB y recibo idénticos a los archivos preparados.
- Juego real local: PC 1280×720/high, móvil emulado 844×390/medium y low. Cuatro GLB cargados y solicitados
  una vez por contexto, cero errores JS/juego/assets y `glError = 0`. Se inspeccionaron mapa, contacto y previews.
- Fallos de los cuatro modelos: 404 y GLB inválido conservan las 158 colocaciones con geometría procedural,
  sin errores de ejecución; el registro informa los cuatro fallos esperados. `noassets` conserva las
  colocaciones sin solicitar modelos y usa cantos de 60 triángulos en lugar de SM_Rock.
- La consola incluye un 404 auxiliar no identificado por el listener de respuestas, sin error del registro
  en los casos normales. No se afirma una consola totalmente vacía.
- [Evidencia detallada de seis casos](../art/beach-details/browser-evidence-v1.json).
- Catálogo vivo: **33 enlaces** registrados verificados byte por byte, revisión 9/80 filas; preview de
  conchas abierta en la interfaz y cargada a 1280 px. Registrar otra vez conserva la misma revisión.

Capturas inspeccionadas del mapa real: [PC](../art/beach-details/desktop-map-clean-v1.png),
[contacto real](../art/beach-details/desktop-contact-v1.png),
[móvil emulado](../art/beach-details/mobile-map-clean-v1.png),
[contacto móvil](../art/beach-details/mobile-contact-v1.png),
[low](../art/beach-details/low-map-clean-v1.png),
[404](../art/beach-details/missing-map-clean-v1.png),
[sin assets](../art/beach-details/disabled-map-clean-v1.png).
Las cámaras se congelaron para comparar arte. Las tomas con HUD conservan overlays del último tick y no
aceptan su colocación como revisión de interfaz. Las tomas limpias ocultan solo la interfaz.

El [muestrario](../art/beach-details/desktop-gallery-v1.png) y las previews individuales
([abanico](../art/beach-details/shell-fan-preview-v1.png), [ovalada](../art/beach-details/shell-oval-preview-v1.png),
[fragmento](../art/beach-details/shell-chip-preview-v1.png), [cantos](../art/beach-details/pebbles-preview-v1.png))
añaden temporalmente los mismos modelos a **escala 1,7×**, ocultando vegetación para ver el acabado.
Esas piezas ampliadas no se guardan ni forman parte de la distribución del mapa; las capturas de contacto
anteriores sí usan una concha existente a escala real.

Ver el juego en `http://127.0.0.1:5192/?solo&debug&q=high&tod=day`: pulsar **Jugar** y bajar hacia la orilla.
Catálogo local en `http://127.0.0.1:5190`, revisión 9/80 filas, con fuentes/modelos/previews/capturas.
Ningún commit, push o despliegue público en este corte. Repetición de la arena, palmas/agua, revisión final
de arte, coste de inicialización y FPS en teléfono físico siguen abiertos. Siguiente por piezas: familia de palmeras.
