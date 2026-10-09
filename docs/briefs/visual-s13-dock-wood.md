# S13 — tablones del muelle

Solicitud de continuar el arte por cortes, 2026-10-07. Extender M01 desde la balsa a la cubierta del
muelle existente: veta pintada, grietas escogidas y restos de pintura turquesa con el mismo lenguaje gráfico.

## Alcance

Reutilizar `tex:raft-comic-v1`, seleccionado por el registro en 1024² PC o 512² táctil. Recortar dentro
de tablas individuales, alinear U con el eje largo de cada cara antes de trasladar/mezclar geometría y
alternar cuatro recortes con sus espejos. El atlas ya lleva tinta: evitar una segunda veta procedural.
La luz/toon, sombras y pase de normales siguen activos; el albedo no añade relieve geométrico.

Solo los tablones y las dos vigas longitudinales de la cubierta. Mantener posiciones, normales, colores
de fallback, triángulos, base/dirección/altura del muelle, colisiones, RNG y datos de simulación.
Conservar material anterior cuando el atlas está desactivado o falla. Paredes, postes, soportes inferiores,
amarres, módulo de construcción y máscara editable de pintura tienen aceptación independiente.

## Reutilización comprobada

Atlas portable ya integrado: [entrega original](../delivery/raft-comic-material.md), UV de
`src/render/raftMaterials.js` y pareja WebP existente. El inventario
[Dreamrise](../research/unreal-assets/survival/FINDINGS.md) no identifica un muelle modular por nombre.
Comprobación puntual de archivos Unreal de solo lectura:

| Candidato | Proyecto/ruta bajo Content | Bytes | Decisión |
|---|---|---:|---|
| Hut completa | SimpleMultiplayerSurvival · Dreamrise_SMSK/Assets/Meshes/SM_SmallWoodeHut.uasset | 70.989 | Casa monolítica; no resuelve cubierta |
| Banco | SimpleMultiplayerSurvival · Dreamrise_SMSK/Assets/Meshes/SM_RepairBench.uasset | 101.896 | Prop distinto; no importar para este corte |
| Caja | SimpleMultiplayerSurvival · Dreamrise_SMSK/Assets/Meshes/SM_StoragePart_03.uasset | 24.248 | Ya exportada como caja; conservar recurso |
| Esquina de galería | MyProject · NiagaraExamples/Gallery/DemoPlatform/Meshes/Floor_Corner.uasset | 78.109 | Plataforma de demo; material/UV/estilo no probados |
| Borde de galería | MyProject · NiagaraExamples/Gallery/DemoPlatform/Meshes/Floor_Edge.uasset | 21.987 | Misma limitación |

Fuentes bajo `C:\Unreal` intactas. Nombres/tamaños de paquetes no demuestran portabilidad; no se
exportan ni se convierten esos candidatos. El atlas portable existente cubre esta necesidad sin nuevas imágenes.

## Gate local

- Comparación antes/después del muelle real en PC, móvil y low con la misma cámara por pareja.
- Posiciones/normales/colores/índices y matriz local de cubierta idénticos por SHA-256; solo UV nuevas.
  Props estáticos y mapa iguales; banderas animadas se excluyen de equivalencia de bytes/matrices.
- Noche, vertical rotado, noassets y 404 deliberado del atlas; cuatro cambios de calidad por caso.
- Una sola variante del atlas por arranque y mismo objeto de textura que la balsa; cero imágenes nuevas.
- Capturas inspeccionadas, fuentes congeladas, enlaces del catálogo verificados por bytes.

Estas pruebas no aceptan FPS/dispositivos físicos ni publican la demo. Registrar M01 extendida y una
fila propia de tablones de muelle; no cerrar el kit modular de piso por este cambio de material.
