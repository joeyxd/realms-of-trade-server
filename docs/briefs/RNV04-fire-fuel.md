# RNV04 — combustible privado y fuegos útiles

Contrato de implementación local de AREA07. La entrega visual, aceptación pública y activación de SQL022 siguen pendientes. Este corte reutiliza la simulación, el perfil de personaje/balsa y la autoridad M5 existentes; no introduce otra autoridad de guardado.

## Reglas de producto

- **Las luces municipales son públicas e infinitas.** Faroles, fogatas y otras luces que forman parte del pueblo no usan los slots privados, no consumen madera y no dependen de quien esté conectado.
- **La antorcha de mano es consumible.** Un slot vacío permite crear y encenderla por una madera de la mochila. Una unidad dura 20 minutos de simulación. Al agotarse no se reenciende: se crea otra pagando una madera.
- **Los fuegos privados a bordo llevan un solo combustible.** Farol, antorcha de suelo, antorcha de pared, fogata y parrilla cargan una unidad de madera por slot. Faroles/antorchas duran 60 minutos; fogata/parrilla, 30 minutos. La carga de un slot ocupado se rechaza. No se extraen ni recargan unidades automáticamente.
- **Apagar conserva el combustible restante.** Al encender o apagar, el servidor calcula segundos completos restantes, redondeando hacia abajo. Un fuego agotado no se reactiva; cargar una unidad nueva lo deja apagado salvo que la petición lo encienda en la misma operación.
- **La parrilla conserva su receta existente.** El combustible habilita el módulo de producción ya instalado; no añade receta, producto ni una nueva vía de cocinar. La parrilla sigue limitada a su cadena de producción actual.
- **La construcción de estos módulos se limita a las piezas de la balsa.** La colocación de hogares privados en tierra aún no existe. El carbón y otros combustibles quedan para una decisión posterior.

## Estado y reloj

`src/data/fire.js` centraliza las duraciones y el límite de slots. `src/sim/economy/fire.js` sanea el estado versionado, calcula el tiempo restante y aplica carga/interruptor como transiciones puras. La omisión antigua del campo se interpreta vacía; versiones futuras o estado inválido fallan cerradas.

El perfil guarda un mapa privado versionado con revisión propia. La antorcha usa la clave `hand`; cada pieza de la balsa usa `[shipId, conditionEntryId]`, para que quitar/reconstruir una pieza no herede combustible de otra. El límite total es 601 slots: una antorcha personal y hasta 600 piezas privadas. La proyección pública entrega solo clave, tipo, segundos restantes y estado encendido; no publica recibos ni marcas temporales privadas.

El consumo usa segundos de simulación derivados del reloj de economía del mundo (`economy.hours × CLOCK.daySec / 24`). No se consulta el reloj del dispositivo ni se cobra inactividad mientras el mundo está detenido. Apagar no pierde el saldo fraccionario ya redondeado; la combustión activa sigue avanzando con la simulación.

## Autoridad y persistencia

El servidor deriva la identidad de la conexión, valida jugador vivo, tipo de slot, pieza/condición, dueño y proximidad antes de mutar. Solo el dueño puede encender, apagar o cargar un fuego privado de su balsa. La madera de mano se descuenta de la mochila; para un fuego de balsa se intenta primero la bodega de esa balsa y después la mochila.

Las operaciones `fire/load` y `fire/set` usan recibo M5 exacto y la autoridad económica existente. La revisión del fuego protege el estado de slots; la carga también avanza `tradeRev`. Repetir una petición exacta devuelve su resultado histórico sin volver a debitar madera. SQL022 valida el nuevo tipo de operación después de SQL001–021. La función se activa solo con `MN_FIRE_OPERATIONS=1` después de aplicar SQL022 y completar el canario previsto; la configuración de ejemplo permanece apagada.

La visualización de la antorcha personal y de piezas privadas sigue el estado confirmado del servidor. N abre el panel de combustible cuando la antorcha está vacía; con combustible confirmado, N solicita el cambio de estado. V/toque abre el panel del fuego privado cercano de la balsa propia. Ninguno de los controles modifica inventario ni enciende luz de forma optimista.

## Arte y presentación

La referencia Unreal previamente comprobada en solo lectura es `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes\SM_Torch.uasset` (21,751 bytes), con `Blueprints\BP_Building_Torch.uasset` (35,153 bytes). La miniatura muestra una antorcha azul alta, distinta del farol cálido de madera/hierro. No hay GLB portable aceptado; el Blueprint no aporta lógica browser portable. Reutilizar el lenguaje procedural existente hasta que exportación, estilo y presupuesto móvil se acepten. No modificar la fuente Unreal.

La implementación actual añade las fuentes privadas usando los presupuestos de luces locales existentes; no añade luces Three.js por pieza, sombras ni oclusión. La revisión visual aún debe comprobar día/noche, materiales, giro/pose, fuego encendido/apagado y reemplazo/retirada en escritorio y móvil bajo/alto. Las capturas deben inspeccionarse antes de aceptar la presentación.

## Estado de aceptación

**Implementación local:** contrato de slots, operación M5 opcional, panel ES/EN, integración N/V y render están en el árbol local. La bandera sigue apagada por defecto. No se declara SQL022 aplicado, canario autenticado, publicado ni desplegado.

**Pruebas de UI ya ejecutadas:** `tests/fire-state.test.mjs` (8/8), `tests/fire-panel.test.mjs` (6/6), y el corte focal `tests/fire-actions.test.mjs tests/personal-lantern-ui.test.mjs tests/raft-lantern-ui.test.mjs` (19/19). Esto no sustituye la suite integrada de autoridad/SQL, la revisión visual, el chequeo del artefacto, el estado sano de la revisión activa ni la entrada pública.

**Pendiente antes de activar:** validar la suite completa de operación con SQL022, canario y replays/crash sobre la autoridad única, aceptación visual de las seis clases privadas, activación explícita de la bandera, despliegue sin jugadores y comprobación pública de revisión/imagen/salud/entrada. No afirmar consumo durable en producción hasta completar esas etapas.

## Continuidad AREA07

Este corte añade combustible a fuentes privadas y no reemplaza la siguiente dependencia del plan naval: agua costera y reembarque con carga, agotamiento, salida y rescate decididos y probados. Provisiones/servicios de hogar y viaje entre puertos continúan después según el orden vigente. La vivienda colocable en tierra, el carbón y la expansión de recetas permanecen fuera de este corte.
