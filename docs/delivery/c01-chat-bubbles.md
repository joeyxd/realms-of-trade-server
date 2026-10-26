# C01 — conversación sobre los personajes

2026-10-07. Ampliación local aprobada por el autor: los mensajes de Cerca y los susurros se leen
en burbujas sobre el personaje que habla, aunque el panel esté cerrado. El panel conserva el historial.

## Comportamiento

- Cerca es el canal inicial al abrir el chat. Enter abre el compositor; enviar crea la burbuja
  después de recibir el mensaje aceptado por el servidor. Escape cierra el panel.
- Mundo sigue disponible en el selector y se muestra en el historial, sin burbuja.
- Los susurros aparecen solamente en los clientes del remitente y del destinatario. Un personaje
  lejano, fuera de pantalla o sin ancla visible se sigue leyendo en el panel.
- Hay una burbuja por personaje: un mensaje nuevo la sustituye. Dura entre 5 y 8 segundos según
  la longitud; muestra hasta 180 puntos Unicode y cuatro líneas. El historial conserva el texto completo.
- El historial recibido en `CHAT_STATE` no vuelve a crear burbujas. Los IDs repetidos tampoco las
  renuevan dentro de la ventana de 200 IDs. Salir, cambiar de sesión, desactivar el chat o cambiar
  la entidad de un participante limpia sus burbujas.

## Implementación y reutilización

`src/ui/chatBubbles.js` valida sesión, canal, audiencia privada y vínculo entre token opaco y entidad
actual antes de mostrar un mensaje. Los nombres proceden del estado de participantes. `src/main.js`
conecta los mensajes en vivo, el estado y la limpieza de desconexión/despawn.

`WorldUI` reutiliza sus anclas de personajes y proyección de cámara con un mapa separado para chat.
Las burbujas siguen la posición renderizada; ocultan temporalmente la nameplate del personaje y
ajustan su posición para caber en el stage. Texto y etiqueta usan `textContent`. Los estilos de
`styles/chat.css` mantienen menta para Cerca, lavanda para Privado y un detalle dorado en mensajes propios.
`src/ui/chat.js` inicia el selector en Cerca.

Se revisó la reutilización de C01 y el inventario Unreal/FAB existente: no hay un widget de chat
portable a este cliente. Se reutilizan `WorldUI`, las fuentes y el transporte actuales; sin dependencia,
imagen, servicio, payload o cambio de protocolo adicional. Las burbujas de NPC siguen su ruta propia.
El checkout compartido ya contiene alpha.6/protocolo 21 de navegación; este corte no cambia esa versión.

## Verificación

- **18/18 pertinentes** con `node --test --test-concurrency=1 tests/chat-bubbles.test.mjs tests/chat.test.mjs`:
  ocho casos del controlador y diez del chat, incluido WebSocket real. Audiencia privada, identidad
  vigente, texto inválido, deduplicación, historial, Unicode y limpieza de lifecycle cubiertos.
- Sintaxis de los cuatro módulos UI/integración y revisión de whitespace pasan. Revisión independiente
  de integración, audiencia y texto sin hallazgos materiales.
- Tres invitados de prueba en Chrome, con orígenes independientes `127.0.0.1`, `localhost` y `localhost.`,
  sobre un host temporal de memoria en el puerto 5194. Cerca se vio con el panel cerrado. Un susurro
  apareció en remitente/destinatario; el tercero tenía cero burbujas y cero entradas privadas.
- La caducidad eliminó el nodo y dejó el mensaje en el historial. Abrir el historial no recreó burbujas.
  Al cerrar el personaje que hablaba, otro cliente pasó de burbuja visible a cero nodos en 3,7 s desde
  el envío, antes de su caducidad. El canal Mundo llegó al historial sin generar burbuja.
- Un arranque nuevo confirmó Cerca como opción inicial y el flujo Enter → escribir → Enter → Escape,
  con burbuja propia visible y panel cerrado.

| Viewport CSS | Burbuja observada | Resultado |
|---|---|---|
| 1707×769 | 252×79,7, x=727,4 / y=178,4 | Cerca y Privado sobre el personaje, panel cerrado |
| 390×844 | 231×72,2, x=8 / y=240,3 | Ajuste al borde izquierdo, texto dentro del viewport |
| 844×390 | 226,8×66,3, x=250,6 / y=29,3 | Susurro legible sobre el personaje, controles disponibles |

Capturas inspeccionadas: [Cerca](c01-chat-bubbles/desktop-local.png),
[susurro](c01-chat-bubbles/desktop-private.png), [vertical](c01-chat-bubbles/portrait-local.png),
[horizontal](c01-chat-bubbles/landscape-private.png) y [detalle](c01-chat-bubbles/bubble-detail.png).

El host temporal y sus pestañas se cerraron; viewport restaurado. Sin despliegue ni cambios al host
de amigos. Teléfono, teclado virtual y rendimiento físico siguen pendientes. La regresión general
anterior está en la [entrega C01](c01-chat.md#verificación); no se repitió para esta ampliación visual.
