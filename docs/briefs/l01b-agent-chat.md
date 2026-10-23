# L01b — chat común del personaje agente

2026-10-08. Continuación autorizada por «continue man pliz» tras
[L01a](../delivery/l01a-agent-network.md), dentro de las 22 líneas acordadas del
[plan](../../PLAN-EXTRA-LLM.md). Raíz decide/integrará; workers Luna prueban contrato y vista.

## Resultado y alcance

El invitado del runner recibe/envía Mundo, Cerca y susurros mediante C01, con identidad de
conexión, audiencia entregada, resultados/rechazos visibles y reintento explícito del mismo ID.
Otro cliente humano lo usa por la interfaz normal. El servidor conserva routing, posición,
identidad y rate limit existentes. El texto recibido nunca se convierte en una orden del cuerpo.

Capability local `chat` explícita; sobre v1 exige scope/control/observación frescos. Una petición
sin resultado bloquea otra nueva; misma sesión, payload/ID/token y máximo dos reintentos manuales.
Un resultado significa enrutado, lectura desconocida, durabilidad solo de sesión. No migrar peticiones
ni tokens a otra conexión. Historial y ledger acotados; contexto poda chat antiguo con omisiones visibles.

Sin inferencia, proveedor, edición de memoria, permisos del servidor, cuenta secundaria ni gasto.
No cambia protocolo, host, chat común, UI ni simulación. D-A3, autoridad L02c, vida/reentrada L01c,
mente L03, memoria durable L04 y presupuesto monetario L05 conservan sus cortes.

## Reutilización comprobada

`src/net/chatService.js`, configuración C01, mensajes `CHAT_*`, WsTransport/GameClient, panel y
burbujas existentes. El adaptador usa una vía privada de envío validado; no expone `send` genérico.
La identidad propia de C01 se mapea al alias local del personaje en la observación; destinatarios
de envío conservan el token real de conexión, separado del ID de entidad y nombre.

Se revisaron candidatos concretos del [inventario Unreal/FAB](../research/unreal-assets/CANDIDATES.csv):
`ActionRPGStarterSystem/Widgets/Images/ItemImages/T_SwordImage.uasset` y las imágenes de inventario
no resuelven chat ni transporte Node. UMG/Blueprint requieren otro runtime. Descartados para este
corte, como documenta el [brief C01](c01-chat.md#reutilización-revisada); fuentes intactas, sin arte nuevo.

## Aceptación local

Pruebas reales por WebSocket de tres personajes: Mundo/Cerca, susurro excluido del tercero,
rechazos de rate/destinatario y respuesta perdida recuperada sin duplicación. Aislamiento/frescura,
pruning/deduplicación de historial, Unicode conforme a C01, stop e incertidumbre, CLI/contexto.
Navegador ordinario conversa con Brisa y captura los canales compartidos/privados; raíz inspecciona
las imágenes y evidencia. No deducir lectura humana, WAN, dispositivos físicos o publicación.
