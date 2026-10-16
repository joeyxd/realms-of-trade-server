# Fuentes alpha ilustradas

Los originales viven en `docs/art/source/character-alpha-v1`. Cada pieza proviene de una petición
independiente a `image_gen.imagegen` con `transparent_background: true`; el puerto es opaco.
`prompts.json` conserva todas las peticiones, referencias y rutas originales. El modelo exacto no es
seleccionable ni informado por esta herramienta; no se acredita ejecución de GPT Image 2.

Desde la raíz del repositorio:

```powershell
python tools/character-alpha-pipeline/alpha-metadata.py --out docs/art/source/character-alpha-v1/alpha-inspection.json
python tools/character-alpha-pipeline/prepare.py
node tools/character-alpha-pipeline/calibrate.mjs
node tools/character-alpha-pipeline/verify-assets.mjs
```

La inspección de **todos los intentos** devuelve código 1 por el PNG azul v1 descartado: alfa mínimo 12,
sin un solo píxel transparente. El descarte permanece íntegro como evidencia. La barba v1 también queda
fuera por su encaje visual. Los dos reemplazos v2 están seleccionados y tienen transparencia real.

`calibrate.mjs` rechaza cualquier fuente elegida que falle transparencia, escribe el manifiesto y
`selected-sources.json` con las 27 imágenes usadas y los descartes explícitos. Su pase técnico no
aprueba el estilo ni declara coincidencia exacta con la referencia.

`prepare.py` hace solo una reducción estándar a 512 px de ancho con PNG lossless, valida la conservación
del alpha reducido y escribe hashes/tamaños en `mobile/derivatives-receipt.json`. No recorta, pinta, limpia
fondos ni altera originales. También conserva derivados de intentos descartados; el manifiesto no los usa.

Con el servidor del laboratorio activo, `verify-assets.mjs` comprueba bytes, SHA-256, MIME y dimensiones
de 62 recursos por HTTP local y compara las 29 copias con sus originales del generador. Esa comparación
requiere que las rutas originales sigan disponibles en esta máquina. Para el uso del visor bastan las
fuentes guardadas en el repositorio. QA de navegador: `node tools/character-alpha-lab/qa-preview.mjs`.

`python tools/character-alpha-pipeline/package-selected.py` empaqueta los originales y móviles elegidos,
con manifiestos/recibos, en `docs/art/character-alpha-v1/character-alpha-v1-selected.zip`. Valida SHA-256
de originales, CRC del ZIP y que no se incluyan los PNG descartados. Los recibos sí conservan su historia.
