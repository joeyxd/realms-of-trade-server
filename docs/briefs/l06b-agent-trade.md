# L06b-2b — comercio autorizado con saldo durable

Corte del área 17, 2026-10-10. Continúa [el plan del compañero](../../PLAN-EXTRA-LLM.md)
y [las lecturas de mercado](l06b-agent-market.md). El resultado es una compra y una venta
explícitas del runner, usando las mismas reglas, perfil y mercado M5 que los humanos.

## Contrato de esta entrega

- Capacidades independientes `trade_buy` y `trade_sell`, concedidas mediante el binding del
  servidor. Entrada privada exacta; el agente nunca selecciona dueño, cuenta, ciudad ni perfil.
- El dueño autenticado crea, consulta o revoca un mandato para su personaje configurado.
  No se crean bindings ni capacidades por este canal. El agente no configura sus límites.
- Unidad: oro de compras y unidades vendidas por bien. Alcance: mundo/dueño/personaje.
  Periodo: vida del mandato, sin renovación automática. Un máximo por operación acompaña
  al acumulado. Las ventas no reponen oro gastado ni amplían otras autorizaciones.
- Los bienes y el oro pertenecen al personaje del agente. Este corte no transfiere patrimonio
  desde el dueño. No crea oro, materiales, crédito ni un segundo inventario.
- Sin mandato no se admiten operaciones. No hay cifras de producto por defecto. Límites cero
  cierran ese lado. El mandato es inmutable y su revocación definitiva; reposición o sustitución
  requieren un contrato posterior. Repetir `create` nunca reinicia consumo ni reactiva el saldo.
- SQL017 extiende M5 con política y vínculo al recibo económico. Una sola transacción bloquea
  la política, comprueba límites, confirma perfil/mundo/recibo SQL014/015 y registra el consumo.
  El bloqueo transaccional reserva el saldo; no existe una reserva externa que venza y se libere
  tras una respuesta perdida. La asociación no es otro escritor de gameplay.
- Antes de enviar el commit se revalida control/vida/stop. Después del envío, el resultado puede
  ser incierto: se consulta el recibo o se reenvía exclusivamente el mismo request CAS. Un stop
  impide nuevos gastos; conserva y reconcilia el commit que ya cruzó esa frontera.
- Reintento con el mismo `opId` recupera el recibo sin repetir efectos ni consumo. Otro contenido
  con ese ID se rechaza. Reentrada usa grant fresco y el mismo ID; no hidrata inventario histórico.
  Para recuperar por este canal se vuelve al servicio de la ciudad original.
- `expectedTotal` se contrasta con el precio actual en el helper humano. Una memoria o cotización
  caduca no autoriza el precio. Rechazos de comercio tienen recibo y coste cero; denegación de
  permiso/presupuesto no escribe una operación económica. Cantidad, carga, stock, calma, ley y
  propiedad conservan las reglas humanas.
- API/CLI explícitas, timeout incierto y feedback privado. Una confirmación nueva invalida las
  lecturas anteriores. Un replay no instala estado vigente. El decisor simulado sigue sin acción
  de gasto; este corte no añade proveedor, planificador autónomo ni coste de inferencia.

## Integración y pruebas

Montaje confiable `agentTrade:true` junto con piloto/control y economía M5. El arranque normal
conserva agentes/comercio de agentes apagados y no necesita SQL017 mientras estén apagados.
No se modifican `.env` ni SQL live como efecto de publicar código inerte. Protocolo 38 requiere
recargar host/peers; versión de esta fuente alpha.26, integrada con Tala, refugio y GM02.

Comprobar compra/venta con conservación y consumo únicos, cap/identidad/selectores adversarios,
precio/carga/stock, revocación durante preparación y después del envío, pérdida de respuesta,
reentrada/reinicio con recibo histórico, ACL/RLS SQL017 y regresión humana/recursos SQL014/015.
Ver [uso](../agents/trade.md) y [entrega](../delivery/l06b-agent-trade.md).

Reutilización Unreal/FAB: el candidato `ActionRPGStarterSystem/InventorySystem` ya identificado
en el [brief anterior](l06b-agent-market.md) no aporta atomicidad M5 ni permisos del servidor JS.
Se reutilizan el mercado, perfil, transporte y controles existentes; no hacen falta nuevos assets,
Blueprints ni importaciones. Fuentes Unreal intactas.
