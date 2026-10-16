# M5 / D09f-2b.32 — sesión del reloj y coordenada de arranque

SQL013 fue aplicada según el autor el 2026-10-08; todavía no es un canario live. Este corte añade el
coordinador server-only que carga y verifica el checkpoint con su recibo, prepara avances exactos,
resuelve respuestas perdidas por lectura y entrega el ancla al llamador en un drain síncrono.

World.tick permanece efímero. GroundClockEpoch convierte enteros entre un ancla local y una durable;
toLocal conserva valores negativos para plazos ya pasados, sin recortarlos ni prolongarlos. El dueño
futuro debe decidir cómo representarlos en gameplay. No transforma registros existentes ni escribe World.

GroundClockSession.load(localTick) prepara una lectura estable del checkpoint y recibo, incluso null.
drain(localTick) exige el mismo tick capturado y publica ready o missing. initialize({operationId,
localTick,tick}) crea solo tras missing explícito; checkpoint({operationId,localTick}) deriva el target
mediante el ancla. Una operación pendiente bloquea logicalTick y nuevas operaciones. settle/await nunca
publica el ancla. reconcile() solo lee; ausencia de recibo conserva unresolved; resume() envía exactamente
el UUID/request anterior. Conflicto, corrupción o un escritor externo cercan la sesión. cancel es sticky.

El llamador debe mantener admisión/simulación detenidas entre preparación y drain. Este contrato no
monta GameHost, proporciona lease ni impide que otro proceso escriba después de las verificaciones.
La política offline sigue consultada al autor; aquí no se elige tasa, reloj de pared ni cadence. Quedan
compatibilidad/versión de plazos legacy, checkpoint atómico con operaciones de suelo, ventana de crash,
montaje conjunto, canario SQL013 y reinicio/reconexión reales. Afinidad por personaje/tipo sigue pendiente.

Verificación prevista: conversiones/bordes/overflow, ausencia explícita, recibo y doble lectura, monotonicidad,
respuesta descartada y lectura sin reenvío, resume exacto, cancel/tick drift, CAS externo y reapertura local.
Reutilización: DTOs SQL013, StoreError y snapshotDropData. Se contrastan los mismos candidatos Unreal/FAB
BP_InventoryComponent y SM_Potion en solo lectura: no aportan autoridad ni coordenadas JS/PostgreSQL.
No hay assets, protocolo, env ni migración nueva.
