# Modelos de campo y cocina — 2026-10-12

Solicitud del autor: ordenar los GLB de Descargas, conservar su aspecto pintado,
integrarlos y publicarlos en el VPS de amigos; corregir los troncos recogibles y
optimizar las texturas con comparación visual.

Los 12 originales se copiaron sin cambios a
`docs/art/source/torch-resin-coconut-v1/<id>/` y
`docs/art/source/cooking-items-v1/<id>/`. Descargas permanece intacta.
La [galería del autor](../../../ARTE-Y-MODELOS.html) muestra cada entrega y referencia.
El [inventario](inventory.json), [contacto original](model-thumbnails.jpg) y
[asignaciones visuales](visual-review.md) conservan su procedencia. Pan, vasija azul
y saco blanco se asignaron provisionalmente a galleta reforzada, agua y harina
por las referencias que el autor estaba modelando; sus nombres de Tripo son genéricos.

La geometría ya era económica: 402–692 triángulos por modelo. Se conservaron
posiciones, normales, índices, UV y factores de color, sin decimar ni repintar.
Las texturas originales llegan a 2048²; los derivados usan un mapa de color WebP
512² de escritorio o 256² de móvil, calidad 90. Se eliminaron únicamente los mapas
normal/metallic-roughness que el material toon de estos objetos ya ignoraba.
Se conserva la pintura del GLB y el contorno de la escena, sin añadir hachurado
ni otra posterización. No se afirma que GLB almacene un shader propietario de Borderlands.

[Registro de optimización](optimization.json): 28,033 MiB originales → 1,348 MiB
para las 24 variantes juntas, 95,19 % menos. La descarga normal incluye solo
antorcha/resina/coco: aproximadamente 199 KB de escritorio o 117 KB de móvil.
Los nueve modelos de cocina/propuesta están en el manifiesto con `preload:false`;
se cargan al seleccionarlos en la biblioteca GM. Las variantes móviles se incluyen
en la huella de publicación y conservan sus metadatos en la revisión preparada.

La antorcha original apagada sustituye el cuerpo procedural del objeto portátil.
Su eje y pivote se ajustan al ancla existente; la llama y la luz permanecen separadas.
El material no se disuelve por proximidad al personaje. Si falla la carga, conserva
el cuerpo procedural. Resina y coco tienen una presentación breve tras el recibo
de tala aceptado: máximo ocho objetos, 2,4 segundos, sin otra recogida ni inventario.
Reintentos históricos no repiten la presentación; salir/reingresar reinicia el efecto.

Los troncos del mapa reutilizan el atlas de madera ilustrada de la balsa y su
material, con UV dentro de la región de madera y normal de contorno emparejada.
No se agrega una textura ni una descarga; el material anterior queda como fallback.
La receta, probabilidades, hidratación, SQL y protocolo conservan sus contratos.
Lima y hierbas son decoración de conceptos; no se agregan recetas o bienes nuevos.

Se revisó la reutilización previa: el brief de antorcha ya registraba `SM_Torch`
de Dreamrise sin exportación aceptada. Este corte utiliza los GLB que el autor
entregó y el atlas de madera existente; las fuentes Unreal permanecen intactas.

Reproducir los derivados: `npm ci --prefix tools/gm-assets`,
`node tools/prepare-item-models.mjs`, `node tools/register-item-models.mjs`,
`node tools/art-catalog/build-items-index.mjs`. Los originales se verifican por SHA-256;
el pipeline rechaza sobrescribir un original con bytes distintos.

Aceptación local: [65/65 regresiones](regression.tap), manifiesto 51/51 validado y
[Chrome escritorio/móvil 2/2](local/final/browser-evidence.json). Se cargaron los
12 GLB y sus mapas reales 512/256; al entrar se descargan solo tres, cada uno en
una variante. Biblioteca GM probada mediante su selección normal bajo demanda.
[Muestrario](local/final/desktop-all-12-item-contact.png),
[madera](local/final/desktop-wood-closeup.png),
[antorcha](local/final/desktop-torch-lit-closeup.png) y
[resina/coco móvil](local/final/mobile-landscape-new-goods-closeup.png) inspeccionados.
Ensayo de 48 copias: geometría/material compartidos; contadores restaurados tras
retirarlas, cero errores de navegador/WebGL. La prueba no mide FPS de teléfono físico.
La primera captura incluyó bordes del atlas y se corrigió a un recorte de tabla
pintada; las capturas finales muestran el resultado revisado.

Publicación pendiente del relevo habitual, con verificación de revisión y entrada pública.
