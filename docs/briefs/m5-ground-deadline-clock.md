# M5 / D09f-2b.33 — proyección explícita de plazos de suelo

Conectar GroundClockEpoch de .32 con la restauración y el ciclo de recogida/expiración ordinario.
Un plazo durable anterior al checkpoint puede quedar negativo en una sesión que empieza en tick cero;
recortarlo cambia su duración y rechazarlo impide restaurar. Los DTOs persistidos siguen no negativos.

GroundDeadlineClock exige mundo, sourceDomain: durable-ground-v1 y un GroundClockEpoch auténtico.
La autoridad que lo construye declara el dominio de los registros; aquí no se descubre ni certifica
el dominio de filas legacy, se crea una marca persistida, se hace backfill ni se decide política offline.
El marker local groundClock conserva dominio, mundo, ancla y ground canónico. No acredita propiedad:
los recibos y el estado actual siguen verificados por los coordinadores existentes.

PearlGroundHydration/PearlStartup aceptan deadlineClock opt-in, incompatible con mapClock legacy.
La restauración conjunta instala tiempos locales con signo, geometría y marker sin modificar el origen.
DeathDropStaging verifica marker/proyección/ground actual, compara elegibilidad local y envía at durable
con el ground original. DeathDropLifecycle acepta vencimientos locales negativos solo a través de esa
validación. El marker de reloj también bloquea consumo nativo si se pierden los IDs de origen;
la autoridad rechaza esa identidad incompleta. Sin opción se conserva el flujo anterior y se rechazan fuentes marcadas para no mezclar dominios.

No activar GameHost/CLI: whole-death y escritores PearlStaging/returnPearl todavía producen tiempos
locales; faltan dominio legacy, cadencia y atomicidad reloj/operación, política offline, leases y ensayo
real de host/reconexión. El host sigue rechazando la restauración conjunta ordinaria. El caller mantiene
simulación/admisión detenidas; la nueva clase no verifica por sí misma un checkpoint ni elimina su ventana
de caída. Usar el ancla verificada y adoptada por GroundClockSession al componer el arranque futuro.

Pruebas: bordes inclusivos/estrictos, pasado/presente/futuro, overflow, marker/mundo/ancla/fuentes falsos,
callback-free, restauración conjunta reversible, rechazo legacy, recogida/expiración con tiempos canónicos,
recibo confirmado antes del drain y restauración nueva sin resucitar el origen terminal. SDK/SQL001–013
locales, fuentes fijadas y hashes pre/post; sin SQL adicional, env real ni conexión live.

Reutilización Unreal/FAB: BP_InventoryComponent.uasset y SM_Potion.uasset en ActionRPGMultiplayerStart,
verificados en solo lectura (24878603 y 117402 bytes). No aportan reloj/recibos JS/Postgres. Reutilizar
GroundClockEpoch, DTOs de suelo, snapshotDropData, hydration/staging existentes; ninguna exportación/asset.
