# D09f-2b.12 — barrera conservadora del tick autoritativo

## Resultado y frontera

Cerrar la entrada autónoma del host antes de evaluar efectos mientras una reserva de perla,
cola pendiente o barrera de recuperación conserva autoridad. El tick actual mezcla movimiento,
combate, bots, rewards, drops, retornos y producción; suspender una parte después de mutar otra
podría perder una recompensa, cambiar el ganador de una recogida o repetir RNG.

`LocalServer.tickAccess()` es un hook trusted opcional y puro, de boolean síncrono. GameHost
consulta `assertWorldAvailable()` y las lanes de cada cliente con entidad/perfil vigentes. Las
cuentas vienen de ProfileSessions; el mensaje del cliente no declara autoridad. Reservas de
suelo/desconectados/UIDs aún desconocidos también cierran el límite global. Cuentas conectadas,
espectadores y autosaves ordinarios pueden seguir presentes.

`pump()` comprueba antes de consumir hitstop, slow-mo o acumular tiempo de simulación. `step()`
comprueba antes del primer dequeue, carry/ACK/starve/filler o helper. `applyFiller()` directo
también comprueba antes de escribir. Un rechazo conserva el estado autoritativo anterior; no
se ha evaluado un efecto ni elegido un nuevo ganador. No instala una cola durable de efectos.
La autoridad no cambia ni inicia nuevas reservas desde callbacks dentro de un tick admitido.

`step()` devuelve false si espera y true si completó el tick. Hook inválido/Promise/throw falla
antes de simular; el indicador queda bloqueado. El Worker sin hook conserva su comportamiento.

## Tiempo, red e inputs

- Durante la reserva **también espera el movimiento autoritativo de todo el mundo**. Esta es
  una protección previa a integrar gameplay durable, no la experiencia final de espera por jugador.
- `last` sigue el reloj del pump; `acc` se descarta al bloquear. Al liberar, solo se simula tiempo
  recién transcurrido, con los límites de catch-up de siempre. La latencia de storage no se
  convierte en producción, expiración, daño ni una ráfaga de ticks atrasados.
- `holdAcc` sirve solo para snapshots a la cadencia habitual, como máximo uno por pump. Son
  estado público actual y el último ACK realmente aplicado, incluidos espectadores. No vacían
  eventos, sincronizan perfil ni programan/ejecutan saves.
- INPUTS/PING siguen disponibles. La cola conserva el límite existente de 30 comandos y su OR
  de presses recortados en `carry`; no conserva cada press individual ni un historial ilimitado.
  Los comandos retenidos se ejecutan con el estado vigente al liberar. La política de epoch/rebase
  tras cambiar loadout requiere su propio contrato antes de la integración automática.
- Los comandos inmediatos conservan sus guards de [2b.11](m5-pearl-command-access.md); un comando
  disjunto que ya estaba autorizado no se vuelve durable ni queda encolado por esta barrera.
- `storage.tickBlocked` informa la última preflight. Si todos están pausados, `pump` retorna antes
  de actualizarla; no es una prueba de readiness ni sustituye health/admisión/startup.

No cambia perfil, snapshots, `you`, EVENT ni PROTOCOL_VERSION 16. El cliente sigue con su predicción
actual; no se implementa un estado visual de espera ni se acepta su sensación/rendimiento por estas pruebas.

## Apply y límites pendientes

No conectar `staging.drain()` detrás de esta barrera: su propia reserva impediría avanzar.
La futura frontera de apply debe progresar incluso si hay pausa/hold, validar identidades actuales,
aplicar/fence de manera síncrona y después consultar disponibilidad antes de simular/publicar.
La integración real de PearlStartup/PearlStaging sigue pendiente.

La barrera cubre `LocalServer.step → applyCommand/stepWorld → economy.step/onAdvance` y fillers.
Llamadas directas a helpers sim o `economy.advance` fuera de esas entradas siguen fuera del contrato;
las entradas dev/commerce ya tienen su preflight inmediato. HELLO/close/adopción/restauración y saves
de mundo mantienen sus contratos propios. No hay activación de operaciones durables, leases, cambios
de reloj offline, finalizador durable ni afinidad permanente.

Una muerte existente se retiene antes de daño/spill y luego ejecuta sus efectos actuales una vez.
Eso no hace atómicos en storage sus efectos de equipo/oro/mundo. El lote pearl-only 007/008 conserva
su alcance anterior. Captura/retención granular de efectos para permitir movimiento durante espera
requiere otro corte; no omitir silenciosamente daño, producción o recompensas.

## Verificación y reutilización

Cubrir las entradas reales del host, cuenta/UID/ledger-only, todas las lanes de cola, fences,
recovery→hydration, identidad stale y autosave en vuelo. Casos positivos de pickup/retorno,
producción de red/parrilla, muerte/spill y kill/roll deben esperar antes de mutar y actuar al liberar.
Probar ACK/press carry/cadencia/no catch-up y un PearlStaging real con respuesta pausada y drain manual.
Regresión aislada desde `ac47564`, overlays propios y hashes; excluir trabajo paralelo explícitamente.

Inventario Unreal/FAB cruzado; BP_JigServerSave (580.554 B) y BP_InventoryComponent (24.878.603 B)
re-verificados de solo lectura. Blueprints de referencia, sin autoridad Node/CAS portable. Se reutilizan
gate, lanes del host, tick y snapshots actuales; ningún asset/fuente Unreal se modifica o importa.

[Mapa común](m5-pearl-common-gate.md), [entrega](../delivery/d09f-pearl-tick-access.md).
