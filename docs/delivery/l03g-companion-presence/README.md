# L03g-a — presencia del compañero en Salty Shore

2026-10-13. Implementación local revisada; **SQL039 y activación pública pendientes**.
Continúa el [contrato de presencia](../../briefs/l03g-companion-presence.md). Base integrada
`a21c47f`; versión candidata alpha.68 / protocolo 61. El alfa .67 estaba sano al iniciar.

Mis compañeros incorpora **Salir conmigo**, **Sígueme**, **Espera aquí**, **Volver al ancla**
y **Descansar en el puerto**, en ES/EN. La presencia funciona sin proveedor ni proceso
local: el host admite una sola entidad, con aspecto de la creación SQL034 y una plaza
normal. La detención de SQL027 y el emparejamiento siguen separados; detener la mente
no elimina este cuerpo. Ninguna prueba consultó Qwen ni modificó a la Brisa real del autor.

## Reglas del primer corte

El ancla es el punto de llegada de Salty Shore. Dueño y compañero deben estar a menos
de 3 unidades para ingreso/retiro; la estancia se limita a 12 unidades, con suelo,
colisiones, práctica, agua, barcos y peligro comprobados por el servidor. Seguir usa pasos
de locomoción con colisión; una ruta bloqueada deja al compañero esperando. No hay
teletransporte para alcanzar al dueño ni navegación global. Al desconectarse el dueño,
intenta volver físicamente y descansar; una herida o peligro conserva el cuerpo.

Se excluyen ataques, recolección, comercio, transferencias hacia el cuerpo y recompensas
pasivas por muertes o zonas. El ensayo no consume necesidades ni actualiza checkpoint
por caminar. El perfil original conserva progresión, equipo, carga y documentos, y lo
guarda únicamente ProfileSessions. No se añaden recursos artísticos: se reutilizan el
aspecto existente y el estilo del panel; el inventario Unreal/FAB no aporta un sustituto
para la autoridad de presencia.

SQL039 confirma un registro activo con UUID de ejecución **antes** de publicar el
cuerpo. La retirada comprueba salud completa, ancla y consecuencias pendientes;
guarda el perfil, retira la entidad y solo después libera el registro. CAS/replay
conservan un único ingreso. Un resultado incierto o un reinicio con el cuerpo fuera/herido
bloquean la reconstrucción y el emparejamiento: no se reabre el perfil para curar al
personaje. Una excepción antes de publicar limpia entidad, plaza y perfil locales,
conservando el cerco durable. Un fallo final de perfil conserva evidencia y cerca el host.

**Límite operativo:** no hay recuperación automática ni botón que borre un registro
activo. Una cancelación posterior a confirmar el ingreso, una caída o incertidumbre
pueden necesitar revisión. Vida/posición y resolución de derrota durables requieren
el siguiente contrato antes de salir de esta zona. No se promete recuperación completa
tras SIGKILL: la prueba de reinicio conserva el cerco y deniega otro cuerpo.

Presencia del host y controlador L03f se excluyen mutuamente en este corte, incluso
con un código/token pendiente. El cerco SQL también protege el emparejamiento al
reiniciar con el flag de presencia apagado, cuando su readiness está disponible.
Conectar una mente al mismo cuerpo es **L03g-b**, todavía pendiente; no se amplía
el grant público `chat`, ni se aceptan conversación/memoria/calidad de modelo aquí.

## Verificación

- [Cohorte final](integration-recheck.tap): **111/111** en 16 archivos seriales.
  Cliente/UI, geometría/peligro, store/SQL, WSS, capacidad, aislamiento, daño, timeout,
  fallo de attachment, fallo final de perfil, recompensas pasivas, reinicio, pairing,
  control/creación, autoridad de agentes, sesiones, inventario y quests.
- SQL local: PGlite con SQL025/027/034/039, RPC como `service_role`; migración repetida,
  CAS/replay, concurrencia, privacidad y readiness ante cambios de RLS, grants, FK y definer.
  No es una aplicación ni canario de SQL039 en Supabase.
- [Navegador](browser/browser.json): **12/12** en el juego completo, autenticación simulada
  y store en memoria. Presencia real del host para ingreso/seguir/esperar/regreso/retiro;
  disponibilidad apagada y recuperación son proyecciones de UI explícitas. Capturas
  ES escritorio y EN móvil vertical/horizontal, botones de 44 px, sin overflow horizontal.
  Cero errores de página/consola, solicitudes fallidas, controladores o llamadas al modelo.
  [Historial del harness](browser/runs.json) conserva la configuración GM faltante y su corrección.

Los logs anteriores [99/99](integration.tap) y [110/110](integration-final.tap) corresponden
a estados previos a la revisión final; no se suman entre sí ni con la cohorte final.
El primer ensayo de fallo de guardado tuvo una expectativa de teardown incorrecta;
se corrigió para llamar y comprobar el cierre real. La suite general no se repitió.
La [composición con continuidad concurrente](continuity-merge.tap) pasó **33/33**;
incluye el host/rutas de swallow, fichas de carga y presencia, con conteos solapados.

## Instalar y probar en el alfa

1. Aplicar [039_companion_presence.sql](../../../server/migrations/039_companion_presence.sql)
   después de SQL034. No reescribe perfiles/documentos, no inicia cuerpos ni consulta modelos.
2. Verificar como servicio `mn_companion_presence_ready()` → `{"version":1}`.
   Preparar `MN_COMPANION_PRESENCE=1` en el entorno privado; requiere creación y pairing
   existentes. No combinar este piloto con `agentPilot` o la autoridad Ground común.
3. Publicar la revisión por el actualizador habitual, con una sola autoridad y mundo vacío.
   Verificar revisión activa y `/status.storage.companionPresence.ready` antes del canario.
4. Desde una cuenta real: ir al punto de llegada, Mis compañeros → Salir conmigo;
   seguir/esperar/volver/descansar. Comprobar una plaza, detención de IA conservada,
   reentrada y separación de permisos. La aceptación pública se registra aparte.

En esta entrega el flag de producción sigue apagado y SQL039 no fue aplicado remotamente.
La creación/documentos reales de Brisa permanecen preparados y detenidos.
