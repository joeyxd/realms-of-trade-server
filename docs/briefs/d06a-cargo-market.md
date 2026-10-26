# D06a — bodega y mercados caminables

Fecha: 2026-10-05. Base de integración `018a177`; D05 aceptado en `991db89`.
Estado: aceptado localmente en software, `0.6.0-alpha.3` / protocolo 15. D06 se divide en cortes:
este conecta carga/comercio; D06b conecta producción. [Resultado y evidencia](../delivery/d06a-cargo-market.md).

## Resultado jugable

Hablar con Don Bacalao en Aldea o La Tuerta en Cala, elegir mercancía y cantidad, pedir el total al servidor
y confirmar compra/venta en la mochila. Junto a la balsa propia, abrir Bodega (H o botón táctil), depositar
o retirar bienes reales y ver capacidad por peso y estadísticas existentes de la balsa.
No cambia pérdidas, muerte, navegación ni reservas seguras de puerto; estas últimas requieren D09.

## Reutilización antes de implementar

Revisión Luna acotada del inventario y candidatos Unreal antes de autoría visual. Caja Dreamrise A02 ya
importada sirve a la balsa; se mantiene. Banco `SM_RepairBench` reservado para producción D06b, pendiente
exportación/canario. No ejecutar Blueprints/UMG en navegador. Reutilizar `Economy`, `cargo`, `raftStats`,
diálogo, looks y estilo de paneles; registrar candidatos y decisión en el informe de entrega.

## Contrato del principal

- Nuevo comando `commerce`, evento privado `commerce` con `op`, `opId`, `ok`, `why`, `rev`.
- Lecturas `list {town}`, `quote {town,g,n,side}`, `cargo {id}`. Respuesta correlacionada al `opId`.
- Mutaciones `buy/sell {town,g,n,expectedTotal,opId}` y `transfer {id,expectedRev,g,n,side:'deposit'|'withdraw',opId}`.
- Cantidad entera segura 1..500. Precio cotizado por servidor; confirmar exige total igual al actual, de
  lo contrario rechazar `price` y volver a cotizar. Sin precios, saldo, propiedad o capacidad del cliente.
- Compras/ventas en radio de pueblo caminable; mutaciones en calma (3 s sin daño), vivo y sin dash/cast.
  Transferencia solo balsa primaria propia amarrada en Aldea, cubierta propia o pasarela válida del D05,
  estacionario y revisión de plano exacta. No transferencias remotas ni a visitantes.
- Clonar mochila/bodega/perfil candidato y preflight de guardado antes de tocar stock o bienes.
  Reusar `load/unload/roomFor` y `Economy.quote/trade`; ninguna mutación parcial si algo no cabe.
- Recibos de mutaciones exitosas en sesión: 64 por entidad, 256 entidades; repetir esa solicitud devuelve
  el mismo acuse y su ID con distinto contenido se rechaza. Fallos/lecturas no se cachean.
  Se limpian al desconectar, sin promesa durable.
- `eco.tradeRev` entero 0..2147483647, default/saneado. Incremento por mutación nueva; UI espera acuse
  y perfil con `tradeRev >= rev` para desbloquear. Transferencia incrementa también `ship.rev`.
- Legacy `market` conserva tests/contrato; cerrar truncado inseguro de cantidades y añadir preflight de
  guardado. No atribuirle recibos nuevos si el cliente no los manda.
- Protocolo 15 por nuevo evento/perfil. Root integra entrypoints y versión; no modificar archivos M5 ajenos.

## Equipo y aceptación

Luna autoridad: nuevo `src/sim/systems/commerce.js`, sin entrypoints. Luna UI: `src/ui/commerce.js`,
`styles/commerce.css`. Luna evidencia: tests y harness separados tras terminar revisión assets.
Root integra NPCs/diálogo/red/entrada, revisa evidencia y mantiene documentación.

Pruebas: conservación y límites por peso, propietario/ubicación/vivo/calma/revisión, cotización y cambios
de precio compartido, cantidades inválidas, reintentos, preflight de guardado antes del mercado,
guardado/reentrada y privacidad. QA real por UI en Worker local: hablar/cotizar/comprar/vender,
mochila→balsa→mochila y fallo por capacidad, PC y móvil horizontal/vertical; capturas inspeccionadas.
Regresión pertinente/completa y build comprometido local; no reiniciar host ni publicar.
