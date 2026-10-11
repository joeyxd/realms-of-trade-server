# S15 — techos y toldo con acabado ilustrado

Entrega local del 2026-10-07. **Seis casas** reciben paja en tonos ocres con fibras y bordes
gastados; **un puesto del mercado** recibe lona usada, franjas rojo apagado/crema y costuras
pintadas. La madera S14 conserva sus nueve materiales. [Brief y decisión de recursos](../briefs/visual-s15-town-covers.md).

## Aplicación y coste

`townCovers.js` añade coordenadas locales y una máscara vec3 a los chunks de props. El shader
solo pinta las cubiertas seleccionadas, después del acabado de madera. La normal de S14 continúa
limitada a madera; paja/tela usan normales geométricas. El material fallback de cubiertas se separa
del de barcos y otros props para conservar sus shaders incluso sin assets.

| Medida real de props | Antes / después |
|---|---|
| Mallas / triángulos | 27 / 42.034, iguales |
| Chunks / triángulos de chunks | 8 / 37.520, iguales |
| Atributo añadido | `aTownCover`, 1.350.720 B (aprox. 1,29 MiB) |
| Vértices con pintura de paja / tela | 1.440 / 324 |
| Mallas, pasadas, imágenes o descargas añadidas | 0 |

La tela usa el mismo objeto de textura del atlas `tex:raft-comic-v1` que el muelle/balsa, una
sola solicitud por contexto. PC 1024² / 308.536 B, táctil 512² / 82.878 B; ambas variantes sRGB.
Solo muestrea la tela en las caras seleccionadas. Paja procedural y marcas con antialias por
derivadas; detalles finos se atenúan cuando son subpíxel. No se generan normales artificiales.
Estas cifras describen recursos y estructura; no miden FPS físicos.

## Evidencia local

**113/113** pruebas pertinentes pasan: nueva familia, madera/muelle, balsa, assets/catálogo y
regresión de arena, terreno, palmas, arbustos, pasto, restos, algas, rocas y agua. Las pruebas
verifican transformación/atributos, máscara neutra, materiales compartidos, no disposición del atlas
al disponer materiales y ausencia de lecturas del RNG o mutación de entradas del mapa.

[Recibo de navegador/GPU](../art/town-covers/runtime-evidence-v1.json): tres casos anteriores
PC/móvil/low y siete finales PC/móvil/low/noche/noassets/404-tela/vertical rotado; cuatro vistas
por caso y **40 capturas**. **28 cambios de calidad finales** reutilizan geometría/material/atlas.
Shaders enlazados, GL=0 y cero errores JS; solo 404 esperados de la prueba y favicon.
Si falta tela, el toldo conserva su pintura procedural y la paja continúa visible.

Posiciones, normales, colores, UV/máscaras S14, índices, matrices y estructura de sombras coinciden
con la fuente anterior en los tres pares; atributos/matriz de banderas animadas se excluyen del
comparador, conservando su índice/conteo/shader. Las cámaras coinciden exactamente. Los 1.259 props
conservan 220.024 B y SHA-256 `cbfcf7c7c00dcacd2bf241805951524f1cf7cc97c8debc42fce46198ee84674c`.

Capturas inspeccionadas: [casa PC](../art/town-covers/desktop-house-after-v1.png),
[antes](../art/town-covers/desktop-house-before-v1.png), [puesto PC](../art/town-covers/desktop-stall-after-v1.png),
[casa móvil](../art/town-covers/mobile-house-after-v1.png), [puesto móvil](../art/town-covers/mobile-stall-after-v1.png),
[Low](../art/town-covers/low-house-after-v1.png), [noche](../art/town-covers/night-house-after-v1.png),
[puesto nocturno](../art/town-covers/night-stall-after-v1.png), [sin assets](../art/town-covers/disabled-house-after-v1.png),
[sin tela](../art/town-covers/missing-cloth-stall-after-v1.png) y [vertical rotado](../art/town-covers/portrait-overview-after-v1.png).
Se comprobó también la vista general y el muelle. La silueta sigue siendo la pirámide escalonada existente;
el detalle de paja es una primera base pintada, sin mechones geométricos. El aviso de misión del HUD
puede cubrir la vista general durante la fixture de teletransporte; las vistas cercanas ocultan HUD.

## Catálogo y continuidad

Ocho fuentes congeladas: una anterior de props y siete finales; hashes/bytes de los dos atlas
reutilizados en el [recibo final](../art/source/town-covers-v1/final-v3/source-snapshot.json).
Tres recibos anteriores se conservan intactos como diagnóstico: se corrigió el comparador de
vértices neutros de `noassets` y los enlaces de código que el catálogo mantiene privados. Las
fichas enlazan sus copias congeladas, servibles bajo `docs/art/source`, con hashes comprobados.
El renderer no cambió durante esas correcciones; la entrega utiliza las copias `final-v3`.
El refresco solo admite las dos fichas exactamente escritas por este corte.
Filas nuevas `town-thatch-v1` (material) y `town-awning-v1` (objeto), con capturas y archivos.
`kit-techo`, `toldo-bandera-vela` y las filas anteriores conservan sus estados y contenido.
Catálogo revisión **28**, **101 filas / 46 aplicadas**; las 99 filas al comenzar este corte se
conservan exactamente. **55 enlaces HTTP** tienen bytes/SHA-256 iguales a los archivos locales.
Registrar de nuevo conserva la revisión. Las dos fichas abren sus imágenes/archivos:
42 imágenes decodificadas y 102 enlaces por ficha, cero errores JS. [Ficha del toldo](../art/town-covers/catalog-awning-v1.png)
y [ficha de paja](../art/town-covers/catalog-thatch-v1.png). Esas dos capturas de UI se conservan como
evidencia adicional a las 40 de gameplay; no son imágenes nuevas del bundle.

Siguiente pieza sugerida: cuerdas y amarres del muelle, después barriles/señales y variaciones de puestos.
Kit modular, techo irregular, telas animadas, arte fino, FPS físicos y publicación pendientes.
Sin cambios SQL/sim/protocolo, navegación, chat/agentes, Web3 ni personajes.
