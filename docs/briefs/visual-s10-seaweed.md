# S10 — algas someras pintadas

Fecha: 2026-10-07. Corte local integrado para dar silueta legible a las algas someras ya colocadas por el mapa. Cambio cosmético: reutiliza las posiciones `seaweed` existentes y no crea props, colisiones ni consumo de RNG. El pasto costero corresponde a S08.

## Reutilización revisada

El mapa ya genera props `seaweed` para el fondo submarino (`src/sim/worldgen.js`, bloque de underwater dressing). El renderer existente ya les da geometría y sway dentro de `src/render/vegetation.js`; S10 sustituye esa representación para dichos anchors, sin añadir una segunda población.

Se revisaron candidatos concretos del inventario Unreal/FAB disponible:

- `C:\Unreal\MyProject\Content\Orasot_Bundle\StylizedForestLandscape\Foliage\LanscapeGrassType\LGT_Sand_Rocket.uasset` (8.659 B): recurso de configuración de hierba, no una malla de alga verificada.
- `C:\Unreal\MyProject\Content\Orasot_Bundle\LowPolyForestVol2\StaticMeshes\Environment\SM_Env_plant_6.uasset` (19.881 B) y `C:\Unreal\MyProject\Content\Orasot_Bundle\LowPolyForestVol2\StaticMeshes\Environment\SM_Env_Grass_small.uasset` (19.148 B): candidatos genéricos de planta/hierba; contenido, dependencias, lectura submarina y encaje con el renderer actual no se verificaron.

No hay evidencia de una malla Unreal de alga revisada y aprobada para este uso. Se mantiene geometría procedural nativa, opaca y sin texturas nuevas hasta que un asset concreto demuestre mejor encaje.

## Contrato y presupuestos

- La selección parte únicamente de props `seaweed` existentes. Hash de coordenadas/semilla fija prioridad, orden y variante; el resultado mantiene prefijos estables al reducir el límite.
- Cada anchor debe tener coordenadas y escala finitas, suelo submarino entre -3.2 y -0.75, pendiente medida en su footprint no mayor que 1.4 y distancia al segmento de acceso del muelle de al menos `2.5 + radio`. Se conserva la normal real del suelo para inclinar las hojas sobre el fondo.
- La escala nunca supera la del prop ni `(-floor - 0.42) / 1.35`. El radio de colocación es `0.77 * escala`, con margen para sway; la cota superior usa `y + escala * (1.1 * ny + 0.77 * hypot(nx, nz)) <= -0.4`. La raíz se apoya en `floor - 0.035`.
- Tres estilos (`ribbon`, `fork`, `fan`) usan geometría indexada con atributos de posición, normal, color, UV y flexión. Altura máxima 1.1 y radio máximo 0.65; presupuesto máximo de 100 triángulos cerca y 40 en LOD reducido.
- Renderer por chunks de 24 m, tres variantes y dos LOD. Material opaco compartido, sin sombra propia, sin pase de contorno y sin texturas. Cambiar calidad conserva recursos.
- Presupuesto: high 256 instancias / distancia 65 / detalle cercano 22; medium o móvil 160 / 45 / 14; low 96 / 32 / sin detalle cercano.

## Estado de revisión

La semilla 99282957 conserva 197/216 posiciones: 58 cintas, 62 bifurcadas y 77 abanicos. Geometría cercana 60/84/72 triángulos; reducida 16 por forma. El primer filtro terrestre 0,35 se descartó al comprobar que la pendiente mínima submarina era aproximadamente 0,408.

83/83 pruebas pertinentes, seis propias S10; cuatro contextos nuevos de navegador PC/móvil emulado/low/noassets, sin errores JS de juego ni GL, programas enlazados. Capturas reales y galería temporal 1× inspeccionadas por el principal. Ver [entrega y límites](../delivery/seaweed-v1.md). La espuma/cáusticas actuales todavía limitan la lectura fina desde la cámara de juego. FPS físico, aceptación artística final y publicación pendientes.
