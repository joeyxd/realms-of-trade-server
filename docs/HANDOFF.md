# Traspaso: cómo seguir con MAREA NEGRA

**AREA07 RNV04, 2026-10-10 — combustible privado, alpha.31 / protocolo 42:**
[Entrega](delivery/rnv04-fire-fuel.md), [contrato](briefs/RNV04-fire-fuel.md).
Luces municipales infinitas; antorcha de mano 20 min, faroles/antorchas privadas 60 min por madera,
fogata/parrilla 30 min provisionales. Un slot, apagar conserva combustible; panel N/V ES/EN y tres piezas
del editor. SQL022 aplicada, canario real 8/8; 91/91 integración, 107/107 selección de imagen y
33/33 de composición GameHost/diario común (selecciones solapadas). PC/móvil emulado bajo/alto
aceptados localmente. Publicación y entrada autenticada VPS pendientes de registrar en la entrega.
No activa artesano ni montaje de reloj común. Sigue agua costera/reembarque y después provisiones/hogar.

**AREA15, 2026-10-10 — código común económico/checkpoint publicado, montaje apagado:**
[entrega](delivery/m5-ground-host-authority.md), [contrato](briefs/m5-ground-host-authority.md).
API explícita de GameHost con un dueño de tick/época/SQL018/019; aplica economía en `beforeTick`
antes del ACK y guarda mundo/reloj juntos. Startup recupera el diario y verifica filas actuales.
355/355 en 44 archivos, doce casos nuevos y dos SIGKILL nuevos de GameHost; GM03b1 preservado.
Readiness real SQL018–021 confirmada tras la aplicación del autor. Mundo legacy aún sin reloj común:
sin activación de este montaje ni artesano. Sigue adopción atómica y composición de perlas/muerte/botín,
después canario autenticado con caída/reinicio VPS. No acredita toda la permanencia del juego.
VPS `cf5857f` sano a 22:04:34 UTC, alpha.30/protocolo 41: 107/107 de imagen, 8/8 focales
del montaje en Node 22.23.3 sin red y entrada pública 6/6; regresiones solapadas con la suite local.

**GM03b1, 2026-10-10 — publicado alpha.30/protocolo 41, release `6e6f421` sana:**
[preparar revisión](delivery/gm03b1/DELIVERY.md), [contrato](briefs/gm03b1-prepared-revision.md).
Online valida el head privado exacto y descarga documento/dependencias/base/colisiones por hash.
Errores enfocan objetos; cambios invalidan el paquete y conflictos conservan diseños. Proyección de
colisiones compartida con caminar, todos los assets base y variantes móviles fijados, sin escrituras
de gameplay/SQL/flags. 183/183 regresión, navegador local simulado 41/41, actualizador 107/107 y
navegador público Supabase real 23/23. 57 dependencias base; ES/EN inspeccionados y borrador previo
restaurado por CAS r6→r13. [Evidencia pública](delivery/gm03b1/public-evidence.json).
Sigue GM03b2: registro durable, activación/rollback con admisión exacta y exclusión del actualizador.

**AREA17, 2026-10-10 — evaluación Inference Center/Hermes, solo documentación:**
[propuesta de arquitectura](briefs/l03d-inference-center.md). Adaptar Nitro sin Nango a conexiones/modelos
por cuenta y ficha del compañero; API acotada recomendada primero, conexión local opcional después.
Nitro actual configura un operador compartido; copiarlo no aísla jugadores. AgentMind/M5 conservan
autoridad y memoria propias. Sin proveedor/modelo elegido, consumo o activación; tramos propuestos
dentro de L03d/L05c. D-A3 aún no se marca acordado o implementado.

**AREA03 PRG01c, 2026-10-10 — código publicado alpha.29/protocolo 41, feature apagada:**
[artesano y bodega personal](delivery/prg01c-artisan.md), [contrato](briefs/prg01c-artisan-storage.md).
Carpintería completa + Tala 60/hito permiten aprender `raft_storage` pagando dos maderas en mochila
(tuning provisional). Colocar/retirar Bodega usa el recibo M5 común; coste seis, volumen +20,
condición/IDs/carga conservados. 114/114 de integración, 107/107 release con solapamiento y 32 checks
de navegador ES/EN. SQL021 después de 001–020 y `MN_ARTISAN_OPERATIONS=1` siguen pendientes de
aplicación/activación y canario real; la feature queda apagada. Se conservan noche/faroles, GM remoto
y SQL019 del upstream. El resto del editor sigue CAS anterior. VPS `67e307e` sano, una autoridad,
107/107 de imagen y entrada pública 8/8 a 21:12 UTC; evidencia y límites en la entrega.

**GM03a publicado, 2026-10-10 — alpha.28 / protocolo 40 integrado:** [borradores remotos privados](delivery/gm03a/DELIVERY.md).
Online permite guardar/cargar explícitamente por cuenta/mundo, CAS, recuperación exacta y exportación de
ambas copias; conflictos conservan el diseño local. SQL020 aplicada y canario real 14/14. Suites locales
102/102 y regresión 113/113 (solapadas), navegador local 35/35, imagen 107/107 y navegador Supabase real
17/17, cero errores. Runtime `9f23be3` sano; copia remota previa restaurada por CAS. No activa mapas ni
escribe gameplay; sigue GM03b publicación/activación/rollback bajo M5.

**AREA17 L03d-a, herramienta publicada 2026-10-10:** [contabilidad nativa durable](delivery/l03d-native-metering.md)
prepara un ledger v2 separado con tarifas/modelo declarados e inmutables, reserva previa, uso nativo
y conciliación sin confundir cargo calculado con factura. V1/panel/runner siguen simulados; sin
proveedor, SDK, credencial ni SQL nuevo. Falta elegir proveedor/modelo y aceptar transporte, memoria,
conversación/PvE y coste reales. Fuente `e614ca4` integrada con alpha.28/protocolo 40; herramienta
del repositorio, excluida de la imagen VPS. Pruebas/continuidad pública en la entrega.

**AREA07 RNV03, 2026-10-10 — alpha.28/protocolo 40, implementado y activo:**
[Contrato](briefs/rnv03-dark-night.md) y [entrega](delivery/rnv03-dark-night.md).
La noche respeta el reloj compartido, sin selector cosmético ni relleno automático del jugador.
N/toque enciende el farol básico de cinturón; otros humanos aprovechan su luz y ven el accesorio.
Estado de sesión, apagado al morir/reentrar, sin inventario/combustible/perfil/SQL nuevo ni otro writer.
El transporte administrado de agentes conserva sus permisos actuales: no admite este interruptor.
650/650 integradas, 107/107 release; integración concurrente 70/70 focales y 107/107 release (solapamiento).
VPS `9f23be3` sano a 2026-10-10 20:56:35 UTC, una autoridad, imagen 107/107 y timer activo.
Entrada real WSS: N encendido/apagado, accesorio/fuente, hora compartida y mapa/minimapa comprobados.
Sigue agua costera/reembarque con reglas explícitas de carga/agotamiento/rescate, después provisiones/hogar.

**AREA15, 2026-10-10 — diario del sobre:** [SQL019 y recuperación](delivery/m5-ground-transaction-journal.md).
UUID/petición exactos antes del efecto; intención y SQL018 se cierran juntos. La sesión opt-in resuelve
pending antes de cargar reloj/mundo actuales, sin instalar perfiles históricos ni emitir ACK al recuperar.
266/266 pruebas y tres SIGKILL locales. Sin montaje GameHost, SQL018/019 live ni flags; sigue dueño común de tick/legacy.
Publicado `6748f9a`, alpha.27/protocolo 39: una imagen sana, 107/107 offline y entrada pública 6/6.
Se verifican imports del journal/recovery en Node 22; este corte no activa SQL018/019.

**AREA07 RNV02, 2026-10-10 — farol funcional, integración alpha.27/protocolo 39:**
[contrato](briefs/rnv02-naval-lantern.md) y [entrega](delivery/rnv02-naval-lantern.md).
Editor B con doce piezas; una madera/un hierro, HP 10, apagado inicial y soporte vivo.
V/toque elige puerta/farol cercano. Luz cálida sigue la nave y pierde servicio al romperse;
reparación pagada y encendido explícito. Estado por instancia en perfil M5 del dueño, visitantes cercanos,
replay acotado, sin SQL, combustible ni otro writer. 631/631 integradas, 107/107 release (solapamiento),
cuatro vistas y probe F/E/V real aceptados. VPS `e648d1b` sano hasta las 20:15:21 UTC, imagen 107/107 y timer activo.
Entrada pública WSS, mapa/minimapa y catálogo comprobados; sigue noche casi negra sin luz, después agua costera/reembarque.
Se conservan comercio L06b y SQL018 no montado del upstream; no se cambiaron SQL ni flags.

**AREA15, corte local 2026-10-10:** [SQL018, gameplay/mundo/reloj atómicos](delivery/m5-ground-transactions.md)
y sesión detenida con recuperación exacta, sobre alpha.26/protocolo 38. SQL017 pertenece al comercio de
agentes; no colisionar migraciones. Sin montaje GameHost ni SQL018 live. Continúa un solo dueño de tick,
diario del sobre y adopción legacy antes de aceptar perlas/muerte/botín con la economía activa.
Código publicado y comprobado dentro de `e648d1b`/alpha.27/protocolo 39, con 107/107 de imagen y 6/6
públicas. Los coordinadores siguen sin montar; aceptar la API publicada no cierra gameplay durable.

**Checkpoint GM02 publicado (2026-10-10):** [decoración existente y prueba caminando](delivery/gm02-draft-walk.md), alpha.25/protocolo 37, release `e2ff69e` sana desde 19:37:56Z. Escena edita/oculta/restaura rocas naturales/costeras, flores y guijarros; círculos XZ y recorrido privado. Documento v2 migra v1; IndexedDB/CAS/recuperación locales. 162/162 pruebas (51 GM), navegador local 28/28, actualizador 107/107 y público Supabase real 12/12. Sin escritura de mapas/M5 ni terreno; sigue GM03 guardado remoto/publicación.

**AREA17 L06b-2b, 2026-10-10 — alpha.26/protocolo 38:** [compra/venta explícitas](delivery/l06b-agent-trade.md)
con presupuesto acumulado y revocable SQL017, separado de inferencia. Se reutilizan perfil/mundo/recibo
M5 humanos; no hay otra autoridad ni transferencia desde el dueño. Reentrada/replay no restauran saldo;
stop cancela preparación y reconcilia commits enviados. [Contrato/CLI ES/EN](agents/trade.md).
917 aprobadas, cero fallos y cinco omisiones Windows; suplemento SQL/host 20/20. Publicado en `cafff18`,
sano desde 19:58:06 UTC; VPS 107/107 y público 10/10. `npm start` conserva agentes/comercio/proveedor apagados.
SQL017 live y canario autenticado pendientes. Integra Tala SQL016 y refugio sin cambiar sus flags.
Sigue L03d proveedor real/conversación/PvE con memoria y gasto medidos; luego autonomía por eventos
y operación del dueño. Publicación inerte no equivale a activación o aceptación de economía agente.

**AREA07 RNV01, 2026-10-10 — alpha.24/protocolo 37:** [refugio naval](delivery/rnv01-naval-refuge.md).
Editor B añade techo/puerta; soporte vivo, materiales/HP, V/toque, colisión y apertura por instancia.
Dueño/visitante usan puertas sin cerradura; guarda el perfil M5 del dueño, sin SQL ni otro writer.
Techo se oculta al entrar y vuelve al salir. Cubierta/predicción admiten cambios de puerta en el mismo tick.
516 pruebas tras integrar Tala, 107 del actualizador con solapamiento y tres vistas UI repetidas/inspeccionadas.
Activo en VPS `29a9e46`, sano a las 19:24:26 UTC, imagen 107/107 y entrada pública/mapa/protocolo
comprobados; evidencia/límites en la entrega. [Plan AREA07](briefs/area07-naval-action-plan.md) y M6
actualizados; sigue RNV02 farol usable, después oscuridad. No acredita clima/descanso/colapso estructural.

**AREA03 PRG01b2, 2026-10-10 — Tala activa:** [Tala cooperativa](delivery/prg01b2-logging.md)
sobre la única autoridad M5. SQL016 verificada y flag habilitado; adopción v1→v2 exacta en `758a217`.
Canario autenticado: reparto 7/3, beneficiario offline/reentrada, hito 60 y siguientes golpes a 45 ticks;
crafting/venta y conclusión individual dejaron A70/B3. Reinicio ordenado en `454e2da` (alpha.26,
protocolo 38) conservó perfiles completos, nodos y ledger; nueve replays sin duplicar progreso/bienes.
Cleanup eliminó dos cuentas QA y conservó nueve recibos. 31/31 de regresión actual, smoke público 6/6;
revisión/imagen sana, una autoridad, timer activo y cero errores verificados a las 20:08:38 UTC.
Evidencia y límites de reloj/crash en la entrega; no acredita persistencia completa de todas las features.
Sigue PRG01c: artesano y enseñanza personal `raft_storage`; no se concede automáticamente con el hito.

**AREA07 PRG02b, 2026-10-10 — alpha.23/protocolo 36:** [Pilotaje II](delivery/prg02b-pilot-learning.md)
concede una vez `pilot_coastal` al completar la lección con atraque real. Timón +15 % desde el siguiente
embarque, progresión común v2 y guardado CAS M5 con estados local/pendiente/confirmado. Sin SQL ni ledger
nuevos; repetición sin premio adicional. 174 pruebas integradas, 38 de agentes y tres vistas de navegador
aprobadas; recursos M5 y continuidad también pasan juntos (22 casos, con solapamiento). Publicación/estado
VPS en la entrega; una conexión abierta aplaza el relevo. Sigue refugio con techo/puerta, después farol;
disponer de fuentes utilizables antes de reducir la luz nocturna. PRG02a sin aprendizaje queda histórico.

**AREA15, 2026-10-10 — live:** [recursos/crafting M5](delivery/m5-resource-authority.md) en
`a5b8f127340c1febbd4c0b29cb83bbc2fa83fe98`, alpha.23/protocolo 36; activación inicial en 4c,
SQL015 y flags económico/recursos activos, status listo, 107/107 offline. Ocho operaciones reales confirmadas y reproducidas tras reinicios ordenados;
pausa offline de 12 918 ms respetada. Release 57/57; los ocho recibos se reprodujeron 23 veces en total,
incluido SIGKILL post-ACK en VPS. Proceso exit 137, luego `docker start` manual; no asumir autoreinicio
del contenedor. El test usó el runtime a5b8f127. Cleanup QA confirma Auth/perfil ausentes y ocho recibos/recursos conservados.
Estado/crash/cleanup: [status final](delivery/m5-resource-authority/final-live-status.json),
[SIGKILL](delivery/m5-resource-authority/crash-restart.json), [cleanup](delivery/m5-resource-authority/cleanup-verification.json).
No prueba corte eléctrico ni restauración de disco; AREA15 no completa todo M5. Ver evidencia/límites en la entrega. Con recursos adoptados, todo rollback necesita runtime compatible y
`MN_RESOURCE_OPERATIONS=1`. Perlas/reloj .40 sigue como corte separado. El aprendizaje naval AREA07
es perfil/progresión; no constituye grant de recursos.

**Hotfix GM01 publicado (2026-10-10):** [bloqueo del gizmo](delivery/gm01-render-fix.md) corregido
en `e78c2c3`, incluido en alpha.23 (`4c6743b`, imagen sana desde 18:43:12Z). Validación local alpha.21:
102/102 pruebas y navegador 16/16, cuatro calidades y arrastre real. Actualizador 107/107; navegador público
7/7 con Supabase real, GM en calidad alta con contornos, colocación/guardado local y logout sin errores de render.

**AREA17 L06b-2a, 2026-10-10:** [inventario/contexto y mercado privado](delivery/l06b-agent-market.md).
Lecturas tipadas `inventory_read`/`market_read`, pueblo derivado del servidor, list/quote sin mutación,
frescura y retiro de vistas ante movimiento, denegación, stop/revocación o nueva sesión. CLI y mente
comparten el snapshot; introducidos en protocolo 35 y alpha.20. Se integran prerrequisitos locales L05/L06a/L06b-1
sobre upstream `70205bd`; piloto y proveedor siguen apagados en `npm start`. Sin SQL nuevo ni gastos
de bienes/inferencia. Sigue L06b-2b: compra/venta y presupuesto durable de bienes en la misma M5.
Publicado dentro de `4c6743b`/alpha.23/protocolo 36: revisión/imagen/health y entrada WSS real
verificadas el 2026-10-10, 18:44–18:45 UTC; 46/46 integración, 107/107 VPS y 8/8 públicas.
Ver [uso opt-in](agents/market-read.md) y evidencia en la entrega. Agentes/proveedor públicos apagados;
la autoridad de recursos del otro frente reporta habilitada/lista, sin activación por AREA17.

**AREA03 PRG01b1, 2026-10-10:** [perfil compatible para aprendizaje](briefs/prg01b1-profile-continuity.md)
y [entrega](delivery/prg01b1-profile-continuity.md). Nuevos perfiles con progreso vacío; legacy conserva
su forma exacta y sus recibos. Aprendizaje válido se conserva en saves, muerte y reentrada; corrupción
o versión futura rechaza admisión sin reemplazar la fila. 140 pruebas focales y 107 de release locales.
Sin SQL nuevo ni cambio del protocolo de esta rama. El cálculo puro de Tala está disponible, pero
en b1 no concedía práctica jugando. PRG01b2 ya activó esa integración/cadencia/ficha con SQL016
y aceptación autenticada/reinicio/replay como se registra arriba.
Publicación efectiva se verifica aparte; los planes y recursos en el checkout compartido avanzan en paralelo.

Para quien retome el proyecto (persona o modelo). Leer `AGENTS.md` y esto primero, luego `PLAN-DELIVERY.md`
(orden operativo de juego + assets + agentes), `DESIGN.md` y el `PLAN-M*.md` del milestone en curso.

**Checkpoint PRG02a, 2026-10-10 — lección costera, alpha.19/protocolo 33:** [contrato](briefs/prg02a-coastal-lesson.md) y [entrega](delivery/prg02a-coastal-lesson.md). Dos boyas en orden, maniobra detenida 0,75 s y regreso con atraque normal; sesión voluntaria, server-owned y sin crédito permanente. 219/219 pruebas seleccionadas y 3/3 vistas de navegador aprobadas, capturas representativas inspeccionadas. Fixture de reubicación: no prueba pilotaje humano ni rendimiento físico. Publicación/despliegue se registran en la entrega. Sigue PRG02b con el aprendizaje común. El brief de oscuridad AREA07 exige disponer de faroles antes de reducir la luz ambiente.

**Corrección de inventario/recogida, 2026-10-09:** [informe y capturas](delivery/inventory-feedback.md).
F/táctil responde inmediatamente; ocultación y cantidades provisionales se reconcilian con la autoridad
sin duplicar materiales. El tiempo de acción comienza al pulsar, sin sumar el viaje de la respuesta.
I muestra `eco.pack.goods`, volumen/capacidad, masa y herramientas; contenido nuevo ES/EN.
57/57 casos Node, 16 Python + 1 omitido en Windows y 3/3 vistas de navegador con 500 ms RTT.
Protocolo 32 conservado (campo opcional en ACK privado); sin SQL ni otra autoridad de guardado.
Corte integrado para publicación por el actualizador del VPS; revisión activa/entrada pública se verifican después.

**Dirección de alfa del autor, 2026-10-08:** tres pueblos especializados que crecen con aportes de jugadores;
primer pueblo **Salty Shore**, reconstruido en la isla existente por el agente de arte. Mecánicas y anclas
funcionales/capacidad se detallan en [PLAN-ALFA-MUNDO](../PLAN-ALFA-MUNDO.md). Ocho personajes incluyendo
agentes y ocho balsas simultáneas son meta propuesta, no capacidad medida: host/pilotaje actuales parten de
cuatro. Tres pueblos caminables, obras/aprendizaje durables y la expansión regional completa siguen por implementar; S21 amplía el terreno de la isla actual.
**Confirmado por el autor:** servers/mundos separados con personajes/economía/progreso propios; geografía
continua y estado conservado hasta wipe explícito, aunque haya cargas de sector. Ocho es meta de conexión
simultánea, no total de residentes durante la vida del server. Aislamiento de perfiles y transición de zonas
requieren implementación/verificación; no se activa SQL, publicación ni cambios de gameplay aquí.
**Ampliación del autor:** dos pueblos conectados por tierra, recursos/bandidos y alternativas de comercio
por camino o mar. El autor aprobó el plan como base: Salty Shore–Puerto Sol en la misma isla y Ceniza aparte; esa ubicación
no cambia todavía los anclajes de Puerto Sol/Ceniza; S21 implementa terreno para la isla actual, y el corredor A3 sigue pendiente. Crecimiento a miles distingue residentes, concurrencia mundial y densidad
local; filtro de interés/regiones/handoff son arquitectura futura, no capacidad demostrada. A3 cubre el
corredor y A8 el prototipo posterior al alfa pequeño.


**Checkpoint S21 de terreno, 2026-10-08, autorizado por el autor como pase solo de terreno:** [informe](delivery/map-revamp-v1.md). Base 400/N401 y RNG legacy conservadas; postpass determinista 560/N561, resolución 1. Suelo seco muestreado +63,148347 % (paso 2, umbral >0,65). Dos conexiones suaves de terreno permiten llegar caminando a puntos interiores (171 y 109 aristas; ascenso máximo 0,1412 y 0,1377 por paso, límite 0,15); se conservan los núcleos húmedos, sin puentes ni assets nuevos. Pueblo: tres niveles 2,4/6,4/10,4, rampas y seis pads planos de huts existentes. Conserva orden/identidad/XZ de 1.259 props y 176 recursos, con Y proyectada; volcán/boss, PvP, llegada y muelle protegidos. Sin pueblo, gameplay, colisiones, recursos o assets nuevos. 0.1.0-alpha.15/protocolo 31 requiere recarga de host/peers. 220 pruebas; 30 capturas de escena + 2 del panel M, cinco contextos emulados, 20 chequeos de datos de calidad y geometría reutilizada. Catálogo rev. 37 (110 filas, 54 aplicadas); fuentes y enlaces HTTP comprobados. Local, no publicado; FPS físico y multijugador humano pendientes.

**Dirección Web3 (2026-10-07):** [PLAN-WEB3](../PLAN-WEB3.md), capa de equipo premium, tierra y contenido
creado por jugadores que pueda tokenizarse y comerciarse. Primer piloto priorizado por el autor:
**equipo y tierra**. Desarrollo autorizado: [W01](delivery/w01-asset-registry.md), registro/transferencias
internas aisladas con intención, reserva y recibo; **25/25 pertinentes + 56/56 regresión seleccionada**.
Supabase SDK contra PGlite local, tres procesos y coexistencia SQL001–010; migración opt-in en
`server/migrations/web3/001_asset_registry.sql`, sin Supabase live, wallets/tokens ni montaje del juego.
Derechos/pérdidas/custodia/economía pendientes; siguiente W00a y W02, sin alterar la cola existente.
**Red elegida por el autor, 2026-10-08: Polygon PoS; piloto Amoy (`80002`), producción futura `137`.**
[Alcance y fuentes](../PLAN-WEB3.md#51-polygon-pos-elegida-amoy-para-pruebas): acceso a OpenSea,
Web3 opcional, USDC nativo/gas patrocinado como dirección propuesta. Plantilla alineada y apagada;
origen/proveedores y presupuesto abiertos, sin modificar `.env` real ni activar servicios/pagos.
El autor elige **apariencias coleccionables y piezas funcionales comerciables** dentro de reglas claras.
[Reglas W00a-equipo](briefs/w00-equipment-rules.md) y [contrato de contenido local](delivery/w00-equipment-content.md):
cero stats para apariencia, paridad con equipo normal para funcional; hash inmutable durante transferencia.
No acredita procedencia ni autoriza mint/uso. Permanencia visual, pérdidas y condiciones económicas abiertas.
[W02a](delivery/w02a-wallet-link.md): vínculo cuenta/wallet EOA, retos/recibos durables y HTTP montable
mediante `createGameServer({walletLink,resolvePlayer})`. 29/29 nuevas + 61/61 regresión seleccionada local;
SQL Web3 002 opcional e independiente, compatible con W01. `npm start` no monta esta opción; sin extensión de wallet,
RPC/testnet, Supabase live, tokens ni pagos. Cambiar wallet sigue sin flujo; un vínculo no concede uso/propiedad.
[W02b](delivery/w02b-wallet-browser.md): panel Cuenta con conexión/revisión/firma explícita/consulta,
109/109 seleccionadas y 3/3 vistas emuladas, proveedor y Auth simulados con firma EOA local real.
Recupera respuesta perdida y recarga sin otra firma; cambios de identidad/red descartan respuestas tardías.
Cerrar intento conserva el reto pendiente hasta caducar. `npm start` sigue sin montar Web3;
extensión real, testnet/RPC, Supabase live, ERC-1271 y publicación pendientes. Ningún cambio de perfil/sim/token.
[W02c](delivery/w02c-wallet-runtime.md), 2026-10-08: montaje desde env explícito en el arranque normal,
apagado por defecto. Requiere cuentas/store Supabase; consulta read-only de prerrequisitos/ACLs SQL antes
de preparar mundo/escuchar. Migración opcional Web3 003 después de Web3 002, sin aplicar SQL live ni
reiniciar el host. 15/15 nuevas + 130/130 regresión seleccionada locales y recuperación al reabrir PGlite;
UI W02b conservada.
[W02d](delivery/w02d-wallet-preflight.md), 2026-10-08: comando independiente `--check` sobre env
explícito, SQL read-only antes de RPC/red/bloque observado, límites y errores sin claves/URLs privadas.
SDK y endpoints de fixture locales; no carga `.env`, inicia el juego ni aplica SQL. W02 sigue parcial.
[W02e](delivery/w02e-erc721-reader.md), 2026-10-08: lector ERC-721 de contrato fijo y token/bloque
explícitos, con EIP-1898 por hash/canonical, interfaz reportada y ownerOf; CLI independiente.
27/27 seleccionadas locales (14 nuevas + 13 W02d), con ABI contrastada por viem y CLI loopback.
Transporte W02d extraído preservando su API/secuencia; sin permisos, SQL, tokens/contrato real o host.
[W02f](delivery/w02f-erc1155-reader.md), 2026-10-08: lector de cantidades ERC-1155 por
holder/tipo/bloque explícitos, con CLI separado. 42/42 seleccionadas locales (15 nuevas + 27 W02d/e),
uint256 decimal exacto incluido cero, ABI contrastada con viem y CLI loopback. Fallo no equivale a cero;
sin inferir tirada/licencias, reservar copias, conceder uso ni probar contratos/testnet reales.
[W02g](delivery/w02g-local-evm-rehearsal.md), 2026-10-08: lectores/CLIs verificados contra bytecode
Solidity ejecutado en EVM en memoria, fixtures OpenZeppelin y loopback. 49/49 seleccionadas locales
(7 nuevas + 42 W02d/e/f): mint/transferencias/historia/revert, saldo exacto y raíces preservadas al leer.
Paquete privado con lock propio; chain ID 31337 y bloques/canonicalidad sintéticos. Sin RPC/testnet real,
contrato público, gas pagado, Supabase/SQL/host o permiso jugable; no cierra derechos/custodia.
[W02h](delivery/w02h-amoy-rpc-check.md), 2026-10-08: diagnóstico RPC Amoy por hash e identity
precompile, 58/58 seleccionadas locales (9 nuevas + 49 anteriores) y CLI contra RPC público real
satisfactorio: chain 80002, formato aceptado, echo y bloque estable; cero gas/transacciones.
No demuestra finalidad, conformidad completa EIP-1898 o contrato NFT; no selecciona proveedor de operación.
[W02i](delivery/w02i-amoy-erc721-pilot.md), 2026-10-08: contrato ERC-721 experimental con
constructor/mint solo 80002, operador explícito inmutable y metadata sin derechos de juego;
artefacto reproducible, 68/68 seleccionadas locales (10 nuevas + 58 previas), runtime contrastado
con sus inmutables. EVM con 80002 simulado y bloques sintéticos; sin NFT público, gas o pagos.
Siguiente W02j: dirección pública del operador/deployer y wallet de firma; simulación/envío testnet,
recibos/código y lectores contra mint/transfer reales. Sin claves por defecto o secretos en chat.
Origen/proveedor operativo, Supabase y extensión reales pendientes; cerrar producto antes de
W03/W04. Fixtures W02g/receptores auxiliares no desplegables; el nuevo artefacto W02i es preparatorio.
[W02j-a](delivery/w02ja-amoy-deployment-review.md), 2026-10-08: preparación offline con direcciones
públicas de deployer/operador explícitas, constructor exacto, artefacto reproducible y runtime esperado
con inmutables; 78/78 locales (10 nuevas + 68 previas). Sin RPC, gas estimado, firma/envío o NFT público.
W02j sigue parcial: W02j-b simulación/estimación pública con wallet/direcciones y presupuesto de prueba;
W02j-c firma/envío/recibos y lecturas históricas públicas. Dirección/wallet del autor todavía ausentes.
[W02j-b](delivery/w02jb-amoy-deployment-simulation.md), 2026-10-09: herramienta read-only lista,
97/97 locales (19 nuevas + 78 previas). Creación eth_call por hash exige runtime completo;
estimateGas por número y bloque/red releídos, productos en wei con gasPrice observado.
Límite explícito solo de simulación; no fee cap/costo mainnet ni permiso de gasto. Sin RPC externo
en este corte/firma/envío. Falta correr con direcciones/RPC del autor; W02j-c público permanece abierto.
Transporte de lectores/SQL013/host/juego intactos; W05 futuro y la cola general conservados.
**Dirección W05 aprobada por el autor, 2026-10-08:** [taller modular](briefs/w05-modular-equipment-direction.md),
sable con pocas hojas/mangos/guardas primero, componentes de catálogo con distintos atributos;
diseño/plano, receta/materiales/oficio e instancia separados. GLB/IA/escultura/armaduras después.
Stats solo por reglas del servidor; crear y jugar sin wallet. Dirección futura, sin piezas/recetas/editor
nuevos ni adelantar W05 sobre el piloto actual/cola general; valores/licencias/pérdidas siguen abiertos.

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

## 3. Estado (2026-10-08)

**Corrección del HUD ordinario, 2026-10-09:** [informe](delivery/live-hud-publication.md),
alpha.16/protocolo 32. Escritorio usa el HUD compacto de referencia: sin barra superior ni sticks,
con Q/I/E en tarjetas y V/M al asignar centrar/mapa. Casco junto a barras del personaje;
viento/rumbo y carga reales. Cubierta distingue cuerpo naval retenido de control del timón.
21/21 focales, 3/3 recorridos ordinarios emulados y 12 capturas; teclas, selector, pausa, amarre y
limpieza comprobados. Avance previo subido en `1a3ef18` y `be1634f`; Git no prueba despliegue público.

**Herramientas y minería D08c.7d:** local **alpha.16/protocolo 32**, conserva S21 y L02c.
[Entrega](delivery/d08c7d-tools.md): madera/hacha/pico desde mochila vacía, dos ranuras fijas de
cinturón saneadas/guardadas; hacha para palmeras, pico para 24 rocas/6 vetas. 206 nodos con los
176 anteriores conservados. Progreso compartido y rendimiento final, grietas/pico/astillas/audio;
mineral de hierro bruto distinto de hierro, sin fundición ni stock de mercado. **121 casos únicos
pertinentes verificados** (120/121 serial + 5/5 focal tras actualizar whitelist de snapshot),
**3/3 vistas emuladas** y reentrada firmada, capturas inspeccionadas. Incidencias de banco/QA en
la entrega; 14 archivos pasan sintaxis. Sin texturas nuevas/SQL/publicación; nodos/regeneración
de sesión. Siguen mantener/timing opcional, luego metalurgia/recetas/aportes comunitarios.

**Recolección por la isla D08c.7c:** local **alpha.14/protocolo 30**; conserva L02c.
[Contrato](briefs/d08c7c-harvest.md) y [entrega](delivery/d08c7c-harvest.md): 176 nodos reales
(96 palmeras cortables, 69 piedras recogibles, 11 troncos sueltos). Tres F/touch → dos troncos;
hacha contextual, audio, astillas/hojas, caída y tocón compartido. Mochila → banco por tandas
→ madera de construcción/reparación. El catálogo se envía al admitir/cambiar, se conserva en
cliente entre snapshots y la admisión invalida cualquier envío previo a HELLO.
**87/87 seleccionadas en serial + 3/3 vistas emuladas**, capturas inspeccionadas y guardado
firmado/reentrada. Incidencia de admisión y carrera de un test previo bajo carga documentadas.
Reutiliza S05/S02/S19/S14; cero texturas nuevas, sin SQL/publicación/cambio de terreno o cupo.
Materiales guardados; nodos/golpes/reloj aún de sesión, reiniciar host repuebla. No afirma
persistencia antifarming ni FPS físicos. El autor priorizó este corte; después seguir §8.1
del plan del mundo con aporte atómico antes de tablero/artesano/aprendizaje.

**Banco de materiales D08c.7b:** local **alpha.13/protocolo 29**; conserva L02c.
[Contrato](briefs/d08c7b-workbench.md) y [entrega](delivery/d08c7b-workbench.md): F/touch abre
receta actual de madera, materiales, cantidad y espacio; tandas completas, un débito/revisión y
replay exacto. Cerrar/alejarse/regresar conserva la solicitud pendiente y permite recuperar el ack.
**61/61 seleccionadas + 3/3 vistas emuladas**, capturas inspeccionadas, guardado firmado/reentrada.
Reutiliza banco S19/atlas S14; sin assets nuevos, terreno, SQL ni publicación. No es A1 comunitario.
Siguiente: contrato de aporte atómico inventario/proyecto/recibo y recuperación antes del tablero,
artesano y aprendizaje personal; perfiles/autosave de mundo actuales son independientes.
Plan de tres pueblos/corredor aprobado como base; cifras de capacidad siguen objetivos no medidos.

**Circuito naval opcional D08c.12:** local **alpha.12/protocolo 27**.
[Contrato](briefs/d08c12-naval-route.md) y [entrega](delivery/d08c12-naval-route.md):
Probar ruta desde el timón cerca del amarre, tres boyas en orden y regreso con Amarrar real.
Una batería anclada lanza salvas hacia marcas fijas con aviso de dos segundos; golpea piezas
vivas del casco girado. Hasta 6 HP por impacto/24 por ensayo, sin bajar una pieza del 50%;
costa conserva su daño. Condición se guarda/repara, carga/plano se conservan, sin botín/XP.
Cancelar/desembarcar/atraque temprano invalidan el ensayo; progreso/salvas son de sesión.
**15/15 nuevas + 371 previas seleccionadas + 9/9 host**, 395 casos únicos entre pases documentados,
**3/3 vistas emuladas** y capturas inspeccionadas; fixtures/incidencias explícitas en la entrega.
Reutiliza VFX/audio/primitivas existentes;
Unreal revisado e intacto. Sin publicación ni SQL. No es aún rival móvil/destructible ni
armamento del jugador; ese es el siguiente corte. D09/M5 mantienen las pérdidas públicas detrás de su gate.

**Conservación y recuperación D08c.11:** local **alpha.11/protocolo 26**.
[Contrato](briefs/d08c11-raft-recovery.md) y [entrega](delivery/d08c11-raft-recovery.md):
ID/HP por pieza y última pose confirmada del viaje sobreviven guardado/reentrada. La balsa vuelve
detenida, sin piloto ni tripulación; el personaje conserva su checkpoint. Reembarcar exige costa
válida/proximidad; recuperar desde el muelle devuelve la misma nave sin sanar ni duplicar carga.
Pose incompatible/otro seed/sin flotación vuelve al amarre conservando daño y bienes.
**617/617 pertinentes + 3/3 vistas emuladas**, capturas inspeccionadas y cero errores finales.
HMAC guest y CAS de cuenta/store en memoria probados localmente; Supabase live no verificado.
Guardado periódico conserva su ventana; blobs guest antiguos siguen reproducibles y no hay
exposición offline. Sin publicación o SQL. Sigue primera ruta/amenaza PvE acotada con assets
revisados; pérdidas públicas permanentes siguen detrás de D09/M5.

**Reparación D08c.10:** local **alpha.10/protocolo 25**.
[Contrato](briefs/d08c10-raft-repair.md) y [entrega](delivery/d08c10-raft-repair.md):
daño por instancia conservado entre viajes de la sesión; astillero Reparar con HP/coste/confirmación,
débito bodega→mochila, recibo exacto y reconstrucción 1:1 sin duplicados. Refuerzo conserva fracción HP;
retiro devuelve según condición. Porte/carga/producción usan módulos vivos; recuperación desde muelle
conserva stock/plano. **355/355 pertinentes + 3/3 vistas emuladas**, capturas inspeccionadas y pase final
sin errores. Condición/pose no sobreviven desconexión/reinicio; materiales/revisión sí se guardan.
Sin publicación o SQL. Sigue condición/pose durable y después amenaza de ruta; balance/dispositivos pendientes.

**Porte y refuerzos D08c.9:** implementación local **alpha.9/protocolo 24**.
[Contrato](briefs/d08c9-raft-load-limits.md) y [entrega](delivery/d08c9-raft-load-limits.md):
límite mínimo estructura/desplazamiento seguro, tripulación y mochilas consentidas; aviso pesado y
rechazo de zarpe/carga antes de mutación. Refuerzo 1:1 de cimiento cuesta 1 madera + 1 hierro,
sube HP/estructura con cinchas reutilizadas y conserva flotación. Recuperación/reembarque permite exceso
por daño; legacy intacto. **344/344 pertinentes** y **3/3 vistas emuladas**: rechazo de zarpe,
refuerzo confirmado, reentrada firmada y timón/HUD; capturas inspeccionadas, cero errores en el pase final.
Pose/HP del viaje siguen de sesión. No publicación, SQL o aceptación de balance/FPS físico.
Sigue reparación con materiales y después pose/daño durable/primera amenaza de ruta.

**Checkpoint previo, carga y porte D08c.8:** implementación local **alpha.8/protocolo 23**.
[Contrato](briefs/d08c8-raft-capacity.md) y [entrega](delivery/d08c8-raft-capacity.md):
masa/volumen independientes por bien, una masa de catálogo para economía y navegación,
lectura privada por dueño de nave/bodega/mochila, espacio y porte nominal restante.
Editor compara estado confirmado con colocación prevista descontando materiales; HUD naval
reutiliza su lectura de carga. **208/208 focales** pasan, incluidos conservación, saves anteriores,
daño de flotación y exceso que sigue navegable. **3/3 vistas emuladas** pasan con transferencia,
colocación real, guardado/reentrada y timón/HUD; capturas de UI inspeccionadas. La cámara ya no
sigue el apuntado de combate mientras se construye. No aceptación de balance/FPS físico.
Porte es una estimación por flotación existente; masa corporal/tripulantes y mochilas de invitados,
límite estructural/materiales/reserva y bloqueo de carga/zarpe siguen pendientes. No se actualiza
la demo pública ni se aplica SQL. Ese límite operativo y el primer refuerzo se incorporan en D08c.9.

**Creador y bases humanas:** el autor pidió iniciar un personaje modular masculino y femenino en el estilo
de las láminas del explorador/tripulación. [Plan](../PLAN-CHARACTER-CREATOR.md) y
[entrega inicial](delivery/characters-base-v0.md) conservan las referencias y GLB v0.
[P02a anatomía v1](delivery/characters-base-v1.md) añade cuerpo continuo, relieve facial, UV y estudio de
material. [P02b superficies v2](delivery/characters-base-v2.md) añade anillos/parches, extremidades
simplificadas, atlas corporal regional y 7.080 triángulos por base. Comparación v0/v1/v2 y mapas 1024/512
en el visor aparte; tres poses y 16 muestras de carrera CPU, escritorio/móvil emulado sin errores. Ejecutar
`node tools/character-lab/server.mjs` y abrir `http://127.0.0.1:5194`.
[P02c rostro/manos v3](delivery/characters-base-v3.md), 2026-10-08: dedos/pulgar estáticos conectados,
relieve facial y pies redondeados, 10.216 tris por base, guía alpha con prompt/origen y acercamientos
de mano/pie. Cuarenta capturas y tres poses/16 muestras CPU; v0/v1/v2 conservadas.
P02 mantiene refinamiento artístico, rig de dedos, atlas y acabado antes de los módulos de cabello/barba/ojos/prendas,
creador, perfil y equipo visible. Los índices legacy y la animación corporal actual tienen contrato de
compatibilidad en el plan. El corte acompaña M5/D08/agentes y permanece fuera de la partida.

**Rechazo visual del autor, 2026-10-08:** rechazó todas las bases procedurales existentes y las mallas de
apariencia por feas y muy alejadas de la referencia más reciente de Horizon Tides. Se conserva el prototipo
como evidencia técnica, no como arte aprobado. P03a tuvo 13/13 pruebas CPU históricas; su QA de navegador
falló (error de red/escritorio y cierre durante móvil), la evidencia HTTP está pendiente y el catálogo de
arte en revisión 31 no contiene filas `char-appearance-*`. Su lógica de piezas/IDs/paletas/exportación puede
reutilizarse. P02/P03 permanecen abiertos y no hay integración de estos visuales en partida.

**Kit ilustrado alpha v1, 2026-10-08 — QA técnica local pasada:** 13/13 aserciones de navegador, ocho
capturas, 26 PNG móviles solicitados y 62 recursos HTTP verificados. Se conservan 29 intentos; 27
seleccionados (26 alpha y un puerto opaco) suman 32,320,538 bytes; derivados móviles seleccionados,
4,290,112 bytes. Los dos descartes son `male-eyes-blue-v1` (fallo alpha) y `male-beard-short-v1`
(contorno flotante, alpha válido); se eligieron v2 para ambos. Recortes/offsets ajustados en runtime, PNG
originales intactos; barba con máscara `base` que sigue la mandíbula. [Entrega](delivery/character-alpha-v1.md).
El autor aceptó el look como dirección para el piloto 3D el 2026-10-08. Registro global en catálogo pendiente;
no se cierra P02/P03 ni se integra a partida. No se afirma coincidencia pixel por pixel ni rendimiento físico.
[Piloto Meshy](delivery/character-3d-pilot-v1.md): MCP oficial 0.6.1 instalado/configurado fuera del checkout,
handshake directo y 24 herramientas comprobados; falta API key. Petición inicial preparada desde el master
masculino; cero generaciones enviadas y ningún modelo 3D producido en este corte.

**Avance local posterior de navegación:** D08c.6 conecta la partida ordinaria al circuito costero,
**alpha.6/protocolo 21**. [Entrega y evidencia](delivery/d08c6-live-coastal-loop.md): timón/cubierta,
carga real, corrientes/ráfaga, cámara/audio/VFX/touch, contacto/HP por pieza, desembarco/reembarque/atraque.
Recolección/crafting avanza en el checkpoint siguiente. Pose/daño siguen siendo de sesión; amarre/plano/bodega
se conservan. Este checkpoint no actualiza la URL pública ni aplica SQL; D09/D10 y dispositivos siguen abiertos.

**Loop de materiales D08c.7:** implementación local **alpha.7/protocolo 22**.
[Contrato](briefs/d08c7-resource-loop.md) y [entrega](delivery/d08c7-resource-loop.md):
nodos autoritativos de troncos/piedra → mochila → banco del puerto (1 tronco → 1 madera)
→ bodega/editor existente. 154/154 focales, incluido guardado firmado/reentrada y
masa refrescada al reembarcar tras recoger en tierra. Sin receta de piedra ni tiers completos;
agotamiento de nodos es de sesión, no durable. **3/3 recorridos emulados** PC/móvil horizontal/
vertical rotado pasan, con capturas inspeccionadas, entradas reales y cero errores JS/consola;
fixture de posición/encuadre explícita en la entrega. No se actualiza la demo pública ni se afirma
rendimiento/aceptación física.

**UI naval móvil de referencia:** timón izquierdo, dial con fuego, tres acciones reasignables por
pulsación larga de 500 ms y stick compacto de cámara. Preferencias locales sobreviven costa/reembarque;
solo se ofrecen acciones reales. 43/43 pruebas focales y 3/3 vistas de navegador emulado aprobadas,
con capturas inspeccionadas en la [entrega D08c.6](delivery/d08c6-live-coastal-loop.md).
Pulido posterior local: timón más pequeño, botones derechos compactos, viento transparente
junto a la brújula y barra del casco integrada bajo las estadísticas del personaje; ver la
evidencia compacta y sus verificaciones en la misma entrega.
13/13 de interacción y 3/3 tamaños emulados aprobados para este pulido; capturas inspeccionadas.
Composición posterior: timón 8 px más abajo, chat cerrado por encima y habilidades en arco
regular alrededor del velocímetro; la entrega conserva evidencia propia de esta pasada.
Arco/chat: 3/3 vistas emuladas aprobadas tras el último ajuste, panel visible y controles
recuperados al cerrar; capturas finales inspeccionadas en la misma entrega.
Porte/materiales: enfoque aprobado por el autor el 2026-10-07 en
[NAVAL-ROADMAP §2.1](NAVAL-ROADMAP.md#21-porte-y-mejoras-del-barco--revisión-2026-10-07):
masa/volumen separados, capacidad por estructura/flotación y upgrades para transportar más.
El peso ya afecta manejo; D08c.8 separa masa/volumen y muestra porte nominal. Límite estructural,
tripulación y upgrades de porte siguen sin implementar. Cifras y márgenes pendientes de calibrar; esta aprobación no activa bloqueos
nuevos de carga ni pérdidas. La primera receta/recolección se integra en D08c.7; sigue la
lectura de D08c.8 queda implementada antes de límites, tiers y recetas regionales.

**Demo actualizada y fuente subida:** [entrega del 2026-10-06](delivery/demo-update-20261006.md),
fuente `f89bec5`, alpha.4/protocolo 16. **745/745** sobre commit aislado, paquete/hash verificados;
153 archivos públicos coincidentes y canario de dos invitados por HTTPS/WSS aceptado.
Host PC/ngrok encendido al verificar, Auth configurado/mundo cargado y cero errores; URL actual en
`URL-PARA-AMIGOS.txt`. Bahía D08a aparte en 5180. No activa staging durable de perlas ni pilotaje;
móvil D06b, visual D08a y dispositivos físicos siguen pendientes. No se aplicó SQL ni se abrió navegador.

Prueba inicial desde el PC (histórica, 2026-10-05): [lanzador y evidencia](delivery/pc-host-playtest.md). `JUGAR-CON-AMIGOS.cmd` levanta el
host 5173 y un túnel HTTPS; en este equipo usa ngrok ya configurado. `DETENER-JUEGO.cmd` apaga con flush.
15/15 pruebas pertinentes; dos invitados y movimiento compartido comprobados por HTTPS/WSS público.
Servidor encendido al aceptar; la URL actual está en `URL-PARA-AMIGOS.txt` ignorado. Cada jugador usa su GPU;
recorrido humano con el amigo/FPS físicos siguen pendientes. Sin cambiar protocolo ni cerrar D04 P2.

| Milestone | Estado |
|---|---|
| M1 … M4.6 | ✅ (ver `DESIGN.md` §16) |
| **M4.7 «Tatuajes»** | ✅ (cómic Ultra, huecos Q/E, los tres tatuajes, apuntar y VFX, pestaña y Doña Sepia) |
| M4.8 «Perlas negras» | **rc.1**: kit pulido y probado; aceptación física y publicación pendientes (`PLAN-M4.8.md`) |
| M5 mundo persistente (Supabase) | **P1–P3 + base D09a–e y D09f server-only**: 003–006 reales; same-holder commit/recuperación 21/21. Efecto común sim/staging 745/745 aisladas; lote death/reemplazo storage 481/481 pertinentes, 007 pendiente real. Afinidad, diario/cola/staging de lote, hooks/restauración/adopción/leases y publicación abiertos (`PLAN-M5.md`) |
| M6 «La Balsa» | **P1–P3 + P4 parcial + D08c.6 circuito costero local integrado**: navegar/desembarcar/reembarcar/atracar; recolección/crafting, agua/hamaca/luces, riesgo durable/PvE, dispositivos y publicación pendientes (`PLAN-M6.md`) |
| M7 comercio | **P1–P2 local**: mercaderes Aldea/Cala, panel con cotización/compra/venta; iconos por bien/muerte/rumores/balance regional/publicación pendientes (`PLAN-M7.md`) |
| M8 construcción en pueblos | núcleo de solares hecho; plan (`PLAN-M8.md`) |
| Assets externos | ✅ (`docs/ASSETS.md`) |
| Jugar en línea en un servidor propio | ✅ (`docs/DEPLOY.md`) |

### Pilar esencial — humanos/agentes y chat C01 (2026-10-07)

- El autor promueve agentes a parte **esencial** y ordena empezar por chat ingame; sustituye la
  prioridad baja del 2026-10-05. Mente LLM conversa/decide, cuerpo determinista actúa, feedback textual.
- Orden propio: **C01 → L00 → L01 → L02 → L03 → L04/L05 → L06**. [Brief C01](briefs/c01-chat.md):
  mundo (instancia), cerca (posición/radio autoritativo) y susurros privados; WebSocket/`ws` existente,
  identidad de sesión y confirmación de routing. Agentes usarán el mismo contrato y solo su audiencia.
- C01 implementado y verificado localmente: [entrega](delivery/c01-chat.md), **17/17 pertinentes**,
  conversación de dos invitados por UI y tamaños reducidos revisados. Regresión general **1707/1708**:
  timeout de dos jugadores pasó aislado, causa exacta abierta. Sin despliegue ni ensayo físico.
  **alpha.5/protocolo 20** fue el corte C01 y requiere cliente/servidor compatibles; las entregas navales
  posteriores avanzan el protocolo. L00 usa contrato propio, separado de esa constante.
  [Pulido visual C01](delivery/c01-chat-style.md): cristal azul, colores por canal, iconos y compositor
  responsive; 10/10 del chat y capturas sobre el juego. Local, sin nuevo protocolo ni publicación.
  [Burbujas sobre personajes](delivery/c01-chat-bubbles.md): Cerca inicial, susurros solo a participantes,
  panel como historial; 18/18 pertinentes, tres clientes y capturas PC/vertical/horizontal. Sin despliegue.
  Modelo real, historial durable, BYOK, offline/PvP y negocio pendientes. Construcción/naval/M5
  continúan; D09 sigue siendo puerta para bienes en riesgo. No habilita proveedores ni cobros.
- El autor pide completar el plan de agentes **paso a paso con una línea de acuerdo por parte**.
  Registro único en [PLAN-EXTRA-LLM §4](../PLAN-EXTRA-LLM.md#4-cortes-de-desarrollo-y-aceptación):
  Las 22 líneas L00a–L06e tienen dirección acordada; L00, L01a/b/c y L02a/b tienen evidencia local;
  L02c añade autoridad opt-in, L03a API/mente simulada y L03b conversación simulada verificadas localmente;
  L03c tiene metas/feedback y ciclo local simulados; L04a tiene memoria local con resúmenes simulados;
  L04b tiene administración local verificada; L05–L06 siguen pendientes, con demostración
  y estado de diseño/implementación por fila.
  **D-A1 acordada:** personaje propio y plaza normal; su dueño autoriza capacidades y puede detenerlo.
  El autor añade autonomía para elegir metas/acciones dentro de límites de gasto del usuario y archivos
  reales de personalidad, memoria y objetivos visibles para su dueño. Distinguir inferencia de bienes
  del juego; la visibilidad comienza con los archivos del runner L01, memoria persistente en L04.
  **D-A2 acordada:** primera prueba de conversación, movimiento y ayuda en PvE; después comercio,
  construcción y barcos. **L00b/D-A8 acordada:** estado propio, entorno observable y chat recibido,
  distinguidos de predicción/recuerdos y con frescura. El autor exige poda/compactado/optimización:
  archivo de memoria separado del contexto por consulta, recuperación pertinente y presupuesto de
  la petición completa; fuentes/resúmenes visibles. Diseñar en L00, aplicar desde L03 y persistir en L04;
  medir también el coste de resumir y comprobar que historial creciente no dispara el prompt.
  **L00c/D-A9 acordada:** órdenes identificables, acotadas y cancelables; feedback de envío,
  ejecución, confirmación, rechazo e incertidumbre. **L00d/D-A10 acordada:** ciclo con decisiones
  simuladas, errores/desconexiones/cancelaciones e historial enorme antes de conectar un LLM.
  Las cuatro líneas L00 tienen contrato/defaults de laboratorio y pruebas locales verificadas;
  integración real, balance y cifras de producto permanecen pendientes.
  **L01a acordada:** cliente textual sin gráficos conectado como jugador normal; observa/actúa
  con feedback, humanos ven su personaje y el dueño inspecciona sus archivos. Adaptador invitado
  verificado localmente; L02c añade vínculo/control opt-in del servidor, sin provisioning ni UI de lanzamiento.
  **L01b acordada:** recepción/envío de Mundo, Cerca y susurros con identidad/reglas humanas y
  audiencia del personaje. [Adaptación invitada verificada localmente](delivery/l01b-agent-chat.md);
  la elección de respuestas LLM llega en L03.
  **L01c acordada:** stop/muerte/desconexión limpian tareas/inputs; reentrada con estado fresco,
  descartando órdenes/respuestas antiguas y conservando incertidumbre sin repetir acciones.
  L01a/b/c tienen software invitado local con vida/reentrada comprobadas. **L02a acordada:** ir a un punto,
  seguir y mantener distancia con colisiones y feedback de progreso/llegada/bloqueo/cancelación,
  sin una consulta LLM por cada paso. [Controlador local verificado](delivery/l02a-agent-movement.md):
  rutas directas acotadas, radio y bloqueo; navegación general no aceptada.
  **L02b acordada:** modos agresivo, defensivo y de apoyo para atacar/proteger/retirarse/reaccionar
  a amenazas en PvE mientras la mente piensa, con recursos/daño/colisiones/recargas del jugador.
  [Controlador/encuentro local verificados](delivery/l02b-agent-pve.md); defaults de ensayo.
  **L02c acordada:** stop/revocación prevalecen; el servidor invalida
  el control anterior, cancela tareas, limpia entradas pendientes y rechaza respuestas tardías, con un
  único controlador autorizado por personaje. [Autoridad opt-in verificada localmente](delivery/l02c-agent-authority.md):
  cuentas separadas, epoch/CAS, prioridad y cola neutralizada antes del siguiente tick permitido.
  Provisioning, panel, vínculo persistente y coordinación entre hosts pendientes.
  **L03a acordada:** mente LLM intercambiable, decisiones estructuradas, contexto relevante/compacto
  y límites de tokens/gasto/tiempo; latencia o fallo no detienen el cuerpo.
  [API y modelos simulados verificados](delivery/l03a-agent-mind.md); proveedor/tokenizer/facturación
  reales y gasto durable pendientes.
  **L03b acordada:** personalidad en Mundo/Cerca/susurros dentro de permisos, solo mensajes entregados,
  charla y órdenes autorizadas diferenciadas, sin ampliar permisos ni crear bucles entre agentes.
  [Turnos explícitos y C01 verificados con modelos simulados](delivery/l03b-agent-conversation.md),
  con audiencia fijada y supresión por proceso; proveedor/calidad/experiencia humana pendientes.
  **L03c acordada:** metas ajustadas con feedback dentro de permisos/gasto,
  objetivos visibles mientras el cuerpo actúa y validar el ciclo junto a un humano en PvE.
  Metas/archivos y ensayo PvE local simulados verificados; encuentro y aceptación humana pendientes. **L04a acordada:** personalidad/objetivos/recuerdos entre
  sesiones, fuentes/vigencia, recuperación relevante y compactado trazable dentro del presupuesto del prompt.
  Journal/recuperación y reentrada locales verificados con resúmenes simulados; calidad/proveedor reales pendientes. **L04b acordada:** consulta/exportación de archivos reales,
  borrado de recuerdos con sus resúmenes/índices derivados, aislamiento por dueño y reglas de retención.
  Consulta/exportación/borrado y retención/migración explícitas verificados localmente en L04b. **L05a acordada:** límites del dueño y reserva antes de inferencia
  incluido compactado, consumo registrado, bloqueo de nuevas llamadas sin presupuesto suficiente,
  aviso y claves fuera del juego. Operación/importes/pruebas pendientes. **L05b acordada:** panel del dueño
  con modelo/estado/tarea/consumo/límites, medición/estimación/desconocido, archivos reales, ajuste de límites
  y stop. Panel/pruebas pendientes. **L06a acordada:** piloto social/PvE pequeño con agentes identificables,
  percepción/permisos del personaje exigidos por el servidor y aislamiento/carga comprobados antes de
  ampliar acceso. Piloto/autoridad/pruebas pendientes. **L06b acordada:** inventario/compra/venta dentro de
  permisos y presupuesto del juego separado de inferencia; reglas humanas, guardado/recuperación verificados
  por operación y reintentos/reconexiones sin duplicar cobros ni objetos. Comercio/contratos/pruebas pendientes.
  **L06c acordada:** construcción con cuerpo/comandos comunes, planos válidos, propiedad y límites de
  materiales/gasto; desmontar/destruir como capacidades autorizadas por separado. Construcción/permisos/pruebas pendientes.
  **L06d acordada:** tripulación/navegación autorizadas, mente para destino/táctica, cuerpo para mandos
  humanos y permisos del barco/carga/colisiones; ruta costera y tarea de cubierta. Cuerpo naval/permisos/pruebas pendientes.
  **L06e acordada:** evaluación con humanos de experiencia/recuperación/efectos económicos/coste de
  inferencia/carga y decisión de ampliar o ajustar el piloto con evidencia. Evaluación y decisión pendientes.
  Dirección de las 22 líneas acordada; [L00 v1](agents/interface-v1.md) y su
  [fixture/evidencia](delivery/l00-agent-interface.md) ya están verificados localmente.
  [L01a](delivery/l01a-agent-network.md): personaje invitado/plaza normal, movimiento visible desde
  navegador, swing de práctica por inputs normales y archivos reales/scope/revisiones/hashes.
  73 aprobadas, una omitida por EPERM de symlink; 12/12 de regresión chat/red en esa entrega.
  [L01b](delivery/l01b-agent-chat.md): recepción/envío por C01, tres clientes ordinarios y privacidad
  de susurros, rechazo/reintento y contexto podado con omisiones visibles. 87 aprobadas, una omitida
  por symlink Windows; 20/20 de regresión chat/burbujas/red, dos capturas inspeccionadas.
  [L01c](delivery/l01c-agent-lifecycle.md): muerte/corte/stop, archivo de resultados acotado y
  reentrada explícita con sesión/snapshot frescos, IDs anteriores bloqueados y cero reanudación automática.
  96 aprobadas, una omitida por symlink Windows; 20/20 de regresión chat/burbujas/red.
  [L02a](delivery/l02a-agent-movement.md): ir/seguir/mantener distancia por inputs normales,
  feedback de posición confirmada, cancelación/CLI y bloqueo en terreno controlado. 114 aprobadas,
  una omitida por symlink Windows; 20/20 de regresión chat/burbujas/red.
  [L02b](delivery/l02b-agent-pve.md): agresivo/defensivo/apoyo, interposición/guardia, retirada,
  reservas/recarga y obstáculo en encuentros invitados controlados. 142 aprobadas, una omitida por
  symlink Windows; 63/63 de regresión chat/burbujas/red/combate/armas/Sin ley/items en esa entrega.
  [L02c](delivery/l02c-agent-authority.md): binding server-owned y runner autenticado opt-in,
  exclusividad, prioridad directa/meta/reflejo, epoch/CAS y limpieza de cola/carry/último input.
  163 aprobadas, una omitida por symlink Windows; 206/206 de regresión de host/cuentas/naval/chat/combate.
  Protocolo 28; entrada npm apagada por defecto, sin aplicar migraciones ni tocar servicios externos.
  [L03a](delivery/l03a-agent-mind.md) añade mente intercambiable/decisiones estructuradas, contexto completo
  podado/compactado, reservas/uso desconocido, timeout y una consulta en curso. 211 pruebas de agentes
  aprobadas, una omitida por symlink Windows; 206/206 de regresión. WebSocket y CLI locales con modelos
  simulados; proveedor/tokenizer/facturación reales pendientes.
  [L03b](delivery/l03b-agent-conversation.md) añade conversación explícita sobre chat entregado,
  personalidad, audiencia fijada, contexto inspeccionable y límites contra respuestas repetidas;
  WebSocket/CLI locales simulados. [L03c](delivery/l03c-agent-goals.md) añade metas con feedback,
  archivo real revisado y ensayo PvE local frente al cuerpo sin modelo. [L04a](delivery/l04a-agent-memory.md)
  añade journal local persistente, recuperación y resúmenes con fuentes/incertidumbre, escritura/CLI/reentrada
  y coste de compactado verificados con modelos simulados. [L04b](delivery/l04b-agent-memory-admin.md) añade
  consulta/exportación byte exacta, borrado con derivados/pendientes y retención/migración explícitas locales.
  Sigue L05a; proveedor, encuentro/aceptación humana y calidad pendientes.
  Provisioning/UI, percepción autoritativa, gasto real, memoria
  con operación remota y evaluación humana siguen pendientes. Sin publicación ni despliegue.

### Dirección visual del puerto (2026-10-06)

- El autor aportó una referencia de puerto tropical de cómic pintado y su lista de assets/materiales.
  Precisión posterior: ilustrado moderno/tipo sprite cercano a Borderlands; láminas de arena y palmera.
  [Catálogo HTML local](../tools/art-catalog/README.md) en `CATALOGO-DE-ARTE.cmd` / puerto 5190:
  80 filas con referencia, archivos reales, variantes, notas y destino. Guardado en JSON del proyecto,
  uploads versionados en `docs/art/catalog-files/` y ficha de integración por pieza.
  [PLAN-VISUAL-PORT](../PLAN-VISUAL-PORT.md) analiza composición, formas, color, luz/agua y las brechas
  frente al renderer; propone materiales, kit compartido, presupuestos y cortes V00–V08 ligados a A05/M8.
  El índice del trabajo por familias está en [docs/art/README.md](art/README.md).
- Reutilización inicial: atlas de balsa 1024/512, crate Dreamrise y geometría procedural. Roughness,
  metallic y AO no se conservan en el adaptador toon actual; su consumo es trabajo propuesto.
- **Catálogo local implementado**: [entrega](delivery/art-catalog.md), 7/7, guardado/uploads y
  PC/móvil emulado en fixture, 14 enlaces verificados en su entrega inicial. Originales ahora encontrados
  en `materials/references/`; lámina de arena copiada y registrada en sus cinco filas.
- **Familia arena aplicada localmente:** [entrega S01](delivery/sand-family-v1.md), **10/10** y capturas
  reales de inicio/costa PC y móvil emulado. Nueve PNG del autor intactos y WebP 1024/512, nueve mapas
  únicos en manifiesto; seca, mojada con normal compartida, ondulada, par pintado de huellas y
  muestra recortada de arena de orilla. Shader albedo/normal, máscaras del terreno y agua animada existentes.
  Registro por filas con pares/evidencia; `PROBAR-ARENAS.cmd` / puerto 5192 abre el juego actual en solo.
  Compactada se incorpora después en S03; conchas grandes pendientes. Repetición/densidad y arte final abiertos.
  Ampliación [huellas dinámicas](delivery/sand-footprints-v1.md): apoyos alternados, 18–5 s según humedad,
  una malla/pool con límite PC 256/táctil 128/baja 96; banda estática apagada por defecto. **35/35**,
  caminata y desaparición PC/móvil emulado revisadas. Cosméticas, sin persistencia ni deformación.
  v1/v2 generadas conservadas. Muestras Unreal revisadas; arena fotográfica no elegida.
  El puerto completo sigue propuesto; sin benchmark físico ni publicación.
- **S02 rocas de playa aplicadas localmente:** [entrega](delivery/coast-rocks-v1.md), **41/41** pertinentes.
  SM_Rock exportado desde copia aislada, cuatro dependencias/hashes verificados; GLB 7.964 B/64 tri,
  sin texturas nuevas. Tres siluetas pintadas en ocho rocas existentes de arena; colisiones/mapa conservados.
  PC/móvil/low y fallos 404/GLB inválido/noassets revisados. Catálogo revisión 6, fila `roca-playa`
  con fuente/modelo/capturas. `?solo&debug&q=high&tod=day&art=rocks` en preview 5192 lleva al ensayo
  tras Jugar. Revisión artística del autor pendiente; conchas/cantos y palmas siguientes por filas.
- **S03 suelos y transiciones aplicados localmente:** [entrega](delivery/ground-family-v1.md), **46/46** pertinentes.
  Ocho PNG del autor intactos; hierba, tierra seca, transición arena–hierba y arena–tierra compactada.
  Dos atlas compartidos PC 2048/móvil 1024; descarga nueva 8.37/2.23 MB, cuatro filas/revisión 7.
  Playa/sendero/pueblo/arena PC/móvil/low y pérdida de color/normal/noassets revisados; shader enlazado,
  14 samplers de 16. Plaza central de piedra preservada, altura/colisiones/clasificación sin cambios.
  El ensayo corregido mantiene proyección mundial para evitar franjas al estirar el degradado.
  Arte fino/repetición/FPS físicos y publicación pendientes; conchas/cantos/palmas siguen abiertos.
- **S04 conchas y cantos aplicados localmente:** [entrega](delivery/beach-details-v1.md), **50/50** pertinentes.
  Tres conchas propias y un grupo de tres cantos derivado del SM_Rock S02: cuatro GLB, 49.176 B en total,
  normales geométricas/color por vértice, sin texturas nuevas. Nervaduras pintadas en shader, también en low.
  Semilla actual: 100 conchas/58 grupos, máximo global 144/96; hash de renderer, props/RNG/colisiones intactos.
  PC/móvil emulado/low y 404/GLB inválido/noassets revisados; catálogo revisión 9, 33 enlaces exactos.
  Fuentes descargables como snapshots de código; muestrario temporal 1,7× distinguido del mapa real.
  Arte final/FPS físicos/publicación pendientes; la base y raíces avanzaron después en S06.
- Siguiente de esta línea: [V00 baseline](briefs/visual-v00-port-baseline.md), luego composición gris V01
  y un rincón acabado V02. Ensayos aislados paralelos; topología/cubiertas funcionales requieren sus
  entregas de gameplay. Mantener la cola y gates D06/D08/D09 y los cambios navales ajenos.

- **S05 familia de palmeras aplicada localmente:** [entrega](delivery/palm-family-v1.md), tres GLB de dos partes
  (1.016/1.064/1.112 triángulos; 377.204 B en total) y atlas compartidos del autor color/normal v2 (1024 PC,
  512 móvil; 1.052.630 B PC y 357.894 B móvil). La semilla actual muestra 234 palmas (93/77/64); selección por
  hash de coordenadas local al renderer, sin consumo de RNG ni cambios de colisión. Frondas recortadas con alpha
  0,35 en color/normal/contorno y MeshDepth; viento conserva ecuación y reloj. Sombra de fronda aislada probada con
  radio 0,35 configurable y mapas existentes (2048 high/medium, 1024 low, half 30): en la captura de escritorio
  cambian dos huecos al comparar viento 0/2,1; en móvil medium no hubo error de shader y en low los huecos pequeños
  desaparecen a 1024. **56/56** pruebas y 4 comprobaciones sintácticas, dos recomputaciones del generador pasaron.
  Ocho casos visuales (tres modos y cinco fallos) terminados sin errores JS/shader. Snapshots de seis fuentes
  verificados con --check; catálogo revisión 10: 80 filas, 24 aplicadas, 52 enlaces de palma exactos por bytes
  comprobados en 5190. Los conjuntos S01/S03/S02/S04 (47/44/13/33 enlaces) también pasan y la repetición
  idempotente conserva revisión 10. Revisión artística fina, FPS físicos y publicación pendientes.
  M5/D08 conservan su cola.

- **S06 raíces y plantas bajas alrededor de palmeras, integradas localmente:** [brief](briefs/visual-s06-palm-bases.md),
  [entrega](delivery/palm-bases-v1.md). Dos GLB (`open`/`lush`), 54.728/70.952 B (125.680 B total), 410/540 triángulos.
  Atlas nuevo de hojas color+normal 512×256 PC (74.944 B) y 256×128 móvil coarse (30.006 B); raíces usan el bark UV
  ya cargado por S05. Descarga nueva total por dispositivo: 200.624 B PC / 155.686 B móvil. De las 234 palmeras
  existentes, 144 bases (74 abiertas/70 frondosas); selección por hash local al renderer, sin RNG ni cambios de props,
  colisiones o mapa. Rechaza huellas sobre caminos, agua/muelle, pendientes, NPCs y otros obstáculos. Seis snapshots
  de código inmutables generados y verificados; snapshots S05 históricos conservados. **62/62** pruebas,
  sin omisiones. Ocho QA (PC/móvil/low y cinco fallos), sin errores JS de juego ni GL, programas enlazados;
  atlas realmente cargados 512×256 PC / 256×128 móvil. Modelos ausentes/inválidos usan geometría nativa;
  sin color las hojas usan silueta geométrica, sin normal conservan pintura; noassets añade cero solicitudes S06.
  Fallos esperados de assets en sus fixtures y mensajes auxiliares 404 documentados; consola no totalmente vacía.
  Catálogo revisión 11, 82 filas/26 aplicadas, 47 enlaces HTTP únicos exactos. Conjuntos anteriores
  S01/S03/S02/S04/S05 (47/44/13/33/52) también pasan. Galería temporal 1× oculta personajes solo en muestrario;
  contacto real conserva dither S05. Arte fino, FPS físicos y publicación pendientes; M5/D08 conservan su cola.
- **S07 arbusto tropical integrado localmente:** [brief](briefs/visual-s07-shrubs.md),
  [entrega](delivery/shrubs-v1.md). Tres modelos 424/512/440 triángulos, 79.208 B juntos; atlas color/normal
  512² PC / 256² móvil. Descarga nueva 250.132 B PC / 138.228 B móvil. Seed 99282957: 784 arbustos
  (330 redondos/290 bajos/164 altos), 262 sustituciones y 522 nuevos; 80 anclajes inseguros conservan
  arbusto anterior. Distribución por hash, límite 900, sin RNG/props/colliders. Exclusiones de agua,
  muelle, caminos, zonas volcánicas, pendientes, obstáculos y accesos. Viento y recorte alfa 0,35 en
  color/contorno/sombra, normal 0,16; arte original y fuentes históricas intactos. **63/63** pruebas
  pertinentes y ocho QA (PC/móvil/low y cinco fallos), sin errores JS de juego ni GL; programas enlazados,
  URLs/resoluciones comprobadas. Favicon 404 de preview e inyección de errores de asset documentados.
  Seis snapshots de integración y dos generadores --check pasan. Catálogo conserva concepto y añade
  previews/archivos/evidencia del mapa. FPS físicos, revisión artística fina y publicación pendientes.

- **S08 pasto volumétrico integrado localmente:** [brief](briefs/visual-s08-grass-patches.md),
  [entrega](delivery/grass-patches-v1.md). Seed 99282957: 522 matas/184 grupos, tres siluetas.
  Material opaco compartido sin mapas; 28/36/44 tri cerca y 14/18/22 lejos, instancing en celdas de 24.
  High 600/radio 55; móvil-medium 320/38; low 160/28. Viento suave, recibe sombras existentes,
  sin sombra propia ni pase de contorno. Distribución cosmética por hash, despejes compartidos con arbustos.
  **69/69** pertinentes; PC/móvil/low/noassets sin errores de página/juego/GL, capturas inspeccionadas.
  Misma vista: +8/+6/+2 draw calls y +918/+464/+108 tri respectivamente; no son FPS físicos.
  Nueve snapshots inmutables, fila propia `pasto-volumetrico`; catálogo revisión 15, 83 filas/28 aplicadas.
  Revisión artística del autor, dispositivos físicos y publicación pendientes.

- **S09 madera varada integrada localmente:** [brief](briefs/visual-s09-beach-debris.md),
  [entrega](delivery/beach-debris-v1.md). 34 conjuntos (19 ramas/ocho troncos/siete tablones) sobre
  arena con despejes de accesos, conchas y vegetación. Tres GLB de 18.740 B, 208/96/132 tri;
  tablones derivados de SM_Logs exportado de copia aislada, fuentes Unreal intactas. Material opaco
  compartido con vetas, instancing y límites high 96/65 m, móvil-medium 64/45, low 32/32.
  Sin texturas nuevas ni sombra propia. **77/77** pertinentes y seis casos PC/móvil/low/noassets/404/GLB
  inválido, sin errores JS de juego ni GL; capturas inspeccionadas. Misma vista: +3/+4/+3 llamadas,
  +568/+664/+568 tri respectivamente, no FPS. Once snapshots históricos; registro `restos-playa`.
  Revisión artística del autor, FPS físicos y publicación pendientes.

- **S10 algas someras integradas localmente:** [brief](briefs/visual-s10-seaweed.md),
  [entrega](delivery/seaweed-v1.md). 197/216 posiciones submarinas existentes, tres formas pintadas
  (58 cintas/62 bifurcadas/77 abanicos), oscilación y LOD de 16 tri por mata. Material opaco compartido,
  sin imágenes/GLB nuevos, sombra propia ni pase de contorno. Fondo inclinado y ocho muestras de apoyo;
  puntas sumergidas y muelle despejado. High 256/65/22, móvil-medium 160/45/14, low 96/32/solo reducido.
  **83/83** pertinentes; cuatro QA PC/móvil/low/noassets sin errores JS de juego ni GL, capturas revisadas.
  Misma vista: +4/+7/+4 llamadas y +684/+696/+80 tri; no son FPS. Ocho snapshots históricos;
  fila `hierbas-algas` junto al pasto costero S08, catálogo revisión 17, 83 filas/30 aplicadas, 31 enlaces exactos.
  Espuma/cáusticas actuales limitan lectura fina; calibración de agua, arte final, FPS físicos y publicación pendientes.

- **S11 agua más clara integrada localmente:** [brief](briefs/visual-s11-water-clarity.md),
  [entrega](delivery/water-clarity-v1.md). Trama de espuma más fina/discontinua, cáustica compartida
  0,12 y refracción 0,02 para leer fondo/algas; mismas texturas y superficie de dos triángulos.
  Corrige depth de `rtNormal` al cambiar tamaño antes de usar el framebuffer: falla histórica
  low→medium conservada en evidencia. **88/88** pertinentes; seis casos finales PC/móvil/low/noassets/
  noche/viewport vertical y 24 cambios de calidad sin errores de juego/GL, programas enlazados.
  27 capturas antes/después, once fuentes finales congeladas, catálogo revisión 18, 83 filas/32
  aplicadas y 44 enlaces HTTP exactos. `m11-mar-espuma`/`fondo-marino` aplicadas; `vfx-contacto-agua`
  pendiente. Contadores globales no aíslan coste visual; FPS físicos, arte fino y publicación pendientes.

- **S12 pintura de roca natural integrada localmente:** [brief](briefs/visual-s12-rock-faces.md),
  [entrega](delivery/rock-faces-v1.md). 33 rocas existentes (ocho S02 + 25 procedurales) comparten
  caras pintadas cálidas, fracturas finas y humedad costera; 35 volcánicas/arena de combate/lava mantienen
  su shader anterior. Instancias/matrices/colores/atributos geométricos coinciden por bytes; cero imágenes
  nuevas. Batches espaciales 34→38, mismos 5.312 triángulos y dos materiales de color, sin afirmar FPS.
  **92/92** pertinentes; seis casos finales, 24 cambios de calidad sin errores JS de juego/assets/GL,
  programas enlazados, capturas inspeccionadas. 27 comparaciones y nueve fuentes finales congeladas.
  Catálogo revisión 20, 85 filas/34 aplicadas, 43 enlaces exactos; `roca-cara` y `m03-roca-natural` aplicadas
  a objetos existentes. Terreno no cambia: módulos/caras de acantilado y arcos pendientes; también
  ajuste artístico final, FPS físicos y publicación. Continuidad naval/M5/chat conservada.

- **S13 tablones del muelle integrados localmente:** [brief](briefs/visual-s13-dock-wood.md),
  [entrega](delivery/dock-wood-v1.md). 67 tablas y dos vigas de cubierta reutilizan el atlas de balsa
  1024/512 con cuatro recortes y espejos, sin imágenes nuevas. Misma geometría/posición/fallback;
  un material de color propio y 19.872 B de UV. **105/105** pertinentes, siete casos finales y 28 cambios
  de calidad GL=0, 20 capturas y ocho fuentes finales congeladas. Catálogo revisión 22, 86 filas/35 aplicadas,
  37 enlaces HTTP exactos; M01 extendida y `muelle-tablones` aplicada. Postes/soportes/kit modular,
  arte final/FPS físicos/publicación pendientes; continuidad naval/M5/chat/personajes conservada.

- **S14 madera del pueblo integrada localmente:** [brief](briefs/visual-s14-town-wood.md),
  [entrega](delivery/town-wood-v1.md). Nueve pares del autor en seis casas, un puesto y ocho postes;
  paredes/puerta/ventanas/pisos/parches/vetas/refuerzos. Dos atlas compartidos 2048 PC / 1024 táctil,
  normal lineal 0.18; color ausente recupera el material anterior y normal ausente conserva pintura.
  Mismas 27 mallas / 42.034 triángulos; +1.350.720 B UV/máscara, dos texturas y un material propio.
  **109/109** pertinentes, ocho casos finales / 32 cambios de calidad GL=0, 44 capturas y doce fuentes
  congeladas. Catálogo revisión 24, 97 filas / 44 aplicadas; 101 enlaces exactos y ficha de puerta con
  52 imágenes cargadas. Los 88 registros previos completos se conservaron. Kit modular/huecos,
  techos/toldos, arte fino/FPS físicos/publicación pendientes; naval/M5/chat/personajes conservados.

- **S15 paja/toldo integrados localmente:** [brief](briefs/visual-s15-town-covers.md),
  [entrega](delivery/town-covers-v1.md). Seis casas con pintura de paja y un puesto del mercado con
  lona del atlas existente 1024/512. Misma geometría/mapa/sombras; cero imágenes/mallas/pasadas nuevas,
  +1.350.720 B de máscara/coordenadas. **113/113** pertinentes; siete casos finales, 28 cambios de
  calidad GL=0, 40 capturas y ocho fuentes finales congeladas. Catálogo revisión 28, 101 filas / 46
  aplicadas, 55 enlaces HTTP exactos; las 99 filas iniciales intactas. Ambas fichas abren 42 imágenes
  y 102 enlaces sin errores JS. Fuentes de diagnóstico retenidas; usar `final-v3` para reproducir.
  Kit modular/techo irregular/tela animada/FPS físicos/publicación abiertos. Siguen cuerdas/amarres;
  naval/M5/chat/agentes/Web3/personajes conservan su continuidad.

- **S16 cuerdas del muelle integradas localmente:** [brief](briefs/visual-s16-dock-ropes.md),
  [entrega](delivery/dock-ropes-v1.md). Vueltas sobre ocho postes y dos rollos laterales, atlas existente
  1024/512 compartido, tinte nativo si falta. +1 malla/material, 4.160 triángulos y 108.672 B de buffers;
  cero imágenes/descargas nuevas, sin caster de sombra/contorno. Props anteriores/mapa/RNG intactos.
  **118/118** pertinentes, siete contextos finales y 28 cambios de calidad GL=0; 30 capturas y ocho
  fuentes congeladas. Catálogo revisión 29, 102 filas / 47 aplicadas; 101 filas previas intactas,
  44 enlaces HTTP exactos y ficha con 32 imágenes / 77 enlaces sin errores. Cuerda física/conexión
  a barcos, nudos complejos, arte fino/FPS físicos/publicación pendientes.
  naval/M5/chat/agentes/Web3/personajes conservan su continuidad.

- **S17 barriles y cajas integrados localmente:** [brief](briefs/visual-s17-port-cargo.md),
  [entrega](delivery/port-cargo-v1.md). Ocho barriles cerrados con duelas/aros pintados y siete cajas
  Dreamrise abiertas con veta horizontal; comparten color/normal del pueblo 2048/1024. Cero imágenes,
  descargas, mallas o pasadas nuevas; geometría/mapa conservados. **122/122** pertinentes, tres
  contextos previos y nueve finales, 36 capturas / 36 cambios de calidad finales GL=0. Ocho fuentes
  congeladas. Catálogo revisión 31, 104 filas / 48 aplicadas; otras 102 filas intactas y 58 enlaces
  HTTP exactos. Ambas fichas revisadas, todas sus imágenes decodifican. Variantes adicionales,
  almacenamiento funcional, arte fino/FPS físicos/publicación pendientes; demás continuidades conservadas.

- **S18 faroles y señalización integrados localmente:** [brief](briefs/visual-s18-town-fixtures.md),
  [entrega](delivery/town-fixtures-v1.md). Ocho faroles con madera/jaula oscura y dos letreros con
  veta horizontal y letras frontales. Atlas color/normal S14 compartidos 2048/1024; dos canvas 256²
  sustituyen los anteriores, cero descargas nuevas. +640 triángulos / 117.840 B en buffers, sin mallas,
  pasadas o luces nuevas. Mapa/colisiones/fuentes de luz intactos. **127/127** pertinentes, un QA previo
  y ocho finales / 36 capturas / 32 cambios finales de calidad GL=0, siete fuentes `final-v2` congeladas.
  Catálogo revisión 32, 106 filas / 50 aplicadas; 104 filas anteriores intactas, 53 enlaces HTTP exactos
  y fichas con 40 imágenes / 98 enlaces cada una, sin fallos. Arte fino/FPS físicos/publicación pendientes.
  Continuado por S19; demás continuidades conservadas.

- **S19 banco y muebles integrados localmente:** [brief](briefs/visual-s19-town-furniture.md),
  [entrega](delivery/town-furniture-v1.md). Banco de carpintero con repisa, tornillo y martillo;
  mesa/taburete/postes/caja de agujas de Doña Sepia con atlas S14 compartidos 2048/1024, sin descargas nuevas.
  Banco 6 → 2 mallas con gema, +96 triángulos; props estáticos conservan forma y presupuesto.
  Ancla/nodos/crafting intactos; fallback sin color conserva el banco anterior. **147/147** pertinentes,
  un PC previo y siete contextos finales / 24 capturas / 28 cambios de calidad finales GL=0.
  Nueve fuentes congeladas; catálogo revisión 33, 108 filas / 52 aplicadas, 106 anteriores intactas.
  43 rutas HTTP exactas; dos fichas con 28 imágenes / 76 enlaces, sin errores.
  Arte fino/FPS físicos/publicación pendientes. Continuado visualmente por S20; composición funcional Salty Shore,
  plaza/capitanía y kit de obra A0/A1 siguen pendientes, con anclas coordinadas antes de mover props.
  Naval/M5/chat/agentes/Web3/personajes conservan su continuidad.

- **S20 fachada Salty Shore integrada localmente:** [brief](briefs/visual-s20-town-hall.md),
  [entrega](delivery/town-hall-v1.md). Tela roja con ancla/letras, madera ilustrada y mástil en
  el lateral del tejado de una hut existente; atlas 2048/1024 compartidos y canvas 256², cero descargas nuevas.
  +218 triángulos / 28.376 B de buffers / una malla, sin luces ni pasos nuevos del pipeline.
  Mapa, colisiones, recursos, puerta/escaleras y Capitana Brea conservados; no capitanía funcional nueva.
  **152/152**, un PC previo y siete finales / 24 capturas / 28 cambios de calidad GL=0;
  25 mallas estáticas intactas y un chunk ampliado, cámaras PC equivalentes. Siete fuentes congeladas.
  Catálogo revisión 34, 109 filas / 53 aplicadas, 108 anteriores intactas; 42 rutas HTTP exactas;
  ficha con 28 imágenes / 76 enlaces, todas decodificadas y sin errores JS. Kit de obra A0/A1,
  composición funcional, FPS físicos/publicación y demás continuidades permanecen pendientes.

### Discusión de navegación activa (2026-10-06)

- El autor pidió brainstorm para que viajar sea entretenido: actividades de navegación y posibles ventajas
  de velocidad. [Propuesta y camino de prueba](NAVIGATION-ACTIVITIES-DISCUSSION.md), síntesis del principal
  con análisis Luna: crucero viable, ajuste de vela/ráfagas y olas/corrientes; alternativas a bordo.
- Ampliación solicitada: impulsos fuertes de varios segundos, oportunidades de escape/combate y rutas
  cambiantes. Catálogo de 18 opciones con costes/respuesta rival; geografía/legalidad estables y entorno
  compartido anunciado. Ráfaga/virada/corriente es recomendación de prueba, no selección aprobada.
- Preferencias posteriores del autor: manejo arcade, corrientes, captura de vela/boost, expulsar carga con
  pequeño impulso y remolinos. Lista corta de ocho familias en la discusión: drift/ancla, wheelie visual,
  lastre humano y rebotes incluidos; tres tandas recomendadas, variantes/cifras aún abiertas.
- **Solo discusión/preferencias, sin implementar.** Preservar masa/distribución, solo/táctil viable y límites
  por barco; sin porcentajes de balance cerrados. No altera demo, cola D06b/D08a ni puertas M5/D09.

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

### M5 P4/P6 — efecto común sim/staging D09f-2b.3 (2026-10-06)

- Fuente `26ef249`, base `60a4773`; [contrato](briefs/m5-pearl-common-effect.md),
  [entrega/evidencia](delivery/d09f-common-effect.md).
- `applyPearlChange` reúne G/cooldown/agua/stats. Sim conserva dirty/eventos; staging conserva
  fila separada/perfil actual/verificación/rollback. Misma regla para ambos, sin balance nuevo.
- **745/745** regresión en 74 archivos del commit aislado, **68/68** smoke; revisión Luna y hashes.
  Pruebas existentes de cuatro kinds/progreso/fences/rollback/predicción; sin tests espejo nuevos.
- Unreal/FAB consultado: referencias empaquetadas sin lógica JS portable, se reutiliza código propio.
  Sin arte, SQL/env, host/reinicio/publicación, activación de staging ni cambios alpha.4/protocolo 16.
- Siguiente lote atómico multi-UID, hooks completos y restauración/scope/reloj/adopción; afinidad aparte.
  Cola visual/móvil naval conservada. Trabajo concurrente de lote fuera de esta aceptación.

### M5 P4/P6 — lote de perlas en storage D09f-2b.4 (2026-10-06)

- Base `4414665`; [brief](briefs/m5-pearl-batch.md), [entrega/evidencia](delivery/d09f-pearl-batch.md).
  Una cuenta y todas las perlas de muerte (1–9 UIDs) o los dos UIDs de reemplazo; perfil CAS,
  ledger/ubicaciones y un recibo atómicos. Memoria y SDK, sin commits parciales por UID.
- Delta exacto del inventario; oro/XP/maestrías/slots restantes conservados. Replay histórico no
  revierte progreso ni una recogida posterior. UUID compartido protegido SQL con 003/004/005.
- **481/481** pertinentes sobre archive aislado + nueve archivos propios, **125 nuevas**;
  cuatro procesos Node con PGlite persistido. Permisos, CAS, límites, rollback tardío, respuesta
  perdida, recibos/lectura/replay; no demuestra backends PostgreSQL concurrentes ni GameHost restart.
- **007 nueva lista, pendiente de aplicar/verificar real.** Sin env/red remota/jugadores/host/deploy;
  trabajo paralelo de efecto común/naval conservado. No cambia sim/LocalServer/cliente/protocolo.
- Siguiente: 007 real, diario/cola/reservas y recuperación de intención sin recibo para lotes,
  staging/tick y hooks/restauración con dueño de sim. Afinidad runtime pendiente; conserva el requisito.
  Solo resuelve perlas de muerte, no vuelve atómicas las otras pérdidas ni el mundo. P4/P6 parciales.

### M5 — commit same-holder 006 aceptado real (2026-10-06)

- Base `532691a`. **21/21 SDK/Supabase/ProfileSessions**, cuatro procesos Node independientes;
  [informe/evidencia](delivery/d09f-same-holder-live.md), [brief](briefs/m5-pearl-same-holder-live.md).
- Bag→swallowed vacío conserva dueño/`since`/progreso/orden, un endpoint y una generación; UID con
  tombstone previo o 003 gestionado sin ubicación. Rechazos sin efectos/recibos y replay histórico
  sin retroceder XP; cliente público denegado. Recuperación de commit sin envío y unsent reanudado
  exactamente una vez. No es reinicio de GameHost ni conexión de staging al juego.
- Dos perfiles/cuatro UIDs/recibos sintéticos limpiados y ausencia verificada; dos diarios committed
  retenidos. 21 fuentes runtime/SQL intactas; sin cambios env/sim/LocalServer/host/protocolo ni despliegue.
- Sigue afinidad confirmada pero no implementada; lotes multi-UID muerte/reemplazo, efecto común y
  hooks/restauración/scope/reloj/adopción antes de activar. P4/P6 parciales; trabajo naval conservado.

### M5 — SQL 006 aplicada y afinidad confirmada (2026-10-06)

- El autor confirma 006 ejecutada. **6/6 probes Supabase de solo lectura** comprueban los validadores
  same-holder/swallow y su denegación pública; sin consultar jugadores/tablas ni escribir fixtures.
  [Alcance/evidencia](delivery/d09f-sql006-readonly.md). Commit nuevo live e integración del host pendientes.
- [Afinidad confirmada](briefs/m48-pearl-affinity.md): aprendizaje del personaje por tipo, independiente
  del UID; mejora el dominio y permanece tras pérdida/death/venta. Recuperar una del mismo tipo usa
  el aprendizaje conservado; otro dueño usa el suyo. Perfil/XP/escalado/UI aún no implementados.
- Curva/techo/acciones/mejoras por definir. Guardar aprendizaje fuera de `profile.pearls`, acreditar en
  servidor y conservarlo al limpiar inventario/transferir/restaurar; no duplicar XP por replay. Registrar
  esta regla al continuar M4.8/M5, con escritor único para sim/perfil/protocolo y sin pisar trabajo naval.

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

**M5 económico, 2026-10-10 — publicado y verificado:** mercado cotizado, compra de materiales
desde el editor de la balsa, transferencias de carga y aportes usan perfil/mundo/recibo en una
transacción M5; sin montar otra autoridad A1. Meta provisional aprobada: 40 madera + 20 piedra.
SQL014 y permisos verificados en Supabase; alfa público 0.6.0-alpha.17. Diez operaciones reales,
diez replays tras reconexión y diez tras reinicio real, sin segundo débito ni retroceso.
[Contrato](briefs/m5-economic-authority.md) · [Entrega](delivery/m5-economic-authority.md).
No cierra recursos/crafting, todo M5 ni crecimiento automático del edificio.

**Checkpoint GM01 (0.6.0-alpha.18; imagen desplegada y sana):** `marea-negra:alpha-d3159949f9ef`, commit `d3159949f9ef6fbbab51ce7e7a1b928d25f428a0`, activo desde 2026-10-10T16:20:39Z. QA local: 100/100 pruebas (30 GM) y navegador 13/13 con autenticación simulada. QA real de producción: 6/6 con Supabase, cero errores; sesión GM permitida, colocación/guardado local y revocación verificados. [Informe](delivery/gm01-world-editor.md) · [evidencia pública](delivery/gm01/public-evidence.json) · [despliegue](delivery/gm01/deployment-evidence.json). Borradores siguen privados en IndexedDB; no hay publicación de mapas. GM00: 14 capturas con loader real, sin FPS móvil físico ni aceptación gameplay. Sigue GM02 edición base/walktest y GM03 almacenamiento remoto/publicación/rollback; terreno posterior.
