# L03d-e2a — Transporte y canario del modelo local

El autor proporcionó una conexión loopback sin clave y el modelo
`qwen3.8-flash-next-coder-iq1_m` para pruebas. Se elige la ruta OpenAI-compatible
`/v1/chat/completions`; la alternativa Anthropic conserva una verificación separada.

Este corte añade una utilidad de operador fuera del bundle/VPS y prueba propuestas sintéticas
con los esquemas existentes de decisión y conversación. No conecta AgentMind, memoria privada,
personajes, SQL028 ni el alfa público. `127.0.0.1` corresponde al equipo que ejecuta la utilidad;
no concede al VPS acceso al modelo del autor. No instala túneles, Hermes ni gateways.

Una instancia fija endpoint/modelo y admite como máximo ocho intentos expresamente configurados,
una petición a la vez, 512 tokens de salida, 64 KiB de entrada, 256 KiB de respuesta y 30 segundos.
El canario final usa sólo tres intentos de hasta 512 tokens: decisión wait, saludo propuesto y cancelación
final. Sin claves, herramientas, streaming, proxy de entorno, redirects, fallback o retries.
No ejecuta propuestas ni repara JSON generado. La cancelación final no se reenvía. Un ensayo anterior
de 192 tokens pasó wait y no admitió el saludo al llegar al techo; se conserva separado con su uso conocido.
El ensayo default de 512 también truncó el saludo. `GET /props` confirmó una plantilla con
`enable_thinking`; se añade opt-in fijo `thinkingMode: disabled`, sin cambiar propiedades globales.
Envía exclusivamente `chat_template_kwargs: {enable_thinking:false}`, extensión documentada por
[llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#post-v1chatcompletions-openai-compatible-chat-completions-api).
El modo por defecto omite la extensión; no se negocia ni cambia de perfil automáticamente.

Los contadores deben proceder de la envoltura nativa y coincidir con el modelo fijado. Se conserva
el uso conocido aunque el texto esté truncado; uso ausente/inválido o pérdida después del envío
queda desconocido y bloquea más generaciones de esa instancia. Abortar el transporte no demuestra
detener el cómputo remoto. Ese bloqueo de laboratorio no es un ledger durable o multiusuario.

Precio, factura, tokenizer de entrada y reserva monetaria permanecen sin verificar. El coste se
expresa como null, nunca cero. El ledger v2 actual exige tarifas positivas explícitas; no se fabrica
una tarifa para hacerlo pasar. Integrar el modelo con AgentMind requiere una política que represente
el recurso local y admisión central de cuenta/conexión bajo los techos SQL028 ya preparados.

Aceptar: transporte falso local para límites/identidad/usage/errores/timeout/cancelación/tardías;
canario real con modelo exacto, JSON aceptado por los validadores existentes y ninguna acción o chat
enviado. La prueba inicial de conectividad ya respondió `MAREA_OK`; no acredita memoria inteligente.
Se reutilizan esquemas y utilidades Node existentes; no hay assets ni UI nueva, por lo que el
inventario Unreal/FAB no aporta un candidato portable a este transporte de operador.
