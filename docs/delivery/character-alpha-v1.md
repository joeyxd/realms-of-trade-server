# Kit alpha ilustrado v1 — estudio 2D

**Actualización posterior, 2026-10-08:** el autor indicó «se ve fantástico» y autorizó investigar/probar
la conversión 3D. El look queda aceptado como dirección visual del [piloto Meshy](character-3d-pilot-v1.md).
Las menciones de aceptación pendiente abajo describen el estado al entregar este estudio; la nueva
aceptación del arte ilustrado no cierra rig, modularidad 3D ni integración al juego.

Fecha: 2026-10-08. Esta entrega prepara una nueva dirección ilustrada para el creador de personajes, a
partir de la referencia Horizon Tides del autor. **QA técnica local aprobada; aceptación visual final del
autor pendiente.** La revisión busca el estilo de la referencia sin afirmar coincidencia pixel por pixel.
No cierra P02/P03, no produce modelos 3D y no se integra a la partida.

## Qué contiene

`docs/art/source/character-alpha-v1/` conserva 29 intentos originales. Se seleccionaron 27 imágenes para
el estudio: 26 PNG con transparencia para personajes y piezas, más un fondo opaco de puerto. Las fuentes
seleccionadas suman 32,320,538 B; sus derivados móviles suman 4,290,112 B. `manifest.json`
las organiza en un lienzo fijo de 1024 × 1536 para dos cuerpos, Explorador y Exploradora. El conjunto
incluye láminas master, bases, rostro, cabello/barba, prendas y piezas de explorador. Las fuentes se
conservan intactas; el montaje ajusta posición y recorte en runtime.

El [ZIP de fuentes seleccionadas](../art/character-alpha-v1/character-alpha-v1-selected.zip) contiene
27 PNG originales, sus 27 derivados móviles y cinco manifiestos/recibos. Se comprobó su CRC y la ausencia
de los dos PNG descartados. El archivo pesa 36,244,966 bytes; los recibos conservan también la historia
de intentos que sigue disponible en el repositorio.

`selected-sources.json` valida las 27 imágenes elegidas: 27/27, incluidas 26 con alpha. `alpha-inspection.json`
inspecciona los 29 intentos y marca un fallo de alpha. El recibo de selección registra dos descartes: `male-eyes-blue-v1.png` no cumple alpha,
y `male-beard-short-v1.png` conserva alpha pero su contorno de mandíbula flotaba. Ambas se guardan como
evidencia de generación; las reemplazan `male-eyes-blue-v2.png` y `male-beard-short-v2.png`, seleccionadas.
El inspector de alpha devuelve exit code 1 por los ojos azules v1; la barba v1 sí pasa alpha, pero no la
revisión de forma. `selected-sources.json` valida por separado las fuentes elegidas.

El catálogo es intencionalmente acotado. El cuerpo masculino ofrece dos cabellos, dos ojos y una barba;
el femenino ofrece un cabello y un estilo de ojos, sin barba. Las demás familias disponibles tienen una
opción por cuerpo. Tono de piel, nariz y rasgos base permanecen fijos en las bases ilustradas. La barba
masculina usa `mask: "base"` para seguir el contorno de la mandíbula; el PNG original no se retocó.

El recibo `mobile/derivatives-receipt.json` documenta derivados de hasta 512 px de ancho para las imágenes
del conjunto seleccionado. La QA del navegador confirmó las URL/resoluciones móviles realmente cargadas:
las piezas de personaje cargan a 512 × 768 y el fondo se sirve en una variante más pequeña. Esto verifica
el camino emulado y no mide FPS ni rendimiento en un teléfono físico.

Las 29 entradas de `prompts.json` conservan prompts y procedencia. El autor pidió GPT Image 2; se usó la
herramienta integrada `image_gen.imagegen`, que no informa ni permite elegir el modelo
ejecutado exacto; no se atribuye un modelo exacto como resultado confirmado. La entrega es arte raster 2D,
no mallas, rig, UV ni atlas de producción.

## Visor y evidencia

El visor aislado vive en [`tools/character-alpha-lab/`](../../tools/character-alpha-lab/README.md) y se abre en
`http://127.0.0.1:5194/tools/character-alpha-lab/index.html`. La vista **Lámina** muestra los masters; la
vista **Piezas** combina capas, permite seleccionar/omitir opciones, acercar el rostro, cambiar fondo y
descargar PNG transparente y ficha JSON local. La ficha solo describe la composición exportada; no guarda
identidad, perfil ni equipo del juego.

La [evidencia de navegador](../art/character-alpha-v1/browser-evidence-v1.json) reporta 13/13 aserciones
técnicas aprobadas en escritorio 1440 × 900 y móvil emulado 390 × 844. Cubre ambos cuerpos y modos,
selección/omisión, aleatorización dentro del catálogo, zoom/fondo checker, reset, descargas y cambio rápido
de cuerpo sin exportación obsoleta, más las variantes de cabello/ojos/barba y exportación móvil. Hay ocho
capturas, incluidos los masters, montajes y revisión de rostro. La QA observó 26 solicitudes reales de PNG
móvil en sus URL de hasta 512 px de ancho. Las capturas y el montaje fueron revisados visualmente durante
este corte; se ajustaron offsets y recortes en runtime sin editar los originales. Esa revisión no equivale
a aceptación final del autor ni confirma coincidencia exacta con su referencia.
La [revisión visual del corte](../art/character-alpha-v1/visual-review-v1.json) registra los ajustes y
los límites del montaje.

La evidencia HTTP local ya está en [artifact-evidence-v1.json](../art/character-alpha-v1/artifact-evidence-v1.json):
estado `pass`, 62 artefactos estáticos servidos con MIME/tamaño/hash revisados y 29 originales comparados
por hash con sus fuentes. Su alcance es bytes/rutas HTTP y conservación de originales; no acredita
aceptación visual, catálogo global registrado ni integración al juego. La inspección de arte global y su
registro en el catálogo siguen pendientes. El próximo corte debe resolver con el autor la semejanza visual
al estilo Horizon Tides y atender clipping de prendas/manos antes de avanzar al trabajo 3D de producción.

## Reproducción local

Desde la raíz del repositorio:

```powershell
# Servidor local del laboratorio, incluido el servicio estático en el puerto 5194
node tools/character-lab/server.mjs

# Inspeccionar alpha (exit 1 esperado por ojos azules v1; barba v1 se descarta después por forma)
python tools/character-alpha-pipeline/alpha-metadata.py --out docs/art/source/character-alpha-v1/alpha-inspection.json
python tools/character-alpha-pipeline/prepare.py
node tools/character-alpha-pipeline/calibrate.mjs

# Con el servidor activo, ejecutar en otra terminal las comprobaciones de navegador/HTTP
node tools/character-alpha-lab/qa-preview.mjs
node tools/character-alpha-lab/capture-review.mjs
node tools/character-alpha-pipeline/verify-assets.mjs
```

Los scripts de inspección, preparación, calibración, navegador y HTTP regeneran recibos, manifiesto,
derivados o capturas. El reporte actual refleja las ejecuciones aprobadas registradas; no se volvieron a
ejecutar para redactar esta actualización. La URL válida del laboratorio es
`/tools/character-alpha-lab/index.html` en el puerto 5194.

## Integración y límites

La revisión del inventario Unreal/FAB no encontró un kit modular compatible de cabezas, cabello y prendas
exportables para este diseño. `Kwang`, `Wukong` y `SKM_Manny_Simple` siguen como candidatos secundarios de
estudio de assets o rig/exportación; su exportación, dependencias y encaje no están verificados y no se
registran como recursos reutilizados en esta entrega.

El laboratorio es una composición 2D de cámara fija. No prueba rig, deformación, animación, geometría,
materiales del renderer, compatibilidad con `CharacterView`, ocultación real bajo prendas, guardado,
autoridad de equipo, rendimiento físico, balance ni jugabilidad. Los gates P02 (anatomía/arte 3D de
producción), P03 (apariencia 3D), vestuario P04, creador, identidad persistente y equipo visible permanecen
abiertos. La lógica útil de ensamblaje modular de P03a puede orientar el contrato futuro; sus mallas
rechazadas no son parte de este kit ni un objetivo visual aprobado.
