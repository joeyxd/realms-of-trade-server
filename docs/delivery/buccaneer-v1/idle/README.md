# Bucanero: idle original en la ficha

Alpha.56, protocolo 56 por la integración concurrente de compañeros; el idle no cambia el protocolo.
La figura principal usa el clip `idle` del GLB del autor;
no hace falta una ilustración nueva. La carga captura una copia de la escena antes del rebind
del modelo de mundo. El preview conserva el rig Mixamo de 65 huesos y materiales toon;
el personaje de mundo mantiene su controlador de 15 huesos y sus acciones existentes.

El idle añade **353.260 B** a cada derivado: escritorio, **1.965.360 B**; móvil, **1.394.284 B**.
Comparte la geometría y textura ya descargadas: una sola petición GLB por dispositivo.
El original archivado, geometría, skin y claves del idle conservan sus bytes.
[Presupuestos y hashes](../../../art/buccaneer-v1/asset-evidence.json).

La figura anima a un máximo de 24 FPS con deltas limitados a 0,1 s. Conserva giro, zoom y reset.
El loop se detiene al cerrar la ficha, cubrirla con ajustes, cambiar a una pestaña sin figura,
ocultar el documento o activar movimiento reducido. Al reanudarse reinicia el reloj para evitar
saltos. Las miniaturas son estáticas; movimiento reducido conserva quieta la pose actual.
La ausencia del clip o un fallo al renderizar conserva el preview estático existente.

## Verificación local

- **42/42 pruebas focales**: claves originales del clip, rig nativo independiente del mundo,
  límites del loop y restauración del estado del renderer ante una excepción, además de regresiones
  de assets, personajes, natación, recolección y fábrica GM.
- Tras integrar `d91bc66`, **57/57 focales** incluyendo cliente/red/UI de creación de compañeros.
  Ese corte conserva la activación de SQL034 por separado; no se aplica SQL en esta entrega.
- **24/24 comprobaciones de navegador**, escritorio 1280×900 y móvil horizontal 844×390:
  secuencia de 16 segundos y cruce de la unión del loop, encuadre completo, giro/zoom/reset,
  miniaturas quietas, pausa/reanudación por ajustes, visibilidad, pestaña, cierre y movimiento reducido.
  Fallback ante un GLB real sin idle y ante una excepción de render comprobados en escritorio.
- Rig de ficha de 65 huesos y mundo de 15; albedo real 1024/512; sin segunda descarga del modelo.
  Cero errores de navegador. Capturas inspeccionadas: [escritorio](desktop-sheet.png),
  [móvil](mobile-sheet.png) y [fallback sin clip](desktop-missing-clip.png).
- [Registro y fotogramas](acceptance.json); runner reproducible `tools/qa-buccaneer-idle.mjs`.
  `node tools/import-asset.mjs --check`: 39 assets válidos. `git diff --check` correcto.

Estas comprobaciones usan móvil emulado y no acreditan rendimiento en un teléfono físico.

## Publicación verificada

2026-10-11, 17:40 UTC: revisión `66fcf82868a5d266db468808689e83dbf8548af9`, alpha.57,
activa y sana en el [VPS público](https://marea.62.171.136.148.sslip.io).
176/176 comprobaciones del actualizador; una autoridad, imagen y etiqueta de revisión coincidentes.
Entrada real invitada en escritorio y móvil: idle nativo avanzando, 65 huesos, tamaño ajustado,
resoluciones correctas y una sola variante GLB. **15 hashes públicos iguales a Git**, cero errores.
Después de cerrar ambas sesiones: cero jugadores, sockets, errores, guardados o economía pendientes.

[Recibo](publication.json), [aceptación pública](public/acceptance.json),
[ficha pública de escritorio](public/desktop-character.png) y [móvil](public/mobile-character.png).
Runner `tools/qa-buccaneer-idle-public.mjs`. No se aplicó SQL ni se activaron pilotos opcionales.
