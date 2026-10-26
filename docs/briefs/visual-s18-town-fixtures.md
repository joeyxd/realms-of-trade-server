# S18 — faroles y señalización pintados

Acabado local de los ocho faroles y dos letreros existentes. El principal diseña, integra y acepta; Luna
realiza el cruce acotado de candidatos, las cinco pruebas nuevas y herramientas de registro en rutas
exclusivas. Un único navegador/GPU para la revisión del principal. No se modifica simulación, mapa,
RNG, luces, manifiesto, protocolo ni fuentes Unreal; el checkout compartido conserva las demás tareas.

## Recursos y decisión

El inventario añadido Unreal/FAB no identifica un farol o letrero dedicado por nombre. Se verificó
`C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes\SM_Torch.uasset`,
21.751 B. `BP_Building_Torch` (35.153 B) lo referencia según `survival/FINDINGS.md`; su miniatura
`survival/previews/BP_Building_Torch_1.jpg` muestra una antorcha sencilla. El principal inspeccionó
la miniatura y el archivo. No prueba geometría, dependencias completas ni exportación portable.
Los paquetes Niagara `SM_TorchBase` (28.485 B) y `SM_TorchFuel` (15.510 B) tampoco son faroles
verificados. Se conservan los modelos procedurales y se reutilizan color/normal S14; sin exportar
o modificar Unreal y sin auditoría de licencias.

## Contrato visual

Poste/viga con madera ilustrada; jaula de cuatro barras, base y colgador de hierro oscuro opaco.
El vidrio emisivo y la selección/parpadeo de luces siguen siendo los existentes. La jaula añade
80 triángulos por farol y permanece dentro de sus bounds anteriores. Se fusiona en el mismo chunk.

Letreros con veta horizontal, borde y clavos pintados; letras claras con borde oscuro, flechas y
calavera. Conservan `LA CALDERA ↑` y `CALA CALAVERA / SIN LEY →`. El tablón mantiene dimensiones
y 12 triángulos, con desplazamiento local Z +0,16 para que el poste quede detrás del texto. El
reverso queda de madera sin letras. Solo se desplaza la geometría visual del tablón; no el prop
ni su colisión. Dos canvas de 256² sustituyen los dos anteriores; atlas/normal compartidos,
2048² PC / 1024² táctil y fuerza 0,18. Ninguna descarga nueva.

Sin color se usa exactamente la geometría/acabado previo del farol y los letreros antiguos;
sin normal se conserva el nuevo albedo. Ningún material transparente ni pase nuevo.

## Aceptación

127/127 pruebas pertinentes. Un contexto previo PC y ocho finales: PC, móvil, low, noche,
noassets, color ausente, normal ausente y vertical rotado. Cuatro vistas por caso, 36 capturas;
32 cambios finales `high → low → medium → high`, GL=0 y recursos conservados. El principal
inspecciona capturas y abre ambas fichas. Registro en [entrega](../delivery/town-fixtures-v1.md).
FPS en equipos físicos, ajuste artístico adicional y publicación siguen pendientes.
