# S01 — familia de arena y pequeños objetos de playa

Fecha: 2026-10-06. Dirección solicitada por el autor: ilustrado moderno, lectura tipo sprite y carácter
de cómic cercano a Borderlands. Primer trabajo por filas del [catálogo](../../tools/art-catalog/README.md).
Este corte ya aplica al mapa la familia entregada por el autor. El ajuste artístico final y la publicación
siguen pendientes; ver [entrega y capturas actuales](../delivery/sand-family-v1.md).
Las rocas independientes ya tienen su [primer corte S02](../delivery/coast-rocks-v1.md): tres siluetas
de SM_Rock aplicado sobre arena, con revisión artística pendiente. Conchas y cantos ya tienen su
[corte S04](../delivery/beach-details-v1.md): tres conchas y grupos pequeños de SM_Rock, sin texturas nuevas.
La arena compactada y las nuevas transiciones a hierba/tierra ya tienen [entrega S03](../delivery/ground-family-v1.md),
con pares del autor, atlas PC/móvil y aplicación en playa/senderos/pueblo.

**Selección posterior del autor:** prefiere `materials/Textura de arena dorada con guijarros y conchas.png`
para arena seca. Esa imagen es la base visual actual; v1/v2 generadas quedan como alternativas históricas.
[Fuente exacta](../art/source/sand-dry-selected-v1.png), [escritorio 1024](../art/sand/sand-dry-selected-v1-desktop.webp),
[móvil 512](../art/sand/sand-dry-selected-v1-mobile.webp) y
[registro de procedencia/derivados](../art/sand/sand-dry-selected-v1-receipt.json).

## Lectura de la lámina

**Aplicación actual:** nueve fuentes PNG conservadas y cinco acabados con pares de color/normal;
seca, mojada con normal compartida, ondulada y muestra de arena de orilla; el par pintado de huellas se conserva.
**Ampliación solicitada:** [huellas al caminar](../delivery/sand-footprints-v1.md), alternadas y con
desvanecimiento de 18 a 5 segundos según humedad. Sustituyen por defecto la banda estática.
WebP 1024/512 en el manifiesto y shader del terreno, registrados por fila con evidencia PC/móvil emulado.
La imagen completa de orilla conserva su agua pintada solo como referencia; el runtime usa un recorte
de arena con la misma normal. Arena compactada y objetos grandes siguen pendientes.
Las propuestas y derivados anteriores de este brief se conservan como historial del proceso.

Fuente local inspeccionada: `materials/references/arena.png`. Copia exacta para el catálogo:
[beach-sand-board-v1.png](../art/references/beach-sand-board-v1.png). La lámina es una referencia de
aspecto: las esferas no contienen archivos de albedo, normal, roughness ni geometría descargables.

| Fila | Aspecto y uso | Producción recomendada |
|---|---|---|
| Arena seca | Dorada/ocre, surcos definidos, guijarros entintados y conchas finas | Imagen seleccionada por el autor; revisar escala, repetición y sombreado incorporado antes de aplicar |
| Arena húmeda | Más oscura y saturada; superficie visualmente más lisa | Misma base con máscara de humedad, tinte y respuesta de brillo propia del shader |
| Arena con conchas | Mayor presencia de conchas reconocibles | La base seleccionada ya incluye conchas finas; ampliar localmente con piezas grandes y agrupaciones |
| Arena compactada | Menos grano, surcos largos y zonas pisadas | Segundo albedo/relieve suave cuando aporte diferencia; máscara localizada en paso y carga |
| Arena de orilla | Arena mojada/sumergida y espuma que toca el borde | Mezcla seca/húmeda + agua/espuma por profundidad; compartir la referencia de altura de la costa |

La referencia muestra además rocas medianas/grandes, cantos, conchas, huellas, madera varada y algas.
Las rocas que sobresalen requieren mallas: una textura no aporta silueta, paralaje ni sombra de contacto.
Preparar tres siluetas de roca y un grupo bajo de cantos, variando escala/rotación de manera controlada.
Conchas: dos o tres siluetas marfil; madera varada: rama, tronco y tabla; algas en grupos reducidos.
Huellas: el primer corte estático fue sustituido por decals individuales producidos por la animación
al caminar; ver la ampliación aplicada arriba. Sin deformación ni persistencia de rastros.

## Arquitectura propuesta

Un sistema de arena comparte base, escala, paleta y máscaras entre los cinco acabados. Las cinco filas
siguen existiendo para revisión individual; no obligan a cinco paquetes PBR completos. Primer objetivo:
un albedo seco, un acabado compactado si es necesario y mezcla húmeda/orilla por shader; objetos encima.

`src/render/terrain.js` ya separa arena seca/húmeda por altura, pendientes rocosas, camino y vegetación,
con detalle procedural. Su albedo final reemplaza `diffuseColor.rgb`; añadir una textura al manifest o a
`material.map` por sí solo no hará que aparezca. Hace falta un consumidor explícito dentro de esa mezcla.
`src/render/water.js` ya tiene espuma de contacto y redes de espuma en aguas someras; se ajustarán sobre
el resultado del terreno. Una banda blanca pintada en el albedo repetiría espuma inmóvil sobre la playa.

El adaptador `src/render/assets/toonmat.js` no conserva roughness/metallic/AO. Por eso el brillo de arena
mojada exige un tratamiento explícito y contenido en el shader; no basta subir un roughness map. Arena
se mantiene dieléctrica, sin metallic. Normal/height solo se producirán si el ensayo demuestra su utilidad;
el color de albedo no se tratará automáticamente como altura física. El relieve grande lo aporta el suelo.

Preservar el terreno de colisión y las máscaras existentes de piedra/camino: la zona de arena compactada
no debe convertir todos los caminos de la isla en playa. El primer ensayo se coloca en un tramo costero
acotado, con un personaje para escala y la iluminación normal del juego. Mantener fallback procedural.

## Reutilización comprobada antes de generar

Se revisó el inventario existente y se verificaron paquetes concretos en disco, sin cambiar Unreal:

- `C:/Unreal/MyProject/Content/SlashTrailElemental/Resource/Texture/T_Sand_M_00.uasset`, 577.831 B.
  JPEGs embebidos de 256 y 1024 inspeccionados: granular/fotográfico, tonos azul gris/marrón. No encaja
  con la autoría pintada del primer corte. La extracción de una imagen no valida todo el material Unreal.
- Grava Megascans `NiagaraExamples/Gallery/Megascans/Surfaces/Gravel_Ground_xbnefjm/Medium/xbnefjm_tier_2/Textures/`:
  `_B` 9.257.303 B, `_N` 12.964.807 B y `_ORM` 7.705.538 B; previews PBR inspeccionadas. No seleccionadas
  para esta arena por aspecto granular y por requerir adaptación/exportación. Tamaño de paquete no es VRAM.
- `C:/Unreal/survival project/SimpleMultiplayerSurvival/Content/Dreamrise_SMSK/Assets/Meshes/SM_Rock.uasset`,
  22.059 B: miniatura muestra una roca angular low-poly que podría servir en una prueba toon. Exportación
  de malla/material y geometría completa pendientes; conservar como candidato para rocas, sin recrearlo aún.

Rutas inventariadas: [MyProject](../research/unreal-assets/myproject/files.csv),
[Supervivencia](../research/unreal-assets/survival/files.csv). Previews de diagnóstico en `.scratch/sand-reuse/`.
Se genera albedo provisional propio para ajustar estilo; no se importa ninguno de esos paquetes al runtime.

## Recursos preparados en este corte

- `docs/art/source/sand-dry-v1.png`: primera propuesta generada. La prueba 3 × 3 mostró cortes de manchas;
  conservada como iteración, no elegida para integración.
- `docs/art/source/sand-dry-v2.png`: segunda propuesta, distribución más tranquila y menos bandas largas.
  Candidato inicial, sustituido por la imagen preferida por el autor; revisión de repetición abierta.
- `docs/art/sand/sand-dry-v2-desktop.webp`: derivado de 1024 × 1024, WebP calidad 85.
- `docs/art/sand/sand-dry-v2-mobile.webp`: derivado de 512 × 512, WebP calidad 82.
- `docs/art/sand/sand-dry-v{1,2}-repeat-3x3.png`: pruebas planas de repetición inspeccionadas.
- `docs/art/sand/sand-dry-v{1,2}-prompt.txt`: prompts exactos; herramienta integrada `image_gen`.
- [sand-dry-v2-receipt.json](../art/sand/sand-dry-v2-receipt.json): tamaños/hashes y parámetros de derivados.

La v2 reduce bandas, pero siguen visibles algunas interrupciones de manchas en las uniones del mosaico.
No se declara seamless aprobada: corregir bordes o probar una mezcla que elimine discontinuidades y
repeticiones antes de adoptarla. Se registró inicialmente como «Archivos preparados»; ahora la fila muestra
la selección del autor y conserva v2 como alternativa histórica.
Los derivados son candidatos en `docs/`; solo los aceptados se trasladarán a `assets/` y tendrán consumidor.

### Imagen seleccionada y revisión actual

Original del autor: 1254 × 1254, 3.728.793 B. Copia `sand-dry-selected-v1.png` exacta por SHA-256;
el archivo de `materials/` permanece intacto. Conversión mecánica con FFmpeg/Lanczos, sin cambiar el arte:
escritorio 1024 × 1024 WebP calidad 88, 441.600 B; móvil 512 × 512 WebP calidad 85, 97.836 B.
La resolución móvil y el derivado escritorio se inspeccionaron visualmente; selección por dispositivo y
lectura dentro del juego siguen pendientes.

[Prueba 3 × 3](../art/sand/sand-dry-selected-v1-repeat-3x3.png) inspeccionada: sin una unión brusca evidente,
pero se reconocen grupos repetidos de conchas/guijarros y formas de surcos. No se afirma igualdad exacta
de píxeles entre bordes. Revisar frecuencia de repetición y variación en el parche de costa antes de extender.
Los guijarros/conchas y sus pequeñas sombras están pintados en el bitmap; la iluminación del juego afectará
la superficie completa, sin dar volumen/sombra independiente a esos detalles. Rocas mayores van como mallas.
La preferencia artística está elegida por el autor; la integración técnica y su aceptación visual son otro paso.

## Ruta de aplicación por filas

1. **Seca:** usar la imagen dorada seleccionada, revisar bordes/repetición y probar escala en un parche de playa.
   Comparar plano 3 × 3, cámara de juego y acercamiento; fijar paleta/contraste con el personaje visible.
2. **Húmeda:** derivar mezcla irregular seca/mojada con los mismos datos de costa. Revisar tinte y brillo
   en día/sombra; evitar zonas que parezcan barro o plástico. No producir una textura extra si no aporta.
3. **Orilla:** ajustar espuma y arena sumergida sobre ese parche. Revisar contacto con una roca, costa
   irregular y vista low; espuma pertenece al agua y la mezcla sigue la profundidad real.
4. **Compactada:** añadir una zona pequeña de paso con marcas amplias y suaves, manteniendo piedra y
   vegetación fuera. Revisar que se distinga sin un borde rectangular ni pérdida de lectura del combate.
5. **Conchas y rocas:** probar SM_Rock exportado si encaja; preparar conchas/cantos independientes,
   colocación dispersa y contactos. Huellas y madera/algas cierran el rincón sin cubrir toda la playa.
6. **Aplicación y evidencia:** integrar una variante por dispositivo; confirmar URL/resolución cargada,
   capturas antes/después PC y móvil emulado, consola y fallback. Registrar evidencia por fila antes de
   marcar «Aplicado». Medidas de bytes y texels no prueban FPS en un teléfono físico.

Esta ruta desarrolla el rincón visual de V02 en paralelo; no acepta V00/V01 del puerto ni altera la cola
D06/D08/D09, persistencia de perlas, gameplay, protocolo o demo publicada.
