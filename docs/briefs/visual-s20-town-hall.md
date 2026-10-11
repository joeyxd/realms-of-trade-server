# S20 — fachada de Salty Shore

## Resultado y límite

Dar identidad al pueblo mediante una tela roja con ancla y letras, soportes de madera y un mástil
corto en una hut existente. Selección exclusiva del renderer: hut nativa más cercana al muelle
cuya puerta ya mira hacia el puerto. El adorno ocupa el lateral contiguo del tejado para leerlo
en cámara isométrica; puerta, ventanas, escaleras, ancla y orientación de la casa permanecen iguales.

Este corte aporta una silueta al futuro Salty Shore. La capitanía funcional, la reordenación de plaza,
los amarres y estados de obra A0/A1 siguen sujetos al [contrato de alfa](../../PLAN-ALFA-MUNDO.md#5-salty-shore-contrato-funcional-con-el-agente-de-arte).
La Capitana Brea mantiene su ubicación/interacción actual. Nombres de zonas y misiones conservados.

## Reutilización comprobada

Auditoría Luna acotada y revisión independiente del principal: inventario `CANDIDATES.csv` y
`survival/FINDINGS.md` en `docs/research/unreal-assets/`, sin repetir el inventario general.

Fuentes verificadas en
`C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\`:

| Candidato | Bytes | Evidencia y decisión |
|---|---:|---|
| `Assets/Meshes/SM_SmallWoodeHut.uasset` | 70.989 | Vivienda candidata; no se acredita export, dependencia ni ajuste al collider web |
| `Blueprints/BP_Building_Base.uasset` | 76.877 | Blueprint asociado; no es autoridad de construcción del juego web |
| `BP_Building_Base_1.jpg` en previews del inventario | 5.302 | Miniatura inspeccionada: hut elevada con rampa y tejado inclinado; no kit de capitanía |

No se identificó un candidato concreto listo para esta fachada/mástil en la búsqueda acotada.
Decisión: conservar la hut procedural y reutilizar el atlas S14 de madera PC/móvil. Fuentes Unreal
intactas, sin exportaciones ni auditoría de licencias. La miniatura no prueba portabilidad o coste.

## Implementación y aceptación

- `townHall.js`: selección sin RNG, soportes opacos integrados en el chunk, tela plegada de 72 triángulos.
- Madera con atlas color/normal compartidos, fuerza 0,18. Metal/banderín conservan pintura nativa.
- Tela estática con canvas sRGB 256², toon, doble cara, sin normal map ni transparencia. Sin descargas nuevas.
- Sin albedo o con hut importada: conservar el renderer anterior sin el adorno. Sin normal: madera con color.
- 146 triángulos de soportes + 72 de tela; una malla adicional y ninguna luz o pasada de pipeline nueva.
- Tests con fixtures congelados, selección/empates/RNG, límites geométricos, integración, import y respaldo.
- Comparación serial GPU del principal: un PC previo y siete finales, tres encuadres, cuatro cambios de calidad.
- Inspeccionar capturas y comparar contratos del mapa/recursos; verificar bytes/HTTP y ficha de catálogo.

FPS físicos, interacción de capitanía, capacidad de ocho participantes y publicación quedan pendientes.
Entrega y evidencia final: [town-hall-v1](../delivery/town-hall-v1.md).
