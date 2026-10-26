# S02 — rocas de playa aplicadas localmente

Fecha: 2026-10-06. Continuación de la arena y las huellas dinámicas.
**Implementado y verificado en el mapa local; revisión artística del autor pendiente.**

La playa usa ahora la geometría angular `SM_Rock` de Dreamrise en tres variantes: compacta, alargada
y baja. Son tres deformaciones de la misma malla, con gris cálido, caras superiores más claras,
sombra fría del toon, pincelado suave, grietas escogidas y oscurecimiento del pie junto al agua.
El color procede de vértices y del shader; este corte no necesita albedo ni normal PNG nuevos.
Las normales geométricas describen sus planos y alimentan el contorno existente.

Se sustituyen únicamente rocas que ya estaban sobre arena, fuera de camino, volcán, lava y arena
de combate. En el seed de prueba hay **8 rocas: 3 compactas, 3 alargadas y 2 bajas**, agrupadas por
variante y chunks. Conservamos mapa, posiciones y colisionadores. Cada vértice cabe dentro de
radio `0.52 × scale`, menor que el colisionador `0.55 × scale`; la base se coloca bajo el mínimo
de nueve muestras de terreno. No añadimos obstáculos ni cambiamos altura transitable, perfiles o protocolo.

## Reutilización y archivos

Se verificaron `SM_Rock.uasset` (22.059 B), `MI_Base_Normal`, `M_Base` y `T_ColorPalette`.
El registro Unreal confirmó exactamente esas cuatro dependencias, sin referencias de juego ausentes.
Copias aisladas en `asset-staging/s02-rock-export/retry-lowercase`; hashes antes/después idénticos,
fuentes originales intactas. El primer intento se conserva en la carpeta `project`: la extensión `.PY`
de la ruta corta hizo que el commandlet tratara la ruta como código Python. El helper ya normaliza
esa ruta a minúsculas. La ejecución corregida terminó **exit 0, 0 errores y 8 avisos**.

NullRHI exportó solo geometría; su material vacío no se acepta como arte ni se integra. Los avisos
incluyen ese material sin recurso de render, plugins de compresión no requeridos y una API deprecada.
El derivado elimina el material vacío, UV y cargas innecesarias y añade el color por vértice.

| Archivo | Uso |
|---|---|
| [coast-rock-v1.glb](../../assets/models/coast-rock-v1.glb) | Modelo común PC/móvil: **7.964 B, 64 triángulos, 192 vértices**, una malla/material, sin imágenes, rig ni animación |
| [Export geométrico](../art/source/coast-rock-v1/SM_Rock.geometry-export.glb) | Fuente portable exacta de Unreal: 12.184 B |
| [Preparación](../art/source/coast-rock-v1/preparation.json) | Medidas, SHA-256 y reducción del archivo |
| [Informe Unreal](../art/source/coast-rock-v1/SM_Rock.unreal-report.json) | Dependencias, opciones y malla exportada |
| [Hashes de las fuentes](../art/source/coast-rock-v1/export-stage-evidence.json) | Evidencia antes/después de la conversión |

Manifiesto: `model:coast-rock-v1`. Consumidor: `src/render/vegetation.js` y
`src/render/coastRockGeometry.js`. Archivo pequeño común para PC/móvil; no se descarga una textura extra.
Si el modelo falta, es inválido o se usa `?noassets`, aparecen las rocas procedurales existentes.

## Verificación

**41/41** pruebas pertinentes: modelo entregado/presupuesto, contacto/radio/preservación de fuente,
arena, huellas, assets, materiales de balsa y catálogo. Sin pruebas de servidor/persistencia nuevas.
Chrome con render de software: PC 1280×720/high, móvil emulado 844×390/medium y low.
En las tres vistas se cargó el GLB correcto, se contaron las ocho rocas y las tres variantes,
sin errores JS/juego/assets ni error WebGL. Los 404 auxiliares de la página se conservan en la evidencia;
no se presentan como una consola totalmente limpia. Fallos 404/GLB inválido y assets desactivados
conservaron la partida y el fallback, sin errores JS/juego/WebGL.

Capturas inspeccionadas:

- [Mapa PC](../art/coast-rocks/desktop-map-v1.png), [detalle cercano](../art/coast-rocks/desktop-close-v1.png).
- [Tres siluetas](../art/coast-rocks/desktop-three-silhouettes-v1.png): muestrario temporal añadido
  solo para la captura; no son tres obstáculos nuevos del mapa.
- [Móvil](../art/coast-rocks/mobile-map-v1.png), [calidad baja](../art/coast-rocks/low-map-v1.png),
  [fallback](../art/coast-rocks/mobile-fallback-v1.png).
- [Estados y fallos de carga](../art/coast-rocks/browser-evidence-v1.json).

Las vistas de mapa usan cámara normal de distancia 20; el detalle y muestrario acercan la cámara.
El follaje y los controles siguen visibles: revisar la lectura caminando antes de aprobar el acabado.
No acreditamos FPS en teléfono/GPU físico, despliegue ni aprobación del puerto completo.

Abrir `PROBAR-ARENAS.cmd` o la [vista local de rocas](http://127.0.0.1:5192/?solo&debug&q=high&tod=day&art=rocks)
y pulsar Jugar. Ese parámetro pertenece solo al servidor de preview: lleva al personaje a la zona de
prueba con el comando debug existente. Catálogo: [Rocas de playa](http://127.0.0.1:5190), con modelo,
fuente y capturas en su ficha. Después de revisión artística: conchas independientes y cantos;
palmeras, material de acantilado y arco conservan sus filas pendientes.

Reproducir conversión en una carpeta nueva dentro del workspace:
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/stage-s02-rock.ps1 -StageRoot <carpeta-nueva> -Export`.
Luego `node tools/prepare-coast-rock.mjs <SM_Rock.glb>` y `node tools/register-coast-rock-manifest.mjs`.
El helper preserva salidas anteriores; no borrar una carpeta para repetir el ensayo.
