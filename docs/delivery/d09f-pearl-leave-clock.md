# D09f-2b.35 — dejar perlas con plazos durables

Fecha: 2026-10-08. Base aislada 241edb9517d6d619c8012cef0a2dc883881ebde5.
SQL013 aplicada según el autor; sin consulta live ni migración adicional en este corte.

## Resultado

PearlStaging recibe deadlineClock opt-in, auténtico y del mismo scope. La ruta leave captura el tick y
los plazos del helper detached antes de reserva/save/loadUnique/commit. Guarda availableAt/returnAt
durables y proyecta de vuelta el mismo pickAt/t sobre el drop local con marker groundClock. Conserva
geometría, orden de bolsa, perla tragada, progreso, RNG y eventos públicos del helper. Sin opción mantiene
DTO y drop legacy. No altera World.tick, reglas de gameplay ni snapshots/protocolo.

Una ligadura privada conserva plan/tick; la resolución gestionada es la única sustitución permitida
del plan para rellenar generación vigente. El request concreto se congela y liga al construirse. Antes
de dispatch se valida plan/epoch/tick, y antes de preparar y aplicar se comprueba recibo exitoso exacto,
UID/kind/ground y marker. Avance global durante I/O conserva los plazos capturados; retroceso anterior
a captura, overflow, ancla futura y sustitución de evidencias impiden publicar. Async solo prepara;
stagedDrop, rollback y fences existentes mantienen la aplicación síncrona y reversible.

## Verificación aceptada

**446/446 pertinentes aisladas**, veinte archivos, **16 nuevas**, cero fallos/cancelaciones/skips/TODOs;
52278.3215 ms, Node 24.14.0. Git archive fijo; **429 fuentes** de server/src/tests y manifiestos,
y **954 archivos físicos Three** idénticos antes/después. Las dependencias externas por junction no
se hashéan completamente. **82/82 focales compartidas**, cuatro archivos, 2904.4618 ms;
**122 fuentes** de imports relativos literales/manifiestos estables antes/después. No equivale a la
regresión completa del trabajo naval/arte/agentes/Web3 concurrente. Pases preparatorios no se suman.

Cobertura nueva: offset durable >2^32 con ancla local no cero, shape legacy, generación después de dos
transferencias, reloj forjado/Proxy/mundo equivocado, overflow/ancla futura sin dispatch ni reserva,
retroceso antes de I/O y después del recibo, respuesta perdida con mismo UUID/request, plan/request/receipt
sustituidos, ground/UID falsos y rollback local tras error de save. El recibo durable permanece intacto.

SDK/SQL001–013 local bajo service_role: reloj verificado/adoptado, leave nuevo, replay exacto sin cambio
de perfil; World sin writes antes del drain. Restauración en World tick cero no emite eventos históricos.
Checkpoint desde el coordinador recargado y segunda restauración conservan ground/intervalo originales,
con disponibilidad pasada negativa. Son Worlds/coordinadores nuevos sobre el mismo store; no reopen
file-backed, proceso ni GameHost real. PGlite no acredita backends independientes, leases ni Supabase live.

Logs/hashes/alcance en [evidencia JSON](d09f-pearl-leave-clock-evidence.json). El control de índice compara
las 429 fuentes aisladas probadas con blobs Git normalizados a LF, separando CRLF heredado. Commit local
selectivo de siete rutas; trabajo ajeno conservado. [Brief](../briefs/m5-pearl-leave-clock.md).

## Lo que sigue

Recogida de suelo necesita un dueño staged: PearlStaging aún no ofrece pickup. Convertir returnPearl
(y la ruta de venta que lo usa) antes de activar el ciclo completo. El marker no concede esas autoridades.
Cerrar dominio/versionado legacy, atomicidad reloj/gameplay y ventana de caída, fuente/cadencia/política
offline y startup conjunto antes de admisión. Checkpoints continuos conservan offset; cambios discontinuos
de autoridad requieren coordinación explícita mientras haya operaciones pendientes. Afinidad permanente
por personaje/tipo, finalizador/leases, P4/P6 y aceptación real de restart/reconexión siguen abiertos.

Sin SQL nueva, host/CLI/env/defaults/protocolo/push/deploy/reinicio. Política offline sigue sin respuesta.
Unreal/FAB: BP_InventoryComponent.uasset y SM_Potion.uasset comprobados solo lectura, sin recurso portable
de reloj/recibos JS/Postgres; se reutilizan helpers/efectos/SDK existentes, sin asset nuevo.
