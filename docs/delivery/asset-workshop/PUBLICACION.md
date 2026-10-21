# AW06a — Publicación del taller al editor GM

La decisión «Usar» deja de ser solo una nota: queda como registro versionado en `assets/workshop/published.json` y una herramienta lo vuelca, con hashes, en el catálogo que carga el editor GM. El contenedor del juego es de solo lectura, así que publicar es un paso de git: se edita, se ejecuta la herramienta, se prueba y se sube.

## Contrato

`published.json` es `{schema: "marea.asset-published.v1", revision, entries[]}`. Cada entrada lleva `id` (ficha del taller), `sourceRevision` (copiada de `prepared.json`), `editorId` (`model:` + id), `decision: "Usar"`, `publishedAt`, `fit` (`size` o `height`) con `size` o `height` en metros, `label {es, en}`, `category`, `status: "ready"` y una `note` opcional.

`tools/asset-workshop/publish-editor.mjs` comprueba que la ficha esté preparada (`preview.kind` model), que `assets/workshop/<id>/desktop.glb` tenga el sha256 de `prepared.json` y que la miniatura sea de la misma revisión; si algo falla, sale con 1 sin escribir. Después fusiona en `assets/editor/catalog.json` y `assets/editor/thumbnails.json`:

- Entrada del catálogo: `id`, `kind: "model"`, `src: workshop/<id>/desktop.glb`, `mobileSrc` (si existe), `fit` y su medida, `label`, `category`, `status`, `workshop {id, sourceRevision, publishedAt}` y `stats {bytes, triangles, sha256}`.
- Se descartan las entradas con campo `workshop` y se añaden las nuevas al final; las entradas `gm-*` no se tocan.
- En `thumbnails.json` las claves del taller se reconocen porque su imagen está en `assets/workshop/thumbnails/`; las que ya no se publican desaparecen.

`status: "ready"` es lo que permite activar: el servidor avisa en la publicación y rechaza la activación de `candidate` (`server/gmContent.mjs`). El servidor ya valida el sha256 de `stats` contra el archivo real.

## Cómo publicar

1. Editar `assets/workshop/published.json` (solo fichas con derivado preparado).
2. `node tools/asset-workshop/publish-editor.mjs` escribe ambos archivos; `--check` no escribe y devuelve 1 si difieren.
3. `node --test --test-concurrency=1 tests/asset-workshop-publish.test.mjs tests/gm-assets.test.mjs tests/asset-protocol.test.mjs` y `npm run assets:check`.
4. Subir como cualquier otro corte; `published.json` está reclamado por el índice como archivo de catálogo.

## Recibo (2026-10-20, alpha.88)

| editorId | ajuste | sha256 (desktop.glb) |
|---|---|---|
| model:aw-pilot-01 Caldero nuevo | size 0,9 m | 9722a4205551243af0b0fed27b28436e08c09a65595e3b8839d4e3f16c938808 |
| model:aw-pilot-05 Palma Kobo | height 7 m | bd179cc41024b96868c2332e35359b24719b339400fc0e5c23ece3bce0557977 |
| model:aw-pilot-06 Puerta | height 2,2 m | 3659b8096a880634040ba404f57422aebfa51711312e85f8888fff0d76577b76 |
| model:aw-pilot-07 Barco de referencia | size 6 m | e83fab8683084326359c7257269c8849a883a0850a6627acbc06e61ec5cb0493 |

## Pendiente

- Joi verifica en pantalla las medidas (están decididas, no vistas en escena).
- Insignia «Publicado en el editor GM» en el taller: siguiente corte.
- Sin límites de colisión ni bounds en las entradas; el piloto 01 es geometría sin texturas.
