# Recogida fluida e inventario de materiales

Fecha: 2026-10-09. Corrección del reporte del autor al recoger objetos del suelo.

## Problema y comportamiento

La recogida mostraba «Esperando confirmación…» y empezaba el tiempo local de acción al recibir
la respuesta, sumando la latencia. Además, I mostraba equipo pero omitía `eco.pack.goods`:
los materiales recogidos estaban en el perfil sin aparecer en esa pantalla.

Ahora F y el botón táctil responden inmediatamente con animación, sonido, ocultación del objeto
suelto y una vista provisional de su cantidad. El tiempo de acción comienza al pulsar. Se puede
recoger otro objeto al terminar ese tiempo aunque siga pendiente la primera respuesta.
I incluye materiales, cantidades, volumen/capacidad, masa y cinturón de herramientas.
El contenido nuevo admite español e inglés.

## Autoridad y recuperación

- La predicción pertenece exclusivamente a la presentación: nunca modifica el perfil canónico,
  el inventario gastable ni el estado de recursos de la simulación.
- La confirmación privada de recogida añade `profileRev`. La vista provisional se retira cuando
  llegan las revisiones canónicas de perfil y recurso, sin contar dos veces la recompensa.
- Un rechazo restaura el objeto y retira solamente su cantidad provisional. Una respuesta que tarda
  cinco segundos retira la predicción y permite reintentar el mismo comando y UUID. Un éxito tardío
  restaura la vista confirmada hasta recibir las actualizaciones canónicas.
- Ocho recogidas pendientes como máximo; sin repetir sonido/recompensa por reintento o ACK duplicado.
- El golpe de herramienta comienza localmente; caída de palmera, rotura de roca y otorgamiento
  de materiales siguen siendo autoritativos. El evento final conserva el sonido de caída.
- Fabricación espera las recogidas pendientes para usar una revisión canónica. Su flujo de
  confirmación existente queda fuera de esta corrección. El guardado sigue usando la autoridad actual.
- Campo privado opcional y compatible con clientes anteriores; no cambian snapshots, `you` ni perfil.
  Se conserva protocolo 32; sin `profileRev`, el cliente espera el perfil canónico sin duplicar cantidades.

## Reutilización de assets

Se revisaron los candidatos `InventorySystem` e `ItemImages` del inventario Unreal/FAB
(`docs/research/unreal-assets/SUMMARY.md`). El primero depende de UMG/Blueprint y los iconos
del segundo no están exportados al runtime web. Para este arreglo se conserva CharPanel,
su paleta/tipografía y SVG nativo liviano; no se modifican ni importan fuentes Unreal.

## Evidencia

- 57 casos Node distintos: recursos y carreras entre jugadores, herramientas, banco, persistencia
  del loop recolectar/fabricar/construir, WebSocket, presentación, rechazos, pérdida de respuesta,
  reintentos, compatibilidad y render de ocultación/restauración.
- Actualizador: 17 casos Python; 16 pasan y uno POSIX se omite en Windows. Los dos archivos de
  regresión de interfaz se añaden a su puerta de publicación.
- Navegador real con servidor efímero, WebSocket y 500 ms de ida/vuelta: 3/3 vistas pasan
  (desktop 1280×720, móvil 844×390 y 390×844 con escenario apaisado existente), sin errores JS.
  Recogida mediante F/botón táctil y apertura por I/botón de mochila. Se inspeccionaron capturas.
- `inventory-feedback/evidence.json` conserva los resultados; `immediateMs` mide de envío a
  callback local, no latencia física de pantalla ni FPS de teléfono real.
- Ninguna fixture de navegador usa datos de producción. Las pruebas firmadas de guardado y recarga
  pertenecen a `resource-loop-server.test.mjs`, separadas del ensayo visual efímero.

Reproducir: `node --test tests/resource-feedback.test.mjs tests/pack-inventory.test.mjs
tests/resources.test.mjs tests/harvest-tools.test.mjs tests/workbench-batch.test.mjs
tests/resource-loop-server.test.mjs tests/server.test.mjs tests/harvest-render.test.mjs`;
`python -B tests/deploy-vps-update.test.py`; `node tools/qa-resource-feedback.mjs` con las
dependencias Playwright/Three/GSAP indicadas por el script.

Publicación: el corte se envía a `claude/loving-lovelace-ptbif7` y entra por el actualizador del
VPS cuando la única autoridad esté sin jugadores ni escrituras pendientes. Un push no acredita
despliegue; la revisión activa y la entrada pública se verifican después.
