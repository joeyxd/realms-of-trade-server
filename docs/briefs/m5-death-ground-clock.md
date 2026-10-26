# M5 / D09f-2b.34 — plazos durables para muertes nuevas

Convertir los escritores whole-death al mismo dominio explícito de GroundDeadlineClock que usa la
restauración .33. El plan capturado de gameplay conserva tick, XP, pérdidas, PK, RNG, eventos y ventanas
locales. DeathStaging recibe deadlineClock opt-in; no lo crea desde fechas ni decide política offline.

Capturar antes de cualquier save/commit una correspondencia privada por drop entre el plan local,
ground durable y plan de aplicación con marker. Perlas: availableAt desde pickAt y returnAt desde t.
Objetos/pociones: availableAt desde el tick de muerte y expiresAt desde t. Validar el round-trip exacto,
mundo/ancla auténticos, intervalos/rangos y overflow; un error de captura libera la reserva sin dispatch.
La ausencia de opción conserva la forma legacy, incluyendo drops ordinarios sin pickAt/groundClock.

Las respuestas async solo preparan recibo/perfiles. Antes del drain, ligar request/receipt exactos con
la correspondencia privada, identidad/item/ordinal/UID y ground canónico. Aplicar un plan detached que
solo añade pickAt/groundClock a drops locales; eventos públicos conservan su forma. Reutilizar el efecto
reversible existente, sin tocar World.tick ni el plan original. El avance global durante I/O es válido;
el retroceso anterior al tick capturado se rechaza en la ruta opt-in. La clase no concede lease/reloj activo.

Verificar muertes sin botín, mixtas y nueve perlas; SDK/SQL001–013 con reloj verificado y durable >2^32,
restauración en World tick cero, recogida ordinaria, checkpoint y nueva restauración sin fuente terminal.
Respuesta perdida, request/receipt/plan reemplazados, fallo de apply y overflow no publican gameplay.
Mantener las regresiones de staging/efecto/host dormant/restauración/reloj pertinentes y fuentes fijadas.

Sin migración ni Supabase live/CLI/host default/env/protocolo. PearlStaging.#leave y returnPearl aún usan
el dominio local y requieren otro corte; los markers de perlas no autorizan su ciclo de vida. Siguen abiertos
dominio de filas legacy, atomicidad reloj/gameplay y ventana de caída, fuente/cadencia/política offline,
composición de startup, leases, afinidad y aceptación real de host/reconexión/publicación.

Unreal/FAB: BP_InventoryComponent.uasset (24878603 bytes) y SM_Potion.uasset (117402 bytes), comprobados
solo lectura en ActionRPGMultiplayerStart. No aportan reloj/recibos JS/Postgres. Reutilizar captureDeathPlan,
GroundDeadlineClock, prepareDeathApply y pruebas/SDK existentes; ninguna exportación o asset nuevo.
