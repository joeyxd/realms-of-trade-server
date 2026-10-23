# S21 — ampliación y terrazas del mapa

## Resultado y límite

Ampliar el terreno jugable alrededor del mapa existente y ordenar el pueblo en tres niveles conectados por rampas. La transformación conserva el diseño superior, las ubicaciones y la orientación de los objetos y zonas: el pase cambia únicamente el terreno. Los puntos de apoyo del pueblo quedan planos para las seis huts existentes.

Se mantienen protegidos el boss y volcán, la Cala PvP, el muelle y la llegada. Se añade únicamente terreno seco conectado para permitir crecimiento futuro. No se agregan objetos, zonas, edificios ni contenido. Las reglas de combate, navegación, recolección y construcción siguen fuera de este pase.

## Terreno y continuidad

El terreno pasa de una cuadrícula 400 / N401 a 560 / N561, resolución 1. El pueblo tiene cotas de 2,4 / 6,4 / 10,4, con rampas transitables y seis plataformas planas para las huts. La extensión conecta al terreno previo y conserva el litoral de las zonas protegidas. La superficie seca aumenta 63,148347 % en la medición final, con muestreo cada 2 unidades y umbral de suelo mayor que 0,65. Dos conexiones suaves permiten llegar caminando a puntos interiores: 171 y 109 aristas, con ascensos maximos de 0,1412 y 0,1377 por paso (limite 0,15). Se conservan los núcleos húmedos; no se agregan puentes ni assets.

El proceso de terreno nativo vive en `src/sim/terrainRevamp.js`; usa materiales existentes y no agrega texturas ni modelos. Los float grids combinados legacy y nuevo ocupan 1.902.088 B; la carga GPU del terreno posterior es 4.891.272 B. Los paneles M ampliados usan un span de 255. La versión es 0.1.0-alpha.15 y el protocolo 31 requiere que los peers recarguen para usar la misma revisión. Se conserva la cantidad y colocación del follaje nativo legacy, sin dispersar follaje nuevo sobre el terreno añadido.

## Reutilización comprobada

La revisión acotada del inventario Unreal no encontró heightmap ni terreno exportable listo para esta extensión. Los candidatos más cercanos son:

| Candidato | Bytes | Evidencia y decisión |
|---|---:|---|
| `Dreamrise_SMSK/Assets/Meshes/SM_Mountain_A.uasset` | 466.592 | Malla Unreal de montaña; no es heightfield ni exportación portátil. No se exporta en este pase. |
| `Dreamrise_SMSK/Assets/Materials/M_Landscape.uasset` | 41.539 | Material Unreal; no contiene datos de altura y su grafo no se usa en el renderer web. |

Se conserva la ruta de terreno nativa y determinista. Las fuentes `C:\Unreal` permanecen intactas y no se exportan assets de esos candidatos durante este pase. Esta conclusión describe únicamente la auditoría acotada de candidatos; el catálogo del juego se gestiona aparte.

## Elementos preservados

La RNG legacy, simulación y objetos mantienen su estado y coordenadas XZ. Se conservan las posiciones de las seis huts y de los 1.259 props. Permanecen los 176 recursos: 96 palmeras, 69 nodos de piedra y 11 nodos de madera; solo cambia la altura Y que sigue la superficie nueva. Los snapshots longitudinales de arbustos y algas marinas tampoco cambian. Boss, volcán, Cala PvP, llegada y muelle se conservan como áreas de referencia y contenido existente.

## Aceptación y evidencia

- 220/220 pruebas pasan en 37 archivos.
- 30 capturas: 5 vistas previas de escritorio y 25 posteriores en cinco dispositivos (escritorio, móvil, calidad baja, retrato y sin assets) por cinco vistas (pueblo, isla, volcán, boss y PvP). Los 20 chequeos high/low/medium/high son verificaciones de datos de transiciones de calidad, no capturas PNG adicionales.
- El panel M ampliado se probó en escritorio y móvil: se abre con M y cierra con Escape. El umbral de conectividad es 100 % de los componentes con altura >0,2; span 255 ajusta todos los puntos de interés.
- Coste de terreno: 64.136 triángulos posteriores frente a 47.882 previos.
- Se revisaron escritorio, móvil, calidad baja, retrato y modo sin assets. Sin errores de GL, enlaces, carga de assets o juego en la evidencia revisada.
- Superficies secas, terrazas y seis apoyos de hut quedan conectados y a nivel; los puntos protegidos permanecen en el mapa.

Catálogo rev. 36 (110 filas, 54 aplicadas); fuentes y enlaces HTTP comprobados.

Entrega local: [informe](../delivery/map-revamp-v1.md), [evidencia de layout](../art/map-revamp/layout-evidence-v1.json) y [evidencia runtime](../art/map-revamp/runtime-evidence-v1.json).

FPS físicos y juego en red local aún no se aceptan; la entrega sigue local y no está publicada.
