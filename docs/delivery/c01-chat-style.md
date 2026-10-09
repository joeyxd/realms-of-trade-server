# C01 — acabado visual del chat

2026-10-07. Pulido local solicitado por el autor: transparencias, degradados, colores y acentos
sobre el chat [C01 existente](c01-chat.md). Sin publicación ni cambio adicional de protocolo.

## Acabado

- Panel de vidrio azul oscuro, degradado marino, desenfoque de 8 px, borde luminoso y sombras suaves.
- Mundo en turquesa, Cerca en menta y Privado en lavanda; selector y botón de envío siguen el canal.
- Tarjetas con una guía de color, nombres dorados y detalle ámbar en mensajes propios y no leídos.
- Iconos SVG locales para abrir, cerrar, enviar y reintentar; cabecera y estado vacío integrados.
- Estados de confirmación, espera y error con texto y color; foco visible y apertura breve que respeta
  la preferencia de movimiento reducido.

`styles/chat.css` contiene el acabado. `src/ui/chat.js` añade los iconos, los grupos del compositor,
el estado vacío y las clases de presentación. El reintento ocupa el lugar del botón de envío cuando
una petición queda incierta. Un `ResizeObserver` mantiene el último mensaje visible al cambiar
la altura del registro, incluido el paso de vertical a horizontal.

Se reutilizan el panel, el transporte y las fuentes existentes. No se añadió dependencia, fuente,
imagen descargada ni servicio externo. Sigue vigente la revisión de reutilización del
[brief C01](../briefs/c01-chat.md#reutilización-revisada): no hay un widget Unreal portable al cliente web.

## Verificación

Chrome sobre un host temporal de memoria, aislado en el puerto 5194, con dos invitados de prueba
y almacenamiento independiente. Mundo, Cerca y un susurro se enviaron desde la UI y llegaron al
otro jugador, con eco y confirmación. Se inspeccionaron las capturas sobre el escenario real.

| Viewport CSS | Panel | Campo y envío | Resultado |
|---|---|---|---|
| 824×742, escritorio | 360×300, y=338 | alto 42, y=586,3 | Controles dentro del panel y sobre la barra de acciones |
| 390×844, vertical | 340×280, y=460 | alto 42, y=689,3 | Destinatario privado y compositor completos |
| 844×390, horizontal | 360×220, y=76 | alto 38, y=251,3 | Último susurro visible tras girar; compositor completo |

Tras el cambio de orientación, el registro horizontal tenía 64 px de altura y 155 px de contenido,
con desplazamiento de 90,7 px: el final del último mensaje quedó dentro de la zona visible.

- `node --check src/ui/chat.js`: pasa.
- `node --test tests/chat.test.mjs`: **10/10**, incluidos los tres canales por WebSocket real.
- Revisión de whitespace y revisión independiente acotada de UI/CSS: sin hallazgos materiales.
- La regresión general anterior y su timeout aislado siguen documentados en la [entrega C01](c01-chat.md#verificación).

Capturas: [escritorio con mensajes](c01-chat-style/desktop-messages.png),
[detalle](c01-chat-style/chat-detail.png), [vertical privado](c01-chat-style/portrait-private.png),
[horizontal privado](c01-chat-style/landscape-private.png) y
[estado vacío inicial, 824×798](c01-chat-style/desktop-empty.png).

Son pruebas en tamaños de navegador: teclado virtual, dispositivos táctiles y FPS físicos no se
evaluaron en este corte. El host de prueba se cerró al terminar; el host de amigos no se modificó.
