# D09f-2b.13 — apply previo al tick

## Resultado aceptado localmente

Frontera opcional síncrona de LocalServer para que un apply ya confirmado pueda liberar su propia
reserva antes del guard del tick, también durante pausa. Un adaptador no válido o reentrante cierra
la instancia de tick/eventos; una espera normal conserva inputs/ACK y evita deuda de simulación.
El filler interno y los ticks de catch-up no vuelven a drenar dentro de la misma entrada al pump.

Los eventos de un apply correcto esperan si aún hay pausa/otra reserva. HELLO, desconexión y flush
externo conservan esa cola; el siguiente tick admitido emite el éxito una vez antes de su snapshot.
Un pump con fallo sticky no publica sus heartbeats. `tickBlocked` se refresca también durante pausa.

GameHost no configura este hook automáticamente. Se prueban adapters inyectados sobre PearlStaging
y PearlStartup reales de memoria; comandos/arranque del juego siguen con sus contratos anteriores.
[Contrato completo](../briefs/m5-pearl-tick-apply.md), [mapa común](../briefs/m5-pearl-common-gate.md).

## Evidencia

Regresión pertinente aislada desde `9846df482dab6f8666ad9369b7d3f9cba12c2f1e` con los dos overlays
propios `src/net/localServer.js` y `tests/pearl-tick-apply.test.mjs`. Node v24.14.0, concurrencia 2;
**855/855**, cero fallos/canceladas/omitidas/todo, 95.468,093 ms. 66 archivos, 197 fuentes fijadas con
SHA256 antes/después. Incluye el puente naval de ese commit,
sin absorber modificaciones paralelas de sim/render/planes/assets ni abrir `.env`.

Resultado final en [evidencia estructurada](d09f-pearl-tick-apply-evidence.json), con comando/lista
exactos, conteos, duración, hashes y log ignorado `shots/review/m5-pearl-tick-apply-accept.log`.
15 pruebas nuevas de contrato cubren:

- Apply antes de permiso/dequeue; false temporal sin modificar estado/tiempo de simulación.
- Throw, Promises resuelta/rechazada y array de drain; fallo sticky sin replay ni publicación automática.
- Reentrada capturada desde apply, permiso y un comando admitido; no inventa rollback de callbacks.
- Catch-up y filler interno sin segundo drain; filler directo preflight antes de cambiar su estado.
- Staging real con respuesta retenida tras commit, pausa, otra lane bloqueada y publicación única.
- HELLO/desconexión/flush externo conservan eventos pendientes; fence de staging no concede éxito.
- Startup real prepared→drain ready antes del primer tick, suelo instalado una vez con mapper explícito.

Se corrigen fixtures iniciales: swallow exige jugador en calma, el suelo usa `pickAt`, y los handles
de gate no admiten consulta/release después de liberar. No son cambios a reglas del juego.

Revisión independiente acotada de lectura; hallazgos de reentrada en tickAccess y flush de lifecycle
cerrados con pruebas positivas. Aceptación del principal tras revisar fuente y evidencia. No hay
cambio visual/payload/asset: no se repite navegador ni se acepta experiencia de juego/dispositivo.

## Límites y siguiente corte

No se vuelve a aplicar SQL, consultar Supabase, reiniciar/desplegar ni modificar env. Protocolo 16.
No hay integración automática de diario/startup/staging en GameHost ni despacho durable del juego.
Las 006–008 y sus verificaciones reales mantienen su aceptación anterior, sin nueva SQL 009.

Una función trusted que escriba y falle puede dejar cambios locales; este guard no los revierte.
Su dueño conserva/reconcilia fences y reemplaza autoridad. Las mutaciones de lifecycle y publicaciones
directas de PROFILE/SAVE/SPAWN/WELCOME siguen fuera de este nuevo contrato de tick/eventos. La espera
temporal conserva snapshots públicos actuales; otra reserva puede retener el evento de un apply
mientras su estado ECS ya está aplicado. No hay publicación especial de apply durante pausa.

Siguen pendientes scope/namespace/reloj/adopción explícitos, epoch/rebase de inputs retenidos, montaje
del host y snapshot canónico, granularidad para mantener movimiento, finalizador durable, muerte
durable completa y [afinidad permanente por personaje/tipo](../briefs/m48-pearl-affinity.md).
P4/P6 continúan parciales. No se anuncia la circulación durable como terminada.

Reutilización: inventario Unreal/FAB y dos Blueprints concretos re-verificados (BP_JigServerSave,
580.554 B; BP_InventoryComponent, 24.878.603 B). No aportan ejecución Node/CAS portable. Drain/gate/
tick/eventos existentes cubren esta necesidad, sin importar/modificar fuentes Unreal.
