# RNV07b — cantimplora y consumo con supervivencia

**Brief de implementación.** RNV07b continúa el circuito manual de [RNV07](RNV07-freshwater-progression.md) y reutiliza la reserva de [RNV07a](../delivery/rnv07-freshwater.md). La cantimplora guarda dosis enteras dentro del perfil M5; beberlas modifica la supervivencia existente. No crea una segunda sed, escritor, reloj ni namespace de operaciones.

## Contrato jugable

- Fabricar una cantimplora cuesta **2 lona y 1 madera** de la mochila. Solo se admite una por perfil. Tiene **3 dosis**, ocupa 1 de volumen y pesa 0,5 vacía más el peso del agua. Se conserva al vaciarse.
- Se rellena desde el manantial de Salty Shore, una cubeta, un barril de la balsa o las provisiones existentes. Cada unidad permanece en un solo recipiente o mercancía. La cantimplora y el barril no duplican agua al transferirla.
- Beber consume exactamente una dosis y restaura hasta **40 puntos de hidratación**. Comer una unidad de un alimento existente aplica los valores de `FOODS` y consume el bien. La comida que aumenta saciedad cura además el **5 % de la vida máxima**; beber no cura.
- La sed y la saciedad bajan a lo largo del juego conectado. A reposo se vacían en aproximadamente **40 y 60 minutos**, respectivamente; movimiento o nado acelera ambas a **1,5×**. Se pausan offline. Las necesidades reducen vida máxima, aguante máximo y recuperación de aguante según `src/data/survival.js`; nunca causan daño ni muerte por sí solas. Al reaparecer, ambas quedan en 50.
- Ningún consumo de cantimplora, alimento, provisiones, cubeta o barril se admite durante un viaje activo. El servidor responde `busy`; el cliente espera la confirmación autoritativa y no descuenta una dosis local que el estado del viaje pueda restaurar.

Las capacidades, costes y restauraciones son tuning de este corte, no una afirmación de balance final.

## Autoridad y perfil

`GameHost`/M5 conserva la validación de propietario, revisión, contenido, coste y operación. Construir, rellenar, comer y beber entran en la familia `freshwater` y usan el recibo económico existente, con replay por identidad de operación. SQL032 valida la transición completa entre perfil anterior y nuevo, incluida la cantidad `surv` y los recipientes; no añade una tabla de necesidades ni un writer.

El campo opcional `surv: { v: 1, sat, hyd }` permite dos decimales exactos. Si falta, ambos medidores parten llenos; si está presente con forma o precisión inválida, se rechaza el perfil/operación. El estado del recipiente vive en `eco.pack.vessels`; agua de barril y mercancía `agua` siguen en sus contenedores actuales. La simulación actualiza el perfil conectado desde los ticks aceptados, y el guardado/captura usa el mismo perfil. Los efectos del consumo se aplican junto con el perfil confirmado por el recibo M5; una espera o fallo de commit congela la aplicación conjunta de cambios.

El opt-in `MN_CANTEEN_OPERATIONS` queda apagado por defecto. Requiere SQL032 aplicada después de SQL031 y readiness correcto antes de habilitar cuentas. El archivo de migración presente en el repositorio no significa que esté aplicado.

## Presentación y reutilización

La interfaz reutiliza el panel de agua/provisiones y el inventario existentes, con etiquetas ES/EN y acciones de escritorio/touch. El inventario refleja dosis, volumen y masa con agua incluida.

Se revisaron dos candidatos concretos del inventario Unreal: `Dreamrise_SMSK/Assets/Meshes/SM_WaterBottle.uasset` (**22.030 B**) y `Dreamrise_SMSK/Assets/Textures/Icons/Items/T_WaterBottle.uasset` (**110.336 B**), registrados en [`files.csv`](../research/unreal-assets/survival/files.csv). El inventario solo los identifica como candidatos por paquete/ruta; las referencias y dependencias siguen sin resolverse y no se exportó ninguno. No se acepta un modelo ni icono Unreal en este corte. La cantimplora se integra en los datos y presentación existentes hasta que un asset concreto pase exportación, inspección y aceptación.

## Aceptación y límites

La aceptación local cubre coste y unicidad de fabricación, llenado desde cada origen, dosis llenas/vacías, consumo de comida y agua, carga, revisión/replay, reconnect, rechazo durante viaje activo, hold durante commit, ES/EN y escritorio/touch. [Resultados y capturas aceptados](../delivery/rnv07b-canteen.md): 153/153 en la selección del actualizador y dos viewports. La fixture visual sin enemigos no acepta el encuentro ni prueba activación en VPS.

La publicación se identifica como **alpha.47 / protocolo 53**. SQL032 fue aplicada por el autor y su readiness 1 se verificó contra Supabase. El [informe de entrega](../delivery/rnv07b-canteen.md) registra la activación y revisión activa, imagen sana, 19 hashes públicos y canario WSS autenticado con reconexión en Supabase; esas evidencias prevalecen sobre el estado candidato inicial.

Después de RNV07b sigue el viaje comercial Salty Shore–Puerto Sol: cargar reservas, llegar físicamente, comerciar, descargar y regresar. El purificador avanzado en Bahía Ceniza queda para una entrega posterior, cuando el origen jugable del componente raro y su adquisición estén acordados y accesibles.
