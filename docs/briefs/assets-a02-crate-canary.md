# A02 — primera caja GLB desde Unreal

Preparación sobre `9a76925` (Tinta); comparación de juego sobre `626beb7` (D03, rc.1, protocolo 12). Una prueba visual independiente de los sistemas de bodega.

## Objetivo y límites

Exportar `Dreamrise_SMSK/Assets/Meshes/SM_StoragePart_03` y comparar su uso como `crate` real del juego con la caja procedural. Decidir aceptar/aplazar por forma, estilo, legibilidad y coste. No portar Blueprint ni añadir almacenamiento.

- `C:\Unreal` permanece de solo lectura. No abrir su proyecto, guardar paquetes allí ni ejecutar sus plugins/scripts.
- Fuente: `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes\SM_StoragePart_03.uasset`.
- Crear proyecto mínimo independiente bajo `C:\DEV\real of trade\asset-staging\a02-export\project`, fuera de carpetas con punto como `.claude`; conservar rutas `/Game/Dreamrise_SMSK/...` y hashes de los cuatro paquetes seleccionados.
- Cierre estático inicial: malla, `MI_Base_Normal`, `M_Base`, `T_ColorPalette`; verificar cierre en Unreal y registrar dependencias faltantes. Copiar solo lo necesario.
- Activar PythonScriptPlugin/GLTFExporter instalados y sus dependencias; ningún plugin o script del proyecto fuente. Caches, Saved, Intermediate, logs y exportaciones en staging/temporal.
- El principal controla `.uproject`, configuración, launcher, importación/manifiesto, revisión visual y decisión. Luna implementa tooling acotado y revisa datos; un escritor por archivo.

## Exportación y aceptación

1. Confirmar StaticMesh, materiales, bounds/LOD y dependencias cargadas. Exportar GLB sin guardar paquetes; registrar UE/plugin/opciones/hashes. Primera prueba sin bake; corregir una vez si el material exige bake comprobado.
2. Revisar GLB/triángulos/partes/materiales/texturas/resolución/tamaño/bounds/pivote. Props apuntan a ≤6.000 triángulos; cada excepción requiere revisión explícita.
3. `node tools/import-asset.mjs <staging.glb> --id=prop:storage-crate --props=crate --dry`; importación solo en worktree aislado, seguida de `--check` y tests existentes pertinentes de assets.
4. Comparar consumidor `createProps` existente, misma escena/cámara/transformación/luz/tiempo, procedural y candidato. No cambiar mapa/sim/colliders ni multiplicar variantes del asset.
5. Capturas inspeccionadas día/noche, high/low, escritorio/móvil emulado; comprobar `?noassets`, 404 y GLB inválido conservan caja procedural y escena. Registrar estado/errors, draw calls, geometría, textura/descarga estimadas, renderer y límites de medición.
6. Aceptar solo con mejora clara sin coste o cambio de tamaño/silueta inadecuados; de lo contrario preservar procedural y guardar evidencia del aplazamiento.

Código preparado: `tools/stage-a02-crate.ps1` (copia verificada y launcher, `-Export -RenderMaterials` para bake), `tools/export-a02-crate.py` (solo desde staging), `tools/look-prop-canary.mjs` (QA). Nada de navegador/Unreal concurrentes; launcher y capturas son del principal.
Reporte durable de resultado ≤20 líneas en `docs/delivery/`, con datos JSON y rutas de capturas ignoradas. Commit selectivo del principal; sin push, publicación ni despliegue implícitos.
