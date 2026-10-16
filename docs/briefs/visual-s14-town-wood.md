# S14 — madera pintada del pueblo

Pedido del autor, 2026-10-07: integrar las texturas y normales recién añadidas a
`materials/references`, organizarlas por fila y probarlas en el pueblo actual.
Estética ilustrada moderna: vetas grandes, grietas con tinta y color cálido; relieve moderado.

## Alcance y aplicación

| Par recibido | Consumidor de esta entrega |
|---|---|
| Tablones | Paredes de las seis casas existentes |
| Tablones parchados | Mostrador del puesto de fruta |
| Piso de tablones | Plataformas de casas y mesa del puesto |
| Viga horizontal | Tres peldaños por casa, veta a lo largo de cada pieza |
| Madera sólida | Ocho postes actuales del muelle |
| Madera con hierro | Cuatro postes del puesto |
| Esquina exterior | Cuatro apoyos de esquina por casa |
| Puerta cerrada | Panel de puerta existente, recorte central del mapa |
| Ventana | Dos paneles por casa, recorte con marco y abertura pintada |

Son superficies sobre geometría existente. Los marcos/puertas son decoración; el negro de la ventana
queda opaco y la luz nocturna existente se conserva. No equivalen a huecos transitables ni a un kit
modular exportado. Techos, toldos, escala del pueblo, colisiones y RNG conservan su ruta anterior.
El material de muelle S13 sigue en su cubierta; S14 alcanza sus postes.

## Fuentes y presupuesto

Nueve pares PNG 1254². Copias exactas de los 18 originales fuera de `assets`, sin mover los archivos
del autor. Dos atlas compartidos 4×4: 2048² para PC, 1024² para puntero táctil; una variante por arranque.
Contenido por celda 480²/240², gutters 16/8 con borde duplicado. Color sRGB; normales RGB lineales,
WebP sin pérdida y convención del autor conservada. Intensidad inicial 0.18, sin desplazamiento.
Las celdas sobrantes contienen blanco/normal neutra para conservar los demás colores de los chunks.

Cruce Unreal/FAB: `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes\SM_SmallWoodeHut.uasset`
existe, 70.989 B. La casa Dreamrise completa tiene techo/rampa y no tiene GLB portable probado para
estas superficies. El atlas de balsa existente sirve como antecedente de UV/fallback, pero carece de
los nuevos marcos/puerta/parches. Se reutilizan las casas/puesto/postes del juego y los mapas del autor;
fuentes Unreal intactas, sin exportación ni auditoría de licencias.

## Gate local

Pruebas de igualdad de geometría/colores/índices y mapa/RNG; albedo y normal compartidos con fallbacks
independientes. Comparación con cámaras iguales PC/móvil/low, noche, vertical rotado, noassets y 404
separado de cada atlas. Revisar capturas reales, selección de URL/resolución/espacio de color, shaders y
cuatro cambios de calidad por caso. Congelar fuentes y verificar enlaces del catálogo.

FPS físicos, aprobación artística fina y publicación permanecen pendientes.
