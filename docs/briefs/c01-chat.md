# C01 — Chat en juego para personas y agentes

Estado: **implementado y verificado localmente; publicación pendiente**. [Entrega y límites de la verificación](../delivery/c01-chat.md): 17/17 pertinentes; regresión general 1707/1708 con un timeout que pasó aislado. Este corte establece el primer canal social compartido para jugadores humanos y agentes. El trabajo de agentes es una prioridad esencial del proyecto, según la dirección actual del autor; los documentos anteriores que lo describen como línea de baja prioridad quedan superados en ese punto.

## Objetivo y alcance

Permitir conversar desde el juego con tres canales: **Mundo** llega a los jugadores admitidos en la instancia actual; **Cerca** llega a quienes están dentro de un radio tridimensional de 24 unidades; **Susurro** llega únicamente al remitente y al jugador conectado elegido. El radio, longitud, ritmo e historial tienen controles de configuración del host. No hay mensajes entre instancias.

Personas y agentes usarán el mismo contrato de transporte y audiencia. C01 prepara mensajes estructurados para el runner L01; la respuesta elegida por el LLM llega en L03. Este corte no integra proveedores LLM ni concede a un agente permisos de juego adicionales.

## Contrato y límites

- El chat usa la sesión admitida del WebSocket que ya conecta el cliente con su servidor de juego, tanto invitado como cuenta verificada. El servidor deriva identidad y nombre del remitente de la sesión; ignora cualquier identidad enviada en el payload.
- Solo participantes admitidos tienen sesión de chat. Quien está mirando como espectador no recibe ni envía mensajes.
- Cerca calcula elegibilidad al enviar, con las posiciones actuales autoritativas `x/y/z` y distancia euclidiana inclusiva. El valor inicial es 24, configurable entre 1 y 200.
- Susurro usa un identificador opaco de conexión de corta duración, no el ID reciclable de entidad ECS. Un destinatario desconectado o token vencido se rechaza; susurros no se redirigen a quien ocupe después esa entidad.
- El texto se normaliza, limpia controles y se limita a 300 puntos Unicode por defecto. No se interpreta como HTML. Límite de envío inicial: ráfaga de 4, recarga de 0,5 mensajes por segundo, por sesión.
- Cada petición lleva `id`, devuelto como `requestId`. El servidor conserva hasta 128 recibos por sesión: dentro de esa ventana un reintento idéntico devuelve el mismo resultado sin duplicar el mensaje; reutilizar el ID con otro contenido se rechaza como conflicto. No hay reenvío automático tras reconectar ni garantía de deduplicación fuera de esa ventana.
- El recibo confirma que el servidor aceptó y enrutó el mensaje; no confirma que se leyó. No es almacenamiento durable.
- Se conserva un máximo de 100 mensajes visibles para cada sesión conectada. La desconexión termina esa historia; al volver no se repone el historial. Una persona que entra después no recibe mensajes anteriores de Cerca o Susurro.
- El texto de chat no entra en `src/sim/**`, perfiles, guardados ni eventos de gameplay. No consume RNG ni modifica el estado del mundo.

## Interfaz

El panel compacto ofrece selector de canal y destinatario, log accesible, indicador de no leídos, estado de envío y reintento de la misma petición si queda incierta. Está disponible con teclado y controles táctiles. Escribir no mueve ni ataca al personaje; Escape cierra el panel. El render usa nodos de texto (`textContent`), no ejecuta marcado del usuario.

Ampliación aprobada y verificada localmente: [burbujas sobre los personajes](../delivery/c01-chat-bubbles.md).
Cerca es el canal inicial y genera burbujas temporales; los susurros solo aparecen a sus participantes
cuando el personaje es visible y cercano. Mundo conserva su lectura en el panel. El historial queda
disponible sin reanimar mensajes antiguos; el panel puede estar cerrado al leer las burbujas.

Al integrar conversación de agentes, el runner recibirá solo mensajes que el servidor haya entregado a su sesión y podrá contestar en los canales/destinatarios autorizados por el mismo contrato. C01 no convierte al modelo en autoridad ni comparte conversaciones que el jugador no recibió.

## Reutilización revisada

- Se reutilizan `ws` y el endpoint `/ws`, la autenticación/join existente, `GameClient`/su bus de eventos y el transporte JSON compartido con el worker local. No se añade dependencia.
- Se reutiliza el diálogo existente únicamente como referencia de interacción: `talk` abre conversaciones de NPC/quests, no es chat libre entre jugadores.
- El inventario Unreal/FAB en `docs/research/unreal-assets/CANDIDATES.csv`, `SUMMARY.md` y `PORTABILITY.md` no identifica un asset ni widget de chat. Las interfaces UMG/Blueprint no se ejecutan en el cliente web. Por eso C01 usa una interfaz HTML propia; la ampliación de burbujas reutiliza las anclas/proyección de `src/ui/worldui.js`, con nodos de texto y un mapa separado del diálogo NPC.
- Supabase Realtime Broadcast ofrece canales privados con autorización RLS y podría apoyar historial persistente en otro corte. No conoce por sí solo la proximidad autoritativa del ECS, y añadirlo ahora duplicaría routing y sesión.
- Firebase Realtime Database aporta listeners y reglas de lectura/escritura aplicadas en servidor; el producto y sus reglas añadirían otra capa de identidad/datos sin resolver el alcance espacial del juego.
- Socket.IO incluye rooms, acknowledgements, reconexión y recuperación temporal de estado, pero usa su propio protocolo y requeriría adaptar o sustituir el transporte actual. Su documentación aclara que la recuperación puede fallar y aún exige sincronización normal.

Fuentes oficiales consultadas: [`ws` README y API](https://github.com/websockets/ws/blob/master/README.md), [WebSocket del navegador](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket), [Supabase Broadcast](https://supabase.com/docs/guides/realtime/broadcast) y [autorización Realtime](https://supabase.com/docs/guides/realtime/authorization), [reglas de seguridad Firebase RTDB](https://firebase.google.com/docs/database/security), [cómo funciona Socket.IO](https://socket.io/docs/v4/how-it-works/) y [recuperación de conexión](https://socket.io/docs/v4/connection-state-recovery/).

## Implementación y verificación

La implementación local está en `src/data/chat.js`, `src/net/chatService.js`, `src/ui/chat.js` y `styles/chat.css`, con cableado en servidor, protocolo y cliente. `PROTOCOL_VERSION` pasa a 20.

El contrato tiene **10/10 pruebas locales** en `tests/chat.test.mjs`, incluidos routing de los tres canales, distancia 3D actual, spectator, tokens de susurro obsoletos, idempotencia, límites, rate limit y conversación por WebSocket real. Junto con red y servidor son **17/17 pertinentes**. Dos invitados conversaron por UI real y se inspeccionaron formatos de escritorio, 844×390 y 390×844. La batería general terminó 1707/1708; el único timeout de servidor pasó aislado, sin causa exacta demostrada. [Evidencia, configuración y pendientes](../delivery/c01-chat.md). No está desplegado; dispositivos físicos y teclado virtual siguen pendientes.

## Fuera de C01

Historial durable, sincronización entre servidores, bloques/ignorados, reportes, moderación de contenido, herramientas de moderación, traducción, presencia histórica y conexión directa a proveedores LLM requieren cortes posteriores. Cualquier historial futuro deberá preservar la separación de audiencias y la política de privacidad de conversaciones privadas.
