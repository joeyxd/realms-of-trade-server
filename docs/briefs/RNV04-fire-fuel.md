# RNV04 — combustible privado y fuegos útiles

Contrato AREA07, alpha.31 / protocolo 42. Implementación y aceptación local completadas; SQL022 aplicada y canario real 8/8. Publicación y entrada autenticada pendientes de registrar en la [entrega](../delivery/rnv04-fire-fuel.md). Este corte reutiliza la simulación, el perfil de personaje/balsa y la autoridad M5 existentes; no introduce otra autoridad de guardado.

## Reglas de producto

- **Las luces municipales son públicas e infinitas.** Faroles, fogatas y otras luces que forman parte del pueblo no usan los slots privados, no consumen madera y no dependen de quien esté conectado.
- **La antorcha de mano es consumible.** Un slot vacío permite crear y encenderla por una madera de la mochila. Una unidad dura 20 minutos de simulación. Al agotarse no se reenciende: se crea otra pagando una madera.
- **Los fuegos privados a bordo llevan un solo combustible.** Farol, antorcha de suelo, antorcha de pared, fogata y parrilla cargan una unidad de madera por slot. Faroles/antorchas duran 60 minutos; fogata/parrilla, 30 minutos. La carga de un slot ocupado se rechaza. No se extraen ni recargan unidades automáticamente.
- **Apagar conserva el combustible restante.** Al encender o apagar, el servidor calcula segundos completos restantes, redondeando hacia abajo. Un fuego agotado no se reactiva; cargar una unidad nueva lo deja apagado salvo que la petición lo encienda en la misma operación.
- **La parrilla conserva su receta existente.** El combustible habilita el módulo de producción ya instalado; no añade receta, producto ni una nueva vía de cocinar. La parrilla sigue limitada a su cadena de producción actual.
- **La construcción de estos módulos se limita a las piezas de la balsa.** La colocación de hogares privados en tierra aún no existe. El carbón y otros combustibles quedan para una decisión posterior.

## Estado y reloj

`src/data/fire.js` centraliza las duraciones y el límite de slots. `src/sim/economy/fire.js` sanea el estado versionado, calcula el tiempo restante y aplica carga/interruptor como transiciones puras. La omisión antigua del campo se interpreta vacía; versiones futuras o estado inválido fallan cerradas.

El perfil guarda un mapa privado versionado con revisión propia. La antorcha usa la clave `hand`; cada pieza de la balsa usa `[shipId, conditionEntryId]`, para que quitar/reconstruir una pieza no herede combustible de otra. El límite total es 601 slots: una antorcha personal y hasta 600 piezas privadas. La proyección privada de UI entrega clave, tipo, segundos restantes y estado encendido. Los demás reciben solo el estado visible de la antorcha y las piezas encendidas; no reciben combustible, recibos ni marcas temporales privadas.

El consumo usa segundos de simulación derivados del reloj de economía del mundo (`economy.hours × CLOCK.daySec / 24`). No se consulta el reloj del dispositivo ni se cobra inactividad mientras el mundo está detenido. Apagar no pierde el saldo fraccionario ya redondeado; la combustión activa sigue avanzando con la simulación.

## Autoridad y persistencia

El servidor deriva la identidad de la conexión, valida jugador vivo, tipo de slot, pieza/condición, dueño y proximidad antes de mutar. Solo el dueño puede encender, apagar o cargar un fuego privado de su balsa. La madera de mano se descuenta de la mochila; para un fuego de balsa se intenta primero la bodega de esa balsa y después la mochila.

Las operaciones `fire/load` y `fire/set` usan recibo M5 exacto y la autoridad económica existente. La revisión del fuego protege el estado de slots; la carga también avanza `tradeRev`. Repetir una petición exacta devuelve su resultado histórico sin volver a debitar madera. SQL022 valida el nuevo tipo de operación después de SQL001–021. La función se activa solo con `MN_FIRE_OPERATIONS=1` después de aplicar SQL022 y completar el canario previsto; la configuración de ejemplo permanece apagada.

La visualización de la antorcha personal y de piezas privadas sigue el estado confirmado del servidor. N abre el panel de combustible cuando la antorcha está vacía; con combustible confirmado, N solicita el cambio de estado. V/toque abre el panel del fuego privado cercano de la balsa propia. Ninguno de los controles modifica inventario ni enciende luz de forma optimista.

## Arte y presentación

La referencia Unreal previamente comprobada en solo lectura es `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes\SM_Torch.uasset` (21,751 bytes), con `Blueprints\BP_Building_Torch.uasset` (35,153 bytes). La miniatura muestra una antorcha azul alta, distinta del farol cálido de madera/hierro. No hay GLB portable aceptado; el Blueprint no aporta lógica browser portable. Reutilizar el lenguaje procedural existente hasta que exportación, estilo y presupuesto móvil se acepten. No modificar la fuente Unreal.

La implementación actual añade las fuentes privadas usando los presupuestos de luces locales existentes; no añade luces Three.js por pieza, sombras ni oclusión. La revisión local comprobó antorcha, farol, antorchas de pared/suelo, fogata y parrilla en PC ES y móvil emulado EN, bajo/alto. Capturas inspeccionadas y resultados enlazados en la entrega. Selección/reubicación/reloj de fixtures son programáticos; no acreditan recorrido humano ni FPS en teléfono físico.

## Estado de aceptación

**Implementado y probado localmente:** slots, M5, panel ES/EN, N/V, render y piezas del editor. Integración 91/91, selección de imagen 107/107 y composición del diario/autoridad común 33/33 (selecciones solapadas). Cuatro vistas PC/móvil emulado bajo/alto aceptadas. Suite global con fallos ajenos/temporización documentada; no se declara globalmente verde.

**SQL real:** SQL022 aplicada mediante editor SQL autenticado; canario aislado 8/8, perfiles/mundos QA eliminados y recibos inmutables retenidos. Composición con SQL018/019 probada localmente sin activar el montaje de reloj común del mundo legacy.

**Publicación:** bandera por defecto apagada; activación VPS y entrada autenticada por registrar en la [entrega](../delivery/rnv04-fire-fuel.md). No afirmar consumo durable público hasta cerrar esa evidencia.

## Continuidad AREA07

Este corte añade combustible a fuentes privadas y no reemplaza la siguiente dependencia del plan naval: agua costera y reembarque con carga, agotamiento, salida y rescate decididos y probados. Provisiones/servicios de hogar y viaje entre puertos continúan después según el orden vigente. La vivienda colocable en tierra, el carbón y la expansión de recetas permanecen fuera de este corte.
