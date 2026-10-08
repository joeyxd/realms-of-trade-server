# D09f-2b.33 — restauración y consumo con plazos de suelo proyectados

Fecha: 2026-10-08. Base aislada: 95fc29192321fd83a4db33c77536e8f56761371a.
SQL013 aplicada según el autor; este corte no consultó Supabase live ni creó otra migración.

## Resultado

El botín que precede al checkpoint se puede restaurar con deadlines locales negativos, conservando
su ventana exacta. GroundDeadlineClock exige mundo, dominio explícito durable-ground-v1 y un
GroundClockEpoch auténtico; entrega pickAt/t locales y un marker detached con ancla/ground canónico.
No recorta plazos, modifica World.tick ni convierte datos persistidos en números negativos.

PearlGroundHydration/PearlStartup integran la opción para ambas familias, incompatible con mapClock.
Lecturas preparan y el drain reversible publica geometría/marker/plazos. DeathDropStaging valida el
marker y el ground contra el presente, mantiene elegibilidad local y envía at durable junto con el
ground original. DeathDropLifecycle permite vencer un plazo negativo bajo esa validación. Sin opción
se mantiene el comportamiento legacy y se rechaza un drop proyectado. El marker de reloj también
impide consumo nativo si desaparecen ambos IDs de origen; su identidad incompleta se rechaza.

El marker local no prueba dominio histórico ni ownership. La declaración sourceDomain pertenece a
la autoridad que compone el arranque; las filas de fixture se declaran expresamente para estas pruebas.
Recibos/current state conservan su validación y no hay adopción silenciosa, backfill o certificado en DB.

## Verificación aceptada

**185/185** pertinentes aisladas en trece archivos, **22 nuevas**, cero fallos/cancelaciones/skips/TODOs.
Duración 21457.2448 ms, Node 24.14.0. Git archive de la base, 476 fuentes y 954 archivos físicos
Three idénticos antes/después. Tests de bordes inclusivos/estrictos, pasado/presente/futuro, overflow,
callbacks/proxies, marker/mundo/ancla, fuente falsa consistente, mutation después del recibo y fallback nativo.
La restauración conjunta y el flujo legacy mantienen sus comprobaciones de barrera/drain/rollback.

SDK con transporte SQL001–013 local bajo service_role: restauración en World nuevo desde checkpoint100,
recogida que guarda at100 y los tiempos originales, replay sin duplicar perfil, checkpoint160 y segunda
restauración que omite el source picked. Perlas y fuentes ordinarias restantes mantienen los plazos
respecto al ancla nueva. Ningún evento histórico ni progreso adicional se publica por hidratar.
Es restauración de coordinadores/World sobre el mismo store SQL, no reinicio real de GameHost/proceso.
PGlite no prueba concurrencia de backends independientes ni leases. La reapertura file-backed de .32
no se cuenta otra vez como aceptación nueva de este corte.

Integración compartida focal **37/37**, cero otros, 1337.4397 ms; 122 fuentes de imports relativos
literales y manifiestos idénticas antes/después. Dependencias externas no hasheadas completamente.
Un pase más amplio pasó 77/77, pero gameClient.js/localServer.js cambiaron concurrentemente: no se
acepta estabilidad de ese pase ni se suma de nuevo. Esas ediciones ajenas se preservaron y su exclusión
consta en el JSON. No se acepta aquí la regresión completa del checkout naval/arte/agentes/Web3.
Un caso agregado de fallback expuso una expectativa errónea del código de error del test: la ausencia
de UUID produce identity. Corregida esa expectativa, se repitieron las cohortes sobre la fuente final.

Logs/hashes, archivos propios y límites en [evidencia JSON](d09f-ground-deadline-clock-evidence.json).
El control de integración compara contenido normalizado LF frente a los blobs Git; diferencias de
CRLF/LF heredadas no se interpretan como cambios de código probado: 476 textos probados coinciden
con el índice Git, cero discrepancias normalizadas y 468 diferencias de bytes solo por CRLF/LF.

## Lo que sigue

La opción sigue sin montaje GameHost/CLI ni cambios de protocolo/env. GameHost conserva el rechazo de
startup ordinario conjunto. Los nuevos spills de muerte y PearlStaging todavía crean deadlines locales;
returnPearl genera otro drop sin persistir su retorno ni conservar este marker. Esos escritores necesitan
el mismo dominio antes de activar el flujo completo. Un marker proyectado encontrado por el owner
ordinario se reserva a la autoridad y no entra en consumo nativo, incluso si su kind es incompatible.

Siguen dominio/versionado legacy, política offline consultada sin respuesta, cadencia/checkpoint atómico
con operación de suelo y ventana de crash, barrera de arranque conjunto, canario013/restart/reconexión
reales y leases/finalizador. Afinidad permanente por personaje/tipo y transacciones navales P4/P6 abiertas.
Esta proyección no verifica por sí misma el checkpoint: usar el ancla ya verificada/adoptada por .32.

Unreal/FAB revisado en solo lectura: BP_InventoryComponent.uasset 24878603 bytes y SM_Potion.uasset 117402
bytes de ActionRPGMultiplayerStart. No suministran coordenadas/recibos JS/Postgres; se reutilizan
GroundClockEpoch, DTOs, snapshotDropData y coordinadores existentes. Sin exportaciones ni assets nuevos.

Solo los doce archivos propios de evidencia se integran y commitean localmente. Sin push, deploy,
escritura SQL/env live, lectura de credenciales o reinicio de servidor. Trabajo ajeno conservado.
