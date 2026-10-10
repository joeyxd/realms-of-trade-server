# L03d-b — Mis compañeros dentro del juego

2026-10-10. Primer tramo aprobado de [Inference Center](l03d-inference-center.md).

## Resultado y alcance

Una persona autenticada puede abrir «Mis compañeros», consultar sus personajes ya vinculados
y detener su control sin depender de un proveedor. Invitados reciben una invitación a iniciar sesión.
Si el servidor no habilita compañeros, la interfaz lo indica. Español/inglés, teclado y móvil.

Este tramo no crea compañeros ni conexiones, elige modelos, instala Hermes o realiza inferencia.
El siguiente tramo necesita configuración/vínculos durables, referencias privadas, límites compartidos
y un proveedor admitido. La memoria inteligente conserva el canario pendiente de L03d/L04;
una lista de personajes no acredita esa memoria.

## Autoridad y contrato

- El socket admitido con perfil autenticado determina la cuenta. No acepta un selector de dueño.
- `agent_owner`: listado `{requestId,op:'list'}` o detención
  `{requestId,op:'stop',characterKey,epoch}`. Claves exactas, UUID canónico y revisión exacta.
- `agent_owner_result`: `{requestId,ok,why,enabled,companions}`. Cada fila expone solamente
  `characterKey,name,online,active,stopped,epoch,capabilities`; nombre público o fallback localizado.
  No devuelve dueño, token, sesión, grant, tarea ni credenciales.
- Detener usa la revocación existente, retira la tarea y limpia entradas pendientes. Una revisión
  antigua, incluido `null` antes de la primera admisión, no detiene una sesión nueva.
- Se permite detener un personaje desconectado; repetir con la revisión actual es idempotente.
  El control actual es memoria del proceso: la detención se pierde al reiniciar el servidor.
  La interfaz lo explica; no se presenta como revocación durable.
- Cerrar sesión/cambiar cuenta/desconectar borra la proyección y descarta respuestas anteriores.
  Timeout no reenvía una mutación. El panel neutraliza movimiento/ataque mientras está abierto.

Protocolo 42 revisado tras integrar combustible: dos tipos opcionales nuevos; no cambia snapshot, `you`, perfil ni mensajes
existentes. Sin SQL, nuevo writer o cambios de flags. M5/GameHost conserva la autoridad del juego.

## Reutilización y aceptación

Se adapta el flujo pequeño estado/control de Nitro con panel DOM existente de MAREA, sin React,
Nango o runtime administrativo. El candidato Unreal/FAB VibeUE revisado en el brief padre es Editor
Win64 y no aporta UI portable a este cliente; no hay arte nuevo ni cambios a las fuentes donantes.

Aceptar con dos cuentas aisladas, invitado denegado, host deshabilitado, stop de personaje activo
y desconectado, queue vacía, revisión antigua rechazada, logout/respuesta tardía, teclado ES/EN,
panel móvil inspeccionado y continuidad pública de la revisión exacta. Autenticación local de fixture
no demuestra Supabase real; agentes públicos permanecen apagados.

[Entrega y evidencia](../delivery/l03d-owner-center.md).
