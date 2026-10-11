# Bucanero v1 — modelo e icono del autor

2026-10-11. Implementado sobre `6fd7f68`; release alpha.52, protocolo 55 conservado, sin SQL.
[Brief previo](../../briefs/buccaneer-character-v1.md).

**Ficha con idle, alpha.56:** usa el clip original del autor con su rig Mixamo en una instancia
independiente. [Resultado, coste y verificación](idle/README.md). Miniaturas quietas, giro/zoom
y movimiento reducido; el controlador de juego conserva las animaciones existentes.

**Revisión posterior, alpha.53:** a petición del autor, el modelo crece un 12,2 %, la ficha se
acerca un 10 % y el icono presenta la cara a ×1,60. [Comparación y verificación](size-review/README.md).
Los binarios del modelo/retrato y los originales conservan sus hashes; cambia su presentación.

## Resultado

El aspecto **Bucanero**, índice 2 del selector existente, usa el GLB del autor en la partida y en
el giro de la ficha de personaje. El icono ilustrado aparece en selector/HUD/retratos; conserva su
transparencia. Alpha.52 dibujaba el medallón completo; alpha.53 acerca la cara en runtime.
Los otros aspectos conservan sus fuentes. Originales archivados
byte por byte en `docs/art/source/buccaneer-v1/`, además de la carpeta entregada por el autor.

El GLB fuente Tripo tiene 9.164 triángulos, 65 huesos Mixamo, tres mapas 2048 y cuatro clips.
El runtime reutiliza el rebind y las animaciones procedurales de 15 huesos del juego, con sable,
pistolas, guardia, carrera, dash, impactos, recolección, natación y despiece. Los clips fuente
siguen disponibles en el original; desde alpha.56 el derivado conserva solo `idle` para la ficha.
No se cambia el controlador de combate por los clips Tripo.

## Preparación y coste

| Recurso | Original | Escritorio | Móvil |
|---|---:|---:|---:|
| Modelo GLB con idle | 4.726.368 B | 1.965.360 B | 1.394.284 B |
| Albedo | 2048² | 1024² JPEG | 512² JPEG |
| Icono | 3.321.172 B / 1600² | 290.760 B / 512² | 82.546 B / 256² |

El dispositivo carga una sola variante GLB y un icono. Los mapas normal/RM no consumidos por
`charToon` y los clips swim/run/hit se excluyen de los derivados. `idle` conserva sus claves exactas.
Geometría, UV, pesos, jerarquía y matrices
de bind conservan sus bytes; JPEG calidad 94, sin submuestreo, y WebP lossless con alpha.
Estimación RGBA8 con mipmaps: albedo 5,33 MiB escritorio / 1,33 MiB móvil; icono 1,33 / 0,33 MiB.
Son presupuestos de texels, no mediciones físicas de memoria/FPS.

Regeneración: `python tools/buccaneer-character/prepare.py` (requiere Pillow; versiones y hashes
en [asset-evidence.json](../../art/buccaneer-v1/asset-evidence.json)). `--source-dir` permite
recibir la carpeta fuente; una recepción distinta requiere nuevo ID para conservar este original.

## Verificación local

- **36/36**: assets, paquete Bucanero, personajes, natación, render de recolección y assets/fábrica GM.
- **19 comprobaciones de navegador**, escritorio 1280×900 y móvil emulado 390×844: entrada con
  skin 2, GLB y retrato correctos, resolución real cargada, ficha ES/EN, poses, vértices finitos,
  despiece, fallback con 404 real del modelo/icono en ambos dispositivos y `?noassets`.
- Capturas inspeccionadas: ficha/cámara de juego, retrato, nueve poses con armas/herramienta y
  comparación de fuente 2048 frente a derivados 1024/512 con la misma pose, cámara y shader.
- `node tools/import-asset.mjs --check`: manifiesto completo válido; `git diff --check` correcto.

[Evidencia de navegador](browser-evidence.json), [poses y comparación](desktop-poses.png),
[ficha](desktop-character-es.png), [HUD móvil](mobile-game.png).

El runner `tools/qa-buccaneer-character.mjs` usa exclusivamente un host local de memoria.
`MN_PLAYWRIGHT`, `MN_BROWSER` y `MN_GSAP` permiten seleccionar las herramientas instaladas.

## Límites y publicación

Es un aspecto completo provisional: ropa/cabello/cara todavía forman una sola malla y los dedos
conservan la forma fuente tras el rebind simplificado. El creador modular sigue abierto.
La UI vertical conserva el escalado de la ficha existente; no se acepta aquí una reforma móvil
ni FPS en un teléfono físico. Los cuatro clips propios del modelo podrían evaluarse después.

Publicación y revisión activa del VPS se registran en `publication.json` tras el relevo del
actualizador; las pruebas locales anteriores no acreditan por sí mismas el despliegue.
