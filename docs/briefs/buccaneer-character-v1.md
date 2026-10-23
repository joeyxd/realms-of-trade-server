# Bucanero v1 — integración del personaje del autor

Fecha: 2026-10-11. Solicitud del autor: incorporar provisionalmente su modelo e icono de
`materials/characters/`; habrá cambios artísticos posteriores.

## Revisión de tamaño pedida por el autor

Tras alpha.52 el autor confirma que lo siente demasiado pequeño en el mundo y en la ficha.
Pase previsto: altura visual del modelo 1,89 → 2,12 u (+12,2 %), encuadre de ficha ×1,10 y
recorte de presentación del icono ×1,60 centrado a Y=44 %. Revisar antes/después con la misma
cámara y pose, cuerpo completo en la ficha, armas/herramienta y escritorio/móvil emulado.
Son ajustes de presentación sobre los assets ya recibidos: no hace falta otra fuente Unreal/FAB.
Los archivos de arte, colisiones y reglas conservan sus contratos.

## Corte previsto antes de implementar

1. Conservar ambos originales, sus hashes y la recepción del GLB Tripo/Mixamo.
2. Sustituir solo el aspecto existente Bucanero (índice 2), conservando identidad/red y el resto de aspectos.
3. Usar el rebind Mixamo existente al rig interno y sus acciones de movimiento/combate; comprobar
   escala, frente, manos/armas, reposo, carrera, guardia, dash, natación, impactos y despiece.
4. Crear GLB derivados con albedo 1024 escritorio / 512 móvil. El shader toon solo consume albedo:
   mapas PBR no utilizados y clips fuente se conservan en el original, fuera del paquete runtime.
   Seleccionar un solo GLB por dispositivo, con fallback procedural si falla la carga.
5. Incorporar el icono ilustrado en selector y HUD del Bucanero. Conservar el arte y alpha originales;
   el RGB magenta bajo alpha cero no se presenta en UI. Las vistas 3D siguen usando el modelo.
6. Revisar capturas en escritorio y móvil emulado y medir archivos/URLs/texturas realmente cargadas.
   Ejecutar pruebas acotadas de assets/personajes/UI. No atribuir FPS físicos a emulación.

## Alcance y reutilización

Se integra un aspecto completo provisional. La futura separación de ropa, cabello, cara y equipo
del creador conserva sus gates de `PLAN-CHARACTER-CREATOR.md`.
El inventario `docs/research/unreal-assets/SUMMARY.md` y la referencia `SKM_Manny_Simple` del
plan se revisaron: no aportan el arte específico entregado por el autor ni un rig más directo
que Mixamo, ya soportado por `src/render/assets/rebind.js`. No se exporta ni altera Unreal.

No se cambian perfiles, protocolo, inventarios, colisiones, SQL ni reglas. Las armas existentes
siguen sus slots/acciones actuales. La publicación sigue el actualizador del VPS y se registra
separada de la integración y de las pruebas locales.
