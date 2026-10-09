# Estudio alpha de personajes

Desde la raíz del repositorio, ejecutar `node tools/character-lab/server.mjs` y abrir
<http://127.0.0.1:5194/tools/character-alpha-lab/index.html>.

**Lámina** muestra el personaje completo generado. **Piezas** monta los PNG separados sobre una base:
cabello, ojos, cejas, boca, barba, camisa, pantalón, botas, guantes, arnés/cinturón, gafas, bolsa y cuerda.
Cada categoría permite quitar la pieza; las variantes disponibles vienen del catálogo. Cambiar de cuerpo
aplica sus opciones iniciales. Restablecer, acercar el rostro y los fondos ayudan a revisar el montaje.

El PNG descargado contiene solo el personaje, con transparencia, en 1024 × 1536. La ficha JSON describe
el cuerpo, modo, calidad y selecciones de esa exportación. El fondo y el zoom no se incorporan al PNG.
Los botones esperan la composición completa y una selección nueva invalida la exportación anterior.

El [manifiesto](../../docs/art/source/character-alpha-v1/manifest.json) declara `canvas`, `backgrounds` y
`bodies`. Cada cuerpo contiene `base`, `master`, `defaults` y `layers`. Cada asset tiene URL, hash y tamaño
original; `mobileUrl` sirve una copia de 512 px de ancho para pantallas de hasta 700 px. En móvil, el PNG
exportado sigue midiendo 1024 × 1536 y la ficha registra que usa fuentes reducidas.

`rect: [x,y,width,height]` sitúa una pieza en fracciones del lienzo. `sourceRect` selecciona su zona en
píxeles del original, escalada también para el PNG móvil. `mask: "base"` limita la barba al contorno de
la base durante la composición. Estas reglas no retocan los originales ni constituyen un contrato de rig.

Reproducir las comprobaciones con `node tools/character-alpha-lab/qa-preview.mjs`; las capturas y descargas
quedan en `docs/art/character-alpha-v1/`. `capture-review.mjs` conserva vistas completas y el canvas.
La [entrega](../../docs/delivery/character-alpha-v1.md) separa QA técnico y revisión artística.

Esta es una vista ilustrada 2D fija. El catálogo inicial tiene opciones limitadas, una nariz y un tono de
piel por base. No guarda perfil de juego, no tiene rotación 3D y no acredita animación ni equipo autoritativo.
