# L02c — autoridad y revocación del agente

Software opt-in implementado y verificado localmente en la [entrega L02c](../delivery/l02c-agent-authority.md).
El servidor es la autoridad del controlador: cada personaje admite como máximo
un grant activo, ligado a dueño autenticado, personaje, mundo y sesión. El UUID de
dueño y el UUID de personaje son identidades distintas. El cliente no puede crear,
ampliar ni renovar ese grant por sí mismo.

## Alcance del corte

La capacidad `agentControl` se habilita solo de forma opt-in en `GameHost`, con un
mapping server-owned entre dueño autenticado y personaje. La resolución requiere
`resolvePlayer` autenticado. No se activa desde los comandos npm por defecto; no
añade SQL ni provisiona cuentas. `HELLO` con `agent: true` identifica un cliente de
agente separado de la cuenta/personaje normal. Un `HELLO` normal que intente usar
un personaje administrado se rechaza.

El dueño conectado con su avatar autenticado puede enviar mensajes nuevos de
`stop`, `revoke`, `resume`, cancelación y orden directa. Revocar invalida el grant anterior y
mantiene el personaje sin agente hasta que el dueño lo reanude explícitamente. La
reanudación requiere una conexión fresca del agente y un grant nuevo; no revive
colas, tareas, revisiones ni respuestas del grant anterior. La sesión normal del
dueño conserva su control del avatar y puede ordenar stop/revocación, pero no
transfiere la posesión del avatar humano al agente.

La integración del runner es opcional y recibe su token desde el entorno, nunca
como argumento CLI. El runner adopta el grant emitido por el servidor solo si su
scope coincide con dueño/personaje/mundo esperados y adopta la sesión fresca del servidor. Sus solicitudes de
tarea esperan autoridad confirmada. Las órdenes directas del dueño llegan como
mensajes autenticados del servidor. El modo invitado actual continúa siendo local:
sirve para ensayos y no prueba autoridad ni revocación del host.

## Control de tareas y tick

El lease, el epoch de control y la revisión CAS de tarea viven fuera de `src/sim/**`.
La simulación determinista recibe únicamente el input admitido para el tick y
conserva como fuente los validadores existentes. Cada solicitud se valida al entrar
en la cola y de nuevo en el tick que la aplica: grant/scope/revisión vigentes,
revisión CAS esperada, vida del personaje y capacidad de la acción. Un grant o
epoch anterior nunca puede reinsertar trabajo después de una revocación.

La prioridad de control es: orden directa del dueño, meta vigente del agente y,
por último, reflejos del cuerpo. El servidor hace CAS al reemplazar una tarea y
limita a una tarea activa por personaje. Stop/revoke invalida el lease, cancela la
tarea, limpia cola, carry y último input; el personaje recibe input neutral en el
siguiente tick. Efectos ya aplicados no se revierten. Respuestas tardías de socket,
incluido `LagLink`, se rechazan por grant/epoch/revisión obsoletos y no vuelven a
encolar acciones.

Los modos PvE mantienen recursos, daño, colisiones y cooldowns existentes. Además
de los filtros del runner, el servidor suprime ataques si otro jugador vivo está a menos de
8 unidades en su ECS; no demuestra percepción autoritativa ni una política PvP completa.

## Reutilización revisada

La búsqueda acotada del inventario `docs/research/unreal-assets/` encontró como
referencias `BP_ARPG_PlayerController.uasset` y `AIBehaviorTree.uasset`. Los paths
fuente existen en `C:\Unreal\ActionRPGMultiplayerStart\Content\ActionRPGStarterSystem\`:
`Character/Blueprints/BP_ARPG_PlayerController.uasset` (5.365.068 B) y
`AI/Behavior/AIBehaviorTree.uasset` (111.879 B). El inventario de ActionRPG registra
también `AIBlackboard.uasset` (10.661 B). `actionrpg/FINDINGS.md` menciona cadenas
como `HasAuthority`, `IsDedicatedServer`, `GetAIController`, `GetBlackboard` y
`RunBehaviorTree`, pero advierte que los nombres muestreados no verifican el grafo.

Estos Blueprints no se ejecutan en Node/ws ni se portan como autoridad. Su utilidad
es solo conceptual: separar el controlador del jugador de la lógica de comportamiento.
No reducen código ni tiempo de L02c; no se exportaron ni modificaron fuentes Unreal.
El contrato del servidor y la integración GameHost son la fuente de autoridad.

## Criterios de aceptación y pruebas

- Dos agentes compiten por el mismo personaje: solo el grant vigente puede crear
  trabajo; un segundo controlador se rechaza. Un agente no puede reclamar un avatar
  humano ni cambiar dueño, personaje, mundo o sesión en HELLO/solicitudes.
- Orden de dueño, stop, revoke, reanudación y grant nuevo demuestran la precedencia
  directa > meta > reflejo, incremento de epoch/revisión, CAS y aislamiento entre
  grants. Tras revoke se limpian cola/carry/último input y el siguiente tick es
  neutral; se comprueba que efectos ya aplicados permanecen.
- Órdenes, solicitudes de tarea y respuestas async tardías tras revoke, muerte,
  expiración, cierre/reconexión o cambio de vida se rechazan, incluso si llegan por
  `LagLink`; no hay reintento que restaure trabajo antiguo.
- El gate `agentControl` permanece apagado por defecto, y el path opt-in exige
  `resolvePlayer` autenticado y mapping server-owned. Verificar que comandos npm
  normales no lo habilitan y que el cliente no puede inventar un grant.
- El servidor aplica también la supresión PvE frente a jugadores observados. Correr
  pruebas unitarias de límites de autoridad, ensayo de WebSocket real y regresiones
  de humano, naval y perfil.

El protocolo pasa a versión 28 por `WELCOME` con `control` opcional y los mensajes wire nuevos.
Las pruebas usan WebSockets reales y CLI hijo: 163 aprobadas y una omitida por symlink Windows;
206/206 de regresión. [TAP, comandos y hashes](../delivery/l02c-agent-authority-verification.json).
El recibo confirma limpieza y neutral programado, no que el siguiente tick ya haya ocurrido.

## Fuera de esta aceptación

No habilita producción, UI de lanzamiento, cuentas nuevas, persistencia/SQL,
inferencia LLM, BYOK, nuevas capacidades de inventario/comercio/construcción/naval,
control offline, despliegue ni publicación. El gate opt-in es para una fixture/host
de prueba expresamente configurado. El binding vive en una instancia; persistencia, recuperación
entre reinicios y coordinación entre hosts permanecen pendientes. Self-release del CLI no
deshabilita el binding; stop/revoke autenticados del dueño sí requieren resume.
