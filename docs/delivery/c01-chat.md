# C01 — chat en juego, entrega local

2026-10-07. Implementado el chat común de personas y futuros agentes. El autor promovió la línea
de agentes a **parte esencial** y pidió empezar por este sistema. [Plan](../../PLAN-EXTRA-LLM.md)
y [contrato/reutilización](../briefs/c01-chat.md). Versión local **0.6.0-alpha.5 / protocolo 20**;
cliente y servidor deben actualizarse juntos. No se publicó ni se cambió el host de amigos.

Pulido posterior solicitado por el autor: [acabado visual y capturas](c01-chat-style.md), vidrio azul,
acentos por canal y compositor revisado en escritorio, vertical y horizontal; 10/10 del chat pasan.

Ampliación aprobada: [burbujas sobre los personajes](c01-chat-bubbles.md), Cerca como canal inicial,
susurros privados y panel como historial; **18/18 pertinentes** y comprobación con tres clientes.

## Comportamiento

- **Mundo:** jugadores admitidos en la instancia actual.
- **Cerca:** participantes dentro del radio 3D actual del servidor, inicialmente 24 unidades.
- **Privado:** susurro al jugador conectado elegido y eco al remitente. El destino es un token
  opaco de esa conexión; un ID de entidad reciclado no recibe susurros de otra persona.

El servidor deriva el remitente, valida texto/canal/destino y limita el ritmo. Espectadores no
participan. La UI usa texto literal, selector de destinatario, no leídos, confirmación y reintento
explícito de una petición incierta. Mientras el campo tiene foco, el bucle envía inputs neutrales;
entrar/salir limpia acciones y puntería. Enter abre y Escape cierra.

El recibo confirma aceptación/routing, no lectura. Hay hasta 100 mensajes elegibles por sesión y
128 recibos para deduplicar el mismo ID; fuera de esa ventana no se promete deduplicación. No hay
reenvío automático al reconectar ni historial durable. Cambiar de sesión limpia historial y recibos
pendientes del panel. Chat no escribe eventos de simulación, RNG, perfil ni guardado.

## Transporte y configuración

Se reutilizan `/ws`, `ws`, la admisión existente y `GameClient`; también funciona con el transporte
worker de solo. No se añadió dependencia ni otro servicio de autenticación. El servidor ya conoce
quién está conectado y su posición, necesarios para susurros y cercanía. Supabase sigue siendo una
opción posterior para almacenamiento durable con audiencias explícitas; Broadcast por sí solo no
es historial persistente. La comparación con Firebase/Socket.IO y las fuentes oficiales están en
el [brief](../briefs/c01-chat.md#reutilización-revisada).

| Variable del host | Valor inicial | Rango |
|---|---:|---|
| `CHAT_ENABLED` | `1` | `0` o `1` |
| `CHAT_LOCAL_RADIUS` | 24 | 1–200 |
| `CHAT_MAX_LENGTH` | 300 puntos Unicode | 1–1000, entero |
| `CHAT_BURST` | 4 | 1–20, entero |
| `CHAT_REFILL_PER_SECOND` | 0,5 | 0,01–10 |
| `CHAT_HISTORY_LIMIT` | 100 | 1–200, entero |
| `CHAT_RECEIPT_LIMIT` | 128 | 1–512, entero |

Configuración validada al iniciar el host; también puede pasarse como opción `chat` a
`createGameServer`/`LocalServer`. Los límites y el radio llegan al cliente por `CHAT_STATE`.

## Verificación

**17/17 pruebas pertinentes pasaron:** `tests/chat.test.mjs` + `tests/net.test.mjs` (12/12)
y `tests/server.test.mjs` aislado (5/5). Cubren los tres canales por WebSocket real,
privacidad entre tres jugadores, distancia inclusiva 3D con posiciones actuales, identidad no
suplantable, destinos obsoletos, espectadores, deduplicación/conflictos, historial por audiencia,
límites, rate limit, join, movimiento y desconexión. Sintaxis de los módulos modificados y
comprobación de whitespace pasan. Nueve módulos pasaron `node --check`; también se comprobaron
defaults/overrides del host y rechazo de configuración inválida. La integración de inputs neutrales
se revisó en el código.

La regresión general del checkout con `node --test --test-concurrency=2 tests/*.test.mjs`
terminó en **1707/1708**, sin cancelaciones ni omisiones, en 709,7 s. Falló por timeout el caso
de dos jugadores de `tests/server.test.mjs:61`; el mismo archivo luego pasó 5/5 aislado y ese caso
tardó 1,455 s. No se reprodujo una regresión, pero el timeout no registra qué espera venció y
su causa exacta queda sin demostrar. El primer intento con la concurrencia predeterminada saturó
el equipo y quedó bloqueado tras otro timeout de red; se detuvo únicamente ese árbol de tests.
Los logs locales están en `shots/review/c01-chat-regression{,-limited}.log` (ignorados).

En Chrome, dos invitados con almacenamiento independiente (`127.0.0.1` y `localhost`) conectaron
al mismo host temporal de memoria en el puerto 5194. Mundo, Cerca y un susurro funcionaron desde
la interfaz visible, con eco y confirmación. También se aceptó desde la UI un mensaje de 173 puntos
Unicode (160 emojis), superior a 300 unidades UTF-16: el compositor cuenta puntos como el servidor.
La privacidad frente a terceros y fuera del radio se
verificó en las pruebas automatizadas. Se inspeccionaron capturas de escritorio y formatos reducidos:

| Viewport CSS | Panel | Campo de texto | Resultado |
|---|---|---|---|
| 844×390 | y=76, alto=220 | y=248, alto=40 | Campo y envío dentro del panel, encima de la barra de acciones |
| 390×844 | y=460, alto=280 | y=689, alto=42 | Campo, envío y destinatario visibles |

La revisión corrigió el envío deshabilitado al recibir estado antes de terminar el join y un
desbordamiento del compositor en horizontal. Escape cerró y Enter abrió el panel. Son tamaños de
navegador, no un ensayo de teclado virtual, mando, dispositivo táctil o rendimiento físico.
La consulta de estado interno por CDP fue rechazada; la revisión continuó por UI visible y
geometría DOM. No se afirma esa comprobación interna ni ausencia total de errores de consola.

## Continuidad

Siguiente corte: **L00**, contrato/fixture de observación y acciones, seguido de **L01**, cliente
textual que recibe y envía estos mismos `CHAT_*`. L02 añade el cuerpo y L03 conecta decisiones y
respuestas LLM. C01 aporta el canal, todavía no un personaje que piensa o contesta con un modelo.
Historial durable, bloqueos/reportes/moderación y comunicación entre instancias son cortes posteriores.
Construcción, barcos/comercio y D09/M5 conservan sus contratos; chat no habilita operaciones económicas.
