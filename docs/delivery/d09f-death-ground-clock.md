# D09f-2b.34 — muertes nuevas con plazos de suelo durables

Fecha: 2026-10-08. Base aislada bc566af538a94f246c7cedd29124b15a5e4e2db9.
SQL013 aplicada según el autor; sin consulta live ni migración adicional en este corte.

## Resultado

DeathStaging acepta deadlineClock opt-in, auténtico y del mismo mundo. Antes de saves/commits captura
una correspondencia privada entre el plan de muerte local, los grounds durables y el plan detached de
aplicación. Perlas guardan availableAt/returnAt desde pickAt/t; objetos y pociones guardan availableAt
al tick de muerte y expiresAt desde t. El round-trip conserva intervalos y rechaza overflow/rangos antes
de I/O. La reserva se libera si esa captura falla. Sin opción se conserva la forma y semántica legacy.

El plan de gameplay original permanece congelado: mismas pérdidas de XP/bienes/perlas, PK, RNG y eventos.
La respuesta async prepara el recibo; drain compara request/receipt con el binding privado y cada
source/item/ordinal/UID/ground antes del efecto existente. Solo los drops locales reciben pickAt y marker
groundClock; los eventos conservan su forma. Aplicación/publicación reversibles y fences se mantienen.
Un avance del tick global durante I/O es válido; la ruta opt-in rechaza retroceder antes del tick capturado.
No altera World.tick ni sustituye su dominio/protocolo por el contador durable.

## Verificación aceptada

**216/216 pertinentes aisladas**, quince archivos, **16 nuevas**, cero fallos/cancelaciones/skips/TODOs;
25776.869 ms, Node 24.14.0. Git archive fijo; **478 fuentes y 954 archivos físicos Three** idénticos
antes/después. Las dependencias externas por junction no se hashéan completamente.
**75/75 focales compartidas**, cuatro archivos, 2219.0904 ms; **121 fuentes** de imports relativos literales
y manifiestos idénticas antes/después. No se afirma regresión completa del checkout naval/arte/agentes/Web3.
Pases preparatorios 56/56 y SQL del worker 1/1 no se suman como pruebas adicionales aceptadas.

Cobertura nueva: muerte vacía/mixta/nueve perlas, epoch durable >2^32 con offset no trivial, conservación
de ventanas y shape legacy, reloj forjado/Proxy/mundo equivocado, overflow/ancla futura sin dispatch,
retroceso antes del commit, respuesta perdida, request/plan/receipt reemplazados, resultado fallido,
ground de recibo falso, rollback local después de commit y recogida ordinaria con at/ground durables.

SDK/SQL001–013 bajo service_role local: reloj verificado/adoptado, muerte nueva con perlas/objetos/pociones,
recibo durable y replay sin duplicar perfiles; ninguna escritura del mundo antes del drain. Restauración
en World tick cero verifica todos los markers/grounds, recoge un objeto a tick local cinco, guarda
checkpoint a treinta y vuelve a restaurar desde cero. La fuente picked no reaparece; todas las restantes
mantienen sus grounds originales/plazos relativos, sin eventos históricos ni progreso adicional.
Son coordinadores/World nuevos sobre el mismo store SQL; no reopen file-backed, proceso ni GameHost real.
PGlite no prueba backends independientes ni leases. SQL live sigue siendo confirmación del autor aquí.

Logs/hashes y alcance en [evidencia JSON](d09f-death-ground-clock-evidence.json). El control final compara
los textos de las 478 fuentes probadas con blobs del índice Git normalizados a LF, separando diferencias
de CRLF/LF heredadas. Trabajo compartido ajeno se preserva; commit selectivo de siete rutas propias.

## Lo que sigue

Convertir PearlStaging y returnPearl antes de activar el ciclo completo; el marker de una perla no
concede autoridad de recoger/dejar/retornar. La declaración de dominio aún no certifica filas legacy.
Cerrar atomicidad reloj/gameplay y ventana de caída, fuente/cadencia/política offline, composición de
startup, autoridad entre procesos y ensayo real de host/reconexión. El mapper es una instantánea de epoch;
un checkpoint continuo conserva el offset, pero cambio discontinuo de autoridad exige coordinación
explícita del host y no puede adoptarse silenciosamente mientras existe trabajo pendiente.
Afinidad permanente del personaje, finalizador/leases y P4/P6 siguen abiertos.

Sin host/CLI/env/protocolo/defaults, push/deploy ni reinicio. Política offline sigue sin respuesta.
[Brief](../briefs/m5-death-ground-clock.md) registra reutilización: BP_InventoryComponent.uasset y
SM_Potion.uasset verificados solo lectura, sin recurso portable de reloj/recibos; ningún asset nuevo.
