# D08c.7c — piedras recogibles y palmeras cortables

Fecha: 2026-10-08. Prioridad directa del autor sobre el siguiente contrato de aportes comunitarios.

## Resultado jugable

Distribuir materiales por la isla existente: piedra de un toque y palmeras existentes que se cortan
con tres golpes de F o Cortar en touch. Dos troncos al talar, listos para el banco de materiales,
la bodega y las piezas de la balsa. No hace falta comprar o fabricar un hacha en este primer corte;
el hacha contextual es una representación de la acción, no un nuevo objeto de inventario.

## Contrato

- Hasta 96 palmeras existentes y 64 piedras adicionales, con los 16 nodos anteriores: límite 176.
  Layout determinista, sin consumir RNG ni modificar terreno, props o índices de colisión.
  Excluir agua, pendientes fuertes, muelle, NPCs, racks, camino y práctica; espaciar nodos.
- Tres golpes estacionarios, separados 54 ticks. Los dos primeros no conceden materiales ni
  cambian la revisión de mochila. El tercero concede dos troncos y cambia una revisión.
  Cada golpe cambia la revisión compartida del nodo. Revisión/opId, vida, tierra, calma,
  proximidad, espacio para el rendimiento completo y tamaño de guardado se verifican en servidor.
- Un replay exacto no corta otra vez ni emite otra animación; otro jugador ve el mismo agotamiento.
  No modificar el catálogo de mercancías ni los límites de la mochila para facilitar pruebas.
- Caída, marcas, hacha, astillas, hojas y sonidos deben proceder de confirmación del servidor.
  Tocón tras talar; regeneración a 3600 ticks de sesión. El collider original de .38 permanece
  como tocón: no reconstruir el índice de colisiones ni introducir troncos físicos que bloqueen rutas.
- Recursos del perfil conservan el guardado existente. Nodos, golpes, cooldown y recibos siguen
  siendo de sesión; este corte no acredita estado durable del bosque tras reiniciar el host.
- Catálogo completo al admitir/conectar y al cambiar estado, omitido de snapshots rutinarios;
  cliente conserva última lectura y calcula espera desde ticks. Sin implementar AOI/regiones.

## Assets revisados

Reusar S05 (`palm-tall/curved/short-v1.glb`) y atlas/normal S05 v2. Palmera de recurso sustituye
la misma instancia estática y comparte geometría, materiales, viento, normal pass y sombras;
seis batches para las tres formas. Reusar S02 `coast-rock-v1.glb` (7964 bytes, 64 tris, sin
texturas), ya convertido desde `SM_Rock`, con pintura de roca natural. Banco S19/S14 conservado.
Ninguna textura, GLB o descarga nueva; partículas en pools de 32 astillas y 16 hojas.

Unreal verificado de solo lectura: `SM_Rock.uasset`, `SM_Tree_Green_01.uasset`,
`BP_Harvestable.uasset` y `BP_Harvestable_Stone.uasset` de Dreamrise_SMSK en
`C:/Unreal/survival project/SimpleMultiplayerSurvival/Content/`. Árbol verde tiene otra
silueta; Blueprints no tienen lógica portable/verificada para Three/Node. `SM_Leaf`/`M_Leaf_8`
de NiagaraWeather en MyProject no tienen portabilidad/dependencias aprobadas y no mejoran
la reutilización del atlas existente. Fuentes intactas. Referencias:
[S05](visual-s05-palm-family.md), [S02](visual-s02-coast-rocks.md),
[inventario survival](../research/unreal-assets/survival/FINDINGS.md).

## Aceptación

Pruebas de determinismo, exclusiones, tres golpes, carreras, replay, atomicidad, regeneración,
publicación, conservación de perfil/guardado y renderer. Navegador real con host loopback,
F/touch y capturas inspeccionadas en PC, móvil horizontal y portrait rotado. No pedir al autor
playtest ahora; balance, rendimiento en teléfono físico y publicación se informan aparte.
