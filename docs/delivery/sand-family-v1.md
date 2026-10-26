# S01: arenas del autor aplicadas al mapa

Fecha local: 2026-10-06. Los archivos aportados en `materials/` ya tienen copias fuente con nombres
estables, variantes de escritorio/móvil, registro en el manifiesto y consumidor real en el terreno.
Esta entrega aplica el arte para revisión local; el ajuste artístico final sigue abierto.
Ampliación posterior: [huellas dinámicas](sand-footprints-v1.md) reemplazan por defecto la banda
pintada estática descrita en esta primera entrega. Los archivos del autor permanecen conservados.

| Acabado | Archivos y colocación |
|---|---|
| Seca dorada | `dry-albedo` + `dry-normal`; base de playa, tile de 8 unidades |
| Mojada | `wet-albedo` + normal de seca compartida; mezcla por altura junto al agua, tile de 8 unidades |
| Ondulada | `ripple-albedo` + `ripple-normal`; zonas abiertas con máscara amplia de ruido, tile de 10 unidades |
| Con huellas | `footprints-albedo` + `footprints-normal`; banda localizada entre inicio y aldea, tile de 3,2 unidades |
| Arena de orilla | `shore-sand-albedo` + `shore-sand-normal`; muestra de arena mezclada en la costa, tile de 3,2 unidades |

La arena seca ya incorpora conchas/guijarros pequeños pintados. Esa parte también está registrada en
la fila de arena con conchas; las conchas grandes y rocas con silueta necesitan objetos separados.
La arena ondulada recibida tiene su propia fila: no se presenta como un bitmap de arena compactada.
Las huellas son un patrón estático localizado; no son pisadas que genere el jugador al caminar.

La imagen completa de orilla incluye agua y espuma pintadas. Se conserva intacta para referencia.
El juego usa solamente el recorte de arena inferior izquierdo, **x=0, y=742, 512×512**, idéntico para
color y normal. Así la costa sigue la altura del mapa y conserva el agua y la espuma animadas existentes.
El recorte no agrega agua pintada a la playa. La malla, alturas, colisiones y caminos del mapa son los mismos.

## Archivos y presupuesto

- Originales intactos: `materials/`; nueve copias exactas PNG 1254×1254 en `docs/art/source/sand-family-v1/`.
- Runtime: `assets/textures/sand-family-v1/`; nueve mapas únicos, 1024×1024 escritorio o 512×512 móvil.
- Color WebP calidad 85/82, normales WebP lossless con canales RGB lineales. El relieve compartido evita
  descargar una segunda normal para arena mojada. Los PNG fuente no están en el manifiesto.
- Descarga del paquete: **7.946.906 B** escritorio y **2.251.840 B** móvil, un ahorro del **71,7 %**.
  RGBA8 con mipmaps: aproximadamente 48 MiB escritorio y 12 MiB móvil; es una estimación de texturas,
  no medición de la memoria total de la GPU ni del rendimiento de un teléfono.
- Registro y procedencia: [recibo](../art/sand/sand-family-v1-receipt.json).
  Reproducir/verificar: `node tools/prepare-sand-materials.mjs --check`.

El shader lee color sRGB una sola vez y normal como datos, proyectados en coordenadas del mundo.
La fuerza inicial del relieve es 0,22 y disminuye a distancia. Roca, vegetación, caminos, lava y arena
del coliseo conservan sus máscaras; las normales finas no modifican el pase de contornos negros.
`src/render/sandMaterials.js` concentra pares, escala y controles de revisión, y `terrain.js` los mezcla.
El registro elige una sola URL por dispositivo antes de cargarla.

## Revisión del mapa real

[Antes](../art/sand/map-desktop-before-v1.png) y [después](../art/sand/map-desktop-spawn-v1.png)
usan la misma cámara y escena del juego, desactivando/activando solamente esta familia de arena.
También se inspeccionaron [costa PC](../art/sand/map-desktop-coast-v1.png),
[inicio móvil](../art/sand/map-mobile-spawn-v1.png) y [costa móvil](../art/sand/map-mobile-coast-v1.png).

Escritorio: 1280×720, calidad high; móvil emulado: 844×390, calidad medium, pointer coarse real del contexto.
Se verificaron nueve peticiones por dispositivo, exclusivamente a su variante, con imágenes decodificadas
de 1024 o 512 px y espacios de color correctos. WebGL2 compiló el shader; el registro de errores del juego
quedó vacío. La consola de escritorio tuvo dos 404 de favicon, sin errores de shader. No se midieron FPS
en un teléfono físico. [Datos de revisión](sand-family-v1-evidence.json).

Los surcos, conchas y granos se leen a escala de personaje. Las huellas forman una banda de paso y
la costa mezcla mojada/sumergida sin un rectángulo de agua pintada. Las bandas y grupos repetidos,
y los brillos/sombras incorporados al arte, siguen siendo reconocibles: su escala y frecuencia quedan
para la revisión del autor. El relieve tiene efecto sutil: comparación con normal apagada, misma cámara,
PSNR finito de 51,41 dB. Se conserva la orientación de los mapas suministrados.
Una comparación síncrona del framebuffer WebGL confirma el efecto sin animación de UI: 111.086
píxeles cambiados, RMS 0,791 en RGB de 8 bits. También se inspeccionó la lista HTML con las seis
miniaturas actuales decodificadas y sus filas aplicadas.

Pruebas: `node --test tests/sand-terrain.test.mjs tests/art-catalog.test.mjs`, **10/10**.
Cubren fuente por dispositivo, normales lineales/compartidas, material de respaldo y geometría idéntica;
la revisión en navegador cubre compilación y lectura visual. Las candidatas Unreal ya revisadas en
[S01](../briefs/visual-s01-sand-family.md) eran fotográficas; se reutiliza el arte elegido del autor.
Comprobación adicional de contratos de assets/balsa/arena: **21/21**. El catálogo vivo sirve sus seis
filas aplicadas, revisión 4, con **42 enlaces verificados por bytes** (`node tools/verify-sand-catalog.mjs`).

## Abrir y seguir por filas

Ejecutar `PROBAR-ARENAS.cmd` y abrir **http://127.0.0.1:5192/?solo&debug&q=high&tod=day**;
pulsar JUGAR. Es el juego actual en solo, servido localmente, con las arenas habilitadas por defecto.
El servidor de vista previa es de solo lectura. `CATALOGO-DE-ARTE.cmd` abre el registro en puerto 5190.

Para comparar en consola del navegador:
`__mn.world.terrain.userData.sand.uniforms.mnSandEnabled.value = 0` (1 para restaurar).
La fuerza de normal se ajusta en `mnSandNormalStrength.value`.

Siguiente revisión: elegir escala/densidad de huellas y repetición de surcos antes de extender el
acabado del puerto; luego rocas/conchas con volumen y el resto del kit. La entrega es local, sin
publicación ni cambios de simulación, protocolo, persistencia o aceptación del milestone M5.
