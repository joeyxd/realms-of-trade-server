# S19 — banco de carpintero y mobiliario de Doña Sepia

2026-10-08. Corte visual local de la cola S18 → S19, alineado con la madera cálida del
[contrato de Salty Shore](../../PLAN-ALFA-MUNDO.md#5-salty-shore-contrato-funcional-con-el-agente-de-arte).
Principal: diseño, integración, GPU y aceptación; Luna: candidatos Unreal, pruebas y scripts de registro.

## Decisión de reutilización

Auditoría acotada sobre contenido añadido, sin modificar Unreal:

- `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes\SM_RepairBench.uasset`,
  **101.896 B**, y `Blueprints/BP_Building_Bench.uasset`, **35.058 B**. El principal comprobó
  ambos archivos y la [miniatura Blueprint existente](../research/unreal-assets/survival/previews/BP_Building_Bench_1.jpg):
  mesa azul con herramientas. No acredita geometría, pivote, materiales completos ni GLB portable.
- `BP_Holdable_BuildHammer_Bench` sirve de referencia de colocación, no de mobiliario exportable;
  `SM_StoragePart_03` ya integra una caja en S17, sin necesidad de repetirla bajo este banco.
- `Plane_Chair_*` corresponde a una silla de avión; no aporta una silla tropical validada.

Se reutilizan los cuatro atlas S14 de madera/color/normal y el banco procedural de respaldo.
La pieza nueva mantiene escala compacta, usa formas opacas y no necesita imágenes ni modelos nuevos.
No se importan Blueprints ni se cambian permisos o recetas de gameplay.

## Contrato del corte

1. Banco en la misma ancla `snapshot.bench`: tablones separados, repisa, refuerzos, tornillo
   de banco, martillo y recorte de madera. Una malla de **276 triángulos**, más la gema original.
   Sin albedo usa exactamente el tablero/patas anteriores; normal ausente conserva la pintura.
2. Mesa, taburete, postes, barra y caja de agujas de Doña Sepia reciben tiles de madera S14.
   Posiciones, normales, colores, índices y transformaciones no cambian. Tela, tintas, metal,
   vela y pieles conservan sus materiales anteriores.
3. Atlas PC 2048² / táctil 1024², color sRGB y normal lineal de intensidad 0,18, compartidos.
   Metal del banco queda fuera del muestreo de color/normal. Sin transparencias ni luces nuevas.
4. No cambiar mapa, colisiones, simulación/RNG, inventario, perfiles, protocolo, SQL o publicación.
   El tornillo y martillo son decoración; el corte no habilita nuevas recetas o reparaciones.

## Aceptación local

**147/147 pruebas** pertinentes, cinco nuevas y regresión visual/recursos.
Un contexto PC previo y siete finales: PC, móvil, low, noassets, albedo ausente, normal ausente
y vertical rotado; tres vistas por caso, **24 capturas**, **28 cambios de calidad finales**.
Capturas inspeccionadas por el principal, cero errores JS/GL y programas enlazados.
Comparación de las 26 mallas estáticas del grupo props y cámaras PC; ancla/nodos sin cambios.
Fuentes congeladas, catálogo con CAS y verificación HTTP; detalles en la
[entrega S19](../delivery/town-furniture-v1.md).
Rendimiento físico, lectura artística fina y publicación siguen pendientes.
