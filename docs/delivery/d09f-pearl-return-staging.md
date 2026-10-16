# D09f-2b.37 — retorno persistente a la playa

Fecha: 2026-10-09. Base aislada 7a6be456ed5e408e682c2dc28385c658f0d03a3f; integración comprobada sobre cbcc414a1c19061e51bbdb0e5c32f07cc3afd9b0.
SQL013 aplicada según el autor; no se aplicó ni se consultó SQL live en este corte.

## Resultado

PearlReturnStaging agrega retorno ground-only opt-in. Deriva UID/kind/versión/fuente desde las
autoridades del servidor y acepta solamente dropId. Verifica marker y reloj auténtico del mismo
mundo, ledger local y ubicación original de storage; requiere tick estrictamente posterior al
returnAt. La cola revalida generación/holder/world y CAS; el recibo prueba destino, por eso la
fuente original se conserva y compara por separado. No fabrica ni adopta un UID desconocido.

La búsqueda costera usa el helper actual returnPearl y mulberry32 separado desde el estado capturado.
Conserva fallback, geometría, delay de pickup, vida del nuevo drop y eventos unloot/loot/pearlReturn.
No consume RNG vivo ni allocator antes de receipt/drain. Una reserva exacta solo de UID excluye
pickup/otro movimiento de esa perla; un claim local por World precede callbacks de captura y
serializa otros return coordinators. El tick completo debe quedar retenido por el caller. Claim,
baseline y assertPublishable no implementan la pausa del host ni bloquean otras clases de gameplay.

Antes de dispatch y drain comprueba tick/clock, RNG referencia/estado, allocator, orden/identidad
de entradas de drops, fuente/marker/ledger, ausencia de dueño/duplicado, geometría por referencias,
footprint del destino y tuning. Request/recibo/destino privados impiden sustitución pública. Drain
decora en buffer separado, valida, instala un solo nuevo drop/ledger/RNG/allocator y publica al final.
Rollback conserva también el orden de drops para no alterar RNG futuro; mantiene recibo y fence.
El RNG posterior se instala como nueva función mulberry32; referencias externas al RNG anterior no
se retargetean. El host futuro debe usar el dueño World y respetar ese contrato, sin aliases retenidos.

## Verificación aceptada

**300/300 aisladas**, 14 archivos, **65 nuevas** (63 unitarias y 2 SQL), cero fail/cancelled/skipped/TODO,
21.280,7615 ms. **635 fuentes** de server/src/tests/manifiestos estables antes/después sobre git archive
acotado. Dependencias físicas por junction a node_modules existente: bytes externos no se pinnearon
ni hashéaron completos. **140/140 focales compartidas**, cuatro archivos, 8.486,0605 ms;
**145 fuentes** del cierre literal de imports relativos + manifiestos + SQL001–013 estables y
equivalentes normalizadas al aislamiento. Los pases se solapan y no se suman; no es regresión completa
de los cambios concurrentes en comunidad, arte, mapas, LLM o Web3.

Cobertura: deadline igual/anterior/posterior, radio temporal de la siguiente recogida, selectors
getter/Proxy sin callbacks, source/UID duplicados/perfil/ledger, allocator collision/overflow,
unique/location falsos, fuente movida antes de dispatch, lecturas independientes completas, respuesta
perdida con mismo UUID/request/destino, source/receipt/tick/RNG/allocator/terreno/eventos alterados,
reentrada de otro owner durante captura y durante decoración, fallo de publicación/liberación,
rollback con drops ajenos conservados en orden y dos retornos consecutivos. Fuentes proyectadas
siguen bloqueadas por helper nativo; una fuente retornada se recoge durablemente después del delay.

SDK service_role contra SQL001–013 local: leave → vencimiento → retorno → replay sin nueva generación
→ apply único → checkpoint → nuevo reloj/World0 con startup/hidratación → destino exacto sin RNG ni
eventos antiguos → pickup único. Segundo caso pierde primera respuesta SQL después de commit,
reintenta exactamente y falla decoración de apply: nueva autoridad hidrata el destino ya confirmado
una sola vez. Worlds/coordinadores nuevos sobre la misma instancia PGlite; no reopen file-backed,
proceso, conexiones PostgreSQL independientes, GameHost real, Supabase live, WAN o leases aquí.

Preparación: archive amplio excedió timeout del REPL; se conservó copia incompleta ignorada y se
pasó a archivo acotado. Un closure de escritura retuvo la primera ruta y un lanzamiento no encontró
el test; ruta corregida/verificada. Pases preliminares 58/58, 63/63 y 1/1–2/2 del worker SQL no se
agregan a aceptación. Revisión de autoridad/inventario delegada; SQL y revisión final con GPT-6 Luna,
principal conserva arquitectura, integración y aceptación. No se aceptan conclusiones del worker sin
lectura y pruebas propias. [Evidencia/hashes](d09f-pearl-return-staging-evidence.json),
[brief](../briefs/m5-pearl-return-staging.md). Logs en shots/review.

## Siguiente corte

Cerrar venta durable con oro y perla en una operación; después componer pickup/return y startup
con retención de tick/publicación en el host. Siguen certificación/adopción legacy, reloj/gameplay
atómicos o política explícita de crash, respuesta sobre edad offline/cadencia, autoridad/leases,
afinidad permanente por personaje/tipo, finalizador y P4/P6. El retorno de suelo no implementa venta,
regreso por inactividad del poseedor ni permanencia del RNG entre procesos.

Sin SQL nueva, host/defaults/protocolo/env/push/deploy/reinicio. Trabajo ajeno conservado mediante
commit selectivo de siete rutas. Unreal/FAB: cuatro assets del brief comprobados por metadatos,
sin exportar/modificar fuentes, cero assets nuevos. No acreditan comportamiento o portabilidad.
