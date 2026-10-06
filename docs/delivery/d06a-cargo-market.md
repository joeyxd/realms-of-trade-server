# D06a — bodega y mercados caminables

Fecha: 2026-10-05. Base de integración `018a177`; D05 `991db89`.
Versión `0.6.0-alpha.3`, protocolo 15. Estado: aceptado localmente en software.
[Brief](../briefs/d06a-cargo-market.md). D06b producción sigue separado.

## Qué cambia

Don Bacalao en Aldea y La Tuerta en Cala ofrecen «Comerciar mercancías» al hablar. El panel muestra stock,
compra/venta, tendencia, contrabando, oro y mochila. Seleccionar bien/cantidad solicita cotización al servidor;
confirmar exige el total vigente. Los mercados existentes siguen compartidos entre los jugadores.

Junto a la balsa propia amarrada en Aldea, H o Bodega abre transferencias mochila ↔ bodega. Se muestra capacidad
por peso y las estadísticas existentes; la velocidad es teórica, todavía no hay navegación. Las cajas comparten
la bodega. G conserva el poder de la perla también en cubierta; Esc cierra y B abre el editor existente.
El panel permite movimiento y silencia combate; una transferencia requiere estar quieto y en calma.

## Autoridad y persistencia

`commerce` envía respuestas privadas correlacionadas. Cantidades enteras 1..500, propietario, ubicación,
vida/calma, revisión de plano, saldo, bienes, stock y capacidad se validan en servidor. Se clona estado y se
prueba el save candidato antes de cambiar recursos o stock real. El mercado legacy recibe también cantidad
estricta, protección de oro máximo y preflight del save firmado.

Compras/ventas y transferencias suben `eco.tradeRev`, saneado/default 0. Transferencias suben también
`ship.rev`. La UI espera acuse y perfil correspondiente antes de permitir otra mutación. Cerrar/reabrir no
borra la solicitud pendiente; un reenvío conserva el identificador y contenido.

Recibos de éxito en memoria: 64 por entidad y 256 entidades, limpiados al desconectar. Dentro de esa ventana,
repetir solicitud devuelve el acuse; alterar contenido con el mismo ID se rechaza. Son recibos de sesión;
el mercado del mundo y el perfil siguen en almacenes separados. No es una transacción durable conjunta ni
recuperación de bienes expuestos D09. La partida invitada sigue el límite firmado existente de 32 KiB.

## Reutilización y siguiente paso

Antes de implementar se verificaron candidatos del inventario Unreal/FAB mediante Luna.
[Revisión concreta](../research/unreal-assets/D06-REUSE.md): caja Dreamrise ya importada, GLB 51.684 B/204
triángulos; reutilizada sin nueva textura/modelo. Mercaderes usan looks y diálogo existentes; categorías
dibujadas en UI. Blueprints/UMG, icono y audio siguen empaquetados, no ejecutables/importados en navegador.
Fuentes `C:\Unreal` intactas. Atlas de balsa conserva sus variantes 1024 escritorio/512 móvil.

El [siguiente brief D06b](../briefs/d06b-production.md) prepara producción y el canario `SM_RepairBench`.
Debe resolver progreso fraccionario, identidad de piezas y lotes con bodega llena antes de conectar el reloj.
Después D08 manejo; reservas de puerto y movimientos con riesgo durable requieren D09. Este corte no entrega
viento, zarpar, daño naval, pérdida de mochila al morir, hamaca ni luces de vivienda.

## Verificación

- **8/8 pruebas nuevas** de comercio: entradas estrictas, cotización compartida, recibos/reintentos,
  conservación, peso, propiedad/ubicación/calma/revisión, privacidad, guardado firmado y reentrada.
- Regresión completa del checkout compartido: **453/453**, concurrencia 2 y timeout de 60 s por archivo.
  Incluye pruebas M5 ajenas en curso al ejecutar; no equivale a aceptar ni incorporar esa misión.
  Registro `.scratch/d06a-regression-final.log`, SHA-256 y resultado en el [registro durable](d06a-evidence.json).
- Tres recorridos reales en Worker local: escritorio 1280×720, táctil 844×390 y teléfono vertical 390×844
  con escenario girado. **45 capturas inspeccionadas** en `shots/review/d06a/*-accepted/`.
  Hablar → cotizar → comprar tres maderas → vender una → comprar una → depositar dos → retirar una.
  Resultado por caso: oro 984, mochila dos maderas, bodega una, `tradeRev=5`, `ship.rev=3`; mismos bienes
  y revisiones después de guardado ordinario/reload/reentrada. Capacidad llena bloquea otra transferencia.
- Escritorio pierde deliberadamente el primer acuse de compra: cerrar/reabrir conserva la petición;
  reintentar con el mismo ID devuelve el acuse sin otro cobro. H abre/cierra bodega y G sigue entrada de perla.
  Móvil habla también con La Tuerta y muestra precios/contrabando propios de Cala; usa modo dios de fixture
  para inspeccionar UI entre mobs, sin aceptar combate/comercio bajo daño.
- Oro inicial 1000 y teletransporte son fixtures aislados; bienes obtenidos pagando y transfiriendo mediante
  controles reales. Render solo al capturar, reloj/Worker/entrada normales, cámara de balsa controlada y
  fade cercano desactivado para inspección. Sin errores JS de página/juego; Google Fonts bloqueadas
  deliberadamente generan avisos de red conocidos. No se afirma consola global vacía.
- Textura cargada realmente: atlas 1024² escritorio, solo variante 512² móvil. Este corte no añade arte ni
  descargas. Navegador/GPU en software y móvil emulado no acreditan FPS o sensación en dispositivo físico.

Build local desde árbol commiteado y verificación de hashes se registran junto al commit en la evidencia.
No se reinicia host ni se publica desde este corte. Cliente y servidor deben actualizarse juntos a protocolo 15
cuando se autorice actualizar el host.
