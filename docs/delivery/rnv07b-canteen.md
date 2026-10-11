# RNV07b — cantimplora y supervivencia

**Implementación y revisión local aceptadas; activación y entrega pública en curso.** El corte agrega una cantimplora reutilizable de tres dosis y consumo de alimentos/agua integrado con la supervivencia SRV01 y las operaciones económicas M5 existentes. La especificación funcional está en el [brief](../briefs/RNV07b-canteen-survival.md).

## Resultado local

La cantimplora se fabrica con 2 lona y 1 madera, admite 3 unidades y se rellena desde manantial, cubeta, barril de balsa o provisiones. Las transferencias conservan una sola cantidad; recipientes y agua cuentan en la carga. Beber gasta una dosis y restaura hasta 40 de hidratación. Comer usa bienes existentes, actualiza saciedad/hidratación y aplica el heal de comida una sola vez al confirmarse la nueva operación.

La supervivencia reutiliza `surv:{v:1,sat,hyd}` opcional de dos decimales y se actualiza dentro del perfil conectado y el guardado existente. Los medidores drenan en unos 60 minutos de saciedad y 40 de hidratación a reposo, a 1,5× al moverse/nadar; no avanzan offline ni durante muerte. Reducen máximos y recuperación sin causar daño de hambre/sed. Reaparecer establece ambos en 50. Todo consumo se deniega con `busy` durante un viaje activo. El cliente concilia la acción con el snapshot/ACK del host, y una espera del recibo durable no adelanta el efecto.

Los puntos de entrada están en [`waterContainers.js`](../../src/sim/economy/waterContainers.js), [`freshwater.js`](../../src/sim/systems/freshwater.js), [`freshwaterProfile.js`](../../src/sim/systems/freshwaterProfile.js) y [`survival.js`](../../src/sim/systems/survival.js). El contrato de recipientes/tuning está en [`freshwater.js`](../../src/data/freshwater.js); la validación de supervivencia en [`survival.js`](../../src/data/survival.js). M5 conserva el recibo, la revisión y el commit mediante `EconomicAuthority`.

La feature queda detrás de `MN_CANTEEN_OPERATIONS`, cuyo default es apagado. **SQL032 aplicada por el autor** y [readiness 1 verificado](rnv07b-canteen/sql-live.json) contra Supabase a las 05:41Z. La etiqueta **alpha.47 / protocolo 53** identifica el corte; el despliegue y la comprobación pública se registrarán por separado.

## Assets

La auditoría encontró `SM_WaterBottle.uasset` (22.030 B) y `T_WaterBottle.uasset` (110.336 B) en el inventario [`survival/files.csv`](../research/unreal-assets/survival/files.csv). Permanecen como candidatos con referencias/dependencias sin resolver; no se exportaron ni aceptaron modelo o icono. El corte usa la interfaz e inventario existentes.

## Pruebas y evidencia

La [selección de 21 archivos del actualizador](rnv07b-canteen/updater-selection.json) pasó **153/153**, sin fallos ni saltos. La [integración de 18 archivos](rnv07b-canteen/integration.json) pasó **117/117**, incluidos los **13/13 de SQL032**; una revisión focal posterior pasó 18/18 con regresión del máximo de aguante cliente/servidor. Los conteos se solapan. Cubren validación estricta, recipientes en ambos órdenes, conservación, revisión/replay, consumo, curación única, bloqueo durante viaje y espera de commit.

El [navegador local](rnv07b-canteen/local/evidence-2026-10-11T05-44-13-236Z.json) pasó escritorio ES 1280×720 y touch EN 390×844 con orientación de juego horizontal: fabricación pagada, canal de manantial, rellenos desde cubeta/provisiones/barril, bebida/comida, cantimplora vacía conservada, reload y límites del panel. **14 capturas**, siete por viewport; inspección directa de escritorio y móvil, sin errores de navegador ni solicitudes externas. La fixture elimina enemigos y ajusta necesidades entre etapas; prueba el flujo de interfaz en memoria, no el encuentro, WAN, crash o rendimiento físico.

## Siguiente entrega

Tras cerrar la revisión visual y readiness/activación autorizada, el siguiente tramo jugable es la ruta comercial Salty Shore–Puerto Sol: preparar y cargar reservas, llegar, comerciar, descargar y regresar. Después seguirá el purificador avanzado en Bahía Ceniza, sujeto a un origen jugable y adquisición única del componente raro.
