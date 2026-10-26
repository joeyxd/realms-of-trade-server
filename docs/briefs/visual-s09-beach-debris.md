# S09 — madera pintada y restos de playa

Fecha: 2026-10-07. Corte local de detalle costero: ramas, troncos y tablones como elementos cosméticos opacos. No altera terreno, colisiones, props de simulación, RNG ni gameplay.

## Procedencia y reutilización

`UnrealSM_Logs` se exportó en un proyecto aislado de Unreal 5.8 con `NullRHI`: GLB de geometría, 13.304 bytes, 132 triángulos y sin imágenes. La forma fuente es un conjunto apilado de tablas, no una rama ni tres piezas; su material original no se conserva. Se adaptó como variante `planks`, manteniendo los 132 triángulos, normalizando sus límites y pintando color de vértice. La adaptación pasa el contrato de carga del renderer y las pruebas verifican que no muta la geometría original. Las otras siluetas usan geometría procedural propia. No añade texturas, mapas, alpha, sombras propias ni pase de contorno.

## Contrato del corte

- Tres estilos de madera pintada: rama, tronco y tablones. Siluetas bajas e irregulares, color por vértice y material toon opaco compartido.
- La geometría cargada se valida antes de aceptarla: atributos finitos y completos, triángulos válidos, altura de 0 a 0.45 m y radio máximo de 1.35 m. Fallback procedural si la fuente no pasa validación.
- Distribución determinista por semilla, con límite global de 96 instancias. El footprint completo debe permanecer sobre arena y fuera de agua, caminos, muelles, accesos y obstáculos, manteniendo despejes de S07/S08.
- El detalle es de render; no consume RNG de simulación ni muta datos de mundo o entradas compartidas.
- Calidad alta: 96 elementos y distancia de 65 m; móvil: 64 y 45 m; baja: 32 y 32 m. Las instancias visibles se agrupan espacialmente y comparten geometrías/material, sin sombras propias ni contorno.

## Verificación del corte

Registrar seed, cantidades/variantes, instancias visibles, lotes y triángulos por calidad. Revisar capturas del mapa real en escritorio, móvil emulado y low, además de previews temporales de cada estilo. Confirmar lectura de silueta, footprint y despejes en runtime, ausencia de mapas/alpha/sombras propias y reutilización de recursos al cambiar calidad.

La prueba automatizada parsea el GLB auditado y los tres modelos preparados con `GLTFLoader`, conserva la topología de origen, comprueba que la adaptación deja intacto el source y valida los payloads con la forma `{ parts: [{ geo }] }` que usa el registry. El corte pasa 77/77 pruebas pertinentes y seis casos de navegador con capturas inspeccionadas; seed 99282957: 34 conjuntos, 19 ramas/ocho troncos/siete tablones. Resultados y capturas en [la entrega](../delivery/beach-debris-v1.md). La aceptación artística del autor y el rendimiento en dispositivo físico quedan pendientes; las comprobaciones emuladas no certifican FPS. La compatibilidad del export se comprobó para esta adaptación geométrica; su material original no se reutiliza.
