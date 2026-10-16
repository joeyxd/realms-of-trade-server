# A1b1 — backend durable de aportes comunitarios

2026-10-09. Subcorte de A1b, posterior al contrato A1a. Preparar almacenamiento transaccional recuperable antes de conectar la Carpintería de Salty Shore.

## Alcance

Una migración opcional e independiente en `server/migrations/community/001_contributions.sql`, un adaptador Supabase y pruebas PostgreSQL locales. La migración requiere los roles habituales `anon`, `authenticated` y `service_role`; no depende de aplicar SQL001–013. Los fixtures verifican también su convivencia con esas migraciones. No se aplica SQL a un servicio real ni se monta el módulo en host, sesiones, simulación, protocolo o UI.

Se guarda conjuntamente el perfil completo del personaje, el progreso del proyecto y el recibo terminal. Se conserva el contrato A1a: un material por solicitud, cantidad efectiva limitada al remanente, financiación exclusivamente desde `eco.pack.goods`, revisión optimista de ambos estados y requisitos de obra inmutables. No añade recetas, premios, precios o costes de gameplay.

## Identidad y autoridad

Los personajes y proyectos se identifican por mundo, época y su ID. `operationId` es único entre todos los aportes de este backend, incluso entre mundos/épocas. El namespace de recibos es independiente de las familias M5/Web3 actuales; su convivencia no acredita un namespace único entre todas esas familias.

Estas tablas **no son todavía el perfil autoritativo del juego**. No se copia ni importa `mn_profiles`; los baselines del fixture se inicializan mediante RPC de servidor. Una inicialización exacta puede repetirse; un baseline distinto obtiene conflicto y no reemplaza filas existentes. `service_role` tiene lectura, sin DML directo. Las únicas escrituras disponibles a ese rol son RPC `SECURITY DEFINER`, cualificados y con `search_path` vacío. RLS y revocación de acceso mantienen perfiles/recibos privados frente a `anon`/`authenticated`.

Antes de montar este backend se necesita A1b2: resolver la cuenta a personaje/mundo/época admitidos, coordinar o reemplazar el guardado M5 y reservar/fencear el personaje durante el aporte. Los guardados actuales de `ProfileSessions` no conocen estas filas; conectar ambos sistemas sin esa coordinación dejaría dos autoridades para una misma mochila. También faltan autorización y proximidad al receptor, bootstrap del mundo y comprobación de prerrequisitos de arranque.

## Transacción y recuperación

Se exige `READ COMMITTED`. Orden de locks: UUID de operación, personaje delimitado por mundo/época, proyecto delimitado por mundo/época y filas. Los locks advisory cubren también filas ausentes y la inicialización. El commit vuelve a leer los baselines después de adquirir los locks y compara ambas revisiones antes de calcular el delta.

Débito, crédito, revisiones y recibo se escriben en una transacción. Un fallo SQL aborta todo; no se atrapa como un rechazo de negocio ni deja recibo provisional. Rechazos válidos, incluidos falta de bienes, conflicto o filas ausentes, sí se registran como resultados terminales. El replay idéntico devuelve el resultado original con `replay:true`, aunque después cambien los estados. Reutilizar el UUID con otro request devuelve `why:'operation'` y conserva el recibo anterior.

El adaptador acota el tiempo de RPC, valida formas/identidades/revisiones de las respuestas y no reintenta automáticamente. Un fallo de transporte o timeout produce `ContributionError('unavailable')`: no acredita que el commit fallara. El caller puede consultar `{request,result}` por UUID o reintentar exactamente el request original. Antes de publicar estado en una sesión viva deberá comparar las revisiones con las filas actuales; un recibo histórico no es un snapshot nuevo.

El catálogo SQL refleja `src/data/goods.js`; una prueba compara ambos catálogos y obliga a actualizarlos juntos. El límite de perfil es 128 KiB; SQL cuenta JSON compacto sin eliminar espacios dentro de strings. La representación numérica JSONB puede diferir de `JSON.stringify` cerca de ese límite; no se acredita igualdad exacta del conteo para cualquier número. Ambos stores rechazan sin mutar si crecer un dígito de `tradeRev` rebasa el techo del perfil resultante.

## Aceptación local

- Conservación de todos los campos ajenos al aporte, débito/crédito iguales y cantidades limitadas al remanente.
- CAS, rechazo terminal, replay histórico, colisión de UUID, aislamiento por mundo/época e inicialización sin sobrescritura.
- Validación SQL ante llamadas directas, incluyendo enteros JSON `4.0`; paridad de bienes conocidos y materiales aportables.
- RLS/ACLs de tablas y funciones; respuestas SDK inválidas rechazadas y timeout sin reintento.
- Inyección de fallos después del débito y al insertar el recibo, con rollback completo y mismo ID todavía retryable.
- Cierre del backend local, reapertura desde otro proceso Node, consulta del recibo y replay sin segundo cobro.
- Respuesta SDK perdida después del commit, recuperación del recibo y reintento exacto sin duplicación.
- Convivencia con SQL001–013 y reaplicación de la migración opcional preservando datos/recibos.

PGlite serializa las llamadas concurrentes del fixture. Esa prueba demuestra resultados optimistas y conservación, pero no scheduling/deadlocks entre conexiones PostgreSQL reales, failover o resistencia a corte eléctrico. La prueba de proceso usa un cierre limpio antes de reabrir. Supabase live y autoridad M5 integrada quedan pendientes.

## Reutilización

No requiere arte. Se contrastó el [inventario Survival](../research/unreal-assets/survival/FINDINGS.md): `SM_RepairBench`/`BP_Building_Bench` y `SM_StoragePart_03`/`BP_LootBox` son candidatos visuales; no proporcionan persistencia web ni una transacción de inventario. Para el montaje posterior permanecen disponibles el banco procedural S19/S14 y la caja ya registrada. No se importan assets ni se modifican fuentes Unreal.
