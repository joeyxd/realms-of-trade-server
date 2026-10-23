# S09 — exportación y adaptación de SM_Logs

Se exportó `SM_Logs` desde una copia aislada con Unreal 5.8, `NullRHI` y horneado de material desactivado.
Su cierre de dependencias `/Game` consta de la malla, `MI_Base_Normal`, `M_Base` y `T_ColorPalette`.
Las referencias de motor a NavigationSystem/InterchangeEngine no se copiaron. Los cuatro hashes de
fuentes coinciden antes y después; los proyectos de `C:\Unreal` permanecen intactos.

Resultado exportado: `StaticMesh`, LOD0, una sección/material, 132 triángulos, 180 posiciones,
GLB de 13.304 B y sin imágenes. Límites fuente: 42,61 × 50,49 × 36,11 cm; centro desplazado
(1,17; -0,49; 6,84) cm respecto al origen Unreal. El export conserva un material PBR genérico,
sin la apariencia de la paleta original. Clase, límites, dependencias y hashes están en los informes.

La inspección visual mostró una pila de tablas pese al nombre de la malla. La entrega reutiliza esta
forma en `beach-debris-planks-v1.glb`; ramas y troncos usan geometría nativa. Se centra la fuente,
se orienta el eje largo, se ajusta a 1,5 m y altura 0,4 m, y se pinta por vértice. Las vetas oscuras
proceden del material compartido en runtime. Se conservan los 132 triángulos originales.

- `SM_Logs.geometry-export.glb`: geometría portable exacta del export.
- `SM_Logs.unreal-report.json`: informe de clase, límites, materiales, LOD y dependencias.
- `stage-evidence.json`: hashes de fuentes/copias, salida del commandlet y hashes exportados.
- `runtime-models.json`: modelos preparados finales, tamaños y hashes.
- `trial-01/`: primer ensayo conservado, previo a corregir su clasificación visual y pintura.
- [Preparación aislada](../../../../tools/stage-s09-logs.ps1) y [exportador](../../../../tools/export-s09-logs.py).

El primer ensayo con solo la malla identificó su dependencia de material ausente; el informe fallido se
conserva en `C:\DEV\real of trade\asset-staging\s09-logs-export\project\out`. El ensayo final añadió
exactamente las tres dependencias verificadas. Evidencia de mapa y límites de aceptación en la
[entrega S09](../../../delivery/beach-debris-v1.md).
