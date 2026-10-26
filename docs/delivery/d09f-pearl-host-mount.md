# D09f-2b.16 — host dueño del apply de perlas

Base `155390a06a2a0aeb428ff63de6d91713e8e039c0`; conserva el ensayo naval de pasajeros ya aceptado y
excluye las ediciones visuales paralelas. [Contrato](../briefs/m5-pearl-host-mount.md).

## Resultado

GameHost puede montar una vez el staging, antes de attach/admisión/start, con scope explícito. Construye
captura ECS trusted, efecto de inputs y beforeTick propio. Recibos preparados se aplican mediante su
pump/step normal; perfiles, ECS, ledger, drop y filtros conservan el apply reversible existente.

El fallo de apply detiene admisión/timers y difiere la desconexión hasta completar rollback. El cierre
espera las operaciones en vuelo, no aplica durante shutdown y rechaza contextos pendientes/fenced o
progreso sin guardar. El caller conserva la Promise rechazada; no hay reintento mutante ni rollback SQL.

`createGameServer` ofrece el montaje solo mediante API interna explícita. El entrypoint no lo activa.
Default beforeTick null, comandos ordinarios y saves firmados de invitados conservados. Estado HTTP
solo con conteos públicos, sin UUIDs, cuentas, inventarios ni recibos.

## Evidencia

**992/992** pertinentes, cero fallos/canceladas/skips/todo, Node v24.14.0/concurrencia 2,
107.746 ms. Archivo Git fijo `155390a` más tres overlays propios de runtime/pruebas; 78 archivos
de pruebas y 226 fuentes SHA256 normalizadas LF verificadas antes/después. Conserva los 950 checks
anteriores y añade **21 propios en 12 pruebas superiores** más 21 del ensayo naval de pasajeros ya
aceptado. Regresión aislada y hashes en [JSON](d09f-pearl-host-mount-evidence.json). Nuevas pruebas de host
componen las piezas con sesiones reales de GameHost, almacenamiento memory y SDK con SQL001–008 local.
No reemplazan su World, sus ProfileSessions ni beforeTick mediante adapters manuales.

Montaje tras una conexión ya cerrada denegado, caso real de save firmado de invitado y comandos directos
denegados al detener el host. Revisión read-only GPT-6 Luna sin defecto material; precisión de nombres/
cobertura de invitados corregida. La comprobación final usa la revisión exacta con esas guardas.

Sin modificación visual o payload de juego: no se repite navegador/GPU ni se afirma aceptación física.
HTTP de `/health`/`/status` solo en loopback efímero. Sin env/secrets, Supabase real, nueva SQL,
push, publicación, reinicio del host del PC o modificación de arte/naval paralelo.

## Lo que sigue

Montaje de adapters cerrado para callers trusted; **activación pública M5 P4/P6 sigue incompleta**.
Falta montar recuperación de diario/suelo con políticas explícitas y despachar operaciones durables del
juego, incluida circulación autónoma y muerte completa. La RPC confirmada no garantiza el save CAS
del progreso posterior; finalizador durable todavía pendiente. Epoch de inputs de extremo a extremo,
operaciones conjuntas de mercado/barco/mundo, leases y afinidad permanente conservan sus cortes.
