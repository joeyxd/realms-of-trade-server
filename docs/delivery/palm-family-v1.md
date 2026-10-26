# S05 — palmeras pintadas y luz entre las hojas

Fecha: 2026-10-07. Entrega local de arte: tres palmeras, copa y corteza. Primera versión aplicada,
pendiente de ajuste artístico con el autor y de rendimiento en dispositivos físicos.
[Brief y decisión de reutilización](../briefs/visual-s05-palm-family.md).

| Modelo | Triángulos | Bytes | Palmeras de esta semilla |
|---|---:|---:|---:|
| `palm-tall-v1.glb` | 1.016 | 123.256 | 93 |
| `palm-curved-v1.glb` | 1.064 | 125.740 | 77 |
| `palm-short-v1.glb` | 1.112 | 128.208 | 64 |

Los tres GLB suman **377.204 B** y contienen dos partes, sin imágenes ni rigs: tronco/cocos y frondas.
Incluyen UV, normales geométricas, color de fallback y atributos propios de viento. El material blanco del
GLB es soporte portable; la pintura, el shader toon, el viento y las sombras se montan en el renderer.
La selección por hash de coordenadas conserva las **234 posiciones**, escala base y orientación de
la semilla `99282957`, sin consumir RNG del mundo ni modificar sus props, colisiones o gameplay.

Se conservaron copias exactas de los PNG del autor: `texturas pintadas a mano palmera.png` y
`Atlas normal mapas de palmeras tropicales.png`. De ese atlas opaco se recortaron corteza, dos hojas y
cocos en cuatro cuadrantes con gutter. El albedo es sRGB y el normal es dato lineal, con fuerza **0,16**.
La coincidencia visual del par no certifica un bake tangente específico para estos modelos.

| Atlas compartidos | Resolución | Albedo B | Normal B | Par B |
|---|---:|---:|---:|---:|
| PC | 1024 × 1024 | 162.998 | 889.632 | 1.052.630 |
| Móvil | 512 × 512 | 58.454 | 299.440 | 357.894 |

Descarga nueva de la familia, modelos más el par elegido: **1.429.834 B PC** o **735.098 B móvil**.
No se añaden samplers al shader de terreno. El primer atlas v1 dejaba interiores negros opacos;
se preservó como borrador y v2 corrige esos huecos. Los modelos v1 usan las mismas UV con el atlas v2.
Los generadores y recibos protegen las salidas existentes: otra revisión debe tener otra versión.

## Sombras y viento comprobados

Las frondas son de doble cara, con recorte alpha **0,35** en color, contornos y sombras. El pase de
normales de Three r160 necesita recorte explícito para que el contorno no rellene los huecos; el pase
de sombra usa el recorte estándar de MeshDepthMaterial. Su movimiento replica el mismo reloj,
fase por instancia, sway y flutter de la superficie. Los bounds incluyen padding para el viento.

El filtrado PCF de radio 1 borraba los huecos pequeños. `Lighting` ahora admite `shadowRadius`, con
valor por defecto **0,35**: estrecha el filtro del sol y hace también más definidos los bordes de las
otras sombras. Se conserva el mapa de **2048** en high/medium, **1024** en low y el encuadre de juego
de ±30 u. No se aumentó la resolución ni se agregó un pase de luz.

El ensayo temporal de una sola fronda de producción separa sus huecos de otras hojas superpuestas.
[Recorte activo](../art/palms/desktop-shadow-holes-v1.png) y
[control sin recorte de sombra](../art/palms/desktop-shadow-solid-control-v1.png) muestran la diferencia.
Las tomas de reloj [0](../art/palms/desktop-shadow-wind-0-v1.png) y
[2,1](../art/palms/desktop-shadow-wind-2-v1.png) muestran el desplazamiento de sombra y luz.
No se afirma que cada agujero quede visible bajo una copa completa: otras hojas pueden taparlo.
En low los huecos interiores pequeños no se distinguen en esta captura, por la resolución reducida.

## Verificación local

- **56/56 pruebas** en diez archivos pertinentes: palmas/materiales, playa, terreno, arenas, rocas,
  huellas, assets, balsa y catálogo. Cuatro comprobaciones de sintaxis y dos generadores `--check` pasaron.
- PC 1280×720/high, móvil emulado 844×390/medium y low: modelos y atlas previstos, cero errores
  JS/juego, `glError = 0` y programas enlazados. Móvil tiene pointer coarse y carga solo el par 512.
- Cinco ensayos adicionales: modelos 404, modelos inválidos, albedo perdido, normal perdido y
  `noassets`. Conservaron 234 palmas y no produjeron errores de ejecución ni de shaders.
  El registro informa los fallos de carga provocados. Sin albedo se usan hojas geométricas rasgadas
  y color por vértice; sin normal se conserva pintura; sin modelo se usa geometría nativa compatible.
- La consola del contexto desktop incluye un 404 auxiliar no capturado por el listener de respuestas.
  No se afirma consola totalmente vacía. [Resultados completos de ocho casos](../art/palms/browser-evidence-v1.json).
- Fuentes exactas descargables y hashes en `docs/art/source/palm-family-v1/source-snapshot.json`;
  originales/recortes/máscara/hashes en `docs/art/source/palm-textures-v2/receipt.json`.

Capturas del [mapa real PC](../art/palms/desktop-map-clean-v1.png),
[contacto PC](../art/palms/desktop-contact-v1.png),
[contacto móvil](../art/palms/mobile-contact-v1.png) y [low](../art/palms/low-map-clean-v1.png).
El [muestrario](../art/palms/desktop-gallery-v1.png) y las previews individuales son objetos temporales
a escala de modelo **1×**, con vegetación oculta; no se guardan en el mapa. Se mantuvieron terreno,
personajes y FX existentes. La cámara y el reloj se congelan para comparar; los HUD conservan su
último tick y estas tomas no aceptan la colocación de overlays. La toma de contacto usa palmas reales.

Catálogo local: cinco filas existentes `palma-alta`, `palma-curva`, `palma-corta`, `copa-palma-doble`
y `m08-corteza`, con originales, GLB, atlas, fuentes, previews y capturas. **52 enlaces** verificados
byte por byte en revisión **10**, 80 filas y 24 aplicadas. Registrar de nuevo conserva esa revisión.
Los verificadores de S01–S04 también pasaron: 47 enlaces de arena, 44 de terreno, 13 de rocas y 33 de playa.
La ficha «Palma alta» se abrió en la interfaz HTML: preview 1280×720, referencia y atlas cargados;
[captura del catálogo](../art/palms/catalog-palm-v1.png). Las imágenes inferiores usan carga diferida.
Juego local: `http://127.0.0.1:5192/?solo&debug&q=high&tod=day`; catálogo: `http://127.0.0.1:5190`.

No hubo commit, push ni despliegue público. M5/D08 permanece independiente. Quedan revisión artística
de proporciones y repetición de corteza, FPS físicos y coste de inicialización. Raíces, vegetación de base,
restos del atlas y recogida de cocos no forman parte de este corte. Próxima pieza propuesta: base/raíces.
