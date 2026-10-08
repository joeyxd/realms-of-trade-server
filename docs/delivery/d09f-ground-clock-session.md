# D09f-2b.32 — sesión de recuperación del reloj del suelo

Fecha: 2026-10-08. Base aislada: da98c6b162670808bbf31c08574ef60be6b8a7fa.
SQL013 aplicada según confirmación del autor en este turno. No se consultó Supabase live.

## Cambio aceptable y propósito

GroundClockSession carga checkpoint/recibo y vuelve a leer el presente antes de preparar el ancla. Un
avance parte del baseline CAS verificado y de la diferencia exacta entre tick local y tick durable.
El await no publica estado usable: drain exige el mismo tick local capturado. Ausencia estable lleva
solo a missing; initialize explícito crea el checkpoint, sin adoptar suelo legacy ni emitir gameplay.

GroundClockEpoch conserva el tick local efímero y permite convertir coordenadas sin cambiar World.tick,
economía, perfiles, botín ni inputs. Los plazos pasados pueden dar un tick local negativo; no se recortan
a cero. Esta aritmética todavía no convierte ni marca el dominio de registros históricos.

Respuesta de escritura perdida/malformada conserva el intento unresolved. reconcile solo consulta y
valida petición/recibo/presente. Sin recibo conserva incertidumbre; resume reenvía el mismo UUID y
request. CAS rechazado, recibo contradictorio, cambio entre lecturas o cancelación cercan la sesión.
Cancelar no aborta SQL ya enviado: puede quedar confirmado en storage, pero nunca publica un ancla local.

## Verificación

**157/157** pruebas pertinentes aisladas, en nueve archivos; **25 nuevas**. Cero fallos, cancelaciones,
skips o TODOs. Duración 50405.1845 ms, Node 24.14.0. 472 fuentes y 954 archivos físicos Three
idénticos antes/después. Un pase preparatorio anterior de 22/22 no se suma otra vez.

El SDK usa transporte local a SQL001–013 bajo service_role. Se cierra y reabre PGlite file-backed sin
recrear roles/migraciones: sesión nueva parte de tick local cero, recupera checkpoint y conserva
conversiones antes/en/después de disponibilidad y expiración. Es reinicio del storage/coordinador,
no GameHost ni aceptación deployed. Pruebas de respuesta descartada cuentan RPCs y confirman recuperación
por lectura sin otro envío; ausencia de recibo exige resume explícito idéntico.

Cohorte fijada desde Git archive, Three 0.160 físico privado, Supabase/PGlite/ws disponibles por junction.
No copia/carga de env. Hashes fuente/Three antes/después y logs en el JSON adjunto. Los textos heredados
CRLF pueden diferir de blobs Git LF; el control de integración compara contenido con normalización LF. Las 472 fuentes probadas coinciden
con los blobs commiteados; 469 diferencias de bytes corresponden solo a CRLF/LF, cero diferencias de texto.
Integración compartida focal: **53/53**, cero otros, 1247.8445 ms; 119 fuentes de la clausura de imports
relativos literales y manifiestos idénticas antes/después. Dependencias externas no se hashean completas.
Un primer pase compartido también pasó 53/53, pero su vigilancia global detectó siete cambios ajenos y
no se aceptó como fuente estable; ese pase no se suma nuevamente. Se conservan las ediciones paralelas
registradas en evidencia. No se acepta regresión completa de los cambios ajenos del checkout.

## Integración y siguientes límites

No monta GameHost/CLI, cambia protocolo, activa servicios ni requiere SQL nueva. La política offline
sigue esperando decisión del autor; no se toma una pausa ni envejecimiento como regla acordada.
Quedan la correspondencia/versionado de plazos legacy, autoridad de cadence, atomicidad de operaciones
con el reloj y ventana de caída, barrera conjunta antes de admisión y restart/reconexión/WAN reales.
Afinidad permanente por personaje/tipo, finalizador/leases y transacciones navales P4/P6 siguen abiertos.

Se revisaron BP_InventoryComponent.uasset (24878603 bytes) y SM_Potion.uasset (117402 bytes) de
ActionRPGMultiplayerStart en solo lectura. Blueprint/mesh no aporta reloj/recibos/epoch JS-Postgres:
se reutilizan DTOs SQL013, StoreError y snapshotDropData existentes; ninguna fuente Unreal exportada.

Solo se integran los siete archivos propios enumerados en evidencia. Trabajo paralelo naval, arte,
agentes y Web3 conservado. No hubo push, deploy, escritura live ni reinicio de servidor.
