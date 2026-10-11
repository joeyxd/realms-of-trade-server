# S08 — matas pequeñas de hierba volumétrica

Fecha: 2026-10-07. Corte local para dar volumen a las praderas y los bordes costeros con grupos pequeños de hojas geométricas pintadas. Es detalle de render: no cambia terreno, colisiones, props, RNG del mundo ni gameplay.

## Reutilización revisada

Se comprobaron estos candidatos concretos del inventario Unreal, en solo lectura:

- `C:\Unreal\MyProject\Content\BigNiagaraBundle\NiagaraWeather\StatickMesh\SM_Leaf.uasset` (101.110 B): candidato de hoja asociado a Niagara; no se verificó como malla reutilizable de pasto ni su compatibilidad/dependencias.
- `C:\Unreal\MyProject\Content\BigNiagaraBundle\NiagaraWeather\Textures\T_Leaf_1.uasset` (2.595.733 B): textura de hoja; no se verificó su contenido, recorte ni encaje con la geometría opaca del corte.
- `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Levels\Grass_LayerInfo.uasset` (1.591 B): recurso de capa de terreno, no una malla de hierba; sus datos y dependencias no se verificaron.

Se usa geometría procedural nativa del renderer, sin imágenes ni texturas nuevas; el navegador descarga los tres módulos JavaScript de pasto. Las plantas pequeñas junto a palmeras siguen siendo responsabilidad de S06; el registro existente `hierbas-algas` permanece pendiente y conserva sus variantes de hierba costera y alga somera.

## Contrato

- Un modelo de clump por instancia, con tres estilos estables (`tuft`, `fan`, `wild`), hojas estrechas, curvas y con orientación radial variada. El color de vértice pinta el verde oscuro de la base y los reflejos cálidos lima.
- Material toon opaco de doble cara y viento del renderer existente. Sin mapas ni alpha: el contorno geométrico de cada hoja evita tarjetas rectangulares y alpha overdraw.
- La distribución comparte `shrubSite` y su contexto para despejar palmeras, arbustos, edificios y accesos. Usa hashes de coordenadas/semilla, sin consumir RNG de simulación ni crear colisionadores.
- Las matas son cosméticas. No tienen sombra propia (`castShadow: false`), reciben la sombra existente y se colocan en `NO_OUTLINE` para evitar un segundo pase de contorno.
- Presupuesto por calidad: high 600 instancias, radio 55 y detalle cercano hasta 24; medium/móvil 320, radio 38 y detalle hasta 14; low 160, radio 28 y todas las instancias lejanas usan la geometría reducida.
- En calidad baja cada clump baja de cuatro a dos triángulos por hoja. Las tres formas usan 7/9/11 hojas: 28/36/44 triángulos detallados y 14/18/22 en low.

## Comprobación local requerida

Registrar el seed de mapa, cantidades y variantes efectivamente generadas, instancias activas y triángulos por calidad. Revisar capturas de mapa real en escritorio, móvil emulado y low, además de una galería temporal y previews de cada estilo. Confirmar en runtime la ausencia de texturas/alpha, el viento toon, la lectura de silueta, el presupuesto de detalle/distancia y la conservación de las zonas despejadas.

La revisión emulada no mide FPS en dispositivo físico. No afirmar aceptación visual final, rendimiento físico ni publicación a partir de estas capturas.
