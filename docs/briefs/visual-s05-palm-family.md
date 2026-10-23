# S05 — palmeras y atlas pintado del autor

Fecha: 2026-10-07. Ensayo local de la línea visual; no activa gameplay ni publica la demo.

El autor pidió seguir por piezas y añadió `texturas pintadas a mano palmera.png` junto con
`Atlas normal mapas de palmeras tropicales.png`. Son una lámina/atlas de componentes, con fondo gris,
no un material de corteza repetible sobre toda la imagen. La lámina `materials/references/palmera tropical.png`
define tronco segmentado cálido, hojas anchas con nervaduras/tinta y copas alta, curva y corta.

## Reutilización comprobada

El candidato existente `SM_Tree_Green_01.uasset` está en Dreamrise SMSK, 289.283 B. Su única preview
disponible, `docs/research/unreal-assets/survival/previews/BP_Harvestable_1.jpg`, muestra copa de árbol
frondoso común. Principal y worker la inspeccionaron; no se confirmó una palmera dentro de ese mesh.
No se exportó ni se alteró `C:\Unreal`. La búsqueda acotada en `materials` encontró el par nuevo y la
referencia, sin modelo de palma portable. Decisión: adaptar la geometría procedural existente a tres formas
y a UV del atlas del autor. La evidencia no permite afirmar qué otras dependencias ocultas contiene Unreal.

## Corte y contrato

- Tres modelos con dos partes: tronco/cocos y frondas. Normales geométricas, UV, color de fallback y
  atributos de viento propios. Máximo propuesto 200 KiB y 1.600 triángulos por modelo, sin texturas embebidas.
- Dos atlas compartidos, color sRGB y normal lineal: PC 1024, móvil 512. Recortes de corteza, dos hojas y
  un coco; fondo de hojas convertido en máscara de recorte, conservando tinta y huecos. Copias exactas de
  los dos PNG originales y receta/hashes fuera del bundle. Raíces, bases y restos de la lámina quedan pendientes.
- Posiciones, escala base, orientación, RNG, colisiones y datos de mapa conservados. Selección de variante
  por hash local de coordenadas del renderer; la corta tiene proporción propia, no solo escala reducida.
- Viento y flutter existentes en color, contorno y sombra. Alpha recortado también en contorno/sombra;
  frondas de doble cara. Padding de culling para el desplazamiento del viento.
- Filtro PCF del sol configurable con `shadowRadius`, por defecto 0,35: conserva huecos pequeños en
  high/medium sin aumentar el mapa 2048 ni reducir el encuadre ±30 u. Afecta también a los bordes de
  otras sombras. Low mantiene 1024; sus huecos interiores pequeños pueden perderse por resolución.
- Albedo perdido/noassets: formas pintadas geométricas con bordes rasgados. Normal perdido: albedo sin
  relieve adicional. Modelo perdido/inválido: geometría nativa con las mismas UV si existe el albedo.
- Normal del autor utilizado con fuerza reducida 0,16: su coincidencia visual no certifica un bake tangente
  sobre estos modelos. La pintura trae iluminación dibujada; se revisa con nuestra luz toon.

## Verificación y registro

Pruebas de geometría/UV/viento/selección y contratos de archivos. Capturas del mapa real y muestrario
temporal separado, PC, móvil emulado y low. Revisar normales del pase geométrico, alpha de sombras,
errores de shader y URLs/resoluciones cargadas. Ensayar pérdidas de albedo, normal, modelo y noassets.
Registrar tres palmas, copa y corteza con referencias, archivos y evidencia. Rendimiento en dispositivos
físicos, ajuste artístico del autor y publicación permanecen pendientes.
