# Brief V00 — baseline visual del puerto tropical

Fecha: 2026-10-06. **Preparado; ejecución pendiente.**
Plan: [PLAN-VISUAL-PORT](../../PLAN-VISUAL-PORT.md), cortes V00–V02.
Cola: [PLAN-DELIVERY](../../PLAN-DELIVERY.md), línea visual/A05; no desplaza gates D06/D08/D09.

## Resultado

Un punto de comparación reproducible entre isla actual y dirección del puerto ilustrado: capturas de
costa, aldea, muelle y balsa; carta de materiales; métricas y decisiones de reutilización. Debe permitir
preparar la composición gris V01 sin asumir que faltan sistemas ya implementados.

Este corte registra y compara. No cambia mundo, gameplay, shader, mapa persistente ni manifiesto productivo.

## Continuidad y ownership

- Base de preparación: `fa226d2`. Al comenzar, verificar HEAD, AGENTS, HANDOFF, PLAN-DELIVERY y árbol sucio;
  esta base no garantiza el mismo estado de checkout más adelante.
- Los cambios navales existentes son ajenos y quedan fuera del corte. No reset, clean ni staging masivo.
- Principal: autoría del look, cámaras seleccionadas, revisión de evidencia y documentos compartidos.
- Luna: inventario/capturas o carta aislada cuando haya archivos exclusivos asignados; una sola sesión
  de navegador/GPU. Usar worktree si empieza trabajo concurrente sobre archivos comunes.
- Leer `src/render/{scene,camera,pipeline,lighting,terrain,water,vegetation,quality,raftMaterials}.js`,
  `src/render/assets/{toonmat,registry}.js`, `assets/manifest.json` y los informes A02/balsa cómic.

Rutas propuestas para ejecución, reservadas al corte cuando se asigne:

- `docs/delivery/visual-v00-port-baseline.md` y `docs/delivery/visual-v00-evidence.json`.
- `shots/review/visual-v00/` para capturas/logs locales.
- `tools/visual-port-lab/` para una carta de materiales aislada si las herramientas existentes no bastan.
- Entry point/pipeline/manifiesto, `src/sim/**`, SQL, host y fuentes `C:\Unreal`: fuera del writable scope.

## Trabajo secuencial

1. Registrar commit y ownership. Fijar semilla, hora del día y modo de sesión solo/fixture sin escribir
   perfiles productivos. Usar entorno aislado para evitar persistir teleports o estados de revisión.
2. Obtener capturas nuevas del código actual: costa/playa, Aldea Coralina, muelle y balsa; una panorámica,
   vista normal y detalle. Registrar cámara completa, posición/fov/yaw/pitch/zoom y viewport.
3. Repetir día en high PC y low/medium móvil emulado. Una muestra golden/noche detecta albedos con sombras
   horneadas, emisiones y tinta demasiado oscuros. Comparación con/sin HUD sin rediseñarlo.
4. Hacer carta de prueba aislada: madera del muelle y atlas de balsa, lona, roca, arena, palma y agua
   juntos. Mantener el mismo tamaño de pieza y luz; no comparar una miniatura iluminada con otro shader.
5. Confirmar URLs/dimensiones de las variantes de atlas cargadas; registrar bytes transferidos y material
   efectivo. La carta diferencia albedo normal/emisión de los mapas sin consumidor roughness/metallic/AO.
6. Medir contadores, p50/p95 y coste de targets con dispositivo/renderer/tier/DPR anotados. Si no hay GPU
   o teléfono físico disponible, dejar ese gate pendiente y usar software solo para revisión visual.
7. Revisar candidatos concretos para la primera familia: crate/atlas integrados, geometría actual y
   `SM_Rock`/hut/banco donde aporten. Reusar o descartar con motivo; no hacer inventario completo ni exportar
   fuentes Unreal durante V00. Preparar necesidad de exportación como trabajo posterior.
8. Entregar comparación y especificación de V01/V02: composición, paleta ajustada, piezas mínimas,
   riesgos observados y presupuesto provisional corregido por baseline.

## Criterios de aceptación

- Baseline nuevo identificado por código/semilla/cámara/tier; imágenes inspeccionadas por el principal.
- Lista explícita de brechas observadas, distinguiendo carencia visual de sistema ya presente.
- Comparación madera muelle↔balsa y costa/agua con evidencia; no atribuir todo a texturas.
- Plan de reuso basado en recursos reales; `.uasset` candidato no se cuenta como GLB disponible.
- Fuentes 1024/512 realmente comprobadas y cifras físicas etiquetadas según dispositivo.
- Propuesta de V01 con pasos libres, dos cotas y muelle ramificado; V02 cabe en un rincón aproximado
  de 30 × 30 u, ajustable tras composición. Ninguna topología se publica en este corte.
- Fallback y consola del baseline registrados; problemas previos documentados sin apropiarse de otro trabajo.
- Sin secretos en capturas/logs y sin cambios de perfiles persistentes, migraciones ni servidor público.

## Verificación y cierre

Usar herramientas de captura existentes antes de añadir otras. Revisar que sus dependencias y modo de
sesión permitan aislamiento en Windows. No sortear una revisión automática del navegador si rechaza
la acción; registrar el bloqueo y completar la parte documental/código independiente que sí sea posible.

No requiere una regresión completa por documentar/capturar. Un harness nuevo necesita comprobación
funcional acotada; cambios futuros de runtime se prueban en su propio corte. El informe debe incluir
evidencia real, no marcar campos pendientes como aceptados.

Siguiente al aceptar: V01 composición gris aislada; materiales/meshes de V02 pueden prepararse con dueños
separados. El principal asigna writable paths nuevos antes de cualquier modificación de runtime.
