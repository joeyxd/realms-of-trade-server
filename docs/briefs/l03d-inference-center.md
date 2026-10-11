# AREA17 — Inference Center y conexión local

2026-10-10. Evaluación solicitada tras L03d-a: reutilizar Nitro sin Nango y considerar
Hermes para una experiencia sencilla con muchos jugadores.
**Estado: arquitectura contrastada; el autor aprobó comenzar su implementación.**
Primer tramo: [Mis compañeros ingame](l03d-owner-center.md), estado y detención de vínculos existentes.
Continúa [L03d-c, ficha privada durable](l03d-companion-config.md), personalidad y objetivos de esos
vínculos, todavía sin alimentar la mente. Conexiones/vínculos durables, proveedor, memoria y canario
conservan sus puertas pendientes.
No selecciona proveedor/modelo, instala Hermes, custodia credenciales ni habilita inferencia.
Complementa [el plan de agentes](../../PLAN-EXTRA-LLM.md); conserva los contratos L03/L04/L05 y M5.

## Recomendación y resultado jugable

Adaptar los flujos del Inference Center de Nitro a una interfaz pequeña propia de MAREA.
Conservar AgentMind como productor de propuestas y GameHost/M5 como autoridad de gameplay.
Hermes es candidato de transporte/autenticación, especialmente para una conexión personal local;
su runtime completo requiere una evaluación separada.

Una persona debe poder vincular un compañero, elegir un modelo disponible en su conexión,
fijar límites y jugar con él. Puede ver qué recuerda y detenerlo aunque el proveedor falle.
No necesita conocer archivos, contenedores o configuración de Nitro.

Dos superficies dentro del juego:

| Superficie | Contenido |
|---|---|
| Centro de inferencia | Conexiones propias, modo local/alojado, modelos elegibles, autenticación, disponibilidad, uso y límites. Probar catálogo y probar generación son operaciones diferentes; la segunda muestra y reserva su máximo. |
| Mi compañero | Personaje propio, personalidad, metas, permisos, modelo elegido, iniciar/detener, actividad y memoria con fuentes, exportación y borrado. Gasto de bienes e inferencia separados. |

El jugador puede añadir su conexión a un proveedor admitido y elegir su modelo.
El operador administra destinos y disponibilidad global en una superficie privada.
La selección personal nunca modifica la conexión de otro jugador.
La conexión local tendría además una utilidad de emparejamiento en el dispositivo.

## Reutilización comprobada

Auditoría de solo lectura: Nitro main 9f1a387; Hermes submódulo b6bcb3e7, versión 0.20.5;
herdr 3e8963bf; OmniRoute v3.8.50. Versiones de fuente, sin verificar su despliegue actual.
Nitro permanece intacto.

| Fuente revisada | Adaptar | Brecha de MAREA |
|---|---|---|
| Nitro frontend/src/components/InferenceCenter.tsx:36–117, InferenceParts.tsx e InferenceGateway.tsx | Conectar → comprobar → elegir modelo; estados de error/carga y uso. | Panel DOM del juego ES/EN. El donante usa React y configuración global. |
| Nitro frontend/src/lib/inference.ts:175–223 | DTOs pequeños y escritura de claves sin devolución. | API por cuenta/conexión/personaje, sin exponer el DTO administrativo global. |
| Nitro runner/hermes_config.py:150–172,369–464; runner/runner.py:1170–1218,1285–1361 | Catálogo y configuración de proveedor. | Custodia multiusuario: archivos de operador con permisos no equivalen a una bóveda cifrada por jugador. |
| Nitro docker-compose.yml:59–73,119–131 | Proceso de inferencia separado del host. | Aislamiento: allí hay HERMES_HOME, CODEX_HOME y volumen de estado compartidos. |
| Hermes agent/oneshot.py:106–149, agent/auxiliary_client.py:9280–9335 | Helper interno de llamada única y transporte compartido. | No es SDK estable; oneshot devuelve texto sin uso nativo. El adaptador debe preservar contadores, identidad y límites, revisar reintentos/auxiliares. |
| MAREA [AgentMind](../../tools/agent/mind.mjs), [contexto](../../tools/agent/mind-context.mjs), [presupuesto](../../tools/agent/persistent-budget.mjs), [memoria](../../tools/agent/memory-store.mjs) | Propuestas acotadas, una consulta, reservas, uso incierto, scope, CAS y fuentes. | Transporte real y servicio por cuenta; hoy son herramientas con archivos locales. |

El Inference Center de Nitro no depende transitivamente de Nango: usa runner/Hermes y
catálogo/gateway. Los conectores Nango pertenecen a otro flujo; pueden omitirse en este corte.
No se recomienda copiar todo Nitro ni su administración global al juego.

Hermes tiene un proxy local (hermes proxy), pero en esta versión solo registra adaptadores
Nous/xAI y no ofrece admisión multiusuario. Su API de chat separada
(gateway/platforms/api_server.py) ejecuta el loop de agente.
Ninguno puede exponerse como servicio de juego solo por aceptar formato OpenAI.
OmniRoute es un gateway opcional: no hace falta instalarlo junto con Hermes para el primer adaptador.
El stewardship del worktree Nitro feat/inference-stewardship 8ff3306 aporta patrones de admisión,
pero no está integrado íntegramente en main. Catálogo/tarifa cero no prueban ruta utilizable/gratuita.

Unreal/FAB: se contrastó [VibeUE](../research/unreal-assets/myproject/FINDINGS.md), plugin Editor
Win64 de Unreal. No aporta transporte o UI portable a este cliente. Se adaptan paneles existentes,
sin arte nuevo ni cambios a proyectos fuente.

## Codex local: alcance comprobado

No se inspeccionó Mixar; no se le atribuye un mecanismo concreto. Codex documenta caché
local en auth.json o el almacén del sistema operativo, diferente de una cookie web.
También admite login por navegador/código de dispositivo para equipos remotos.
Eso no da al servidor público la sesión local de cada jugador.

Hermes documenta adopción de credenciales de Codex y login propio: permite evaluar una UX
«usar mi sesión local» explícita, sin enviar la caché al juego. Sus perfiles comparten CODEX_HOME
por defecto. Separarlo no aísla por sí solo procesos, sistema operativo y herramientas.

Para el alfa público se recomienda una API de servidor admitida. OpenAI recomienda claves API
para automatización y desaconseja exponer ejecución Codex en entornos públicos/no confiables.
El login de Codex no establece una API general de juego financiada por una suscripción personal.
La conexión local es candidata posterior, sujeta a compatibilidad del uso y pruebas.

Fuentes primarias consultadas el 2026-10-10:
[autenticación Codex](https://learn.chatgpt.com/docs/auth),
[autenticación App Server](https://learn.chatgpt.com/docs/app-server#authentication-modes),
[proveedores Hermes](https://hermes-agent.nousresearch.com/docs/integrations/providers),
[perfiles y tareas auxiliares Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/codex-app-server-runtime).

## Dos rutas bajo el mismo contrato

| Ruta propuesta | Ejecución | Disponibilidad y contabilidad |
|---|---|---|
| API alojada | Worker privado fuera del tick; BYOK personal o cupo del operador expresamente concedido. | Puede seguir sin el dispositivo si el ciclo de vida lo permite; no aprueba autonomía offline. Techos por cuenta/conexión/personaje y global del operador. |
| Compañero local opcional | Utilidad personal con conexión saliente autenticada y emparejamiento revocable; evaluar Hermes como adaptador. | Dispositivo encendido. Credencial local; solo estado/decisiones acotados viajan al juego. Cuota de suscripción y coste API son unidades distintas. |

Flujo propuesto: cuenta autenticada → configuración/conexión/modelo → AgentMind y memoria pertinente
→ reserva de gasto → adaptador API/local → propuesta y uso correlacionados → validación GameHost
→ efectos confirmados M5 → feedback con fuentes.
No hace falta un Hermes completo por personaje; concurrencia/capacidad se miden después del canario.
Cambiar de proveedor debe conservar la identidad y memoria del personaje.

## Contratos pendientes para varios usuarios

- **Identidad durable:** vínculo cuenta–personaje–mundo y configuración CAS. Los bindings actuales
  de agentControl son configuración en memoria, sin provisioning multiusuario. GameHost deriva
  dueño/capacidades de la sesión; cambiar conexión/modelo invalida propuestas anteriores.
- **Conexiones privadas:** referencia opaca fuera del perfil, memoria y protocolo de gameplay.
  Alojado: secreto cifrado en almacén de servicio, rotación/revocación y metadatos seguros en UI.
  Local: el servidor recibe un vínculo, no el token. Otra cuenta no puede leer/probar/usarla.
- **Elegibilidad:** catálogo derivado de conexión y política de servidor, modelo exacto y evidencia.
  La prueba de listado no demuestra generación. Una generación de prueba también reserva gasto.
  Sin URL arbitraria del navegador, redirect no admitido ni fallback a otra cuenta/proveedor.
- **Gasto conjunto:** v2 actual es local/cooperativo, calcula nano USD con tarifas entrada/salida;
  no es tope central multiusuario ni modela gratis, suscripción u otras dimensiones sin ampliación.
  Hace falta admisión atómica por conexión compartida, techos por personaje/acumulados,
  concurrencia y recuperación durable. Reiniciar no reenvía generaciones inciertas.
- **Medición completa:** decisión, resumen, embeddings, revisión y pruebas cuentan. Integrar
  Hermes exige deshabilitar llamadas auxiliares o admitirlas/medirlas explícitamente. Uso
  desconocido retiene reserva; cuota desconocida tampoco es cero o ilimitada. Cargo calculado
  y factura conservan etiquetas distintas.
- **Runtime acotado:** sin shell, filesystem general, plugins personales, MCP o administración
  accesibles desde texto del juego. Reutilizar transporte Hermes no concede sus herramientas.
  La mente recibe contexto permitido y solo propone acciones bajo el contrato vigente.
- **Memoria propia:** scope dueño/personaje/mundo, fuentes/vigencia/incertidumbre, captura por
  eventos y contexto limitado. Precios/inventario se revalidan; borrar retira derivados.
  Recuerdos no conceden bienes/recetas/permisos. Journal/búsqueda léxica existen localmente;
  calidad semántica y continuidad alojada siguen pendientes.

El panel loopback conserva su modo simulado y rechazo de v2; tools/agent está fuera de la imagen VPS.
Exponer ese panel o copiar el donante no cierra estos contratos.

## Secuencia mínima propuesta dentro de L03d/L05c

| Tramo | Resultado | Aceptación |
|---|---|---|
| Centro, base | Entrada ingame autenticada, compañeros ya vinculados, estado y stop; proveedor ausente mostrado con honestidad. | Dos cuentas aisladas, invitado denegado, stop sin proveedor, desktop/móvil ES/EN; sin consumo. |
| Ficha privada, L03d-c | Personalidad y objetivos durables de un compañero ya vinculado, todavía sin alimentar su mente. | Cuenta/mundo/personaje aislados, CAS/replay, borrador ante conflicto/incertidumbre, reentrada y base en disco; sin proveedor ni gameplay nuevo. |
| Conexión/configuración | Una ruta API admitida, referencia privada, catálogo elegible, modelo/límites persistentes. | Reinicio/reentrada y CAS; secreto ausente de bundle/perfil/logs; dos personajes comparten techo sin duplicarlo. Proveedor/modelo/importes por elegir. |
| Canario L03d | Conversar, ayudar en PvE y recordar un acuerdo en una segunda sesión. | Uso/coste/incertidumbre, latencia, timeout/stop/tardía, reserva conjunta, JSON inválido, paráfrasis/contradicción/precio nuevo y efecto único. |
| Operación/memoria | Inicio/reentrada, captura por eventos y archivos reales visibles con exportación/borrado. | Scope por cuenta, continuidad, coste completo de recuperación/resumen y agotamiento de presupuesto. |
| Conexión local | Emparejamiento personal y evaluación de adaptador Hermes/Codex compatible. | Sesiones privadas, revocación/desconexión, cuota diferenciada; sin adopción silenciosa de plugins/credenciales o ejecución general. |

El canario no espera a soportar todos los proveedores o instalar un gateway.
Un selector/archivo no prueba calidad de memoria. SQL017 conserva su puerta económica independiente.

## Evidencia de esta evaluación

Tres auditorías acotadas con GPT-6 Luna, contrastadas con fuente. MAREA se actualizó por
fast-forward a continuidad bed9389 antes de redactar. Solo documentación/enlaces:
sin pruebas de gameplay, llamadas de modelo, instalaciones, migraciones, credenciales o activaciones.
No se verificó salud/despliegue actual del alfa o Nitro durante esta evaluación.

[L03d-a](l03d-native-metering.md) · [contrato nativo](../agents/native-metering.md) ·
[panel de laboratorio](../../tools/agent/owner-panel-server.mjs).
