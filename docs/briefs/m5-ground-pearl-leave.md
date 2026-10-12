# AREA15: soltar una perla bajo la autoridad común

Continúa el mint de élites/cofres. Corte acotado: `leave` de una perla de bolsa
autenticada a suelo público. Reutiliza la familia `ground` SQL004/018/019 y el
reloj ya adoptado; no introduce SQL, protocolo, flag ni activación pública.

El selector acepta solo UID y endpoint actual del servidor. El dueño común
reserva cuenta y todos sus UIDs antes de capturar progreso pendiente y consultar
la generación durable. `settleGroundProfile` conserva primero el progreso ECS
anterior al comando dentro de esa reserva. Perfil, UID, ubicación, mundo y reloj
se confirman después juntos. Ningún snapshot/version/holder del cliente es autoridad.

Un planner separado ejecuta `leavePearl` sobre contenedores detached, conservando
calma, pertenencia, dispersión, checkpoint y evento existentes. Prepara plazos con
pausa offline. El apply síncrono reversible instala bolsa, sesión confirmada,
ledger, drop, índice de fuentes y eventos solo tras el recibo. IO no publica ni
avanza el tick. Deriva, desconexión, cierre o pérdida de callbacks cercan el host.

El montaje explícito de GroundPearlLifecycle conecta un callback de comandos
LocalServer. Sin montaje no cambia el juego. En el piloto, `give` y `swallow`
permanecen cercados hasta su composición posterior; `spit`/`sell` mantienen sus
rechazos de gameplay. No añade reemplazo de la perla vinculada.

Aceptación: selector y comando real, denegaciones sin mutación, reserva antes de
IO, progreso previo, commit retenido hasta boundary, sesión/perfil/índice coherentes,
pickup/retorno posterior, rollback de publicación, desconexión/cierre, dos SIGKILL
tras preparar intención y tras commit. Reabrir PGlite sin migraciones, una fuente
actual, una recogida, sin callbacks históricos. Regresión de mint/muerte/suelo,
recursos/economía, comidas SQL035 y cambios de combate/nado concurrentes.

Reutilización: `BP_JigServerSave.uasset` de ActionRPG vuelve a comprobarse físicamente;
su paquete Blueprint no se ejecuta en Node/Postgres. Se conservan las fuentes Unreal
y se reutilizan `leavePearl`, GroundHostAuthority, GroundDeadlineClock y recibos JS.
Sin arte ni cambios visuales. El sobre completo de kill/cofre, `give`/`swallow`,
adopción pública y canario autenticado de caída del VPS siguen pendientes.
