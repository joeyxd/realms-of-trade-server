# Traspaso: cómo seguir con MAREA NEGRA

Para quien retome el proyecto (persona o modelo). Leer `AGENTS.md` y esto primero, luego `PLAN-DELIVERY.md`
(orden operativo de juego + assets + agentes), `DESIGN.md` y el `PLAN-M*.md` del milestone en curso.

## 1. Qué es y sus reglas

- Action-RPG isométrico / bullet hell para navegador, **Three.js 0.160** desde CDN, sin bundler. Interfaz y textos
  en **español**; comentarios de código en **inglés**, con el estilo de los que ya hay (qué hace y por qué, en
  prosa, sin relleno).
- **Servidor autoritativo**: `LocalServer` (`src/net/localServer.js`) corre el mundo; en solo vive en un Web Worker,
  en línea dentro de `server/index.mjs` (WebSocket). El cliente predice solo al jugador (`PLAYER_FIELDS` en
  `src/sim/ecs.js`) y reconcilia.
- **Determinismo**: la simulación (`src/sim/**`) no usa `Math.random` ni el reloj; usa `world.rng` / semillas
  (`mulberry32`). Lo que toca balas hostiles va en `stepPlayerCombat` al tick del comando (`pt`); los golpes a
  enemigos son del servidor (`world.*Hits`, `historyAt`).
- **Eventos privados**: `world.emit({ type, to: e, … })`. Los que deben guardar la partida al instante van en
  `SAVE_NOW` (`src/net/saves.js`).
- **Perfil** (lo que se guarda, firmado en el navegador): `newProfile` / `sanitizeProfile` en
  `src/sim/systems/inventory.js`. Todo campo nuevo necesita su valor por defecto y su saneado.
- `PROTOCOL_VERSION` (`src/net/protocol.js`) sube cuando cambia lo que se manda en el snapshot o en `you`.
- **Procedural + assets**: base procedural con fallback; cajas estáticas ya usan un modelo Dreamrise. Las piezas compatibles se pueden cambiar por un `.glb`
  (`docs/ASSETS.md`).

## 2. Mapa del repo

```
src/core      bucle, entrada, ajustes, matemáticas, rng
src/data      números y contenido (tuning, armas, tatuajes, enemigos, objetos, misiones, mercancías, pueblos,
              barcos, piezas de balsa, edificios)
src/sim       ECS, mundo, generación del mapa, sistemas (movimiento, combate, habilidades, enemigos, jefe,
              inventario, misiones, comercio), economía (mercados, bodegas, viajes, balsa, solares)
src/net       protocolo, LocalServer, transporte (worker / WebSocket), partidas guardadas
src/client    gameClient (predicción, interpolación)
src/render    escena, pipeline (tinta, bloom, agua), toon, personajes, props, vegetación, VFX, assets externos
src/ui        HUD, paneles, diálogo, mapa, cómic, táctil, título, pausa
server/       servidor Node (estáticos + WebSocket + partidas firmadas)
tools/        build-artifact, look (capturas), import-asset, playtest, nettest, progress, botbrain…
tests/        node --test (regresión y contratos de simulación, red y almacenamiento)
docs/         ASSETS, DEPLOY, HANDOFF y los briefs de trabajo (docs/briefs)
deploy/       systemd, Caddy, env de ejemplo, script de actualización
```

## 3. Estado (2026-10-05)

Prueba desde el PC: [lanzador y evidencia](delivery/pc-host-playtest.md). `JUGAR-CON-AMIGOS.cmd` levanta el
host 5173 y un túnel HTTPS; en este equipo usa ngrok ya configurado. `DETENER-JUEGO.cmd` apaga con flush.
15/15 pruebas pertinentes; dos invitados y movimiento compartido comprobados por HTTPS/WSS público.
Servidor encendido al aceptar; la URL actual está en `URL-PARA-AMIGOS.txt` ignorado. Cada jugador usa su GPU;
recorrido humano con el amigo/FPS físicos siguen pendientes. Sin cambiar protocolo ni cerrar D04 P2.

| Milestone | Estado |
|---|---|
| M1 … M4.6 | ✅ (ver `DESIGN.md` §16) |
| **M4.7 «Tatuajes»** | ✅ (cómic Ultra, huecos Q/E, los tres tatuajes, apuntar y VFX, pestaña y Doña Sepia) |
| M4.8 «Perlas negras» | **rc.1**: kit pulido y probado; aceptación física y publicación pendientes (`PLAN-M4.8.md`) |
| M5 mundo persistente (Supabase) | **P1–P3 + base D09a–e y D09f-2b.2 server-only**: 003/004/005 reales; diario, gate común, CAS same-holder y staging give/swallow/ECS en tick, 356/356 aisladas. 006 real, lotes, efecto común/hooks/restauración/adopción/leases y publicación abiertos (`PLAN-M5.md`) |
| M6 «La Balsa» | **P1–P3 + P4 bodega/producción local**: red/parrilla y fracciones guardadas; agua/hamaca/luces, dispositivos y publicación pendientes (`PLAN-M6.md`) |
| M7 comercio | **P1–P2 local**: mercaderes Aldea/Cala, panel con cotización/compra/venta; iconos por bien/muerte/rumores/balance regional/publicación pendientes (`PLAN-M7.md`) |
| M8 construcción en pueblos | núcleo de solares hecho; plan (`PLAN-M8.md`) |
| Assets externos | ✅ (`docs/ASSETS.md`) |
| Jugar en línea en un servidor propio | ✅ (`docs/DEPLOY.md`) |

### Línea extra de baja prioridad — personajes con LLM (2026-10-05)

- Dirección del autor documentada en [PLAN-EXTRA-LLM](../PLAN-EXTRA-LLM.md): LLM para objetivos/táctica,
  cuerpo programado con modos y acciones directas, feedback textual, memoria y exploración de tokens propios.
- Cola aparte **L00–L06**, incremental/en paralelo cuando haya capacidad; no desplaza D06/D08/D09.
  Primero contrato y cliente sin gráficos en instancia aislada; BYOK, convivencia económica/PvP y
  servicio comercial son fases posteriores. Reglas numéricas, autonomía offline y cobros siguen abiertos.
- Solo planificación y enlaces revisados; implementación/pruebas de juego/publicación pendientes.
  La propuesta de diferenciación/ingresos es una hipótesis con precedentes y métricas de piloto en el plan.
  Próximo paso propio: L00 al asignarlo; la siguiente entrega principal conserva su estado actual.

### D08a — bahía de manejo aislada (2026-10-05)

- Fuente `eab3e5c`; laboratorio local independiente en `PROBAR-NAVEGACION.cmd` / puerto 5180.
  [Brief](briefs/d08a-handling-lab.md), [entrega y evidencia](delivery/d08a-handling-lab.md).
  No activa pilotaje en partida ni accede a perfiles/bienes; versión/protocolo alpha.4/16 conservados.
- Cuerpo agregado determinista a 60 Hz, inercia/drag/freno/timón, lastre centrado/periférico/alto y casa 4 × 4;
  cuatro vientos constantes, ayuda de remo en calma. Soltar lastre conserva pose/movimiento del casco.
  W/S/A/D, controles táctiles y mando estándar; pausa/blur limpian entradas. Coeficientes experimentales.
- **26/26 propias; 695/695 regresión** en 72 archivos fijados al commit. 20 comparaciones;
  el mismo peso en extremos alarga el giro frente al centro. 30/60/120 FPS dan los mismos ticks/resultados
  dentro del presupuesto, sin afirmar FPS físicos. Fuente Unreal intacta; atlas/crate/agua reutilizados.
- **Aceptación visual pendiente:** Chrome seguía bloqueado por revisión automática/límite de uso; sin
  nuevas capturas, sin eludir bloqueo. Selección real de atlas y desktop/táctil/GPU físicos no aceptados.
- **Siguiente:** resolver revisión y cerrar móvil D06b; revisar bahía y sensación humana, ajustar valores;
  después corte de autoridad/predicción/cubierta móvil. D09 antes de riesgo persistente; D08 completo abierto.

### D06b — primera producción de la balsa (2026-10-05)

- Fuente `5b253a4`; **0.6.0-alpha.4 / protocolo 16**. Red/parrilla en editor de nueve piezas;
  H/Bodega → Producción. Trabajo por módulo, reloj autoritativo, espera de ingredientes/espacio y lote completo.
  Fracciones guardadas; retirar no traslada progreso a otra pieza. Preflight de todo el tick antes de mutar.
  Restaurar el mundo en GameHost conserva tanto producción como cobro de mantenimiento.
- [Contrato](briefs/d06b-production.md), [entrega/evidencia](delivery/d06b-production.md).
  16 pruebas nuevas; regresión **547/547 sobre commit aislado**. Escritorio aceptado en software con
  12 capturas inspeccionadas; móvil horizontal/vertical pendiente por límite de revisión automática de Chrome.
- [Revisión Unreal/FAB previa](research/unreal-assets/D06B-REUSE.md): modelos/atlas existentes; banco
  Dreamrise aplazado. Sin nuevas texturas ni cambios en fuentes. Revisiones privadas conservan mallas GPU.
  Atlas 1024 escritorio / 512 móvil; aceptación visual móvil D06b, FPS y dispositivos físicos pendientes.
- Solo red/parrilla en balsas primarias conectadas y amarradas en Aldea. Motor antiguo inactivo;
  agua/huertos, hamaca/reaparición y luces abiertos. Sin producción offline ni custodia durable de carga.
- **Siguiente: cerrar móvil D06b**, luego [D08 bahía de manejo](briefs/d08-navigation-feel.md), Unreal primero;
  aceleración, frenado/giro y comparaciones de peso/carga. Tier/skill/viento/balance aún por prototipar y decidir.
  Build local verificado desde el commit; host/publicación sin actualizar. Cliente/servidor deben subir juntos a 16.

### D06a — bodega y mercados caminables (2026-10-05)

- Base D05 `991db89`, integrada sobre M5 `cfb494b`; fuente aceptada `bcd0886`; **`0.6.0-alpha.3`, protocolo 15**.
  [Informe](delivery/d06a-cargo-market.md), [evidencia durable](delivery/d06a-evidence.json).
- Don Bacalao en Aldea y La Tuerta en Cala: hablar → Comerciar mercancías → lista/cotización/compra/venta.
  Total y stock reales del servidor, oro/mochila visibles. H/botón Bodega junto a balsa propia amarrada
  transfiere mochila↔bodega por peso; G conserva perla, B construcción, I inventario, Esc cerrar.
- Propiedad, ubicación, vida/calma, revisión, stock/oro/capacidad y save candidato se validan antes de mutar.
  Acuse privado + perfil confirmado; cierre/reapertura conserva pendiente. Recibos exitosos acotados de sesión
  permiten reenvío exacto sin otro cobro. No son transacción durable mercado/perfil ni reserva de puerto D09.
- **8 pruebas nuevas**, **493/493** sobre árbol commiteado `bcd0886` aislado;
  **45 capturas inspeccionadas** PC/táctil horizontal/vertical. Compras/venta/transferencias por controles,
  bodega llena bloqueada, save/reentrada exactos y primera respuesta de compra perdida/reintentada en PC.
  Atlas realmente cargado 1024 escritorio/512 móvil; sin textura/modelo nuevo ni errores JS de juego.
- Revisión previa Unreal/FAB con Luna: [D06-REUSE](research/unreal-assets/D06-REUSE.md). Caja Dreamrise
  existente reutilizada; mercaderes con looks actuales. Iconos/UMG/audio empaquetados, no exportados.
  Fuentes intactas; regla de comprobar candidatos antes de cada nueva parte persistida en AGENTS.md.
- **Siguiente exacto: [D06b producción](briefs/d06b-production.md)**. Revisar/exportar mínimamente
  `SM_RepairBench` si encaja; una cadena pequeña, progreso fraccionario/identidad de piezas y lote atómico
  con bodega llena antes de activar reloj. Después D08 manejo. M6 P4 sigue parcial; per-good icons, hamaca,
  luces, viento/zarpar/combate/pérdidas y reservas durables siguen abiertos.
- Build desde commit y hashes en evidencia; host/publicación sin actualizar. Para jugar online actualizar
  cliente y servidor juntos a **15**. GPU/teléfono/mando físicos, FPS y sensación humana pendientes.

### D05 / M6 P3 — construir la balsa (2026-10-05)

- Base `15bfb44`, integrada sobre M5 sesiones `12a6854`; **`0.6.0-alpha.2`, protocolo 14**.
  [Informe](delivery/d05-raft-editor.md), [registro durable](delivery/d05-evidence.json).
- Editor B/botón táctil, R rotación contextual, I inventario y Esc cerrar. Siete piezas, fantasma, nivel,
  orientación, costes y retirada explícita; comandos privados con revisión/UUID, acuse y snapshots antes de desbloquear.
- Materiales bodega→mochila; compras de madera/hierro al precio/stock de Aldea con oro real. Devolución mitad
  sin pérdida, capacidad recalculada al poner/quitar cajas. Guardado y amarre se conservan al reentrar.
- Protección de soporte, ocupantes, aterrizajes, salida y pasarela; no invadir muelle/otra balsa. Techo técnico
  de 600 piezas para respetar saneado y preflight de guardado firmado 32 KiB; no es presupuesto móvil medido.
- **413/413** regresión, 12 pruebas nuevas y 24 capturas PC/móvil horizontal/vertical inspeccionadas.
  Worker normal, compras/colocación/retirada por UI; error de predicción 0 en muestras, atlas 1024/512.
  Fixtures aislados: starter intacta y oro QA; 19 madera compradas, siete piezas añadidas y una caja retirada.
- No se reinició/publicó el host ni se alteró una partida online. **Actualizar cliente y servidor juntos a 14**
  antes de usar el editor en línea. Teléfono/GPU físicos y sensación humana pendientes.
- **Siguiente D06**: bodega/transferencias, producción y mercaderes; banco Dreamrise como candidato acotado.
  Después [bahía D08](briefs/d08-navigation-feel.md), carga/giro/materiales/navegación; viento y balance siguen abiertos.

### D04 P2 — cubierta transitable (2026-10-05)

- Base inicial `6402462`, integrada sobre D09a `d028a42`; `0.6.0-alpha.1`, protocolo 13 conservado.
  [Informe](delivery/d04p2-raft-walk.md), [registro durable](delivery/d04p2-evidence.json).
- `RaftDeck` compila soporte/bloqueos por plano y pose; autoridad/predicción usan las mismas consultas.
  Pasarela real en amarres adyacentes, pisos/escaleras en cuatro direcciones, pared/puerta cerrada/barandilla,
  marcha/dash y aterrizaje Abordaje. Geometría instalada antes del replay; corrección Y y snapshots antiguos probados.
- **383/383** regresión acotada, 14 pruebas nuevas, 18 capturas PC/móvil emulado inspeccionadas; entradas reales
  WASD/Space y joystick/Dash. Error de predicción 0 en muestras; atlas cargado 1024 PC/512 móvil.
- Desconexión del dueño durante Abordaje hacia su balsa rescata al visitante incluso si está en vuelo sobre agua;
  no se usan destinos de salto obsoletos mientras otra habilidad está activa.
- No se reinició/publicó el host activo ni se alteró una partida online. Plano QA aislado de 17 piezas;
  starter sigue 2×2 + vela + caja. Móvil físico/FPS y sensación humana pendientes.
- Límites: amarres remotos berth 2+ sin pasarela, puerta aún cerrada sin interacción, escalas/muebles/combate
  entre alturas y plataformas móviles fuera del corte. No afirmar navegación ni editor por estas capturas.
- Assets Unreal revisados: caja ya usada en balsa; banco candidato D06, hut prefab M8 y Blueprint de martillo
  como referencia UX. No apareció un kit modular listo, no hubo nueva importación ni modificación de fuentes.
- **[Siguiente D05 / M6 P3](briefs/d05-raft-editor.md)**: editor con fantasma/rotación y comandos autoritativos, costes reales/propiedad/
  revisión/soporte/ocupantes seguros, teclado/táctil y persistencia. Después D06 y
  [bahía D08 propuesta](briefs/d08-navigation-feel.md); reglas finales de carga/tier/viento siguen abiertas.

### M4.7 terminado (lo que queda abierto)

1. **P3** (sim de los tatuajes) ✅: los tres tatuajes y sus formas se lanzan, golpean, borran balas y se predicen
   (`tests/tattoos2.test.mjs`). Eventos para el render: `cast` (el del salto con `x0, z0, x1, z1, air, h, form`),
   `slam {x, z, r, form}`, `blink`, `tromba {x, z, tick, r, form, n}` (n 0 la primera, 1 la gemela), `trombaHit`,
   `trombaEnd`, `wheel {x, z, dx, dz, v0, R, r, k, hang, tick, form, slot}`, `wheelBack`, `wheelCatch`,
   `wheelDrop`; la posición del timón en vuelo está en `ecs.whX / whZ` (y `wheelOut()` para la ida).
2. **P4 + P5** (cliente) ✅: apuntado tipo MOBA, VFX, animación, iconos, sonido, pestaña Tatuajes y Doña Sepia.
3. **P1**: el autor revisa el cómic Ultra y manda ajustes.
4. **P6** ✅: versión `0.4.7-m4.7`, protocolo 7, README / DESIGN, artefacto.

Después: M4.8 (perlas), y la estructura (M6 balsa → M7 comercio → M5 persistencia → M8), en el orden que decida el
autor.

### M5 P4/P6 — diario y recuperación D09e (2026-10-05)

- Base `c6bc368`. [Brief](briefs/m5-pearl-journal.md), [informe](delivery/d09e-pearl-journal.md).
- Diario opcional memoria/Supabase conserva solicitud concreta/familia/UUID/scope antes del RPC de perla;
  terminales inmutables y reservas recargadas de cuentas/UID/UUID antes de admitir tras scan completo.
- Startup/reconcile leen recibo y perfiles/ledger/ubicación actuales; exacto cierra committed, avance conflict
  sin publicar historia, desconocido mantiene reserva. Reanudación explícita manda una sola solicitud guardada,
  nunca builder/UUID nuevo. Fallo de cierre del diario retiene reserva; snapshots perdidos no se reproducen.
- **005 aplicada por el autor y verificada real: 21/21 checks**; procesos independientes de ProfileSessions,
  venta recuperada sin otro envío y request pendiente reanudado una vez con UUID original. Fixtures de juego
  limpiadas; cuatro filas terminales de auditoría retenidas. [Verificación](delivery/d09e-journal-live.md).
  No cambia env ni activa el diario/operaciones en host/juego,
  sim/cliente/protocolo/editor/comercio permanecen con D06; no inicio/reinicio/publicación del host.
- Prueba de cuatro procesos Node/PGlite independientes: venta confirmada recuperada sin envío y mint preparado
  reanudado una vez. Regresión/evidencia consolidada en informe; no demuestra leases/concurrencia multi-host.
- Siguiente preparado: [D09f](briefs/m5-pearl-game-staging.md), transferencia de un UID gestionado entre
  cuentas en aislamiento, staging antes de mutación/ack coordinado con dueño D06b. Slot swap y death/reemplazo
  de varios UIDs requieren otro contrato; startup/restauración/reloj/adopción/invitados preceden activación.
  P4/P6 siguen parciales.

### M5 P4/P6 — primer coordinador de staging D09f-1 (2026-10-05)

- Base de aceptación `1b5c2fa`; solo `server/pearlStaging.mjs` y pruebas nuevos, archivos D06b intactos.
  [Brief](briefs/m5-pearl-game-staging.md), [contrato/evidencia](delivery/d09f-pearl-staging.md).
- Una entrega give entre cuentas/UID ya gestionado: reglas actuales en vista separada, UUID server-only,
  CAS/diario fuera del tick y cero efectos de juego antes de confirmar. Reserva propia persiste después
  de liberar cola de storage; snapshots diferidos, delta de perla aplicado al progreso actual una vez.
- `drain()` síncrono antes de eventos/snapshots; identidad de sesión/perfil/ECS.clientId, vida y versión
  confirmada verificadas. Close/death/recycle/bypass/error cercan cuentas/UID; reconcile no dispara apply tardío.
- **184/184** pruebas pertinentes en archivo de Git aislado, incluidas **38 nuevas**. Revisión Luna de solo
  lectura aceptada por principal. Reinicio probado con nuevas sesiones sobre memoria, sin proceso de host real.
- No SQL nueva, env, Supabase live adicional, inicio/reinicio/publicación de host ni cambio de protocolo/UI.
  Coordinador sin importación en host/LocalServer; full gate aún pendiente y P4/P6 parciales.
- **Siguiente D09f-2**: acordar parche con dueño de LocalServer/sim para puerta común de mutaciones,
  snapshots y lifecycle; CAS same-holder/lotes death/reemplazo, hidratación/reloj/adopción antes de activar.
  Nunca activar solo give mientras las otras rutas sigan saltándose la reserva.

### M5 P4/P6 — reserva común de autoridad D09f-2a (2026-10-05)

- Base `0e82162`; [contrato/evidencia](delivery/d09f-mutation-gate.md),
  [hooks concretos del siguiente parche](briefs/m5-pearl-common-gate.md).
- Un gate por ProfileSessions reserva conjuntos completos de cuentas/UIDs con handles opacos. Staging,
  admisión/guardados y ambos commits de sesiones lo consultan; bypass se rechaza antes del dispatch.
  Close/fail/release invalidan antes de identidad/callbacks; prepare y resume revalidan permiso antes de envío.
- Snapshot directo durante apply gap ya no despacha escritura. Perfil publicado espera mediante
  `assertPublishable`; progreso propio diferido y apply en tick siguen conservados.
- **80/80** pruebas enfocadas y **226/226** pertinentes, **42 nuevas**; árbol Git aislado sin env.
  No SQL/env nueva, live adicional, inicio/reinicio/publicación del host ni cambio de protocolo/UI.
  LocalServer/sim/host sin hooks ni activación; trabajo gameplay del otro dueño intacto.
- **Siguiente D09f-2b:** único escritor de hooks, CAS same-holder/lotes death/reemplazo y restauración de
  World/reloj/adopción/invitados. Una reserva multi-UID no es transacción SQL de lote. P4/P6 siguen parciales.

### M5 P4/P6 — CAS same-holder de un UID D09f-2b.1 (2026-10-05)

- Base `0ec0b9d`; [brief](briefs/m5-pearl-same-holder.md), [contrato/evidencia](delivery/d09f-same-holder.md).
- Ground admite from=to para un UID bag→swallowed vacío; un perfil CAS, conservación exacta del resto,
  generaciones de perfil/ledger/tombstone y recibo juntos, mismo dueño/since/mundo. Sin 003 child receipt.
- Cola deduplica cuenta en admisión/reserva/recuperación; permiso común, requests congelados, diario y
  rebase de progreso reutilizados. Recibo histórico no revierte estado ni habilita apply tardío.
- **306/306** pertinentes, **80 nuevas**, Git archive aislado; seis procesos Node/PGlite prueban recibo
  confirmado recuperado sin send y request preparado reanudado una vez con UUID/payload original.
- **006 nueva: aplicar después de 005; verificación Supabase pendiente.** No nuevo env ni cambio a SQL
  003/004/005 aplicadas. Pruebas de SDK/SQL locales, sin credenciales, host, browser ni publicación.
- D08/sim/LocalServer/entrypoints/UI/protocolo del otro dueño intactos. Storage no aplica cooldowns/stats
  ni elegibilidad de combate. Siguiente staging ECS, lote real death/reemplazo y hooks/hidratación/políticas
  del brief común con un escritor por archivo. P4/P6 siguen parciales; no activar give o swallow aislados.

### M5 P4/P6 — staging swallow/ECS en tick D09f-2b.2 (2026-10-05)

- Base `d7398d8`; [brief](briefs/m5-pearl-swallow-staging.md), [contrato/evidencia](delivery/d09f-swallow-staging.md).
- Preflight usa `swallowPearl` real sobre perfil/fila ECS separados, un UID gestionado y swallowed vacío.
  Cola/diario ground confirman fuera del tick; reserva común persiste hasta apply/fence. Sin nueva SQL/env.
- `drain()` aplica solo delta pearls al progreso vivo y efecto actual G/cooldown/agua/`refreshStats`; no
  copia ECS preflight. HP/gear/mastery/movimiento/combate actuales conservados, evento privado postelem una vez.
- Error de apply/enqueue/publicación revierte solo cambios locales tentativos y cerca; SQL se conserva.
  Close/death/revival/recycle y bypass invalidan; reconciliación no aplica ni publica historia.
- **356/356** pertinentes, **50 nuevas**, 23 archivos aislados. Memoria y SDK/SQL006; autoridad nueva
  carga swallowed/elem sin evento ni send. Es reconstrucción de test, no restart real de GameHost.
- **006 aún pendiente de confirmación/verificación Supabase**; no live, host/reinicio/publicación ni
  cambios sim/LocalServer/naval/cliente/protocolo del otro dueño. Reset/refresh comparados con helper real
  para cuatro kinds; extraer efecto común con dueño sim al integrar, antes de cambiar sus reglas.
- Siguiente lote real multi-UID death/reemplazo y hooks completos/hidratación/scope/reloj/adopción/invitados;
  leases/naval separados. P4/P6 parciales; no activar solo give/swallow.

### M5 P4/P6 — cola de suelo y SQL real D09d (2026-10-05)

- Base `018a177`. [Brief](briefs/m5-pearl-ground-queue.md), [informe](delivery/d09d-pearl-ground-queue.md).
- **159/159** pruebas pertinentes en árbol confirmado `018a177` más cuatro archivos propios; diez nuevas
  también pasaron en checkout compartido. Aísla cambios D06 activos, sin aceptar su regresión/visual.
- Autor confirmó 004 aplicada; probe RPC/RLS real **5/5**, canario SQL/SDK **10/10**, cola SDK real **7/7**.
  Perfiles/UIDs/recibos temporales limpiados y ausencia verificada; no consultas a jugadores existentes.
- `commitPearlGround(meta,build)` comparte cuentas/UID/UUID con familia 003 y congela mundo/ground antes de
  awaits. Builder una vez, máximo dos envíos idénticos, fuente validada y saves posteriores rebasados.
- `reconcilePearlGround(UUID)` solo lee su recibo/perfiles/UID/ubicación. Recibo ausente/diferente/malformado o
  lectura fallida conserva reservas; estado posterior rechaza el resultado histórico. Ground-only participa
  en flush y sus errores permanecen contabilizados durante la instancia, incluso después de reconciliar.
- No nueva SQL/env ni cambios de sim/cliente/protocolo/editor, host reiniciado o publicación. D06 conserva
  sus archivos. Reservas/intenciones siguen en memoria: diario durable tras restart es el siguiente corte,
  seguido de staging previo a efectos/acks, reloj/restauración y política de adopción/invitados. P4/P6 parciales.

### M5 P4/P6 — ubicación durable D09c (2026-10-05)

- Base M5 `12a6854`, integrada sobre editor D05 `991db89`; `0.6.0-alpha.2`, protocolo 14 conservados.
  [Brief](briefs/m5-pearl-ground.md), [informe](delivery/d09c-pearl-ground.md).
- `commitPearlGround` confirma perfiles CAS, UID/generación, posición/tiempos y recibos juntos; mint/relocación
  sin cuentas. Lecturas de ubicación, listado paginado por mundo/UID y recibo por UUID solo del servicio.
- Tombstone al estar en perfil; mundo estable y generaciones coincidentes. Replay histórico sin mutar;
  UUID compartido entre familias 003/004; guardias diferidas impiden usar la RPC antigua o saves para perder suelo.
- **149/149** pruebas pertinentes (132 previas + 17 nuevas), PostgreSQL/SDK locales y revisión Luna aceptada
  por el principal. RLS, rollback de perfiles/ledger/suelo/recibos, replay histórico y guardias raw verificados.
  **70/70** del subconjunto sobre fuentes M5 `12a6854` más este corte prueban independencia del editor D05.
- Al aceptar D09c, **004 nueva pendiente de aplicar/verificar en Supabase**; D09d registra su verificación arriba.
  No se reinició/publicó el host
  ni se cambió cliente/sim/editor. Este corte es almacenamiento local, no acepta persistencia de suelo en juego.
- Próximo corte: aplicar/verificar 004 con fixtures, ampliar cola/reconciliación para ubicación y acordar seam
  previo a mutación/ack con dueño de LocalServer. Retener UUIDs tras restart, restaurar suelo y cerrar adopción/
  invitados antes de activar circulación. Reloj/expiración offline y leases siguen pendientes.

### M5 P4/P6 — cola y reconciliación D09b (2026-10-05)

- Base D09a `d028a42`, integrada sobre cubierta `15bfb44`; `0.6.0-alpha.1`, protocolo 13 conservados.
  [Brief](briefs/m5-pearl-session-queue.md), [contrato y evidencia](delivery/d09b-pearl-sessions.md).
- Autor aplicó 001/002/003. Probe real 5/5 + canario SQL/SDK 9/9 + coordinador 6/6: contendientes HTTP,
  transferencia, venta con dos replies perdidas, progreso posterior preservado y reconexión. Solo fixtures
  temporales nuevos; todos eliminados y ausencia verificada. Sin leer/modificar jugadores existentes.
- `ProfileSessions.commitPearl(meta, build)` ordena save→operación→save y reserva UID/cuentas; builder puro
  ejecutado una vez, request congelado/reintento exacto. No emite ack ni modifica la simulación viva.
  Join valida kind/dueño de UIDs registrados; ausentes siguen sin adoptar. Error de lectura bloquea WELCOME.
- Doble respuesta ambigua sin recibo mantiene las reservas incluso tras close. `reconcilePearl` hace lecturas
  acotadas, compara payload/perfiles/UID y no reenvía mutaciones ni reaplica recibos viejos. Leer solo el recibo
  no libera una reserva si las lecturas de estado fallan. Errores/flush
  permanecen cercados; leases y recuperación entre procesos aún pendientes.
- Próximo corte M5: seam de staging/ack previo a la mutación de sim, adopción/cuarentena de raras existentes,
  invitados, pickups/death y suelo/expiración durables. No activar circulación gestionada con esta base sola.
  Legendarias, retorno por inactividad/cartel y transacciones navales pendientes; P4/P6 siguen parciales.
- **109/109 pruebas pertinentes**, 18 nuevas; subconjunto 45/45 en base confirmada `15bfb44` aislada + misión,
  sin depender de cambios del editor ajenos. Logs `shots/review/m5-pearl-sessions-*.log`; revisión Luna cerrada.
- Host actual consultado solo por HTTP: health/status/página 200, mundo ready y cero errores. Sin reinicio/push/
  despliegue. Otro responsable sigue con editor D05; sus archivos y cambios se conservan.

### M5 P4/P6 — base atómica de perlas D09a (2026-10-05)

- Base `6402462`, versión `0.6.0-alpha.1` y protocolo 13 conservados. [Contrato y evidencia](delivery/d09a-pearl-operations.md).
- `server/pearlOperations.mjs` + `store.commitPearl`: CAS de perfiles y UID, conservación de otras perlas,
  perfil/ledger/recibo confirmados juntos. Repetir mismo UUID/payload devuelve el recibo sin repetir oro;
  UUID reutilizado con otro contenido falla. `loadUnique` consulta dueño/generación. Solo servidor.
- SQL 003 añade recibos RLS, locks ordenados por filas/UID y guardia de propiedad diferida. Perfil guardado o
  importado no puede contradecir una perla registrada; los locks por UID cubren su primera creación.
  Memoria conserva el contrato, sin durabilidad. Primitivas únicas P1 independientes no alteran `pearl:*`.
- Al aceptar D09a, **003 estaba pendiente**. El autor la aplicó y D09b la verificó arriba; el juego aún no
  llama a esta operación. [Archivo](../server/migrations/003_pearl_operations.sql). Host no reiniciado.
- **91/91 pruebas pertinentes**: 77 de cuentas/store/SQL/mundo/economía y 14 nuevas de perlas, incluyendo
  respuesta perdida y rollback después de mutar un perfil. Host activo health 200 y cero errores. PGlite no
  acredita conexiones independientes reales; SQL exige `READ COMMITTED`. Logs `shots/review/m5-pearl-*.log`.
- Pendientes al aceptar D09a: aplicar/verificar 003 y preparar cola/ack + reconciliación al entrar, con política explícita de
  backfill/adopción/collisiones de raras existentes e invitados. Suelo/expiración durable, legendarias, regreso
  por inactividad, cartel, leases y transacciones navales siguen abiertos. P4/P6 no se marcan terminados.
- Trabajo ajeno de cubierta/navegación/host del PC preservado; pruebas y límites detallados en el informe.

### M5 P3 — mundo económico D07d (2026-10-05)

- Base `f0b74a7`, versión `0.6.0-alpha.1` y protocolo 13 conservados. [Contrato y evidencia](delivery/d07d-world.md).
- `server/worldState.mjs` carga/crea antes de escuchar o simular; snapshot económico CAS cada 60 s/cierre.
  Reloj, acumulador, RNG, stocks/tendencia y solares se restauran. Conserva callback de upkeep del host.
- `WORLD_ID=marea-negra` y `WORLD_SAVE_SECONDS=60` en el entrypoint. Memoria conserva el mismo contrato,
  pero no es durable. Un registro incompatible no se reemplaza. Conflicto/error de guardado detiene ticks
  y admisiones, health 503, cierre fallido; nunca recarga para sobrescribir el estado de otra autoridad.
- Canario real con ID temporal: creación, snapshot final, reinicio exacto, siguiente paso determinista,
  conflicto CAS y limpieza verificados. No se tocaron cuentas/mundos existentes ni servidores ya abiertos.
- **79/79 pruebas pertinentes**: 43 cuentas/store/SQL + 34 mundo/economía + 2 red. Host activo consultado:
  Supabase durable, mundo ready y sin errores; logs `shots/review/m5-p3-*.log`. No es regresión de toda la suite.
- Una autoridad por ID. P3 no guarda ECS/combate ni avanza durante downtime; cobro offline, leases y
  atomicidad mundo/perfil permanecen P5/P6. Correo humano y publicación pendientes; P4 únicos es el próximo
  corte de M5, sujeto al contrato duradero de perlas/perfiles antes de activar riesgo público.
- Trabajo ajeno de balsas/assets/host del PC preservado. Preview existente no reiniciado por esta entrega.

### M5 P2 — cuentas e importación D07b (2026-10-05)

Actualización D07c: [dossier de cómic y selector](delivery/d07c-comic-account.md). Login/registro separados,
confirmación/reenvío, teclado/foco, cinco retratos reales y nombre sincronizado con el HELLO. Un perfil de progreso
por cuenta; nombre/aspecto siguen siendo preferencias locales, creador/múltiples personajes posteriores.
43/43 pruebas pertinentes y recorrido desktop/móvil horizontal/vertical sin errores JS. 001/002 aplicadas:
canario real de alta por enlace/OTP, login, RPC denegada al cliente y perfil tras reiniciar, con limpieza del fixture.
Entrega de correo humano, P3 economía y publicación pendientes. Vista previa local en `http://localhost:5173/`.

- Base inicial `da757d3`; integrado sobre `a01294c`, protocolo 13/`0.6.0-alpha.1` de M6 P1 conservados.
  HELLO con token/importación opcionales. [Informe D07b](delivery/d07b-accounts.md).
- Correo/contraseña, registro/confirmación, sesión SDK renovable y cierre local en título online. Worker sin login.
  Configuración pública desde servidor; verificador Auth separado de la clave de servicio. Token inválido no entra
  como invitado. Errores de sesión/almacenamiento/importación tienen mensajes propios y códigos fijos.
- El trio URL/servicio/pública activa cuentas en `npm start`; par sin pública conserva adaptador sin cuentas.
  `.env` local ignorado configurado por el autor; 001/002 aplicadas y tablas/RPCs disponibles.
  Consultas de servicio 200 y acceso público denegado; D07c completa el canario Auth/DB. Sin push ni despliegue.
- Importación opt-in al crear personaje: HMAC e identidad obligatorios; perfil/recibo único se guardan juntos.
  Cuenta existente prevalece, versiones de un legacy no se importan en otra cuenta y dejan de entrar como invitado.
  Reserva de cuenta/legacy de un proceso; leases/concurrencia de conexiones independientes aún pendientes.
- Regresión sobre M6 P1 **321/321 + 2/2 red = 323/323**; CLI memoria/adaptador/cuentas y configuración rechazada comprobados.
  SQL en PGlite/SDK y recorrido Chrome desktop/móvil emulado contra Auth local simulado, sin errores JS de página.
  Capturas `shots/review/m5-accounts/`, logs `m5-p2-*.log`; no certifican Supabase real ni GPU/dispositivos físicos.
- Próximo corte **P3 economía persistente**: carga, autosave y cierre con CAS. Aceptación real de Auth/DB pendiente;
  Google/Discord y recuperación sin UI propia. P4/P6 ledger/transferencias y P5 leases siguen abiertos.

### M5 P1 — base de almacenamiento D07a

- Base `61a34a5`, protocolo 12 y versión cliente `0.4.8-rc.1` conservados. [Informe D07a](delivery/d07a-store.md).
- `server/store.mjs`: memoria y Supabase, CAS de perfiles/mundo y propiedad única por generación.
  `server/migrations/001_store.sql`: RPCs solo para `service_role`, RLS sin permisos de cliente.
- Host con verificador de identidad inyectado: carga antes del HELLO, reserva de cuenta/capacidad, cierre de
  joins cancelados, snapshots aislados, escrituras serializadas y guardado final esperado al cerrar.
  Un conflicto cierra la sesión sin sobrescribir. Las cuentas no reciben blobs reutilizables como anónimos.
- `npm start` selecciona adaptador con `storeFromEnv`, pero aún no tiene verificador/login P2. Sin cuentas
  activas, siguen las partidas firmadas anteriores. Configuración parcial de Supabase falla al arrancar.
- Suite SQL ejecuta la migración en PGlite y usa el SDK con transporte local; verifica permisos y reaplicación.
  No demuestra concurrencia de conexiones independientes ni aceptación de un proyecto real/PostgREST.
- Regresión **296/296 + 2/2 red = 298/298**, instalación limpia y selección CLI memory/Supabase/rechazo
  parcial comprobados. Logs `shots/review/m5-tests.log`, `m5-net.log`, `m5-cli.log`; resumen en D07a.
- P2 cuentas/importación y P3 economía siguen pendientes. P4/P6 aún deben conectar ledger, perfiles y suelo
  mediante transacciones durables; P5 requiere leases entre procesos. P1 no activa legendarias ni pérdidas navales.
- Próximo paso en M5: P2, verificación de token y login con configuración pública/privada separada; después
  aceptación del proyecto real y migración única. D04 sigue preparado para cuando el autor retome construcción.

### M4.8 — candidato P5 (`0.4.8-rc.1`)

- Base `9a76925`; commit de esta entrega: el que incorpora [D03](delivery/d03-pearlkit.md). Paleta compartida,
  partículas y capa de sonido de todo el kit, tanto local como remoto. Timones independientes conservan toon.
- Protocolo **12**: `shot` y `shotEnd` conservan propietario y elemento de salida. Daño/pasiva, rebote, estela e
  impacto diferido lo usan aunque cambie la perla; el servidor corrige predicción, incluido cero. Eventos de ataque
  neutrales declaran cero. La maldición nocturna sigue usando el portador y la hora del impacto.
- Regresión **276/276 sin red + 2/2 de red**. `tests/pearlkit.test.mjs` tiene cinco pruebas con comandos reales de
  arma/artes/tatuajes para las cuatro perlas, balas/reflejos tras escupir, rebote, eco e impacto remoto y base neutral.
- `tools/pearl-balance.mjs` da una muestra determinista de daño y tablas de circulación/control/maldiciones.
  Se conservan los valores actuales: no confundir esa muestra con aceptación de equilibrio competitivo.
- Capturas de paletas en `shots/review/p5-desktop/` (high) y `p5-mobile/` (low). Galería sintética congelada;
  no mide FPS. Chrome + Edge comprobaron disparo/impacto remoto, cancelación G con mando emulado y nube canónica
  compartida en WebSocket local. Compañeros/avisos se separan del reloj. Evidencia en D03 y `p5-online/`.
- Próximo cierre P5: GPU/teléfono/mando físicos y audición del conjunto, después republicar cliente y servidor
  compatibles. El artefacto local se construye desde el commit; no es despliegue. D04 sigue en la cola de entrega;
  M5, afinidad y decisiones navales mantienen su alcance pendiente.

### A02 — primera caja Dreamrise (2026-10-04)

- Aceptación visual local sobre `626beb7` (rc.1/protocolo 12): modelo para los `crate` estáticos mediante el
  consumidor existente. [Informe A02](delivery/a02-crate.md) y JSON con hashes, exportación, capturas y coste.
- Copia de cuatro paquetes, 73.699 B, exportada en proyecto mínimo aislado con UE 5.8/glTF Exporter 1.3.1;
  fuente `C:\Unreal` sin abrir ni guardar. GLB 51.684 B/204 triángulos/una parte, paleta 1024² (~5,33 MiB mipmaps).
- 8/8 tests de assets y `--check` pasaron. Siete pares A/B inspeccionados día/noche/high/low móvil,
  `?noassets`, 404 y archivo roto: fallback intacto, 0 errores de página/juego. Chrome SwiftShader congelado,
  sin acreditar FPS/GPU o dispositivos físicos. No hay nuevos sistemas de bodega ni cambios de colisión.
- Tooling: `stage-a02-crate.ps1` (copia/launcher), `export-a02-crate.py`, `look-prop-canary.mjs`; staging real
  fuera de `.claude` para rutas Unreal. Caché fría SM5 tardó ~28,5 min; registrar RHI explícito en futuras pruebas.
- Próximo corte: [D04 P1 balsa del jugador amarrada, snapshot y renderer; después P2 cubierta](delivery/d04-raft-readiness.md).
  Confirmar base/dueños al empezar; creación/migración única y clave estable antes de editar. Banco sin exportar.
- GPU/teléfono/mando físicos, rendimiento y publicación siguen pendientes. Fuente/caches/proyectos no van al
  bundle; solo manifiesto y GLB final. Continuar PR #1; un commit local no actualiza servidor ni artefacto público.

### Balsa cómic — material y móvil (2026-10-05)

- Prueba de arte sobre D04 P1, solicitada por el autor: madera ámbar/turquesa, hierro oxidado, cuerda y lona
  remendada. Atlas original, UVs semánticas y herrajes/aparejo; la caja FAB se viste sin mutar su fuente.
  [Informe, pruebas y siguiente corte](delivery/raft-comic-material.md), [evidencia](delivery/raft-comic-evidence.json).
- WebP escritorio 1024² / 308.536 B; táctil 512² / 82.878 B. Móvil descarga solo su variante: 97,3 % menos
  que el PNG fuente. Original fuera del bundle; reconstrucción con tools/optimize-raft-texture.mjs.
  La regla de presupuesto móvil queda en AGENTS.md; no confundir estimación de texels con VRAM/FPS medidos.
- 340/340 pruebas sobre cuentas f0b74a7 + material; ocho casos visuales y 26 capturas inspeccionadas:
  día/noche high/low móvil, comparación sin skin, atlas 404/corrupto y noassets; SAVE/reload conserva balsa/bodega.
- Versión 0.6.0-alpha.1 y protocolo 13 conservados. GPU/teléfono físicos y publicación pendientes.
  Próximo corte sigue D04 P2: cubierta/bloqueos/escaleras compartidos entre servidor y predicción;
  no se habilitan navegación, editor ni pérdidas persistentes. Host para amigos tiene otro dueño.

### D04 P1 — balsa propia amarrada (2026-10-05)

- Base `da757d3`, build `0.6.0-alpha.1`, protocolo **13**: cliente/servidor deben actualizarse juntos.
  [Informe D04 P1](delivery/d04p1-raft.md), [brief](briefs/d04p1-moored-raft.md). Rama de continuidad/PR #1 conservados.
- `eco.raftV` concede/migra la starter una sola vez; `eco.id` y barco `id/rev/berth` sobreviven al guardado.
  Grid explícitamente vacío y hp=0 se preservan. Capacidad derivada de las piezas sin borrar carga legacy.
- `src/sim/systems/rafts.js`: vehículo ECS autoritativo, amarre validado dentro del mapa, primera balsa operativa
  en Aldea por perfil conectado. Al salir se retira la vista; guardado conserva barco/carga y amarre preferido.
- Snapshot completo público `rafts`: blueprint/pose/aspecto y entidad del propietario; sin bodega, eco.id ni cuenta.
  Cliente ignora listas antiguas; renderer no reconstruye snapshots iguales y limpia las bajas.
- `src/render/rafts.js`: procedural por capas/colores, caja FAB existente con fallback. `tools/look-raft.mjs`
  comprueba Worker/guardado/reload y modelos en cámara controlada. Supabase real/GPU/dispositivos físicos pendientes.
- Regresión aislada **304/304** (302 + 2 red); capturas inspeccionadas high/low, día/noche, recarga normal
  y fallback sin assets. No revalida los cambios de cuentas M5 P2 en curso en el checkout principal.
- Próximo corte exacto: **D04 P2**, superficie/colliders de cubierta y transiciones entre niveles compartidas
  por autoridad y predicción; playa→muelle→balsa, paredes/barandillas y subir/bajar. El editor sigue en D05.
- No navegar/producción/saqueo/recuperación habilitados. Los blobs anónimos siguen siendo replayables tras
  desconectar/reiniciar; el cerco de clones activos es local. M5 mantiene su puerta para riesgo persistente.

### Checkpoint previo Tinta (`0.4.8-alpha.4`)

- Base compartida: perfil `pirateId` / `pearls`, ledger UID en memoria, botín público, bolsa de 8, confirmación
  con UID anterior, entregar a otro pirata, vender, escupir, caída al morir en cualquier zona y retorno a playa tras 90 s.
- Brasa: G / cruceta abajo / botón COMETA. Embestida predicha, colisiones, limpieza de balas parreables, estela
  ardiente de 2 s; quemadura de todo el kit y maldición al vadear. El poder no se puede poner en Q/E.
- Escarcha: G / cruceta abajo / botón ANCLA. Campo apuntado (mantener/soltar), alcance 10 u, radio 3 u, 4 s,
  CD 16 s; ralentiza al 50 % a NPC enemigos y balas hostiles. Golpes ralentizan 30 % durante 3 s y tres congelan
  0,6 s (jefes nunca). Fuego/lava recibido ×1.5; fuentes físicas normales conservan su daño.
- Balas: trayectoria analítica con historia de campos y obstáculos; no se acelera la bala al expirar un campo.
  Snapshot `frost` completo, dedupe por pirata/secuencia, rollback del cast rechazado y recuperación de eventos
  perdidos. Estado predicho `icX/icZ/icT0/icEnd/icSeq`. El renderer usa la misma trayectoria que el combate.
- Tormenta: G / cruceta abajo / botón RAYO. Carga hasta 1.2 s, soltar o sostener 3 s dispara; 2–5 NPC distintos,
  cono de 40° y alcance 10 u, saltos de 5 u, ATK ×1.8 con ×0.75 por salto. CD 15 s al soltar; dash/stagger/muerte
  cancelan gratis. Golpes del kit saltan una vez al vecino más cercano, daño bruto ×0.5, sin crítico nuevo ni recursión.
  Primer golpe mortal también encadena. ID resuelve empates; no aplica saltos contra jugadores en PvP.
- Imán de tormenta: posición del portador fijada al emitir el patrón (`magnets`), alcance 18 u desde cada bala,
  giro suave ≤0.22 rad/s, desvío total ≤0.45 rad, luego tangente. No sigue cambios posteriores del jugador.
  La curva se compone con Escarcha a 240 Hz deterministas; caché por historial, clipping sobre la curva real y TTL fijo.
  Snapshots `storm` reparan eventos perdidos/entrada tardía, incluidas retiradas tras liberar el slot de una bala
  y omisiones por capacidad del pool autoritativo.
  Parry, auto-aim y renderer leen esa trayectoria/velocidad. G carga/CD conserva las columnas predichas existentes.
- Pestaña Perlas (P), HUD G, VFX naranja/azul/amarillo/morado iniciales y pilar de luz. Cambios fuera de combate. F4 permite dar una
  perla en solo para probar; cerrar el panel y esperar 4 s antes de G.
- Archivos de entrada: `src/data/pearls.js`, `src/sim/systems/pearls.js`, `pearlcombat.js`, `skills.js`,
  `src/ui/pearlpanel.js`, `src/sim/projectiles.js`, `src/sim/systems/ink.js`, `src/data/clock.js`,
  `src/render/vfx/frostfx.js`, `stormfx.js`, `inkfx.js`. Próximo paso concreto: **P5 cierre** en `PLAN-M4.8.md`;
  M5 sigue en plan, sin capa de almacenamiento implementada.
- **Protocolo 11**: actualiza cliente y servidor juntos. Partidas anteriores migran con bolsa vacía. El ledger
  no sobrevive a reinicios; M5 debe cerrar los duplicados antes de introducir perlas únicas.
- Validación previa de Escarcha: 247 tests (245 sin red + 2 de red), incluidas 14 de Escarcha. Revisión previa de Brasa: panel,
  confirmación/G en desktop y móvil emulado 844×390; Cometa con partículas detenidas por el render de software. Falta
  aceptación a 60 fps con GPU y dispositivos reales. `shots/review/` contiene evidencia local, ignorada por Git.
- Escarcha: panel y apuntado/cancelación en desktop 1280×720; panel, botón ANCLA dentro de pantalla y lanzamiento
  táctil en móvil emulado 844×390. Capturas inspeccionadas en `shots/review/escarcha-desktop/` y
  `shots/review/escarcha-mobile/`. El escenario detiene el campo ya aceptado por el servidor para capturarlo
  con SwiftShader; no certifica rendimiento. Sin errores JS de juego; avisos del render de software y fuentes
  Google bloqueadas durante el recorrido. Tras revisar la integración, 37/37 pruebas de Escarcha/apuntado/tatuajes.
- Tormenta: 12 pruebas nuevas de perfil, carga/CD, selección/daño de cadenas, anclas/curvas, obstáculos/TTL,
  Escarcha, snapshots/retiradas/capacidad, eco G, rechazo predicho y tiempos de parry. Regresión general final:
  257/257 sin red y 2/2 de red (~100 ms RTT); integración dirigida: 61/61. Total: 259/259.
  Logs locales `shots/review/tormenta-tests.log`, `tormenta-focused.log` y `tormenta-net.log`.
  Escenario `SCEN=tormenta`: panel, cono/carga completa y cadena real de cinco objetivos en desktop 1280×720.
  Cintas de rayo reforzadas tras inspeccionar el trazo sobre arena. El escenario pausa carga/efectos aceptados para
  capturarlos con SwiftShader; no certifica rendimiento ni sustituye GPU, mando o teléfono reales.
  Móvil emulado 844×390: panel con scroll conservado, botón RAYO dentro de pantalla, carga con contacto/arrastre
  táctil y liberación hacia cinco objetivos. Capturas inspeccionadas en `shots/review/tormenta-desktop/` y
  `tormenta-mobile/`. Sin errores JS de juego; fuentes Google bloqueadas y avisos de SwiftShader conocidos.
  Checkpoint D01 y próxima misión D02: [informe de Tormenta](delivery/d01-tormenta.md).
- Tinta / D02, base `f9ddb17`: marca de 4 s, +10 % en golpes posteriores de cualquier atacante, sin acumulación
  ni marca PvP. Nube G apuntada: alcance 10 u, radio 3 u, 5 s, CD 18 s; todos los piratas cubiertos quedan ocultos
  para NPC. Disparan/marchan a su última posición visible; no adquieren objetivos ocultos nuevos. Cañones,
  morteros y HELLFIRE comparten la regla; ataques comprometidos y daño recibido siguen activos.
  Hora del servidor/economía: noche 20:00–06:00, día de 16 min. De día pociones ×0.7; de noche daño ×1.1.
  El ciclo visual sigue el servidor; los presets de «Luz del escenario» son cosméticos. F4 cambia hora en solo.
  Snapshot `ink` (nubes/marcas) y `clock`, campos predichos `inkX/inkZ/inkT0/inkEnd/inkSeq`; eco deduplicado,
  rechazo revertido y reparación de eventos perdidos/entrada tardía.
  Validación vigente: **269/269 sin red + 2/2 red = 271/271**. 12 casos nuevos de Tinta; sintaxis de 29 archivos
  y diff limpios. Logs `shots/review/tinta-tests.log`, `tinta-net.log`, `tinta-focused.log`.
  `SCEN=tinta`: panel con scroll, apuntado/cancelación desktop, nube canónica, marca real y HUD día/noche;
  desktop 1280×720 y móvil emulado 844×390 con contactos/arrastre táctiles. Se corrigió el tutorial sobre la hora.
  Capturas inspeccionadas en `shots/review/tinta-desktop/` y `tinta-mobile/`, sin errores JS del juego; avisos de
  SwiftShader y fuentes Google bloqueadas. El escenario congela efectos aceptados para fotografiarlos;
  no acredita FPS ni controles físicos. Informe durable y siguiente tarea: [D02 Tinta](delivery/d02-tinta.md).
- `package-lock.json` corregido: Three.js 0.160 viene del registro npm, sin enlaces a carpetas temporales;
  `npm ci` comprobado en instalación limpia. `tools/look.mjs` acepta Playwright/Chrome instalados en Windows.
- No se han seleccionado/importado assets FAB. El autor los está revisando; la mecánica conserva el arte
  procedural y el importer GLB de `docs/ASSETS.md`. Tampoco se ha desplegado el servidor ni republicado el artefacto;
  la URL de claude.ai conserva M4.7.

### Dirección del autor y discusión naval (2026-10-04)

- Construir y habitar en tierra o en barcos modulares es la joya del juego; barcos aéreos más adelante.
- Usar **GPT-6 Luna** para trabajo delegable que ahorre tiempo/tokens sin comprometer calidad, con autoría,
  integración y revisión final del agente principal. Regla persistente: `AGENTS.md`.
- Dirección naval acordada y fases: `docs/NAVAL-ROADMAP.md`; discusión inicial y antecedentes en
  `docs/NAVAL-HOUSING-DISCUSSION.md`. Formato de combate y detalles de balance/protección siguen abiertos.
- El autor autorizó iniciar la exploración Unreal/FAB en paralelo mientras redacta sus decisiones. Ruta fuente
  confirmada: `C:\Unreal` (tres proyectos), inventario de solo lectura con Luna, contenido adicional y su portabilidad/utilidad;
  excluir módulos base de Unreal. El autor gestiona las licencias. Seguimiento: `docs/research/unreal-assets/README.md`.
- El autor aprobó direcciones de manejo/economía/piratería, sin implementación de esos sistemas.
  La implementación actual de M4.8 se detalla en el checkpoint de Tinta de arriba.

### Dirección naval y productiva incorporada a los planes (2026-10-04)

- `docs/NAVAL-ROADMAP.md` registra acuerdos: materiales/navegación/carga/distribución afectan tamaño/manejo;
  soltar carga, rendición por bienes, recuperación sin duplicados, patrullas/notoriedad y riesgo a bordo.
- Rutas protegidas con PvE interactivo y atajos disputados; tiers/recursos/oficios regionales, especialidades
  comerciales, afinidad de perlas y ciudades que crecen con entregas/caravanas. Tecnología variada; aire después.
- Recomendación todavía abierta: mar regional compartido con dos zooms; proyectiles esquivables y maniobra
  naval con inercia; abordar cubiertas reales enganchadas a baja velocidad antes de saltos entre barcos móviles.
- Planes M4.8–M8 actualizados como trabajo futuro. Orden propuesto: cerrar kit actual → habitar/cargar/comerciar
  → manejo → autoridad durable → NPC naval → PvP/rendición/patrulla → oficios regionales → ciudad/convoy.
- M5 puede avanzar en paralelo, pero es requisito para publicar pérdidas/recuperación y bienes persistentes.
  Plano frente a daño, transferencias idempotentes y liquidación de remesas antes de PvP económico público.
- Afinidad solicitada: aprendizaje guardado; personaje/tipo de poder es recomendación, sin curvas ni mejoras
  decididas. La perla conserva su circulación actual. No añadir alcance silenciosamente al cierre de M4.8.
- Pendientes: fórmulas, nivel de barco, topología/controles, patrimonio protegido, pérdidas/rescate, legalidad
  por región, treguas/bounty, XP y población requerida para obras. No asumir que estas cifras están aprobadas.
- Esta actualización solo cambia planificación/documentación; simulación, versión, protocolo y despliegue
  permanecían en el checkpoint del commit `40949b2` (Escarcha); la entrega posterior de Tormenta se detalla arriba.

### Inventario Unreal terminado (2026-10-04)

- Tres agentes GPT-6 Luna analizaron `C:\Unreal`; informes y revisión del principal en
  `docs/research/unreal-assets/SUMMARY.md`, CSV por proyecto, catálogo de packs y comparación selectiva SHA-256.
- 7.406 archivos / 6.934.252.744 bytes, contando repeticiones; CSV y JSON reconciliados. Se revisaron miniaturas
  de vivienda/props/VFX y dos texturas PNG sueltas. No se abrió Unreal ni se modificaron proyectos fuente.
- Prioridades: mapas PNG de sA para VFX; banco/caja/hut Dreamrise para arte doméstico; flujos de construcción,
  inventario/crafting/vendor como referencias. No identificado kit modular naval ni doméstico completo.
- Casi todo está empaquetado en `.uasset`; exportabilidad, rigs, polígonos y rendimiento aún no comprobados.
  No hay imports, exportaciones GLB/audio ni implementación de estas propuestas. `assets/manifest.json` sigue vacío.
- Contexto previo de MyProject menciona otros packs de entorno/aldea, sin presencia identificada por sus nombres
  exactos. Son pistas para buscar después, no contenido local verificado.

## 4. Cómo trabajar

- **Plan unificado**: `PLAN-DELIVERY.md` enlaza entregas D00–D15 con pruebas de assets A00–A09, dependencias
  y aceptación. Primera ola: respetar dueño de Tormenta → A01 preparación aislada → preparar/revisar Tinta.
  `docs/briefs/assets-a01-texture-canary.md` y `delivery-template.md` fijan scope/rutas/evidencia; no ejecutados
  al crear el plan. Mantener la base aceptada separada del trabajo que esté cambiando en el checkout.
- Estado al redactar el plan (2026-10-04): HEAD `20d8ee6`; cambios y pruebas de Tormenta corresponden al árbol
  local aún sin commit. Esta entrega documental no los revalida ni acepta. Comprobar HEAD al retomar;
  si Tormenta ya está aceptada, registrar D01 y seguir con D02 Tinta, sin repetir la implementación.
- Al aceptar cada misión, actualizar plan + handoff y reporte durable en `docs/delivery/`: Dxx/Axx, commit,
  pruebas/capturas/limitaciones, decisión del asset y próxima tarea exacta. Arte nuevo entra con fallback y
  comparación; no frena el gameplay si no mejora o no exporta. M5 precede todo riesgo público persistente.
- **Tests**: `npm test`. Si el equipo va cargado (otro navegador corriendo), la suite entera puede pasar de 10 min:
  correr `ls tests/*.test.mjs | grep -v net.test | xargs node --test` y `node --test tests/net.test.mjs` aparte.
  En PowerShell, limitar concurrencia y separar red:
  ```powershell
  $testFiles = @(rg --files tests -g '*.test.mjs' | Where-Object { $_ -notmatch '(^|[\\/])net\.test\.mjs$' })
  node --test --test-concurrency=2 @testFiles
  node --test tests/net.test.mjs
  ```
- **Ver los cambios visuales** (siempre, con capturas): `OUT=shots/x Q=high SCEN=village,fight,impact node
  tools/look.mjs` (escenarios en su cabecera; `lineup` para personajes de cerca; `MN_LIBS` si la red bloquea el
  CDN). Mirar las capturas antes de dar algo por bueno.
  En Windows: `MN_PLAYWRIGHT` = ruta absoluta al `index.mjs` de Playwright; `MN_BROWSER` = ruta al Chrome/Edge
  instalado. `MN_THREE` / `MN_GSAP` = carpetas de los paquetes locales si el CDN está bloqueado. `SCEN=pearl`
  prueba Brasa, `SCEN=escarcha` prueba Ancla, `SCEN=tormenta` prueba carga/cadena y `SCEN=tinta` nube/marca/reloj;
  para móvil `PHONE=1`, `VW=844`, `VH=390`.
- **Artefacto** (la versión que se juega en claude.ai, modo solo): construir desde lo **commiteado**, no desde el
  árbol de trabajo:
  ```bash
  P=/tmp/pub; rm -rf $P && mkdir -p $P && git archive HEAD | tar -x -C $P
  (cd $P && node tools/build-artifact.mjs dist/index.html)   # imprime la página y la lista de archivos
  ```
  y publicar `dist/index.html` con esos archivos (`root` = `$P`) en la **misma URL**:
  https://claude.ai/artifact/MpCdPMbgw41nJKcf8NvSrD
- **Git**: rama `claude/loving-lovelace-ptbif7`, PR https://github.com/joeyxd/realms-of-trade-server/pull/1 (no
  abrir otro). Mensajes de commit descriptivos en inglés, con las líneas de coautoría del entorno al final; ningún
  identificador de modelo en commits ni en el código.
- **Método del autor**: el agente principal diseña, integra, revisa y pule; usar agentes GPT-6 Luna para todo trabajo
  delegable que ahorre tiempo/tokens sin comprometer el resultado (`AGENTS.md`), con un brief preciso
  (ejemplos en `docs/briefs/`). Se revisa todo antes del commit.
- Hablar con el autor en **español**.

## 5. Trampas conocidas

- `BufferAttribute.getComponent` no existe en three 0.160 (usar `getX/getY/getZ/getW`).
- `MeshToonMaterial` no acepta `flatShading` en el constructor (asignarlo después).
- Los materiales de los personajes llevan `aGlow` y `color` por vértice; un material nuevo de personaje debe
  compartir los uniformes `glow` / `flash` de la vista (`toonmat.js charToon`).
- La pasada de contornos usa `mesh.userData.nm` (o `material.userData.nm`): una malla con lista de materiales
  necesita su `userData.nm` propio.
- En el entorno de agentes, `cd` en Bash cambia el directorio de trabajo para siempre: usar rutas absolutas o
  `git -C`.
