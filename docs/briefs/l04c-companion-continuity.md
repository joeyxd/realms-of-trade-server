# L04c — continuidad acotada del compañero local

2026-10-10, hora del autor. Continúa la dirección de
[propósito y compañía](companion-purpose-continuity.md) y el [Studio local](l03d-local-companion-studio.md).

El jugador necesita retomar una conversación aunque cambie la ventana mental o cierre el proceso.
El Studio captura intercambios entregados, carga un punto de continuación con fuentes y permite
refrescar contexto o resumir episodios sin renovar identidad, sesión de juego ni presupuesto.

## Contrato de este corte

- Capturar después de una conversación confirmada, incluido un `wait` válido tras recibir el mensaje.
  No inferir para capturar, no guardar por tick y deduplicar capturas idénticas del mismo estado.
  Un error de captura se informa aparte de un mensaje que ya fue entregado.
- Derivar la continuación del journal validado: último episodio y resumen vigentes, históricos y no
  confiables como instrucciones. Revalidar el estado actual; nunca reanudar órdenes desde recuerdos.
- Refrescar contexto relee archivos e invalida/cancela la consulta previa. Conserva sesión, cuota y stop;
  funciona durante inferencia y estando detenido. No consulta al modelo ni reentra al juego.
- Resumir manualmente de uno a ocho episodios elegidos desde la UI. Usar el mismo ledger de inferencia,
  referencias exactas y writer de memoria; conservar los originales incluso ante rechazo o uso incierto.
- Resumen automático apagado inicialmente y tras reiniciar. Opt-in local de proceso: después de un chat
  completado, esperar tres segundos de inactividad y presión del payload completo (80 % de tokens
  reservados/bytes, o poda por falta de espacio). Fuentes: de dos a ocho episodios aún no resumidos que
  caben en el turno de memoria. Máximo un intento automático por autorización durable; las reservas
  manuales de compactado también cuentan, incluidos rechazo y uso desconocido. Sin bucle ni retry.
- Mostrar medición/estimación, reserva de salida/margen, última captura/refresco/resumen, fuentes y
  consumo. Un obligatorio que no cabe se rechaza; no lanzar un resumen como reparación oculta.

Los topes locales son 65.536 unidades de contexto, 65.536 bytes, salida 512 y margen 256.
El 80 % y los tres segundos son una política del ensayo, no valores universales del modelo.
Resumir reduce contexto recuperado; no reduce el journal de 1 MiB ni sustituye retención/borrado.

## Autoridad y reutilización

Se reutilizan AgentMind, el journal, los guards de archivos/autoridad y el ledger local del Studio.
La captura histórica admite la ventana de reflexión explícita de 30 s; el snapshot presente y las
decisiones corporales conservan frescura de 1,5 s. No se cambia simulación, protocolo, SQL o M5.
Identidades de ensayo, GameHost efímero y capacidades solo de chat. No añade JEV ni actores del mundo.

Reutilización Unreal/FAB: este corte modifica controles y archivos del Studio existente; no requiere
modelos, texturas, audio ni una UI nueva basada en assets. Se conservan intactas las fuentes Unreal.

## Aceptación

Comprobar captura sin llamada adicional, reabrir desde disco sin renovar cuota, fuentes conservadas,
rechazo/cancelación tardía, stop y refresco sin reentrada; probar el resumen automático por presión
con límites durables. Revisar API privada exacta y UI desktop/portrait/landscape con proveedor simulado
y transporte real local. Calidad lingüística, resumen del modelo real y compañía humana siguen pendientes.

[Entrega y evidencia](../delivery/l04c-companion-continuity.md).
