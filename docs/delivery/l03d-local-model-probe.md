# L03d-e2a — Modelo local: transporte y canario sintético

2026-10-10, hora del autor; capturas UTC del 11 de octubre. Se verificó el endpoint sin clave
`http://127.0.0.1:8080/v1` y el modelo exacto `qwen3.8-flash-next-coder-iq1_m`.
Herramienta de operador fuera del juego/VPS; [brief](../briefs/l03d-local-model-probe.md).

La conexión funciona y el perfil explícito `thinkingMode: disabled` pasó el canario estructurado.
No constituye integración con AgentMind, aceptación de calidad, memoria inteligente ni activación del alfa.

## Evidencia real

| Ensayo | Resultado | Uso nativo conocido | Latencia |
| --- | --- | --- | --- |
| [Conectividad](l03d-local-model-probe/connectivity.json), 96 tokens | Modelo listado y `MAREA_OK` sin clave | 78 entrada, 33 salida | 2.815 ms generación |
| [Default, 192](l03d-local-model-probe/default-192.json) | Wait válido; saludo no admisible, 192 tokens reportados (`invalid_response`, finish null) | 1.620 entrada, 259 salida en dos llamadas | 6.063 / 8.747 ms |
| [Default, 512](l03d-local-model-probe/default-512.json) | Wait válido; saludo truncado (`length`) | 1.620 entrada, 575 salida en dos llamadas | 6.432 / 18.168 ms |
| [Sin razonamiento, 512](l03d-local-model-probe/no-thinking.json) | Wait y reply válidos; aborto final y bloqueo sin request adicional | 1.548 entrada, 47 salida en dos llamadas; tercera desconocida | 5.346 / 5.848 / 212 ms |

Ocho intentos reales en total: siete con contadores conocidos (4.866 entrada, 914 salida) y uno
cancelado sin uso recuperable. Ninguna llamada posterior a la cancelación. No se infiere coste cero:
`costNanoUsd: null`. El aborto cerró el transporte local; no demuestra detener el cómputo remoto.
Las repeticiones de perfil fueron manuales y acotadas después de respuestas completas con uso conocido;
el código no reintenta, repara JSON ni cambia de perfil automáticamente.

El perfil opcional usa `chat_template_kwargs: {enable_thinking:false}`, documentado por
[llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#post-v1chatcompletions-openai-compatible-chat-completions-api).
[GET /props](l03d-local-model-probe/server-capability.json) confirmó que la plantilla expone
`enable_thinking`; sólo se guardaron booleanos y cabecera de servidor, sin plantilla/rutas locales.
No se cambió la configuración global. El modo default omite esta extensión específica.

La propuesta fue `Hola! Como are you? I hope you have a nice day.`. Pasa JSON, tamaño y normalización,
pero mezcla ES/EN: idioma, personalidad, utilidad y calidad siguen sin aceptar. La latencia observada
de unos 5–6 s tampoco acredita el límite temporal de la mente/cuerpo existente. Sólo se admitió wait
y una propuesta de chat no enviada: cero acciones, chats, perfiles, memoria, ledger o SQL modificados.

## Implementación y comprobaciones

- [Transporte](../../tools/agent/local-openai-transport.mjs): Node HTTP directo a loopback IPv4,
  endpoint/modelo/techo fijados, una petición física a la vez hasta cierre, sin auth, proxy, redirects,
  streaming, tools, fallback o retries. Máximo ocho intentos por instancia, 512 tokens pedidos,
  64 KiB de entrada, 256 KiB de respuesta y 30 s. Detecta sobrepaso de salida conservando uso conocido.
- [Canario](../../tools/agent/probe-local-openai.mjs): máximo tres intentos, input 16 KiB, informe nuevo
  exclusivo, propuestas verificadas con `parseDecision` y `validReplyText`. Sin razonamiento ni texto
  bruto en las trazas. Un informe existente impide cualquier llamada.
- 20/20 pruebas en dos archivos: HTTP falso para identidad/usage, límites, null/truncación, herramientas,
  timeout con cuerpo detenido, cancelación/tardía, concurrencia, override y flujo completo sin request 4.
  [Validación y hashes](l03d-local-model-probe/validation.json); los agentes Luna hicieron implementación
  focal y revisión independiente; root revisó código, pruebas y ejecutó las llamadas reales.

```powershell
node --test tests/agent-local-openai-transport.test.mjs tests/agent-local-openai-probe.test.mjs
node tools/agent/probe-local-openai.mjs --base-url http://127.0.0.1:8080/v1 --model qwen3.8-flash-next-coder-iq1_m --thinking-mode disabled --report .scratch/nuevo-canario.json
```

El segundo comando realiza consumo nuevo y termina con un intento desconocido por diseño. El informe
es una traza de laboratorio, no reserva durable ni autorización multiusuario. Reiniciar el proceso o
crear otro informe no reconcilia un consumo previo; no usarlo como runner autónomo.

## Publicación y siguiente frontera

Código/evidencia publicados en la rama de continuidad desde `area17-market`; sin cambios de runtime,
protocolo, UI, SQL, catálogo, credenciales o activación. `deploy/Dockerfile` excluye `tools/agent`.
`127.0.0.1` identifica el equipo que ejecuta la herramienta; no se abrió un acceso del VPS a este modelo.
La ruta Anthropic del autor permanece sin probar.

Sigue definir admisión central por cuenta/conexión y una política de recurso local compatible con el
ledger, fijar conteo/reservas verificables y conectar el runner autenticado con stop durable. El ledger
nativo monetario actual exige tarifa positiva explícita; no se inventó una tarifa para usarlo. Después,
aceptación de idioma/latencia y memoria con fuentes, incertidumbre, vigencia y borrado antes de atribuir
capacidad de recordar o actuar al compañero público.
