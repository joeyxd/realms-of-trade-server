# Traspaso: cómo seguir con MAREA NEGRA

**IC04, 2026-10-21 — la mente del compañero ve el mundo alrededor de su cuerpo (alpha.86):**
[Entrega](delivery/ic04-observation-v2.md). Sin SQL ni protocolo; versión 0.6.0-alpha.86. `server/agentPerception.mjs` exporta
`AGENT_WORLD_POLICY` ({v:1, radius 24, maxNodes 16}) y cada SNAPSHOT proyectado al agente gana una clave `world` para su
propio cuerpo: nodos de recurso a menos de 24 (el más cercano primero, máximo 16, `truncated` si hay más), hora del
día, fuente de agua dulce y banco de trabajo (null si están fuera de radio o la función está apagada), todo redondeado a
0,1; `null` si el cuerpo está muerto o sin posición. `AGENT_PILOT_POLICY` y la comprobación del WELCOME no cambian: los
runners viejos ignoran la clave y un runner nuevo con un servidor viejo no la ve. `network-client.mjs` la normaliza a
`confirmed.world` (descarta nodos a más de 24 y limita a 16; si falta o está mal formada no hay clave) y `contract.mjs`
la acepta como clave opcional exacta (`validWorld`). El bloque serializado en el tope cabe en 2.400 bytes. Tests: 6 en
agent-perception, 2 en agent-interface, 4 en agent-network-client (uno con servidor real). Ticket T-1021-08. Pendiente:
que los prompts expliquen `world` (el modelo ya lo recibe dentro de la observación, sin instrucciones).

**C01 memoria en Windows, 2026-10-20 — un lector abierto ya no pierde recuerdos (sin subir versión; sigue alpha.85):**
Causa (T-1020-104, reproducida): en Windows `renameSync(temp, memory.jsonl)` falla con EPERM si otro handle tiene
abierto memory.jsonl (el sondeo del test C01, owner-panel-server, Defender, el indexador, OneDrive). El almacén lo
trataba como commit incierto, borraba el temporal (se perdía el episodio) y la mente se bloqueaba: cada remember()
posterior devolvía memory_commit_uncertain hasta volver a emparejar. Arreglo (T-1020-108) en
`tools/agent/memory-store.mjs`: con EPERM/EACCES/EBUSY, si el temporal sigue intacto y memory.jsonl conserva el hash
verificado, el fallo es seguro y la ventana síncrona entera se repite tras 10/20/40/80/160 ms con el lock tomado;
agotado devuelve `memory_commit_busy` sin `uncertain`, que no bloquea la mente. Cualquier otro caso sigue igual.
Tests: 4 de Windows en agent-memory-store, 1 en agent-memory-mind; el test C01 espera el resultado del compañero
antes de leer el fichero (20/20). Pendiente: jitter en el backoff y el mismo patrón en objective-store, budget-file
e inference-center.
**AW06a, 2026-10-20 — puente GM: publicación al catálogo del editor, alpha.88/protocolo 63:**
[Entrega](delivery/asset-workshop/PUBLICACION.md). `assets/workshop/published.json` registra en git la decisión «Usar»
(schema `marea.asset-published.v1`) y `tools/asset-workshop/publish-editor.mjs` la vuelca en `assets/editor/catalog.json`
y `thumbnails.json` con sha256 verificado contra `prepared.json` (`--check` no escribe). Publica los cuatro pilotos:
caldero (size 0,9), palmera (height 7), puerta (height 2,2) y bote (size 6), estado `ready`, para colocarlos desde el editor GM.
Las claves del taller en `thumbnails.json` se reconocen por su imagen en `assets/workshop/thumbnails/`. `gm-assets.test.mjs`
fija las cuatro entradas `gm-*` ignorando las del taller; el índice reclama `published.json` como archivo de catálogo.
Medidas decididas por Joi, pendientes de verificar en pantalla; la insignia «Publicado en el editor GM» del taller llegó en AW06b (T-1020-100).
Sin cambios de gameplay, SQL ni protocolo (63).

**AW01, 2026-10-14 (integrado 2026-10-20) — Taller de assets, alpha.87/protocolo 63:**
[Contrato](briefs/AW01-asset-workshop.md), [entrega](delivery/asset-workshop/README.md).
Entrada GM y revisión local, categorías/packs, 28 fichas y 18 pruebas navegables,
PBR/toon A/B, geometría neutra/wireframe y notas/decisiones por fuente/variante.
22 derivados nuevos y 18 miniaturas reales; fuentes intactas por 92 cotejos.
50 pruebas focales y Chrome local 14/14, escritorio/móvil emulado; publicación
se verifica por recibo aparte. Materiales incompletos y diez fichas pendientes
quedan visibles. Sigue AW02 (índice/preparación por lotes), luego rigs/audio/VFX
y revisiones compartidas. No coloca objetos ni cambia gameplay, SQL o protocolo.

**IC03c, 2026-10-20 — el CLI de emparejamiento muestra el modo cuerpo (sin subir versión; sigue alpha.85):**
`tools/agent/pair-companion.mjs` exporta `connectedMessage` (con presence concedida anuncia el cuerpo y las órdenes
sígueme / espera / vuelve; sin ella mantiene el texto "Solo chat") y `presenceMessage`, que traduce cada evento
`presence_order` a una línea fija en español (orden, estado del cuerpo, motivo de rechazo de tabla; nunca repite un
why o estado desconocido). `local-openai-mind.mjs` añade una pista en español sobre `args.body` solo cuando el
contexto trae `required.tools.presence`; sin esa clave el cuerpo de la petición no cambia. El manifest emparejado
escribe `requestedCapabilities` (lo pedido, no lo concedido; nadie lo lee). Tests: tests/pair-companion-cli.test.mjs
y uno en local-openai-mind; gate 202/202. Ticket T-1020-102.

**IC03b, 2026-10-20 — el runner emparejado conduce su cuerpo de presencia (alpha.85, protocolo 63 sin cambio):**
[Entrega](delivery/ic03b-runner-presence.md). Lado runner de IC03a; sin cambios en servidor, SQL ni protocolo.
`tools/agent/contract.mjs` añade `presence` a NETWORK_CAPABILITIES; PairedCompanion pide `["chat","presence"]` y entra
en modo cuerpo solo si el servidor concede presence (bandera MN_COMPANION_PRESENCE); con la bandera apagada adopta
`["chat"]` y nada cambia. `AgentNetworkClient.presence(op, { expectedRevision })` envía un `agent_companion_presence`
con las claves exactas y resuelve con el recibo del mismo requestId (why locales: invalid_request, not_connected,
forbidden, busy, timeout 10 s, closed, invalid_receipt). En modo cuerpo la respuesta del modelo admite `body`
follow/wait/return junto al texto (esquema y una frase de instrucción extra; el chat sigue siendo dato no fiable y el
servidor valida cada orden); la mente nunca ejecuta: `tools/agent/presence-driver.mjs` hace load, op con la revisión
del recibo, un reintento en conflict, el último pedido gana (superseded), mínimo 1000 ms entre envíos y 20 por minuto
(paced). Eventos `presence` y `presence_order` por onFeedback. Tests: tests/paired-companion-presence.test.mjs (casos
a-f sobre servidor real con presencia encendida y apagada) y 2 en agent-network-client; gate 202/202. Incluye f2471f5
(T-1020-84): un socket de mente revocado ya no cuenta como emparejado, 3 tests de revocación y nota de la tarjeta de
presencia. Pendiente (IC03c): pair-companion.mjs aún imprime «Solo chat» y no muestra los resultados de presencia;
pista en español para args.body en local-openai-mind.mjs; el test «live owner C01 delivery» de paired-companion es
inestable desde antes (1/10 en HEAD limpio, 0/10 con este cambio). Prueba a mano: emparejar con la bandera encendida
y decir sígueme / espera / vuelve.
**ST01c, 2026-10-21 — simulación nativa de NS_BasicHit sobre core (piloto sin cambios):**
[Simulación](delivery/st01c/basichit/SIMULATION.md), [checkpoint](delivery/st01c/basichit/simulation-checkpoint.json), sección BasicHit en [CORE-MODULES.md](delivery/st01c/CORE-MODULES.md). `prepare-basichit-source.mjs` escribe `tools/niagara-native-lab/basichit-source.json` (LUT en f32 del T3D, 47 constantes de la tabla VM con su línea, sha256 de cada entrada; dos corridas idénticas); `basichit-simulation.js` es el binding de los tres emisores sobre `core/` (primitivas nuevas en `core/burst.js`, `core/physics.js`, `rng.js` y `particle-state.js`; `burstBirthAge` con guarda (0, dt] aparte de `rateBirthAge`, cuya guarda no cambia). `node tools/niagara-native-lab/verify-basichit.mjs`: 241 frames, 5.103 estados contra `basichit-reference03`, cuentas e ids iguales en cada paso, 0 estados capturados como entrada, edad, rotación y lifetime exactos, error máximo 5,3e-5 cm en tamaño (tolerancias de verify-native); falla cerrado con NaN o checkpoint ausente. Piloto: verify-native/update/depth/core idénticos byte a byte; 44/44 tests. Necesita `.scratch` (no corre en el gate del VPS). Sigue: el lado de render de BasicHit (sprite FaceCameraPosition, MI_Hit_1, MI_Radial_2, SubUV 40 frames, DepthFade).

**ST01c, 2026-10-20 — núcleo común de simulación (sin cambio de comportamiento):** las primitivas del piloto `NS_Flame_Single` (RNG, curva, tasa de nacimiento, estado de partícula, SubUV) viven ahora en `tools/niagara-native-lab/core/` y `native-simulation.js`/`update-simulation.js` son ataduras que las llaman, con la misma API. Prueba y alcance en [CORE-MODULES.md](delivery/st01c/CORE-MODULES.md); `node tools/niagara-native-lab/verify-core.mjs` compara siete digests con [core-checkpoint.json](delivery/st01c/core-checkpoint.json) (base `6cd29b4`). Lado de render y capacidades de BasicHit siguen pendientes; los `codeHashes` de checkpoints anteriores quedan como historia.

**ST01c, 2026-10-20 — captura de referencia por spec y referencia de NS_BasicHit (dos ejecuciones idénticas a 1024 px):**
[Referencia](delivery/st01c/basichit/REFERENCE.md), [checkpoint](delivery/st01c/basichit/reference-checkpoint.json). `capture_reference.py` lee del spec el bloque `capture` (dt, lastStep, imageSteps, linearStep, imageSize, cameras, cameraTarget, cameraDistance, orthoWidth, textures) y exige `-SystemSpec`; el plugin registra el sistema configurado y sus texturas residentes (`ConfigureSystem`) y las funciones de captura lo exigen; `SubImageIndex` pasa a ser opcional (Flash y SimpleBurst no tienen SubUV). Regresión del piloto: `reference-gen01` y `reference-gen02` iguales a `reference11` con `compare_reference_runs.py` (241/241 estados, 3/3 HDR, 16/16 PNG con diferencia 0, 2/2 texturas); `capture_spec_test.py` fija los dos specs. NS_BasicHit: las ráfagas con Spawn Time 0 caen en el paso 1 (1/1/250), vidas Flame 0.4 s, Flash 0.3 s, SimpleBurst 0.10-0.60 s, nada nace después del paso 1 y el efecto termina en el paso 35; encuadre por caja de partículas más medio sprite mayor (`frame_from_particles.py`): objetivo [20, 0, -10], distancia 800, ancho 850, 1024² (0.83 cm/px, como el piloto); imágenes en [2, 6, 12, 18, 24] (el paso 30 sale en blanco con 44 partículas de hasta 2.65 cm), HDR lineal en el 12; par `basichit-reference03`/`04` idéntico (241/241, 3/3, 16/16 a 0, 4/4); 4 texturas exportadas y fijadas (T_FireBall y T_Hit_Circle alimentan renderizadores activos; T_FlameUV_1 y T_Ground_Crack no). `build_reference_checkpoint.py` genera el checkpoint, `check_reference_checkpoint.py` reverifica 265 ficheros, 4 texturas (8 hashes) y 6 hashes de código, `render_reference_md.py` regenera REFERENCE.md byte a byte; los cinco scripts fijados llevan `eol=lf` en .gitattributes; el hash del spec depende de CRLF (Pendiente). Sin cambio de runtime ni versión; sin simulación nativa (tarea 05: primitivas comunes).

**ST01c, 2026-10-20 — cadena de sondas generalizada y NS_BasicHit extraído (3 emisores, 14 scripts, cierre de 58 paquetes):**
[Extracción](delivery/st01c/basichit/EXTRACTION.md), [copia con SHA](delivery/st01c/basichit/source-copy-audit.json), [manifiesto](delivery/st01c/basichit/source-export-manifest.json), [valores nativos](delivery/st01c/basichit/native-values.json), [materiales](delivery/st01c/basichit/material-defaults.json). Las tres sondas Python y el comandlet reciben `-SystemSpec=<ruta absoluta>` y `-ProbeRun=<nombre fresco>` (sin spec no hay ejecución; `-run=` es de Unreal); un JSON por sistema en `tools/unreal-niagara-probe/systems/` (`ns-flame-single.json` reproduce las constantes del piloto, `ns-basichit.json` describe NS_BasicHit; semilla 6371 + índice, 6371-6373). El plugin gana `ConfigureSystem`/`ReadCompiledSystem` y conserva las funciones del piloto para los scripts de captura; nuevas herramientas: `closure_copy.py`, `probe_closure.py`, `check_copy_audit.py`, `build_export_manifest.py`, `compare_t3d.py`. Piloto con el spec: el informe compilado (`gen-pilot-compiled`, 842837…) y los valores nativos (`gen-pilot-native-values`, 869842…) salen idénticos byte a byte; `system.t3d` y `material-defaults.json` NO pueden igualar sus pines (d7d78b…, 0c9d93…): Unreal asigna ChangeId aleatorios en cada carga (la sonda original también da otro hash, `oldcheck-source`) y el pin de materiales contiene una dirección de memoria; con los GUID enmascarados los 7 T3D coinciden (`compare_t3d.py`) y los materiales solo difieren en esa línea (el script del repo ya escribía la ruta del asset, ec98890f…, igual que la copia de entrega). NS_BasicHit: cierre de 15 paquetes `/Game` (3 copiados, 12 ya presentes) más 43 de motor = 58, 3 handles (`NE_Flame_Basic_001`, `NE_Basic_Flash001`, `NE_SimpleBurst`), 14 scripts, nuevas capacidades frente al laboratorio en EXTRACTION.md (ráfaga, Drag, AddVelocityFromPoint, ScaleSpriteSize, SystemLocation, FaceCameraPosition, dos materiales nuevos). Sin cambio de runtime ni versión; sin captura de referencia ni simulación.

**ST01c, 2026-10-20 — decisión del autor: UASTC automático, deriva fijada, memoria móvil aceptada:**
[Entrega](delivery/st01c/ATLAS-LAB.md) sección «Decisión del autor (2026-10-20)»,
[aceptación](delivery/st01c/atlas-drift-acceptance.json). El autor vio la comparación visual (celdas de humo
con picos de 33-52/255, cambio de 1-3 niveles por píxel) y la juzgó invisible en juego. D1: `ktx2-uastc` se
acepta con la deriva de budget07 frente a `source`, fijada: exactamente sus 37 casos fallidos, cada uno con
max255 <= 3 y 0 fallos UE; compare-atlas.py añade `driftAccepted` y `unexpectedFailures` solo a esa variante
(el resto de claves y `thresholdsBeforeReview` no cambian). D2: los 8 MiB cuentan atlases + LUT,
8.039.200 + 262.144 = 8.301.344 B (margen 87.264 B); los targets (~5 MiB) son coste compartido del render.
D3: `AUTOMATIC_VARIANTS` = ktx2-uastc en escritorio y móvil, `MOBILE_MEMORY_ACCEPTED` true;
atlas-policy.js `mobileBudget()`, página con `state.mobileBudget`. qa-atlas.mjs: el fallo 'corrupt-texture'
abre `?variant=full` (la página por defecto ya no pide WebP). Runs budget13/14 (worker) y budget15/16
(verificador) píxel-idénticos a budget07 (2.144 imágenes); 19/19 tests. budget11/12 son parciales (cuelgue
previo al arreglo), no usar. Sin aceptar: las demás variantes, ASTC/ETC2 y FPS en un teléfono real.
Sigue (autor): segunda familia (NS_BasicHit candidata).

**ST01c, 2026-10-20 — mips frente a códec (2x2): domina la cadena de mips; UASTC añade poco:**
[Entrega](delivery/st01c/ATLAS-LAB.md) sección «Cadena de mips frente a códec (descomposición 2x2)»,
[checkpoint](delivery/st01c/atlas-mip-checkpoint.json). Tres variantes diagnósticas (nunca automáticas):
`ktx2-rgba8` (RGBA8 sRGB sin códec, mips toktx lanczos4), `ktx2-rgba8-box` y `ktx2-uastc-box` (`--filter box`).
Fallos/268, todos por maskIoU32 (mín. 0,852941 en el mismo caso en las cuatro: humo, celda 12, frontal, 0 EV):
rgba8 31, uastc 37, rgba8-box 43, uastc-box 47; full 0; 6/6 UE pasan en todas. El nivel 0 de los KTX2 RGBA8 es
byte-idéntico al PNG decodificado y el sampler coincide con el camino WebP: los 31 fallos vienen solo de los
niveles 1-11. toktx box ≈ caja 2x2 en luz lineal (±1 LSB) y aun así se aleja más del driver que lanczos4: los
mips de ANGLE D3D11 no son esa caja (filtro sin medir). Runs idénticos budget07/08 y del verificador budget09/10
(2.144 imágenes); legado píxel-idéntico a budget03. uastc-box 7,67 MiB BC7; rgba8 30,67 MiB. Pin del manifiesto
9731837e (atlas-gpu-checkpoint.json conserva befcf4f9). `MOBILE_MEMORY_ACCEPTED` sigue false. La referencia
del gate es el render con mips del driver: toda cadena de mips en archivo (obligatoria en formatos comprimidos)
deriva en contornos tenues. Sigue (autor): qué referencia vale para variantes con mips en archivo; medición
barata propuesta: solo el códec (uastc contra rgba8 con los mismos mips, sin renders nuevos).

**ST01c, 2026-10-19 — compresión GPU medida (KTX2 UASTC): memoria sí, silueta no; sigue aislar mips:**
[Entrega](delivery/st01c/ATLAS-LAB.md) sección «Compresión GPU a resolución completa (KTX2 UASTC)»,
[checkpoint GPU](delivery/st01c/atlas-gpu-checkpoint.json). Variante `ktx2-uastc` (toktx 4.4.2 portable,
UASTC calidad 4, zstd 3, mips en archivo, sRGB, sin RDO, origen abajo-izquierda) cargada con KTX2Loader:
Chrome sube BC7 (RGBA_BPTC_Format), 8 bpp, 8.039.200 B = 7,67 MiB frente a 30,67 MiB RGBA8; archivos
1.394.823 B (2,5× el par WebP). Gate de 268 casos: 37 fallos, todos por maskIoU32 < 0,98 en celdas de humo
(mín. 0,8529); MAE máx. 0,66/255 y P95 3/255 pasan; 6/6 UE pasan. Dos runs idénticos dos veces
(budget03/04, budget05/06); variantes previas píxel-idénticas a budget01. El resultado no separa el códec
de la cadena de mips (toktx lanczos4 frente a mips del driver en WebP; las celdas se dibujan a ~197 px).
`MOBILE_MEMORY_ACCEPTED` sigue false; los 7,67 MiB no incluyen LUT (256 KiB) ni targets (~5 MiB).
ASTC/ETC2 no expuestos en este Chrome: bpp calculado. Encoder sin instalar en
realms-of-trade-server/.scratch/tools/ktx-4.4.2/bin. compare-atlas.py evalúa ktx2-uastc solo si el run lo
tiene; check-atlas-repeat.py admite `--variants`. atlas-checkpoint.json conserva el pin antiguo del manifiesto.
Sin cambios de juego, SQL, protocolo ni registro. Sigue: aislar la cadena de mips (mips equivalentes al
driver o comparar nivel 0), decisión del autor sobre formato y presupuesto, luego la segunda familia.

**SK04a, 2026-10-20 — gastar y resetear puntos de habilidad, lado servidor, a oscuras (T-1020-62, T-1020-63), alpha.83:**
Nuevo `msg.type 'skills'` en el carril económico M5, calcado de Carga (`attributes`): plan puro
`src/sim/systems/skillPlan.js` `planSkillChange` (`assign` sube un nodo un rango por un punto del árbol; `reset` pone
el árbol a 0: el primero gratis, después `SKILL_RESET_GOLD` = 150 oro), `server/skillOperation.mjs`, cableado en
economicAuthority/economicOperation/store/host. La primera operación adopta: los rangos heredados (tatuajes, artes por
maestría) pasan a `progression.skills`, `skg` = concesión por árbol, v3. Puertas al gastar: tier, puntos (ganados + skg -
gastados), maestría, conocimiento (Doña Sepia) y perla; el arma en mano no cuenta. Sin recuperación de puntos si baja la
maestría. Flag `MN_SKILL_OPERATIONS` (por defecto apagado; exige `MN_STARTER_WORKSHOP`); con el flag encendido el host
exige `mn_skill_operations_ready() = {"version":1}` al arrancar. SQL `server/migrations/041_skill_operations.sql` (NO
aplicado): `mn_valid_logging_progression` acepta v3 (v1/v2 sin cambio), `mn_valid_skill_request`, guarda de que ningún
otro comando económico ni el autosave (`mn_save_profile`) cambian skills/skr/skg ni la práctica pacífica, cadena de
renombrado de commit y validador, readiness con sondas. Los recibos guardados de skills se validan por forma, no
recalculando con el catálogo vivo (añadir nodos no cerca el carril). Sin cliente ni bump de protocolo: el botón Subir
llega en SK04b. Antes de encender el flag: aplicar 041 en Supabase y comprobar readiness (context/ops/migration-check.md),
y que `server/groundTransaction.mjs:22` valide los recibos de skills por la ruta guardada (hoy los recalcula; las
transacciones de suelo están apagadas en producción). El catálogo solo puede crecer (quitar un nodo rompe readProgression).

**AREA15, 2026-10-20 — recursos GM componen con Ground por SQL040; piloto común público apagado, alpha.82/protocolo 63:**
[Entrega/evidencia](delivery/gm-ground-composition.md); segundo corte del paso 3 de la [matriz](CONTINUITY-MATRIX.md) (T-1020-70).
`server/host.mjs` ya no rechaza `gmResources` junto con `groundTransactions` (arranque y `prepareContentResources`); bajo
Ground la admisión del roster es una familia del dueño Ground: intención en diario (`mn_prepare_ground_gm_admission`),
un commit (`mn_commit_ground_gm_admission`) bajo los locks de SQL018 que delega el append-only en SQL036, y la sesión
adopta versión y roster antes de que se mueva el puntero; el reloj no se mueve. Conflicto, respuesta perdida o parada
cercan el mundo sin instalar el mapa. Parada tras commit: el host nuevo carga las filas actuales y reintentar no admite
nada; parada tras la intención: el siguiente cambio la confirma una sola vez. Sin Ground nada cambia (ruta SQL036 igual).
**SQL040 debe aplicarse a mano en Supabase antes de un piloto Ground con mapas GM**; hasta entonces el host falla cerrado
(`configuration` al arrancar, `gm_resource_unavailable` al cambiar). Readiness: `mn_ground_gm_resources_ready()` = 1.
Tests: `tests/gm-ground-sql.test.mjs` 10/10, `tests/gm-ground-host.test.mjs` 10/10; `gm-functional-authority` adapta el
caso sin capacidad (dos subcasos). Conjunto dirigido de 12 archivos 76/76 (base 54/54); actualizador 202/202 (29 archivos).
Los tests nuevos no están en TESTS del actualizador (decisión del operador). Sigue: aplicar SQL040, aceptación del piloto
con mapa GM, y los demás cortes de composición (compañeros, bots, rutas autónomas), kill/cofre, adopción detenida y canario VPS.

**VR06, 2026-10-20 — aldea de noche, sexto corte (siete props Tripo v2, ajustes y grading medidos, farol con vidrio y luz propios), alpha.81/protocolo 63:**
Versión alpha.81 en package.json, package-lock.json (dos entradas) y src/data/meta.js; protocolo 63 sin cambios.
Reutiliza los siete modelos ya importados del estudio Tripo: campfire-ring, crate-stack, fence-rope, notice-board,
planter-flowers, stall-tarp y lantern-post. El manifiesto admite fence/board/planter/stallTarp y sustituye sus kits;
crate conserva la mezcla determinista de storage-crate y crate-stack. Colocaciones, cantidades, simulación y colliders intactos.
Ajustes uniformes a escala de instancia 1, dimensiones finales ancho x alto x fondo en u, con las cajas reales de los kits:
campfire proc 2.256914 x 0.522170 x 2.239205; crate proc 0.788183 x 1 x 0.698677;
fence size 2.431082, final 2.431082 x 1.692318 x 0.520505; board proc 1.610000 x 1.457484 x 0.701633;
planter height 0.9, final 0.967204 x 0.9 x 0.845702; stallTarp proc 2.620354 x 2.516843 x 2.043202;
lantern height 2.6, final 1.314412 x 2.6 x 0.606586. Board a altura 1.9 excedería 1.8 de ancho; planter con proc no llega a 0.8 de alto.
Fence: poste derecho medido por intersección de triángulos a y=0.05, grosor fuente 0.173516778; tamaño L=2W/(W-grosor)
(W=0.978546262), así L=2+grosor ajustado y los postes contiguos se solapan al paso existente 2.0. Su altura 1.692318 supera
1.6; se conserva el tamaño autorizado y queda señalado para revisión. rotY 0 en seis modelos: valla sobre x, papeles del tablón
hacia +z y frente de mercancía/tela del puesto hacia +z; farol rotY 22 para llevar su brazo oblicuo hacia +x.
Grading decidido antes de capturas: mediana de luminancia lineal Rec.709 tras convertir sRGB, máscara unión de triángulos UV
rasterizada en centros de texel, solo baseColor desktop (sin padding). Barril de referencia 0.065884; campfire 0.073082,
crate 0.028037, fence 0.046289, board 0.038610, planter 0.035938, stallTarp 0.029269, lantern 0.037942.
bright=round(10*clamp(barril/prop,1,4))/10: respectivamente 1.0, 2.3, 1.4, 1.7, 1.8, 2.3, 1.7; sat 1.15 salvo planter 1.3.
El farol tiene seis caras de vidrio opaco: doce cajas finas de glowBasic (dos bandas por cara) entran en glowParts;
se dejan libres esquinas, techo, base y abrazadera central. Centro medido tras rotY [0.124953,0.633,-0.016715]; assets.fitted
aplica el mismo ajuste que al modelo. LANTERN_LIGHT_OFFSET=[0.3209,1.68367,-0.00413] mueve la luz puntual a ese centro ajustado,
con rotación y escala de instancia. El vidrio procedural sigue en [0.42,1.78,0]. Sin shader nuevo ni emisión en otros props.
Siete fichas del catálogo reclaman modelos desktop/mobile, fuentes, conceptos y README; README originales conservados.
Pruebas VR06: ocho casos de bindings, grades ligados al SHA256 de cada GLB, ajustes desktop/mobile, vallas, anclaje luminoso,
superficies de vidrio por raycast, instanciación y fallback. Capturas `village-night` de noche y de día (SwiftShader, high) revisadas:
faroles con vidrio encendido y luz en la lámpara, anillo de fogata, lona azul, cajas y maceta legibles; falta GPU real y dispositivos
físicos. Revertir primero el commit de cableado VR06 (el último, alpha.81) y después los siete commits de assets f00c672..9024a4c
(ambos incluidos, en orden inverso; rango Git f00c672^..9024a4c).

**VR05, 2026-10-19 — aldea de noche, quinto corte (hierba de borde respeta las plantas, grading de las plantas Tripo, test de la noche realineado), alpha.80/protocolo 63:**
`grassPlacement.js`: las plantas del pueblo (fern, flowerbush, broadleaf; `PLANT_R` ahora exportado de `shrubPlacement.js`) entran en la
lista `occupied` con la marca `root`: una mata se rechaza solo si su centro cae dentro de la huella de la planta más 0.1 u
(`PLANT_ROOT_MARGIN`); arbustos y bush siguen con la regla de disco completo (`blocked()`); el bucle de anillo de props reintenta 8 veces
(`RING_ATTEMPTS`; las 4 primeras sales reproducen el trazado antiguo). Semilla 99282957: 118 matas de borde (antes 114, 23 con la raíz
dentro de una planta), 71 cerca de la aldea; el contrato de anillo de choza cuenta las plantas al pie como vestido con suelo de 3 matas
(la choza de 77,62 tiene 3 matas y 4 plantas). Test nuevo "grass clumps keep off the village plants" (5 tests, 0 fallos).
Las tres plantas Tripo leían casi negras incluso de día (texturas oscuras de origen: mediana de luminancia lineal 0.032 arbusto de flores,
0.057 helecho, 0.070 hoja ancha; el barril 0.14 de media): `assets/manifest.json` les da bloque `toon` (`sat` 1.3; `bright` 4.0
flower-bush, 2.6 fern-cluster, 2.2 broadleaf-plant), que `toonmat.js gradeGlsl` aplica al albedo antes de la luz; de noche las flores
rojas y las hojas verdes leen bajo los faroles (capturas shots/t1019-43b-day y -night, fuera de git). Sin código nuevo. Regla para los
próximos assets Tripo de vegetación: medir la textura y gradarla en el manifest antes de la primera captura.
`tests/night-lighting.test.mjs` realineado con la noche VR01 (hemisferio azul marino hemiI 1.7; fallaba 3/3 desde 3b10283b y no está en
el gate): 3 tests, 0 fallos. Versión alpha.80 en los tres archivos. Pendiente: los siete props del estudio Tripo (una aprobación de
descarga), agua y materiales; opcional un emisivo nocturno tenue en el arbusto si el grading no basta en GPU real.

**IC03a, 2026-10-20 — la mente emparejada entra en el cuerpo de presencia (L03g-b, servidor y cliente), alpha.79/protocolo 63:**
Con `MN_COMPANION_PRESENCE=1` y SQL039 listo, un HELLO emparejado (`agent: true` + token `mncp_`) ya no crea otra
entidad: se ata al cuerpo de presencia activo del dueño (`server/companionPresence.mjs` `attach`, `server/host.mjs`
`join`), sin perfil, plaza ni segundo nombre. La mente percibe desde el cuerpo (WELCOME con `you` = cuerpo, mismo radio
24 y tope 64), recibe lo que el servidor manda al cuerpo (`host.sendTo`) y habla como el cuerpo ("<nombre> [IA]") por su
sesión de chat normal y sus límites; un susurro al cuerpo le llega. Solo manda `AGENT_COMPANION_PRESENCE`
`load|follow|wait|return` (claves exactas, CAS `expectedRevision`, límite y regla de ocupado del dueño); `join`,
`retire`, INPUTS, AGENT_TASK y el resto: `forbidden`; el cuerpo solo se mueve por `step()`. Grant del emparejamiento
exacto `["chat","presence"]` con presencia encendida y `["chat"]` con ella apagada. Ciclo de vida: emitir código exige el
cuerpo vivo (`presence_body_required`); cuerpo ausente, retirándose u ocupado rechaza el HELLO sin crear nada; una mente
por cuerpo (el cierre de un segundo controlador rechazado no revoca a la primera); retiro, autorretiro, fallo de perfil,
valla y cierre del servidor revocan el emparejamiento (códigos y tokens fuera, mente cerrada con 1008); cerrar o revocar
la mente deja el cuerpo igual (orden, vida, posición, perfil) y otro código ata otra mente; una orden de una mente
revocada o sustituida la rechaza la época de control. Bandera apagada (producción hoy): L03f sin cambios. Cliente: "Conectar
en mi PC" solo ofrece código con el cuerpo presente ("Invoca primero a tu compañero" / "Summon your companion first") y la
tarjeta de presencia dice si hay una mente conectada (ES/EN). `/status` suma `storage.companionPresence.minds` solo con la
presencia encendida. Versión alpha.79 en los tres archivos; protocolo 63.
Tests nuevos: `tests/companion-body-mind-network.test.mjs` (12) y `tests/companion-body-mind-ui.test.mjs` (3). En
`tests/companion-presence-network.test.mjs` cambian cuatro casos que afirmaban la exclusión L03g-a: dos reescritos ("with
presence on, a pairing code needs the live body…", "a claimed pairing token for the live body never yields…") y dos
aserciones `busy` → `presence_body_required` ("ambiguous admission timeout…", "an unpublished attachment failure…").
Suite del área 943 tests, 930 pasan, 8 fallos, todos en la base previa (inventario, trade, PvE y movimiento): 0 nuevos.
Gate 29 ficheros 202/202. i18n 80/80. [Entrega](delivery/ic03-mind-in-body.md).
Pendiente: IC03b, el lado runner (`tools/agent/contract.mjs` `NETWORK_CAPABILITIES` aún rechaza `presence`,
`paired-companion.mjs` fija `["chat"]` y la mente no traduce sus verbos a follow/wait/return); prueba a mano con la bandera
encendida; SQL039 en producción antes de encenderla. Ticket T-1020-02.

**AREA15, 2026-10-20 — antorchas/resina/coco componen con Ground; piloto común público apagado, alpha.78/protocolo 62:**
[Entrega/evidencia](delivery/torch-ground-composition.md); primer corte del paso 3 de la [matriz](CONTINUITY-MATRIX.md) (T-1020-05).
`server/host.mjs` ya no rechaza `torchResinCoconutOperations` junto con `groundTransactions`; conserva workshop, fuego y cantimplora.
Cargar antorcha (2 tronco + 1 resina), extras de tala de palmera con beneficiarios y comer coco se confirman por el recibo
común SQL018/019 con el recibo económico anidado y se aplican en el borde de tick. Host detenido tras commit y antes de apply:
un host nuevo recupera el botín una sola vez, sin nuevo sorteo; el reenvío con el mismo `opId` es réplica.
`tests/torch-ground-host.test.mjs` 4/4 con SQL real 001-037; conjunto dirigido 41/41 (base 36/36); actualizador 202/202.
Sin SQL/flag/protocolo nuevos; Ground sigue opt-in y apagado en público. Los tests nuevos no están en TESTS del actualizador (decisión del operador).
Siguen los demás cortes de composición (recursos/puntero GM, compañeros, bots, rutas autónomas), kill/cofre completo, adopción detenida y canario VPS.

**AREA12 I18N04b2, 2026-10-20 — cobertura ES/EN de todo texto visible y cambio de idioma en vivo, alpha.77/protocolo 62:**
Barrido de los textos que seguían saliendo en español con EN elegido. Roster de personajes: errores en el idioma
elegido y refresco en vivo (`src/client/playerCharacters.js`, `src/ui/playerCharacters.js`). Compañeros IA: roles,
personalidad, metas y errores visibles (`src/net/companionTemplates.js`, `src/ui/companion*.js`); lo que se envía al
LLM no cambia y los campos editables muestran el texto guardado tal cual, con una nota bilingüe. Datos: armas, piezas
de balsa, islas y antorcha en `src/i18n/data.js`; los nombres propios no se traducen. HUD (RIPOSTE se mantiene,
necesidades, tecla de dash `SPC` en EN), `main.js`, `index.html`, natación, agua dulce y taller refrescan al cambiar de
idioma sin escribir el DOM en cada frame. Acciones de recursos, ventana de tala, banco de trabajo y perlas
(`src/ui/resourceActions.js`, `loggingTiming.js`, `workbench.js`, `pearlpanel.js`; claves `systems.resource.*` con
plurales `{one, other}`); comandos al servidor, ids y tiempos sin cambios. Editor GM y cartel `LAWLESS →`.
Anti-regresión: `tools/i18n/scan-hardcoded.mjs` con `tools/i18n/baseline.json` (la línea base solo puede bajar; hoy 0
textos pendientes en 232 archivos) y `tests/i18n-hardcoded.test.mjs`, que falla con una frase visible nueva sin
traducir. Tests nuevos: `tests/i18n-{companions,data-coverage,editor-sign,live-refresh,resource-actions,roster-errors}.test.mjs`.
Suite completa contra la base c818fc2: 0 fallos nuevos; arregla `workshop-build-ui` ("Basic plank") y el panel de
personaje. Pendiente menor: los avisos `onAim` de tala ya visibles no cambian de idioma en vivo
(`tests/resources.test.mjs:147` fija el texto); "Hacha de piedra fabricado" (concordancia, `src/i18n/systems.js`
`craftedTool`); `src/ui/workbench.js:68` elige "Torch" por `recipe.fire`. Sigue I18N04c (promoción).

**SK01-SK03, 2026-10-19 — hoja de habilidades (pestaña T con cinco árboles, iconos pintados y héroes; perfil, lado lector), alpha.76/protocolo 62:**
SK01 `src/data/skillTree.js`: catálogo de cinco árboles (Combate completo, tiers I-II del resto), curvas por árbol y
helpers puros. SK02 `src/ui/skillSheet.js`: la pestaña T (etiqueta Habilidades; el id sigue `tattoo` hasta SK04) dibuja
el tipo `tree` de solo lectura con estado real (maestría, tatuajes, perla), el atlas `ICON_ATLASES.skills` (21 iconos) y
cinco héroes con variante móvil; el modo aprender de Doña Sepia conserva la vista antigua. SK03: `readProgression`
acepta `progression` v3 (`skills`, `skr`, `skg` y práctica pacífica) validando solo la forma; v1 y v2 se leen igual.
Nada escribe v3 todavía: el SQL de producción (`mn_valid_logging_progression`, 016:182, usado por 021 y 029) solo
acepta v 1..2, así que la migración de SK04 debe ampliarlo antes del primer escritor. La práctica de Combate se deriva
siempre de la maestría (`combatPractice`); la hoja suma la concesión de la migración de tatuajes (perfil nuevo:
Ganados 2 / Gastados 2 / Libres 0). Tests: `tests/skill-progression.test.mjs` (15) más skill-tree y skill-sheet-*; seis
fixtures de "versión futura" pasan de v3 a v4. Gate 202/202; suite completa sin fallos nuevos frente a la base (42
previos; `paired-companion` falla a veces bajo carga y pasa aislado). Versión alpha.76 en los tres archivos.
Pendiente: SK04 (gasto y reset: skillPlan, skillOperation, protocolo, SQL con readiness que acepte v3, flag; el id
de la pestaña pasa a `skills`).

**IC02, 2026-10-19 — el compañero del Studio se vincula a un endpoint y un modelo del centro de inferencia, sin cambio de versión:**
El asistente del Studio (paso "Modelo") ofrece "Centro de inferencia" (endpoint registrado, sus modelos en caché y su modelo por defecto) o "Local (127.0.0.1)".
`/api/create` acepta `{draft, limits, inference: {endpointId, modelId}}`. El vínculo vive en `local-runtime.json` (`inference`, un campo opcional del esquema v1) y manda sobre
`manifest.provider`, que no cambia (`companionTemplates.js` intacto). El presupuesto local acepta una segunda política `{endpointId, modelId, thinkingMode}` sin URL ni clave; la loopback
sigue igual de estricta. `LocalCompanion.start()` resuelve el vínculo una vez con `inferenceCenter.resolve()` antes de conectar el runner y piensa con `createEndpointOpenAIMind`; si falla
(`endpoint_unknown`, `model_unknown`, `invalid_store`, `inference_unavailable`) no arranca ni cae al modelo local. La clave nunca se escribe en la carpeta del compañero (lo prueba un escaneo recursivo).
Pruebas: área 191 de 192 (1 omitida, symlink EPERM), UI 16/16, gate 202/202. Pendiente: prueba a mano con un endpoint real; IC03 (la mente en el cuerpo de presencia).
Tickets T-1019-61 (Codex sol) y T-1019-62 (Sonnet, rework 1).

**IC01, 2026-10-19 — centro de inferencia del Studio local (endpoints y claves, sondeo /models con caché, completado de prueba con uso), sin cambio de versión:**
Primer corte de la nueva ruta AREA17 (IC01..IC07, tablero y `area17-market/context/`): las claves y los endpoints viven en el
Studio del PC del dueño, el servidor sigue siendo solo metadatos (D-A3). Nuevo `tools/agent/inference-center.mjs` (registro en
`inference.json` bajo `MN_INFERENCE_HOME` o `~/.marea-negra/`, escritura atómica, `keyHint` y nunca la clave, caché por endpoint con
`updatedAt`/`checkedAt` y tope 2500, uso acumulado, selección activa, fichero corrupto = solo lectura `invalid_store`) y
`tools/agent/endpoint-openai-transport.mjs` (http/https al endpoint registrado, misma `generate()` que el transporte local,
`usage { inputTokens, outputTokens }`, `servedModel`/`modelMismatch`, registros abiertos a metadatos de proveedor, `tool_calls`
no vacío o `function_call` no nulo fallan cerrado, `eos` = `stop`). Studio: rutas `/api/inference/{endpoint,endpoint/delete,probe,
test,select}` tras las vallas existentes, `GET /api/state` con `inference`, sección "Centro de inferencia" en `index.html`/`main.js`;
el `models` del wizard no cambia (IC02 lo cablea). El transporte local sigue clavado a loopback. Tests 64/64 en cinco archivos, gate
29 ficheros 202/202; humo visual Playwright contra endpoint falso (alta, sondeo 3 modelos, selección, completado 12/9 tokens, clave
fuera del DOM, 390 px sin desbordamiento): [entrega](delivery/ic01-inference-center.md), [uso](agents/inference-center.md).
Siguiente: IC02 paso endpoint/modelo en el wizard y `LocalCompanion` sobre el transporte de endpoint; IC03 L03g-b mente en el cuerpo
de presencia con SQL039; IC04 observación v2; IC05 verbos harvest/cook/hunt; IC06 bucle de memoria medido; IC07 feed visual opcional.
Ticket T-1019-09 (Codex sol, rework 1, parche del chef en el decodificador).

**VR04, 2026-10-19 — aldea de noche, cuarto corte (16 luces en high/ultra y calentamiento de los shaders del DOF), alpha.75/protocolo 62:**
`MAX_LIGHTS` sube a 16 en `toon.js` (array del shader; los bucles cortan en `mnLightCount`); preset high con `lights: 16`,
ultra lo hereda, low 4 y medium 8 igual: 14 huecos clasificados más 2 de reserva. `Pipeline.warmDof()` compila
`dofDown`/`dofBlur`/`dofComp` contra el quad en `prewarm` (`scene.js`) con el target `rtDofA`, restaurando material y target
antes de esperar. Tests tocados: `tests/lights.test.mjs` (5, incluye caps de tiers y recorrido con 16 luces) y
`tests/quality-dof.test.mjs` (3, incluye conexión de warmDof en prewarm): 8 tests, 0 fallos. Versión alpha.75 en los tres archivos.
Pendiente: los siete props del estudio Tripo (lantern-post, fence-rope, notice-board, planter-flowers, stall-tarp,
crate-stack, campfire-ring), agua y materiales, y las flores que leen oscuras de noche.

**VR03, 2026-10-19 — aldea de noche, tercer corte (helechos, arbustos de flores y plantas de hoja ancha Tripo), alpha.74/protocolo 62:**
Sigue a VR02 sobre alpha.73 (sin empujar: alpha.72, .73 y .74 salen juntos). Tres kinds de prop nuevos `fern`, `flowerbush` y
`broadleaf` (ya en `PROP_KINDS` y en `assets/manifest.json`: `prop:fern-cluster` 4515 tris, `prop:flower-bush` 3348,
`prop:broadleaf-plant` 2753, WebP 512 / 256, `docs/art/prop-*/`). Render (`props.js`): kits procedurales `fernGeo`,
`flowerbushGeo` y `broadleafGeo` (conos e icosaedros facetados, 108 / 100 / 96 tris, base en y 0) que son el fallback sin modelo
y la caja de ajuste del GLB (`PLANT_BOX`: helecho 1,0 x 0,68 u, arbusto 1,1 x 0,86, hoja ancha 1,1 x 1,0); `fitBox` deja los
modelos en unos 1,11 x 0,68, 1,27 x 0,85 y 1,21 x 1,0 a escala 1, apoyados en el suelo sin yOffset, instanciados con el toon y la
tinta de siempre (sin emisión, sin recorte alfa, doble cara como dice el GLB). Colocación (`worldgen.js` bloque VILLAGE_VEGETATION
tras VILLAGE_PALMS; `townKinds` y `propGap` suben un nivel para compartirlos): 24 filas explícitas (du/dv/kind/rot/escala, sin
rng, v 0,5) anexadas tras las palmeras (1259 + 20 + 17 + 24): 10 helechos, 7 arbustos de flores y 7 de hoja ancha, r 0 (sin
colisionador: jugadores y bots los atraviesan). Dos o tres en la base de cada choza (2,7 a 3,6 u del centro, fuera del arco de
puerta 0,9 rad / 6 u; un arbusto de flores junto a la puerta en cuatro chozas), tres parejas en el borde de la plaza entre las
palmeras del anillo (a 7,4 u o más del punto de aldea, donde los adoquines se funden en arena) y dos tras el puesto de la
vendedora, bajo su palmera. Holguras: FIRE_GAP 3,5, PROP_GAP 0,6, PALM_GAP 0,5 del tronco, PLANT_GAP 0,9, COLLIDER_GAP 0,1,
routeClear con r 0,5, fuera de nearPractice (incluye los 3,2 u del armero de la aldea); empuje máximo 0,6 u. Con la semilla
99282957 ninguna fila se empuja y el reparto de recursos (`resourceLayout`, que también da forma al terreno) no cambia.
Matorrales y hierba dispersa esquivan las plantas (`shrubPlacement.js` PLANT_R: helecho 0,58, arbusto 0,7, hoja ancha 0,58,
por la escala); `grassPlacement.js` EDGE_KINDS sin tocar (la hierba ya llena su tope de 1000 y las plantas no la necesitan).
Tests: nuevo `tests/village-vegetation.test.mjs` (orden, campos, holguras, composición, recursos intactos, determinismo,
matorrales y hierba), `tests/prop-variants.test.mjs` ampliado (manifiesto, tamaño ajustado de los tres GLB, instancias importadas,
fallback de los kits), `tests/village-palms.test.mjs` acota su ventana de palmeras y, como `tests/map-revamp.test.mjs`, fija el
total 1259 + 20 + 17 + 24; `package.json`, `src/data/meta.js` (lo que sirve `/status`) y `package-lock.json` en alpha.74. Pendiente:
la hierba de borde de las chozas solo mira colisionadores y puede crecer sobre una planta.

**VR02, 2026-10-19 — aldea de noche, segundo corte (adoquines, chozas y puesto Tripo, palmeras, recorte del jugador), alpha.73/protocolo 62:**
Sigue a VR01 sobre alpha.72 (sin empujar aún: alpha.72 y alpha.73 salen juntos). Adoquines de plaza (`terrain.js` rama stone,
`groundMaterials.js`): piedras redondeadas de 0,6 u con deriva de valor y tono por celda, junta de arena de 0,10 u sin tinta,
bisel con normal por diferencias finitas en `mnSandN` y piedras que se diluyen en arena en el borde (T-1018-33, Codex sol).
Tres props Tripo (`docs/art/prop-hut-stilt-shingle-v2/`, `prop-hut-stilt-thatch-v2/`, `prop-market-stall-awning-v3/`; 9500 /
9500 / 6174 tris, WebP 1024-512 / 512-256) entran por `assets/manifest.json` con `rotY -90` (puerta y escalones en +x del GLB
hacia el +z del juego). Variantes (`registry.js` byPropAll / propIds / fitted, `props.js` propVariants): un kind puede listar varios
modelos y sus instancias se reparten por hash de posición (round-robin, todos los clientes coinciden); las seis chozas de la aldea
mezclan los dos modelos. Ventanas iluminadas de las chozas importadas (`props.js` HUT_WINDOWS, medidas sobre el GLB tras el rotY,
cajas de brillo por el mismo ajuste de caja que el modelo); el fallback procedural sigue intacto sin modelos. Filas del catálogo
(`tools/art-catalog/catalog.json`). Palmeras de aldea (`worldgen.js` bloque VILLAGE_PALMS, T-1018-36): 17 palmeras explícitas
(du/dv/rot/escala/altura/forma, sin rng) anexadas tras el vestido de plaza (1259 + 20 + 17), colisionador r 0,38, fuera de la plaza,
del fuego, de los arcos de puerta de las chozas, de los props, de las rutas de bots y de las zonas de práctica; forma elegida
deslizando en x hasta que el hash de `palmGeometry.js` da la pedida. Recorte del jugador en el desvanecido cercano (`toon.js`
mnCutoutR / mnPlayerNdc / mnCutoutProj, `scene.js` PLAYER_CUTOUT_R 0,26, T-1018-32): solo se disuelve un disco alrededor del
jugador en pantalla; copas y tejados del borde se quedan y los difumina la profundidad de campo (radio 0 = comportamiento
anterior: título, mar, cámaras de depuración). Harness: `node tools/shot.mjs <dir> --scenario=village-night --quality=high
--tod=night|golden|day`. Tests nuevos: `tests/prop-variants.test.mjs` (contrato del manifiesto, escalones en +x, reparto
determinista, ventanas, fallback) y `tests/village-palms.test.mjs` (orden, campos, distancias, determinismo, recorte);
`tests/map-revamp.test.mjs` fija 1259 + 20 + 17. Gate 29 ficheros 202/202 (verificador), `assets:check` OK. Capturas fuera de
git: `shots/t36/village-night-high.png` (palmeras + recorte + DOF), `shots/t34/night-zoom2.png` (chozas y puesto Tripo de
noche), `shots/t32/village-day-high.png` (día con DOF). Pendiente: empujar alpha.72 + alpha.73; MAX_LIGHTS 12 sigue
descartando ventanas en la plaza (la captura cuenta 1 ventana entre 10 luces); calentamiento de los shaders del DOF en
`scene.js`; los GLB de vegetación ya generados en `asset-staging/tripo/` (fern-cluster, flower-bush, broadleaf-plant, con
`-v2-lod`) necesitan kinds nuevos de prop antes de entrar; los siete props de plaza del estudio Tripo (lantern-post,
fence-rope, notice-board, planter-flowers, stall-tarp, crate-stack, campfire-ring) siguen sin exportar.

**VR01, 2026-10-18 — revamp visual de la aldea de noche (luz, vestido, hierba, atmósfera, DOF), alpha.72/protocolo 62:**
Objetivo: la plaza de Salty Shore de noche como el diorama de referencia (`docs/art/night-village-revamp/`), sin perder el
toon, la tinta ni la mecánica de oscuridad. Luz (`lighting.js`, `lights.js`, `toon.js`): charcos suaves con rebote
(`mnLightSoft`/`mnLightBounce`), preset `night` con relleno azul marino (hemi 1.7, split 0.4 con sombras 0x1c2452,
sat 0.88, lightSoft 0.5, lightBounce 0.1) y radios cortos (linterna i 2.4 r 5.5, hoguera i 3.2 r 6.5, ventana r 6);
el dorado baja a lightSoft 0.45 / lightBounce 0.08 para mantener el orden día < dorado < noche de `tests/fx.test.mjs`.
Vestido de plaza (`worldgen.js` bloque `PLAZA`, `props.js` kits fence/board/planter/stallTarp): 20 props anexados tras
la línea base (1259 + 20) con 32 colisionadores (18 pies de valla), rutas de bots respetadas por tramos (`routeClear`),
`tests/map-revamp.test.mjs` fija el prefijo. Hierba de borde (`grassPlacement.js`, `shrubPlacement.js`, presupuestos
1000/520/160, `tests/grass-placement.test.mjs`). Atmósfera (`vfx/effects.js`): luciérnagas, niebla baja y ascuas con
puerta de noche. Profundidad de campo (`pipeline.js` paso 6b, solo alto/ultra, `quality.js` campo `dof`): CoC desde la
profundidad de `rtNormal` con foco en `rig.dist`, banda nítida ±3.5 u (caída 4 delante / 8 detrás), tilt-shift 0.2–0.5
de pantalla, blur separable a media resolución (13 taps, pesado por CoC), composición a resolución completa con el alfa
de `rtPost` intacto (la máscara de brillo del bloom sobrevive); `?dof=0|1`, vista de depuración `__mn.view('coc')`,
`tests/quality-dof.test.mjs`. Harness: `node tools/shot.mjs <dir> --scenario=village-night --quality=high [--dof=0]`
(pasa el diálogo de personajes, anula `lighting.setGameplay`, imprime JSON con sunI, hemi, dof y luces; 3,5 min bajo
SwiftShader); `tools/qa-night-village.mjs` admite `VARIANTS` para comparar presets en una sola sesión. Gate 29 ficheros
202/202; capturas fuera de git (`shots/`). Pendiente: MAX_LIGHTS 12 descarta la linterna del puesto y 3 ventanas en la
plaza; los shaders del DOF compilan en el primer fotograma (un tirón: añadirlos al calentamiento de `scene.js`); exportar
los 10 GLB del estudio Tripo (T-1018-19) y meterlos con `prep-asset.mjs`; sombreador de losas (`terrain.js:117-128`);
agua y materiales de la tabla de referencia.

**AS02, 2026-10-18 — barril de ron Tripo, alpha.71/protocolo 62:**
El barril procedural se sustituye por el GLB de Tripo `prop-rum-barrel-v1` (1867 tris, textura 512 PC / 256 móvil)
vía `assets/manifest.json` (`prop:barrel`, `mobileSrc`); fila `barril` del catálogo actualizada, fuentes en
`docs/art/prop-rum-barrel/`. Sin cambios de código: un prop importado gana también en pueblos con mapa (como el crate).
Protocolo de assets OK. Sin captura de navegador en este corte; FPS físico no aceptado.

**ST01c, 2026-10-14 — atlas: descarga cerrada, memoria GPU pendiente:**
[Entrega](delivery/st01c/ATLAS-LAB.md), [checkpoint](delivery/st01c/atlas-checkpoint.json).
WebP lossless completo: 1.369.043→552.514 B (-59,64 %), mismos RGBA y 268 renders
exactos del original. Dos runs/1.072 pares de imagen idénticos, 17 Node +5 Python,
URLs/dimensiones reales y liberación en fallos. Los candidatos 128/64 px fallaron
49/230 casos, no se admiten; full sigue a 30,67 MiB GPU estimados. UI lo indica.
Sigue compresión GPU a resolución completa antes de cumplir memoria móvil/taller;
FPS físico, compositor/UI y registro general no aceptados. Fuentes intactas, solo lab.

**Niagara, 2026-10-14 — dirección del autor: cada port alimenta el siguiente:**
[Plan acumulativo](briefs/niagara-reusable-pipeline.md), enlazado desde ST01c y el taller.
IR con procedencia, registro de módulos versionados, pasos deterministas y matriz de
capacidades reutilizadas/nuevas/ausentes; pruebas y fichas se conservan entre familias.
El piloto sigue especializado; el contrato general/CLI no está implementado. Próximo:
atlas/presupuesto, luego extraer primitivas y probar reutilización con otra familia exacta.
No cambia runtime ni acepta nuevos efectos; compositor e UI Workshop siguen en plan.

**ST01c, 2026-10-14 — color controlado cerrado; sigue presupuesto/atlas:**
[Entrega](delivery/st01c/COLOR-LAB.md), [ficha](delivery/st01c/effect-description.json).
Filmic SDR desde fuentes UE5.8 fijadas, LUT32³ con cuantización 10 bits en contenedor
half-float (256 KiB). Target gamma 2,2, estado de captura persistente para exposición
0/+1 EV, HDR raw para evitar pérdida RGBE; sin bloom/AA/grading externo.
96 muestras máximo 1/255; conversión aislada MAE <0,043/255; completo IoU ≥0,9801
y MAE ≤7,838/255, máximos de canal 67/255. Dos referencias HDR/readback y PNG
decodificado idénticos; contenedores PNG pueden diferir en compresión lossless.
14/14 CPU, Chrome color/profundidad/nativo y capturas revisadas a 390 px.
Mismas partículas/fuentes; sin runtime, SQL/protocolo o registro jugable nuevo.
Sigue variantes de atlas y presupuesto antes de taller; FPS físico, bloom libre,
perspectiva, compositor e UI Workshop conservan gates posteriores.

**ST01c, 2026-10-14 — DepthFade cerrado en escena privada; sigue color/presupuesto:**
[Entrega](delivery/st01c/DEPTH-LAB.md), [ficha](delivery/st01c/effect-description.json).
Nativo lee profundidad opaca en pase independiente; rampas de 25/50/100/150 cm
contrastadas con UE dentro de 0,01 RGB lineal. Negativo/cero incluyen oclusión opaca.
Dos ejecuciones idénticas (22 HDR cada una), 16/16 casos dentro de umbrales previos,
11/11 CPU y navegador sin errores; escena vacía y tres modos previos conservados.
Partículas/fuentes intactas, sin captura como entrada del generador. Capturas revisadas
en escritorio y 390 px; FPS físico y perspectiva no aceptados. Color final UE y
presupuesto/variantes de atlas preceden taller; compositor e UI Workshop siguen plan.
Sin cambios de juego, SQL, protocolo ni nuevo registro jugable.

**ST01c, 2026-10-13 — nacimientos y evolución locales; sigue profundidad/color/presupuesto:**
[Entrega](delivery/st01c/NATIVE-LAB.md), [ficha actualizada](delivery/st01c/effect-description.json).
Generador del piloto desde HLSL efectivo, curva y semilla; cero estados grabados como
entradas. Las dos referencias: 241 ticks/4.140 estados cada una, mismos IDs/orden;
error máximo de posición 0,0000019 cm, alfa 0,0000009; resto de campos cotejados exactos.
9/9 CPU, 7 grupos Chrome nuevo modo y regresión de los otros dos; semilla/emisión a 7 s.
Fuentes intactas, solo lab privado. Semilla variante repetible local, aún sin cotejo UE
de variantes; color final/DepthFade/FPS físico/taller pendientes. No amplía la biblioteca
ni activa juego/SQL/protocolo. Fichas para futura autoría, compositor e UI Workshop siguen plan.

**ST01c, 2026-10-13 — actualización local; sigue generador de nacimientos:**
[Entrega](delivery/st01c/UPDATE-LAB.md), [ficha del efecto](delivery/st01c/effect-description.json).
Nuevo modo del lab calcula edad/muerte, posición, alfa y SubUV desde 50 primeros estados
observados. Dos ejecuciones, 241 ticks/4.140 estados cada una dentro de tolerancias;
5/5 CPU y Chrome ambos modos. Parámetros privados de velocidad/vida/parada comprobados.
No declararlo un emisor nativo completo: faltan distribución, Lathe y spawn interpolado;
después DepthFade/color final/presupuesto e integración. El autor pidió prever un agente
de autoría: fichas legibles sin visión repetida, iconos/animaciones y composición por
roles/anclas en ST02/ST03. Plan actualizado, compositor aún no implementado.
Sin juego/SQL/protocolo/alta de catálogo nuevos; UI Workshop sigue solo planificado.

**CH01, 2026-10-13 — personajes independientes, alpha.70/protocolo 62:**
[Contrato](briefs/CH01-character-slots.md), [entrega](delivery/character-slots/README.md).
Tres slots por cuenta; perfil histórico conservado con el mismo UUID, Bucanero nuevo con pistolas.
Auth owner separado del perfil; compañeros/GM/wallet mantienen permisos de cuenta. Al integrar
L03g-a, la presencia y su bloqueo de pairing también pasan a la cuenta, no al personaje.
**Requiere SQL038 listo** (`mn_player_characters_ready()` = `{"version":1}`): sin él, la entrada con cuenta responde 503.

**AREA01 A0-G1, 2026-10-13 — levantamiento cerrado; sigue GM06a:**
[Estudio/matriz](world/a0-g1/README.md), [plano medido](world/a0-g1/terrain-survey.svg),
[datos reproducibles](world/a0-g1/survey.json). Base `a7cf225`, 560/N561, 29 anclas y
206 recursos actuales. Dos sitios existentes son cortos; se recomienda Sol en extensión
occidental, XZ (-720,100), envelope X [-840,280], Z [-280,280], mismo mercado `sol`.
810 u de camino/921 u de costa son previsiones parciales, sin recorrido jugado.
Conservar llegada/Salty/fuente/Caldera/Cala/IDs; banda de conexión censada sin colocaciones.
Primero contrato y prototipo privado de costa/bounds/compatibilidad GM06a; luego A0-G2/A3.
Sin juego, SQL, versión/protocolo o geografía nueva activada. Ceniza sigue lejana y posterior a A6/D10.

**AREA01 A0-P, 2026-10-13 — ajuste del autor: Ceniza mucho más lejos:**
[Plan](../PLAN-REGION-INICIAL.md) y [plano](world/region-inicial-v1.svg).
Mar abierto y combate desde el barco antes de llegar; duración/distancia por medir.
D10/A6 pasa a ser requisito de A4/primera llegada. Preparar equipo desde Salty/Sol;
no exigir su componente raro para superar el viaje ni PvP. Ruta corta a Sol conservada.
Se actualizan región/alfa/roadmap naval; siguiente corte A0-G1, sin cambio de mapa activo.

**Troncos recogibles, 2026-10-13 — corrección de veta:**
[Entrega](delivery/pickup-wood-uv/README.md). Proyección UV por cara sobre el GLB
curvo, normales originales conservadas y recorte limpio del atlas existente.
34/34 pruebas, Chrome local escritorio/móvil 2/2 y comparación visual inspeccionada.
Alpha.69/protocolo 61 publicada en `676833a`: actualizador 197/197, runtime 38 hashes
y entrada pública escritorio/móvil 2/2 con 34 archivos HTTP exactos, cero errores.

**ST01c — laboratorio privado de material, 2026-10-13; sigue simulación propia:**
[Entrega/comparación](delivery/st01c/RENDER-LAB.md). Referencias Unreal multiángulo y
241 estados CPU; reproducción privada 3D en Three con atlas/material originales.
El HDR a 2 s se compara bajo la misma presentación de color; el color final de Unreal
y la simulación propia no están aceptados. Sigue resolver spawn/curvas y reemplazar
la grabación por un generador. Sin runtime, catálogo, SQL, protocolo o activación nuevos.
UI Workshop continúa solo en plan.

**Checkpoint previo ST01c — extracción directa Niagara, 2026-10-13:**
[Entrega](delivery/st01c/DELIVERY.md), [plan autorizado](briefs/st01c-niagara-native-fidelity.md).
Piloto exacto MyProject `NS_Flame_Single`; consultas UE5.8 NullRHI y helper C++ compilado.
Dos versiones/renderers efectivos, 100 registros tipados en ocho stores (80 nombres);
100 cotejos de bytes y valores, cadenas por conexiones, material común de seis expresiones.
51 originales/copias conservan hashes. La extracción justifica un prototipo acotado;
no acepta equivalencia visual ni convierte el resto de la biblioteca. Sin runtime/SQL/protocolo.
Completar semántica/curvas/estado global y referencia multiángulo antes del port privado;
reconsiderar si requiere una réplica desproporcionada. UI Workshop continúa solo en plan.

**AREA17 L03g-a — presencia segura, 2026-10-13:**
[Contrato](briefs/l03g-companion-presence.md) y [entrega](delivery/l03g-companion-presence/README.md).
Mis compañeros: salir, seguir, esperar, volver y descansar sin modelo; cuerpo del host
y plaza normal, limitado al ancla/zona de Salty Shore. SQL039 confirma ingreso antes de
publicar y conserva cerco ante caída/incertidumbre; perfil con su única autoridad existente.
111/111 locales y navegador 12/12 con auth/store simulados, sin Qwen. SQL039/flag/canario
públicos pendientes; Brisa real intacta y detenida. L03g-b conectará mente al mismo cuerpo;
ahora presencia y controlador L03f se excluyen mutuamente. No hay recuperación automática
del cerco ni salida a combate/recolección/economía; detalles y límites en la entrega.

**AREA03, 2026-10-13 — alimentos e INV03:**
[Entrega](delivery/food-item-completion/README.md): fichas ES/EN con usos, masa/volumen,
valores y efectos actuales; ambas barras de carga incluyen el bonus de la galleta.
38/38 regresiones focales, 6/6 configuraciones locales de provisiones y 4/4 de ficha.
[INV03](delivery/inv03-existing-backpacks/README.md) conserva las mejoras existentes:
la prueba pública encontró y corrigió el recorte del taller en móvil girado (4/4 locales).
Aceptación pública completa 22/22: ambos tiers, coste exacto, Carga, piedra conservada,
replay, denegación y reentrada. Publicado en `a21c47f`, siete hashes de UI/CSS exactos
en contenedor/HTTPS; una autoridad saludable, sin nueva SQL ni balance.
El autor eligió cerrar alimentos actuales y continuar mochilas; lima/hierbas siguen
como propuestas. Añadida al plan [fibra, techumbre y cuero](briefs/plant-fiber-thatch-leather.md):
plantas → fibra → lona, palmeras → hojas/techos económicos, animales → piel → cuero.
Recetas y rendimientos por definir; aún no son recursos jugables nuevos.

**AREA15, 2026-10-13 — swallow con recibo común; piloto público apagado:**
[Entrega/evidencia](delivery/m5-ground-pearl-swallow.md), [contrato](briefs/m5-ground-pearl-swallow.md).
Cuenta autenticada, bolsa → ranura tragada vacía; misma cuenta/UID, un perfil CAS,
generación/tombstone y mundo/reloj confirmados por SQL006/018/019 antes de apply.
Efecto de los cuatro poderes y filtrado reversible de inputs antiguos; ligado hasta morir, sin reemplazo/escupir.
45/45 aceptación en cuatro archivos, incluidas dos recuperaciones SIGKILL locales;
266/267 regresión pertinente en 24 archivos; único fallo de expectativa de swallow ya habilitado,
corregida para rechazar reemplazo. 13/13 seguimiento focal en dos archivos, sin delta runtime.
Fuentes congeladas; conteos solapados, sin reetiquetar la cohorte amplia.
Sin SQL/flag/protocolo nuevos. Código publicado en `46902fe`, alpha.67/protocolo 60:
actualizador 197/197, imagen 100/100 y 27 hashes; entrada 6/6,
saludable y cero errores/pendientes. Montajes comunes públicos nulos.
Sigue candidato completo kill/cofre y luego composición GM/compañeros/control/bots/antorchas,
adopción detenida y canario VPS; montaje común público apagado.
Integración posterior alpha.68/protocolo 61: presencia/swallow 78/78 y guard 9/9; VPS `5ad1029` verificado, imagen 38/38, entrada 6/6. Presencia y Ground siguen apagados.

**AREA01 A0-P, 2026-10-13 — diseñar geografía antes de construir Puerto Sol:**
[Plan de primera región](../PLAN-REGION-INICIAL.md), [plano provisional](world/region-inicial-v1.svg).
Salty Shore/Sol comparten isla y camino/costa; Ceniza ocupa otra isla. Esquema de relaciones propuesto,
sin escala ni coordenadas runtime. Conservar anclas/IDs actuales de llegada, puerto, fuente, Caldera,
Cala y recursos; editor actual no crea costa nueva. Siguiente corte **A0-G1: medir terreno y anclas**,
decidir emplazamiento real de Sol y extensión necesaria, antes de GM06/A3 y descarga multipuerto.
No hay código, SQL, versión nueva o geografía activada en esta entrega documental.

**Modelos de campo/cocina, 2026-10-12 — integración visual y optimización:**
[Entrega y evidencia](delivery/item-models-v1/DELIVERY.md). 12 GLB del autor archivados intactos;
24 derivados WebP 512/256, 28,03 → 1,35 MiB, geometría/UV/color conservados.
Antorcha original portátil; resina/coco con presentación breve tras recibo aceptado,
máximo ocho y sin nueva recogida. Troncos recogibles con atlas ilustrado de madera
reutilizado. Nueve piezas de cocina/propuesta en biblioteca GM con carga bajo demanda.
65/65 regresiones focales, 76/76 integración y Chrome local/público 2/2 cada uno.
Alpha.67/protocolo 60 publicada en `a19f5e1`: 38 hashes de contenedor, 34 públicos,
una autoridad saludable, cero errores y variantes reales 512/256. Fuentes confirmadas.
Sin nueva receta, SQL o protocolo.

**ST01b — biblioteca Niagara original, 2026-10-12, alpha.66/protocolo 60 publicada:**
[Entrega y límites](delivery/st01b/DELIVERY.md), [contrato](briefs/st01b-niagara-library.md).
Censo completo de 993 fuentes/916 identidades binarias y 775 miniaturas; 15 componentes
originales separados de sus sistemas y un extracto real de Firework de MyProject, 60 frames.
17 vistas con Tromba, búsqueda/filtros, borradores/historial/recuperación independientes;
biblioteca móvil y foco de teclado. 58/58 CPU y 9/9 Chrome local, 32 variantes de atlas,
cero acciones de juego/escrituras GM. Publicado en `739e1b2`: 197/197 del actualizador,
11 hashes de runtime/paquete y 32 atlas públicos exactos, 9/9 Chrome con cuenta GM,
entrada WSS normal y cierre sin jugadores/errores/pendientes. Sin SQL ni protocolo nuevos.
Las 916 simulaciones Niagara no se ejecutan en el navegador; componentes y captura 2D no
aceptan volumen, densidad ni calidad AAA equivalente. [ST01c](briefs/st01c-niagara-native-fidelity.md)
tiene el piloto de extracción autorizado y documentado arriba; adaptación visual pendiente.
UI Workshop conserva su plan. Fuentes Unreal y trabajo concurrente intactos.

**AREA15, 2026-10-12 — give gratuito con recibo común; piloto público apagado:**
[Entrega/evidencia](delivery/m5-ground-pearl-give.md), [contrato](briefs/m5-ground-pearl-give.md). Dos cuentas autenticadas, bolsa → bolsa;
reserva de ambas cuentas/UIDs antes de IO, progreso/autosaves previos, dos CAS y generación durable.
Apply conjunto o rollback/cerco, reintento exacto y dos SIGKILL locales sin efectos históricos.
38/38 aceptación en 4 archivos. Cohorte pertinente 400/401 en 51 archivos congelados;
único fallo HTML localizado reproducido en upstream. Expectativa corregida; 27/27 repetidos en 2 archivos, sin cambios de runtime.
Sin SQL/flag/protocolo nuevos. Montaje común apagado; venta con pago y perla tragada no entran en give.
Integración posterior de antorchas/resina/coco: 60/60 en siete archivos, fuentes congeladas; conserva su exclusión con el montaje común.
Código publicado en `e237768`, alpha.65/protocolo 60: actualizador 197/197, imagen 74/74 y 23 hashes; entrada pública 6/6, cero errores/pendientes. Montajes comunes y flag nuevo de antorchas apagados.
Siguen swallow/kill-cofre, composición GM/compañeros/control/bots/antorchas, adopción detenida y canario VPS.

**Antorchas/resina/coco, 2026-10-12 — alpha.65 pública y activada, protocolo 60:**
[Contrato](briefs/torch-resin-coconut.md), [entrega y activación](delivery/torch-resin-coconut/DELIVERY.md).
Antorcha a mano por 2 troncos + 1 resina; extras de tala de palmera 35 % resina/40 % coco,
coco +25 hidratación, iconos 128/64 px y referencias PNG con alfa para Tripo3D.
Corregidos idioma del fuego y solapamiento de estadísticas/botón de fabricación.
Chrome local 4/4 EN/ES escritorio/móvil; regresión focal 149/149 y SQL037 final 9/9;
SQL037 readiness 1 y `MN_TORCH_RESIN_COCONUT_OPERATIONS=1` verificados; revisión activa
`fcd5160`, 31 hashes de contenedor y 25 públicos. Receta, coco y reentrada durables
completados en cuatro configuraciones, con repetición final ES aceptada; probes GM
cancelados conservados aparte. Tala pública final 5/5: resina y coco observados,
recibos SQL, reintento sin duplicación y reentrada. Cero errores/pendientes
al cierre, cuentas temporales eliminadas, recibos conservados. GLB espera al autor.
Referencias y recepción de GLB reunidas en [galería](../ARTE-Y-MODELOS.html) y
[guía de objetos](art/ITEMS.md).
La entrega distingue un test antiguo de ficha que falla también en HEAD limpio.

**L03f — recorrido desde la cuenta real, 2026-10-12:**
[Evidencia y límites](delivery/l03f-local-pairing/README.md#recorrido-en-cuenta-real-y-refresco-de-lista).
Brisa creada desde el wizard del alfa.64, con documentos guardados y detenida.
Centro de inferencia carga sin conexiones disponibles; no se generó código, inició
controlador ni consultó Qwen. Lista tras creación corregida con lectura serial de
estado; 33/33 pruebas focales locales. Refresco automático público pendiente del
relevo habitual. L03g sigue como propuesta sin aprobación ni implementación.

**AREA03 — arte de cocina y paquete Tripo, 2026-10-12:**
[Atlas, PNG individuales y ZIP](art/cooking-icons-v1/README.md). 17 referencias transparentes:
básicos, tres comidas especiales, coco/resina/antorcha reutilizados y sal/lima/hierbas propuestas.
Propuestas fuera del catálogo; resultados siguen consumiéndose al preparar. Ingredientes con cantidades
y resultado propio en el panel existente. Atlas de UI 81/27 KB, una variante por dispositivo;
10/10 tests focales y seis configuraciones locales ES/EN/escritorio/móvil. Publicación y mallas pendientes.

**AREA15, 2026-10-12 — plan de continuidad reconciliado:**
[Matriz de cobertura](CONTINUITY-MATRIX.md), [revisión y lectura VPS](delivery/m5-continuity-review.md).
Alpha.63 observado sano; los montajes comunes siguen nulos. La matriz separa estado guardado, recibo probado y aceptación pública.
El contrato give preparado en esta revisión tiene aceptación posterior en la entrega enlazada arriba; sigue swallow/kill-cofre.
Componer GM/compañeros/control y rutas activas antes de adoptar; conservar los guards actuales y los checkpoints fechados debajo.

**ST01a — laboratorio privado de Tromba, alpha.64/protocolo 59:**
[Contrato](briefs/skill-studio-vision.md) y [entrega](delivery/st01a/DELIVERY.md).
Portada → Taller de habilidades con permiso GM; personaje real, reproducción y parámetros visuales,
original/borrador con semilla/reloj/cámara comunes, undo/redo y borrador local por cuenta/servidor.
Importar/exportar JSON acotado; no publica variantes ni ingresa un cuerpo o escribe progreso.
Sin SQL nuevo. Regresiones 29/29 y comparación con Tromba anterior 25/25; Chrome local 9/9
en ES/EN/escritorio/móvil, con recuperación, revocación y foco de teclado. Publicado en `1417975`:
actualizador 194/194, imagen saludable, hashes 14/14 contenedor + 12/12 públicos, GM público 7/7
y entrada WSS normal. Cero errores/guardados pendientes; contenido generación 8 conservado.
ST01 sigue activo: adaptación Niagara real y posterior contrato de variantes compartidas.
El [taller de UI](briefs/ui-workshop-vision.md) queda diseñado para mover/redimensionar/cambiar arte,
con anclajes, estados y pruebas responsive; implementación diferida por petición del autor.

**Bucanero — reacción original y retroceso, alpha.62/protocolo 59:**
[Contrato](briefs/buccaneer-combat-reaction.md) y [entrega](delivery/buccaneer-v1/combat-reaction/README.md).
`hit_to_body_01` adaptado como capa aditiva al rig armado: torso/cabeza, brazos solo quieto;
correr/disparar conserva brazos procedurales. Reinicio por golpe, salida suave, cancelación en dash/nado/muerte.
RMB visual ×1,45/0,42 s frente a LMB ×1/0,18 s, sin cambios de combate, perfil o SQL propios.
Derivados +57 KB, texturas 1024/512 y geometría intactas; idle de ficha/nado original conservados.
Integración concurrente conservada: 76/76 focales y 36/36 integración, Chrome local 16/16 escritorio/móvil.
Suite general no repetida. Enviado en `b466ed9`, publicado en `6f25a0f`: actualizador194/194,
imagen validada/saludable y salud pública 200, cero errores/escrituras pendientes. Público14/14
escritorio/móvil y 28 hashes iguales a Git. Golpe público: sonda cosmética; daño confirmado aceptado localmente.
[Recibo](delivery/buccaneer-v1/combat-reaction/publication.json). Balance/FPS físico pendientes.

**AREA01 GM04d — recursos funcionales publicados, alpha.63/protocolo 59:**
[Contrato](briefs/gm04d-functional-resources.md) y [entrega](delivery/gm04d/DELIVERY.md).
Editor → Recursos: palmera talable/piedra recogible, colocar/mover/duplicar/retirar y undo.
Guardar es privado; publicar admite IDs nuevos mediante SQL036 bajo exclusión de mundo vacío.
Tala/recogida normales; agotamiento y ledger conservados por ID, también en retiro/rollback/reinicio.
SQL036 reaplicada y contrato vivo 4/4: se detectó y corrigió un readiness 1 de definiciones anteriores.
El store verifica también semántica antes de admitir. 418/418 CPU y 8/8 SQL seriales; local UI 9/9.
Suite amplia con fallo de fabricación reproducido en upstream; detalles y límites en la entrega.
VPS `c146b08` sano, actualizador 194/194, fuentes 29/29 + 20/20 públicas y entrada real.
GM público autenticado 9/9 ES/EN escritorio/móvil; borrador privado, base generación 8 conservada.
Cierre integrado 137/137 y compañeros 27/27; conteos solapados. Siguiente corte aprobado:
[Taller de habilidades](briefs/skill-studio-vision.md),
ajustar las actuales primero e incluir una adaptación Niagara real. Intake acotado en
[SKILL-STUDIO-INTAKE](research/unreal-assets/SKILL-STUDIO-INTAKE.md); fuentes Unreal intactas.

**L03f — emparejamiento local integrado, alpha.63/protocolo 59:**
[Contrato](briefs/l03f-local-pairing.md) y [uso/evidencia](delivery/l03f-local-pairing/README.md).
Mis compañeros → Permitir conexión → Conectar en mi PC; código de un uso/cinco minutos,
controlador WSS saliente y capacidad solo chat. Perfil M5 y plaza normal; máximo dos controladores.
SQL025/027/034 existentes, sin SQL nuevo. Detener/revocar/salir/caducidad/reinicio invalidan el permiso.
Documentos, journal y presupuesto permanecen en la PC, conservados al reemparejar; refresco manual r + Enter.
Canario público reanudado 6/6 en alpha.60: controlador real por WSS, respuesta de stub HTTP local,
journal con ámbito y stop durable. Limpieza completada el 2026-10-12: tres registros ausentes por RPC,
dos perfiles nulos y auth QA 404; acceptance final verde, sin manifiesto pendiente (evidencia en la entrega).
Origin HTTPS y tolerancia acotada de reloj corregidos; 42/42 focales, 68/68 integración y 11/11 mundo/GM
tras el merge alpha.63. Navegador local previo 14/14 ES/EN; conteos solapados, suite general no repetida.
Publicado en c146b08: imagen sana, actualizador 194/194, 14 hashes de imagen y 8 públicos contrastados;
portada Chrome verificada. Revisión posterior: alpha.64/7b34381 sana, pairing disponible y sin pendientes.
Qwen apagado por el autor; sin llamadas nuevas. [L03g presencia](briefs/l03g-companion-presence.md)
es propuesta sin implementar: ingreso/retiro seguro separados de mente y emparejamiento; hoy solo chat.

**Bucanero a distancia y nado original — alpha.59/protocolo 58:**
[Brief](briefs/buccaneer-ranged-swim.md) y [entrega](delivery/buccaneer-v1/ranged-swim/README.md).
LMB rápido / RMB potente, manos/modelos distintos y recargas independientes; ambos interceptan
proyectiles por choque continuo 3D, solo el fuerte devuelve pesados. Sable conserva guardia.
Swim original en rig nativo de 65 huesos solo en agua, sin root motion; salida/muerte/fallo recuperan rig15.
Perfiles guardados conservan equipo; sin SQL propio. 85/85 CPU, 27/27 recheck, assets19/19 y catálogo39/39,
conteos solapados. Navegador local 20/20 escritorio/móvil; suite general no verde (ver entrega CPU).
Integrado con SRV02: 49/49 focales seriales y repetición local 20/20. Enviado en `bd55589`.
Publicado por el actualizador habitual en `62490c8`, alpha.59: imagen validada y contenedor saludable,
24 hashes públicos iguales a Git, entrada real y gatillos/nado/regreso a tierra ES/EN 12/12 escritorio/móvil emulado.
Cero errores o pendientes. Choque entre balas aceptado localmente; capturas públicas nocturnas limitan lectura del modelo.
[Recibo](delivery/buccaneer-v1/ranged-swim/publication.json) y [aceptación pública](delivery/buccaneer-v1/ranged-swim/public/acceptance.json).

**AREA03 SRV02, 2026-10-11 — SQL035 activo; grog aceptado en público, alpha.62/protocolo 59:**
[Contrato](briefs/srv02-special-meals.md), [entrega](delivery/srv02-special-meals/README.md).
Tres comidas con un efecto durante 15 min conectados, pausa offline y limpieza al reaparecer.
Recibo freshwater/M5, SQL035 readiness 1 y flag activo. WSS público 11/11 en `e625a5c`:
grog, coste, replay/colisión, pausa offline/reentrada y denegación caliente durable sin cambios.
Navegador público 12/12 en `6f25a0f`: botón real, guardado/reentrada, ES/EN escritorio/móvil vertical y horizontal emulados;
403 limitados al rechazo GM esperado para la cuenta temporal. Capturas y 20/13 hashes en la entrega.
194/194 actualizador previo, SQL 33/33 y recheck alpha.62 33/33, conteos solapados. Un primer rechazo SQL
no tiene causa confirmada; conservar su evidencia. Consumo público con fuego propio aún pendiente.
Después [INV03 sobre mochilas existentes](briefs/inv03-existing-backpacks.md): completar 30→42,
coste, replay/reentrada y Carga conservada. No rehacer sobrepeso ni añadir bolsas equipables todavía.
INV03 iniciado: [cadena SQL001–036 11/11](delivery/inv03-existing-backpacks/README.md), segundo tier
con Carga/coste/conservación/denegación/replay; todavía no acredita taller público.

**L03e creación durable de compañeros — aceptada en el alfa público, protocolo 56:**
[Entrega y evidencia](delivery/l03e-companion-creation/README.md), [brief](briefs/l03e-companion-creation.md).
Wizard privado: nombre, oficio, personalidad, rasgos y aspecto; aleatorio y revisión de documentos antes de confirmar.
Un compañero preparado por cuenta/mundo, con identidad, configuración SQL025 y control SQL027 detenido en SQL034.
57/57 focales; navegador local 12/12 con SQL034 en PGlite persistido y auth simulada; recheck de integración 21/21
solapado tras conservar los cambios concurrentes. Supabase SQL034 instalado/readiness 1 y flag de VPS habilitado.
Aceptación autenticada pública 11/11 en 96af1aa, alpha.56: creación, documentos, recarga/reentrada y limpieza
verificada de la cuenta temporal. Updater 176/176. Salud posterior comprobada en 66fcf82, alpha.57:
una autoridad sana, diez módulos de imagen y seis públicos iguales a Git, cero errores/escrituras pendientes.
Sin modelo/inferencia, spawn ni permisos concedidos; siguiente corte: emparejamiento local revocable y adaptador real de red.

**AREA15, 2026-10-11 — soltar perlas con recibo; piloto común apagado:**
[Entrega/evidencia](delivery/m5-ground-pearl-leave.md), [contrato](briefs/m5-ground-pearl-leave.md).
`leave` autenticado reserva cuenta/UIDs antes de IO, conserva progreso ECS y resuelve generación durable;
confirma perfil/ubicación/mundo/reloj antes de aplicar juntos sesión, suelo, ledger e índices.
Rollback y cerco ante deriva/cierre/desconexión, incluso callback nulo antes del comando.
28/28 nuevos; cohorte 625/636 en 73 archivos congelados, base e625a5c.
Tres archivos con fallos de asignación/clonación repiten 49/49 sin cambios; quedan dos fallos heredados
HTML localizado y Cometa/agua reproducidos en upstream limpio. Cohorte completa no verde. Dos SIGKILL nuevos
con recuperación/recogida únicas y cero efectos históricos. Conteos solapados.
Integración de compañeros alpha.60: 122/122 en 17 archivos seriales; GM036 alpha.61: 83/83 en 12 archivos.
VPS verificado en `6b713d2`, alpha.60/protocolo 59: actualizador 194/194, entrada pública 6/6 y
16 módulos iguales a Git; montajes comunes nulos, sin adopción ni SQL nuevo para `leave`.
Los recursos GM activos aún excluyen el piloto común: esa composición queda pendiente.
Sigue `give` transaccional, después `swallow` y sobre completo kill/cofre; luego transición/adopción y canario VPS.
Regla del autor: `give` solo entrega sin pago un UID en la bolsa del dueño. Tragada no se entrega ni vende.
Compraventa entre jugadores aprobada como dirección; requiere su propio corte y confirmar juntos perla y pago.

**AREA15, 2026-10-11 — perlas nuevas de élites/cofres; piloto común apagado:**
[Entrega/evidencia](delivery/m5-ground-pearl-mint.md), [contrato](briefs/m5-ground-pearl-mint.md).
Captura antes del suelo/evento, UID `mint:<UUID>` y recibo SQL004/018/019 bajo el mismo dueño;
muerte primero, mints en orden y publicación al terminar todos. Aplicación síncrona reversible,
filas actuales y pausa offline. 16/16 nuevos; 1063/1064 en 106 archivos congelados, base ff45e49;
único fallo Cometa/agua reproducido en upstream sin cambios, registrado en la entrega.
Dos SIGKILL nuevos con recuperación y recogida únicas, sin efectos históricos. Conteos solapados.
Integración alpha.56/protocolo 56: 137/137 en 24 archivos congelados (base c535e5d), conteos solapados.
Alpha.57/protocolo 56: 28/28 en 6 archivos (base b89a2d9); core de servidor/suelo sin cambios.
VPS verificado en 056d275, alpha.57/protocolo 56: actualizador 176/176, imagen 78/78,
14 módulos idénticos a Git y entrada pública 6/6. Sin SQL AREA15 nuevo ni activación/adopción pública.
El sobre completo de kill/cofre y candidatos sin intención durable no están aceptados.
Siguen comandos restantes de perlas y loot completo; después transición detenida/adopción y canario VPS.

**Bucanero, idle original en la ficha — alpha.57/protocolo 56, sin SQL propio:**
[Brief](briefs/buccaneer-sheet-idle.md) y [entrega](delivery/buccaneer-v1/idle/README.md).
Vista nativa Mixamo con su clip idle, giro/zoom y miniaturas quietas; mundo conserva rig de 15 huesos y acciones.
Máximo 24 FPS solo con figura visible; pausa/cierre/pestaña/documento oculto/movimiento reducido detienen
el loop. GLB por dispositivo 1.965.360/1.394.284 B (+353.260 B), sin segunda descarga de modelo.
42/42 focales CPU y 24/24 comprobaciones de navegador en escritorio/móvil; 57/57 tras integrar
la creación de compañeros concurrente (protocolo 56, SQL034 conserva su activación separada).
Publicado y verificado en `66fcf82`, alpha.57: 176/176 del actualizador, 15 hashes públicos
iguales a Git y entrada real escritorio/móvil con idle avanzando; cero errores o pendientes.
[Recibo](delivery/buccaneer-v1/idle/publication.json). Incluye el ajuste de tamaño de alpha.53.

**AREA01 GM04c, 2026-10-11 — dispersión decorativa publicada, alpha.57/protocolo 56, sin SQL GM nuevo:**
[Entrega/evidencia](delivery/gm04c/DELIVERY.md) y [contrato](briefs/gm04c-decoration-brush.md).
Biblioteca → Dispersión: arrastre con formas, densidad, separación, semilla y escala; cancelación/undo atómicos.
Costes de geometría/texturas cargadas y ahorro de archivo; límites por trazo y acumulados, modelos existentes.
Copias decorativas sin colisión ni tala. Política del pincel cliente diferenciada del contrato GM manual histórico.
V2–v4/compiler 2/SQL033 conservados. 293/293 base y 87/87 integración actual; local/público GM 10/10 cada uno.
Release `056d275` sana, 21/21 fuentes activas y 15/15 públicas; entrada real, mapa base generación 8 intacto.
Incluye bucanero/carga, compañeros e integraciones posteriores; conteos solapados y límites en la entrega.

**AREA03 INV02d, revisión 2026-10-11 — existente; corrección legacy enviada, alpha.54/protocolo 55:**
[Revisión y evidencia](delivery/inv02d-existing-audit.md). La otra sesión ya implementó sobrepeso,
70 %/40 %, bloqueo de nuevos dash, HUD/ficha ES/EN y predicción; no volver a empezar desde INV02c.
Corregida una discrepancia: sin Carga adoptada, una mochila antigua por encima del techo conserva
su movimiento normal; capacidad sigue impidiendo añadir mercancías. 83/83 en 14 archivos y 14/14
tras integrar el Bucanero concurrente (conteos solapados). Código `e874bed` enviado, sin SQL nuevo.
VPS último comprobado: `f26aae2`, alpha.52, dos jugadores/dos sockets, cero errores o pendientes;
el actualizador espera mundo vacío. Despliegue de la corrección y aceptación pública pendientes.
Siguen SRV02/comidas especiales y bolsas INV03 conservando volumen, como cortes separados.

**Bucanero, ajuste de tamaño pedido por el autor — alpha.53/protocolo 55, sin SQL:**
[Comparación antes/después](delivery/buccaneer-v1/size-review/README.md).
Modelo 1,89 → 2,12 u (+12,2 %); encuadre de ficha ×1,10; rostro del icono ×1,60 centrado.
36/36 focales, cuatro sesiones de comparación y 16 vistas completas sin cortes; originales intactos.
Publicación registrada por separado tras el relevo ordinario del actualizador.

**Bucanero del autor, 2026-10-11 — integrado, alpha.52/protocolo 55, sin SQL:**
[Entrega y evidencia](delivery/buccaneer-v1/README.md), [brief](briefs/buccaneer-character-v1.md).
Aspecto existente 2 con modelo Tripo/Mixamo y retrato ilustrado; rebind al rig/acciones actuales.
Originales conservados y derivados 1024/512 seleccionados por dispositivo, con fallback procedural.
36/36 focales y 19 comprobaciones de navegador; ficha/HUD, poses armadas/herramienta, fuente frente
a derivados y 404 real revisados. La publicación se registra aparte en la entrega.
Aspecto completo provisional; dedos fuente, creador modular y FPS físicos siguen pendientes.

**Antorcha y luz de proyectiles, 2026-10-11 — alpha.51, protocolo 55 sin cambios, sin SQL:**
[Entrega](delivery/torch-light.md). La antorcha (N) siempre pidió 1 tabla básica (`madera`, SQL022), no troncos;
el panel de fuego ahora lo muestra (tarjeta de material, aviso «2 troncos por tabla» y botón a fabricación) y pasa al
kit azul. La antorcha entra como receta a mano en el menú de fabricación (TAB y banco) con la misma intención `fire`
del panel, sin tocar `resource craft`. Balas, perdigones y proyectiles enemigos son luces móviles en los huecos libres
de `LocalLights` (hasta 4, sin quitar faroles) más destello de boca. Suite completa 4721/4743; los 17 fallos también fallan en origin `5da58e9` (18 allí).

**AREA17, 2026-10-11 — disponibilidad del centro público; creación aún pendiente:**
[Entrega](delivery/l03d-public-inference-availability.md), [contrato](briefs/l03d-public-inference-availability.md).
Sin conexiones y sin configuración previa, explica la disponibilidad y oculta el formulario de gasto.
Con valores previos, los conserva de solo lectura. ES/EN, Volver/Recargar; sin SQL/protocolo ni proveedor.
56/56 UI/cliente/red; navegador y despliegue se registran en la entrega. El Studio local no crea
compañeros en cuentas públicas: faltan vínculo durable, emparejamiento y adaptador real de red.
Navegador local 19/19; código `1983733` desplegado en `6fd7f68`, alpha.51/protocolo 55.
Una autoridad sana, seis hashes Git/imagen/URL coincidentes; entrada pública invitada 7/7
y autenticada real 7/7, ES/EN y móvil, sin errores. Cuenta temporal retirada y verificada.
No se forzó relevo ni desconexión; creación/emparejamiento/modelo públicos siguen pendientes.

**AREA15, 2026-10-11 — muerte y botín compuestos; código publicado, montaje común apagado:**
[Entrega/evidencia](delivery/m5-ground-death-lifecycle.md), [contrato](briefs/m5-ground-death-lifecycle.md).
Captura fatal real, pérdidas/XP/PK y fuentes en el recibo común; recogida/expiración automática,
hidratar filas actuales y pausa offline. Aplica perfiles/ECS/sesión/eventos juntos tras SQL confirmado.
1015/1015 en 100 archivos congelados (base 97d32a1), cuatro SIGKILL nuevos;
SQL001–032, Carga/agua/terreno y supervivencia/respawn conservados. Conteos solapados.
Integración final 278/278 en 43 archivos congelados (base 58a097b):
INV02d/carga, SQL033/materiales GM y exclusión de activación, cantimplora y Companion Studio.
RNV08a/costa 74/74 en 14 archivos congelados (base cd2a97b), conteos solapados.
VPS `cd2a97b` sano, 0.6.0-alpha.50/protocolo 55: 176/176 del actualizador,
63/63 sin red en la imagen exacta, diez módulos iguales a Git y entrada pública 6/6.
Una autoridad/timer activo; sin SQL nuevo, adopción ni montaje público. Sigue mint y comandos
restantes de perlas; después transición detenida/adopción y canario autenticado de caída/reinicio VPS.

**AREA07 RNV08a, 2026-10-11 — publicada y desplegada; alpha.50/protocolo 55:**
[Brief](briefs/RNV08a-shore-resupply.md) y [entrega](delivery/rnv08a-shore-resupply.md).
Parada seca autoritativa: mercado físico y agua/comida de mochila disponibles; bodega, barriles y
construcción bloqueados. Reembarque conserva el mismo viaje y recalcula masa de recipientes/agua.
M5/SQL030/032 existentes, sin nueva migración o flag; referencias estables en commits y rechazos.
Runtime `cd2a97b`, una instancia sana, 176/176 en Docker y 21/21 hashes públicos iguales a Git.
WSS autenticado 5/5: consumo, replay y reconexión durables; cuenta temporal retirada, cero errores/pendientes.
Navegador local ES/EN con fixture de ubicación: comercio, agua/comida y el mismo viaje tras reembarcar.
Puerto Sol aún necesita geografía/anclas físicas; este corte no acepta la ruta completa ni descarga.

**INV02d, 2026-10-11 — sobrepeso, ficha de personaje y fabricación a mano, alpha.49/protocolo 54, sin SQL:**
[Entrega](delivery/inv02-survival.md). Sobre INV02a–c y RNV07b sin tocar sus operaciones M5, SQL029/032 ni contratos.
Con Carga adoptada, cómodo = techo / 1,25 (40 + 4 por punto): entre cómodo y techo 70 % de velocidad y sin dash,
por encima del techo 40 %; nunca inmoviliza ni borra. Sin Carga adoptada no cambia nada. Nivel de carga calculado
por la autoridad y predicho (columna `load`); natación intacta. Ficha de personaje del kit UI con los controles INV02c
y medidores SRV01; los alimentos abren el panel de agua y provisiones (consumo durable RNV07b). Menú de fabricación
(TAB/HUD) y hacha/pico a mano con 3 troncos + 2 piedras. Paleta del kit en HUD y paneles. Retirado el borrador
SQL028/`attr`/`eat`. Pendiente: comidas especiales SRV02 como operación `freshwater` + ampliación SQL032.
Suite completa **4598/4659**; los 55 fallos también fallan en origin `c33ed9c` (68 allí) salvo uno de red que pasa
aislado. HUD vertical **36/36** (origin 28 solapes; corregido el bloque del jugador con barras) y ficha en 4 viewports.

**AREA01 GM05b, 2026-10-11 — pintura publicada, alpha.48/protocolo 53:**
[Contrato](briefs/gm05b-terrain-paint.md) y [entrega](delivery/gm05b/DELIVERY.md).
Hierba/tierra/arena/roca, borrar gradual y pinceles circular/cuadrado/elíptico compartidos con escultura.
Documento v4/terreno v2, hash de materiales y alturas; versiones anteriores conservadas.
SQL033 aplicada por el autor y readiness del servicio comprobado. Reutiliza las texturas optimizadas actuales.
267/267 casos acotados, imagen 37/37 y navegador público 11/11; capturas ES/EN escritorio/móvil inspeccionadas.
Release `0a2dfc0` sana, 35/35 fuentes activas verificadas; cadena durable y entrada real aceptadas.
Canario retirado: mapa base generación 8 y borrador original restaurado en r27. Sigue optimización/dispersión y GM06.
Integración concurrente alpha.49/protocolo 54: público 11/11, suites focales 31/31 y entrada real verificadas; evidencia separada en la entrega.

**AREA17 L04c, 2026-10-10 — continuidad del Studio local implementada:**
[Entrega/evidencia](delivery/l04c-companion-continuity.md) y [brief](briefs/l04c-companion-continuity.md).
Captura tras chat confirmado sin inferencia; continuación desde fuentes y refresco que cancela tardías
sin renovar sesión/cuota ni reactivar stop. Resumen manual y automático opt-in por presión/pausa;
un intento automático por cuota durable compartida con compactados manuales, originales conservados.
Regresión integrada: 250 aprobadas/una omitida por symlink Windows; navegador 9/9 simulado con C01 real local.
AgentMind relee observación tras I/O del presupuesto; stop/archivos y frescura corporal conservan sus límites.
Solo Studio local fuera de la imagen VPS, identidades fixture y mundo efímero; sin SQL, protocolo o JEV.
Sigue vínculo durable/ledger central y wizard ingame. Calidad real de Brisa/resumen y experiencia humana pendientes.

**AREA07 RNV07b, 2026-10-11 — publicada y activada, alpha.47/protocolo 53:**
[Brief](briefs/RNV07b-canteen-survival.md) y [entrega](delivery/rnv07b-canteen.md).
Cantimplora reutilizable de tres dosis, relleno desde manantial/cubeta/barril/provisiones y comer/beber;
HUD ES/EN y SRV01 en el mismo perfil/recibo M5, pausa offline y penalizaciones sin muerte por hambre/sed.
SQL032 aplicada por el autor; readiness 1 y MN_CANTEEN_OPERATIONS=1 comprobados en el VPS.
Runtime ef59c5c, una instancia sana, 153/153 en la imagen y 19/19 fuentes públicas iguales a Git.
WSS autenticado: fabricación pagada, relleno, bebida/comida, replay sin doble gasto, colisión y reconnect;
cinco controles correctos, cinco recibos conservados y cuenta temporal retirada; cero errores/pendientes.
Navegador local ES/EN aprobado en dos viewports con 14 capturas; fixture sin enemigos, encuentro pendiente.
Sigue ruta Salty Shore–Puerto Sol; después purificador avanzado con componente de Bahía Ceniza.

**AREA03 INV02c, 2026-10-11 — ficha de Carga ES/EN publicada, alpha.46/protocolo 52:**
[Contrato](briefs/inv02c-attribute-controls.md) y [entrega/evidencia](delivery/inv02c-attribute-controls.md).
Adopción explícita, asignación de un punto y confirmación de la única reasignación gratuita en C/Atributos;
puntos/peso/volumen y límites visibles. ACK privado más perfil canónico; retry exacto y consulta sin acciones
para invitados/solo. Cubeta/agua SQL030 conservadas. Runtime `2a51c8d`, imagen y 21 hashes fijos:
navegador público autenticado **6/6**, recarga/reconexión conservan mochila, tres tablas y agua.
Cuenta QA retirada, tres recibos conservados; Supabase durable y cero errores/pendientes al cerrar.
Pruebas locales **67/67**, integración concurrente **32/32**, imagen VPS **127/127** (conteos solapados);
fixture ES/EN **24 casos, 10 comprobaciones**, desktop/portrait/landscape y capturas inspeccionadas.
No requiere otro SQL. Sigue INV02d: sobrepeso/movimiento y mochila, preservando natación/predicción;
70 % sobre el cómodo, 40 % por encima del techo, nunca inmovilizar. Efectos todavía pendientes.

**AREA17 L03d-e2b, 2026-10-10 — Brisa conversa y recupera memoria en un mundo local:**
[Entrega/evidencia](delivery/l03d-local-companion-studio.md) y [brief](briefs/l03d-local-companion-studio.md).
Wizard de identidad/oficio/rasgos/aspecto/modelo, documentos nuevos y GameHost/C01 real local;
memoria y ledger de recursos en disco, identidades de ensayo, mundo efímero, solo chat.
Tras cerrar el proceso, recuperó «Faro de Jade» desde el episodio guardado. Seis llamadas reales,
19.182 tokens confirmados, cero uso pendiente; resumen rechazado sin tocar el original.
Mezcla ES/EN y 4,9–13,5 s: calidad todavía pendiente. 67/67 focales y capturas desktop/móvil;
la regresión amplia conserva fallos independientes documentados. Sin SQL ni activación pública;
herramientas fuera de la imagen VPS. Sigue identidad/ledger central, wizard ingame y preview humano.

**AREA15, 2026-10-10 — arranque y circulación de perlas implementados; montaje público apagado:**
[entrega](delivery/m5-ground-pearl-lifecycle.md), [contrato](briefs/m5-ground-pearl-lifecycle.md).
Recuperación de filas actuales después del diario común, pausa offline y recogida/devolución
bajo el único `beforeTick`; perfil y metadatos de sesión se aplican juntos tras SQL confirmado.
Base 4edbf30: 594/594 en 58 archivos congelados, dos SIGKILL locales de pickup; devolución con commit/aplicación/reinicio de host;
compatibilidad SQL001–029 con recursos v3/taller/Carga/atributos alpha.43/protocolo 49.
SQL023 confirmado; no añade ni ejecuta SQL. Sigue componer muerte, botín ordinario, mint y comandos
restantes; después transición detenida/adopción y canario autenticado de caída/reinicio VPS.
Integración RNV07 alpha.44/protocolo 50: 226/226 en 25 archivos congelados (base 95595b0);
reserva de llenado revalidada tras la lectura del recibo. Conteos solapados con la base 594.
Integración GM05 alpha.45/protocolo 51: 246/246 en 29 archivos congelados (base 52665ea);
conserva exclusión de activación GM con piloto montado. Conteos solapados.
Código verificado en VPS `ea982f8` sano, 0.6.0-alpha.45/protocolo 51: 127/127 del actualizador,
31/31 sin red en la imagen exacta y entrada pública 6/6. Una autoridad, timer activo; montaje apagado.

**AREA07 RNV07a, 2026-10-11 — publicado y activado, alpha.44/protocolo 50:**
[Entrega](delivery/rnv07-freshwater.md), [dirección](briefs/RNV07-freshwater-progression.md), [WSS público](delivery/rnv07-freshwater/public/acceptance.json), [health/fuentes](delivery/rnv07-freshwater/public-readonly.json) y [activación SQL030](delivery/rnv07-freshwater/activation.json). Runtime comprobado `80e46df8ca4664f93aa59df8350c27cc17589b53`, desplegado 04:47Z; imagen `sha256:b883545f9317c7ba3ed03e7e0ec5d27c62a997b3d0a8c717504980e3f338f353`. SQL030 aplicado por el autor, readiness RPC 1; `MN_FRESHWATER_OPERATIONS` enabled/ready y atributos siguen enabled/ready. WSS público 6/6, anónimo denegado; lectura pública 7 hashes fuente y health 200. Evidencia de agua visual/recogida completa sigue siendo fixture local sin enemigos; no se afirma recolección/transporte completo live y el encuentro en navegador queda pendiente para RNV07b.
Sigue RNV07b: cantimplora y consumo coordinados con supervivencia; el purificador avanzado después.


**AREA01 GM05a, 2026-10-11 — escultura publicada, alpha.45/protocolo 51:**
[Contrato](briefs/gm05a-terrain-sculpt.md) y [entrega](delivery/gm05a/DELIVERY.md).
Cinco pinceles de suelo seco, borrador v3, preview/undo/cancelación y recorrido sobre alturas editadas.
SQL031 aplicado por el autor como 029 (mismo hash); readiness del servicio confirmado.
309/309 en 56 archivos, imagen 20/20 y actualizador 127/127. Público: 11 controles del editor
y cadena HTTP autenticada con Supabase real, cliente nuevo con hash exacto/WELCOME y rollback.
Release `839393a` sana; mapa base generación 6, borrador original restaurado en r25. Evidencia por capa en la entrega.
Sigue GM05b para pintar familias de suelo; GM06 para costa y nueva tierra. Conserva las activaciones del servidor.

**AREA03 INV02b, 2026-10-10 — Carga durable activa y comprobada en público:**
[Contrato](briefs/inv02b-durable-attributes.md) y [entrega](delivery/inv02b-durable-attributes.md).
SQL029 aplicado por el autor; readiness comprobado desde el contenedor. Activación inicial
en `024610b`, alpha.43/protocolo 49; `MN_ATTRIBUTE_OPERATIONS=1` y una autoridad en reposo.
Tras integrar la entrega paralela de agua, el actualizador instaló `80e46df`, alpha.44/protocolo 50.
[Canario activo repetido](delivery/inv02b-public/20261011T044746Z-active/README.md) **5/5**:
adopción, asignación, reset, replay sin rollback, conflicto durable y reconexión. Masa 50 → 60 → 50,
volumen 18 constante. 14 hashes de imagen iguales a Git; Supabase durable, cero errores/pendientes.
Cuenta QA retirada y cuatro recibos conservados por corrida; evidencia inicial/flag apagado separada.
Regresión integrada repetida 20/20; pruebas locales previas: atributos 19/19, composición SQL023/029
1/1 con reapertura, UI existente ES/EN 6/6 y regresión 106/106 (conteos solapados).
Taller y crédito de Tala offline conservan Carga. Sigue ficha ES/EN INV02c para administrar puntos;
después movimiento/sobrepeso. La pantalla de atributos todavía no está montada. No requiere otro SQL
para comenzar INV02c; el flag permanece apagado por defecto en instalaciones nuevas.

**AREA03 HUD/INV02a, 2026-10-10 — HUD público verificado; Carga sin montar:**
[HUD y evidencia](delivery/hud-portrait/README.md), [contrato de Carga](briefs/inv02a-durable-carry.md)
y [entrega INV02a](delivery/inv02a-carry-contract.md). Pantalla vertical con filas separadas para jugador,
controles, minimapa y avisos; horizontal compacto conserva espacio de combate. 36/36 casos locales,
ES/EN, ratón/toque emulado, escala 100/130 %; capturas inspeccionadas. WSS público 36/36 en
`6c42e84`, alpha.41/protocolo 47, revisión/imagen fijas y autoridad sana antes/después.
Carga: asignación/reasignación pura, 11/11 propias y 21/21 con carry/taller/Tala (solapadas).
Código publicado sin imports de gameplay: no cambia capacidad, movimiento ni perfiles públicos.
Sigue recibo M5 y adopción explícita, después UI ES/EN y sobrepeso; conservar crédito offline de Tala.
Sin SQL nuevo. El borrador anterior de supervivencia sigue separado.

**AREA01 GM04b, 2026-10-10 — plantillas publicadas, alpha.41/protocolo 47:**
[Entrega](delivery/gm04b/DELIVERY.md), [navegador público](delivery/gm04b/public-browser-evidence.json)
y [despliegue](delivery/gm04b/deployment.json). Conjuntos de 1–120 decoraciones, fantasma completo,
copias independientes y undo/redo por colocación. Biblioteca local por cuenta–servidor–mundo, 32 plantillas,
CAS e import/export de 2 MiB; misma semilla/revisión base. Regresión GM 199/199 en 35 archivos;
navegador local 17/17 y público autenticado 19/19, sin errores ni mutaciones remotas.
Release `6c42e84` sana, Supabase durable y timer activo; mapa base generación 4 conservado.
Capturas ES/EN/844×390 inspeccionadas; luz de referencia solo del renderer cliente, sin escrituras al reloj.
Documento v2, protocolo y autoridad M5 conservados; sin SQL/arte nuevo. Siguen materiales/dispersión y GM05.

**AREA17 L03d-e2a, 2026-10-10 — transporte del modelo local probado, sin montaje:**
[Entrega/evidencia](delivery/l03d-local-model-probe.md) y [brief](briefs/l03d-local-model-probe.md).
Endpoint loopback sin clave y modelo exacto verificados; wait/reply estructurados y cancelación con
bloqueo pasaron usando extensión explícita de plantilla sin razonamiento. Default 192 no admitió chat y 512 lo truncó;
se conservan ambos ensayos. 20/20 HTTP local simulado; ocho intentos reales, siete usos conocidos y
uno cancelado desconocido, sin retries después. Coste null y cero acciones/chat/memoria enviados.
Reply mezcló ES/EN y tardó 5,8 s: calidad/latencia pendientes. Herramienta fuera del bundle/VPS;
sin proveedor público, ledger central o integración AgentMind. E1 permanece la entrega ingame publicada.

**AREA17 L03d-e1, 2026-10-10 — centro de inferencia configurado y publicado, alpha.42/protocolo 48:**
[Entrega](delivery/l03d-inference-config.md) y [contrato](briefs/l03d-inference-config.md).
Configuración privada por mundo/cuenta: techo conjunto, una fila de límite por conexión y modelo por
compañero existente. SQL028 CAS/replay, aislamiento, stop obligatorio y borrador ante conflicto/incertidumbre.
Integración final 97/97 en 17 archivos y navegador local 12/12 con seis capturas; conserva GM04b/HUD
y frontera de suelo/Carga sin activar. Regresión anterior 54/54 solapada; autenticación local simulada.
Publicado y comprobado en `8a779b5`: una autoridad sana, timer activo, 109/109 del actualizador,
32 hashes de imagen iguales a Git y WSS público 21/21 con entrada real y denegaciones privadas.
SQL028 aplicado/readiness 1, canario de servicio revertido; M5 sin errores/pendientes/bloqueo en la captura.
Catálogo VPS vacío, sin importe/modelo preseleccionados ni proveedor/generación. Los techos son metadata,
todavía no ledger. Guardado de dueño autenticado público y canario de proveedor conservan aceptación propia.
Sigue ledger central, endpoint/modelo local y límites elegidos; después mente/memoria con fuentes.

**AREA15, 2026-10-10 — frontera común de familias implementada y probada, montaje apagado:**
[entrega](delivery/m5-ground-family-boundary.md), [contrato](briefs/m5-ground-family-boundary.md).
Suelo de perlas, lotes, muerte y botín usan una entrada de confianza al mismo dueño de tick/SQL018/019;
SQL preparado no aplica efectos. Reservas hasta el drain síncrono; cierre sin callbacks históricos.
206/206 en 34 archivos, incluidas las cuatro familias SQL, compatibilidad SQL001–027 con
recursos v3/taller/balsa y dos SIGKILL nuevos. Integración final GM04b/HUD/Carga sin montar: 58/58 en diez archivos, solapada con la anterior.
Integración concurrente posterior alpha.42/protocolo 48: 83/83 en doce archivos, solapada;
frontera de familias sin cambios. SQL028 pertenece al frente independiente de inferencia.
SQL023 instalado/readiness confirmado en VPS;
mundo público todavía sin reloj común ni adopción. No requiere SQL nuevo ni cambia flags/protocolo.
Código `e4c5f0d` verificado en VPS alpha.41/protocolo 47: 109/109 del actualizador, 13/13
focales sin red en la imagen exacta y entrada pública 6/6; una autoridad sana y timer activo.
Sigue conectar selectores, hidratación y coordinadores autónomos al mismo dueño, después transición
detenida con exclusión del actualizador y canario autenticado de reinicio/caída VPS.

**AREA07, decisión del autor 2026-10-10 — agua manual antes del purificador avanzado:**
[RNV07](briefs/RNV07-freshwater-progression.md) registra cubeta, fuente interior con enemigos,
barril de casa/balsa y cantimplora reutilizable. Purificador tardío con mucho más hierro/tablas y
componente raro de origen en la tercera ciudad; receta/destino exactos propuestos, no cerrados.
Sigue RNV07a fuente/cubeta/reserva, RNV07b consumo con `inv02-survival`, después viaje comercial
Salty Shore–Puerto Sol y componente avanzado. No duplicar sed, perfil o guardado.
Diseño registrado: no cambia todavía el coste desplegado de RNV06 ni añade recipientes jugables.

**AREA01 GM04a, 2026-10-10 — multiselección publicada, alpha.40/protocolo 47:**
[Entrega](delivery/gm04a/DELIVERY.md), [navegador público](delivery/gm04a/public-browser-evidence.json)
y [despliegue](delivery/gm04a/deployment.json). Shift/casillas, pivote común y movimiento/giro/escala,
duplicar/eliminar y undo atómicos de decoración base/añadida, hasta 120 elementos. Documento v2;
colisiones individuales y selección temporal. Integración final 331/331 en 53 archivos (329+2),
navegador local alpha.39/46 17/17 y público autenticado alpha.40/47 19/19, sin errores.
Runtime `c4ffc62` sano y timer activo; mapa base generación 4 conservado.
Canario solo en borrador local nuevo, sin mutaciones remotas ni SQL. Capturas diurnas finales con luz
solo del renderer cliente; captura nocturna real conservada. Siguen plantillas GM04 y terreno GM05.

**AREA17 L03d-d, 2026-10-10 — detención durable publicada, alpha.38/protocolo 46:**
[Entrega](delivery/l03d-companion-control.md) y [contrato](briefs/l03d-companion-control.md).
Stop inmediato, guardado privado SQL027 y permiso explícito para una conexión nueva; CAS durable
separado del epoch, recuperación antes de escuchar y fallo/timeout/tardía sin reanudación automática.
Conserva el allowlist de vínculos del operador; no provisiona ni activa agentes/proveedor.
SQL027 aplicado y canario de servicio revertido; aceptación alpha.38 `d962055` sana, una autoridad y timer activo.
109/109 del actualizador y 28/28 focales de alpha.38 con hashes Git. Integración posterior
alpha.39/protocolo 47: 30/30 locales y WSS público 17/17; selecciones solapadas.
Las 65/65 focales y el navegador invitado 7/7 corresponden a alpha.37; la UI de compañeros no cambió.
El [baseline de Tala](delivery/prg01d-timing-baseline.md) corrigió el conflicto; alfa recuperado y canario Tala público 6/6.
Local 190/190 y navegador 14/14 con autenticación simulada y SQL027 en disco; conteos solapados.
Stop/resume de un dueño autenticado público sigue pendiente. No es aceptación de memoria inteligente.
Fuente autoritativa en `../area17-market`, rama `codex/area17-market`; no sobreescribir el checkout IDE dirty.
Sigue conexión/modelo admitidos y techo de gasto compartido; después personalidad/metas en la mente,
memoria basada en eventos confirmados y canario social/PvE con acuerdo recordado en otra sesión.

**AREA07 RNV06, 2026-10-10 — purificador publicado, alpha.39/protocolo 47:**
[Contrato](briefs/RNV06-purifier.md) y [entrega](delivery/rnv06-purifier.md).
Editor B: 3 hierro + 2 tablas; agua dulce real en bodega cada 96 s simulados, pasivo, conectado/amarrado.
H/toque → Producción muestra ritmo/fracción y pausas ES/EN. Bodega llena/daño conservan la fracción;
reparar reanuda. Viaje/offline pausados, sin sed/curación ni SQL/writer nuevo.
Integración local 120/120 en 20 archivos; navegador PC ES/móvil EN aceptado con 14 capturas.
VPS `b977b7c` sano, salud/página 200, cero pendientes/errores y una autoridad; actualizador 109/109,
imagen 29/29 con 12/12 hashes de fuentes iguales a Git; conteos solapados.
Entrada pública WSS/minimapa/mapa aceptada, sin escribir economía. La paleta/producción/transferencia
se aceptaron con cuenta local desechable, no con materiales de una cuenta pública. Sin prueba de
crash durability ni FPS de teléfono físico. Tala `d962055` integrada y SQL026 instalado.
La revisión RNV07 anterior pone fuente/cubeta/barril y cantimplora antes del viaje comercial
Salty Shore–Puerto Sol con AREA01/08.

**AREA17 L03d-c, 2026-10-10 — ficha privada durable publicada, alpha.36/protocolo 45:**
[Entrega](delivery/l03d-companion-config.md) y [contrato](briefs/l03d-companion-config.md).
Personalidad/objetivos por cuenta–mundo–personaje ya vinculado; CAS/replay, borrador conservado
ante conflicto/incertidumbre y editor ES/EN. SQL025 aplicado, readiness VPS y canario de servicio
real aprobados; fixture revertido. Runtime `f04cd7d` sano, una autoridad y temporizador activo;
109/109 del actualizador, 45/45 focales en imagen con hashes Git, WSS público 15/15 y navegador
público 7/7. Local: 140/140 y selección naval 58/58; navegador 13/13 con auth simulada y base en disco.
Pendiente save/load de un dueño autenticado en navegador público. No alimenta la mente ni crea
vínculos/conexiones, memorias o presupuesto; stop sigue de proceso. Sigue conexión/modelo/límites
conjuntos y memoria con fuentes antes del canario L03d completo.

**AREA07 RNV05, 2026-10-10 — natación costera publicada, alpha.36/protocolo 45:**
[Contrato](briefs/RNV05-coastal-swimming.md) y [entrega](delivery/rnv05-coastal-swimming.md).
Playa/agua/playa con resistencia, carga de mochila, pose y HUD ES/EN, cinco segundos de aviso y
ahogamiento gradual aprobado por el autor. Conserva la muerte actual; montaje M5 comprobado en
fixture local, sin activarlo en VPS. Sin SQL ni writer nuevo.
G permite bajar desde un borde cercano de la balsa propia detenida; F reembarca en cubierta como
caminante. Solo viaje propio activo, sin invitados, con identidad/revisión/obstáculos verificados.
Integración 121/121 en 17 archivos y regresión previa 104/104, selecciones solapadas. Recorrido
PC ES y móvil EN emulado aceptado. VPS `56155bb` sano: imagen específica 34/34, actualizador 109/109,
entrada pública 10/10 con minimapa/mapa M; continuidad compañeros/i18n integrada 51/51. Sigue RNV06: purificador útil conectado a
provisiones/carga/economía existentes.

**AREA01 GM03b2, 2026-10-10 — publicado alpha.35/protocolo 44, canario aceptado:**
[entrega](delivery/gm03b2/DELIVERY.md), [evidencia pública](delivery/gm03b2/public-evidence.json) y [despliegue](delivery/gm03b2/deployment.json).
Online registra revisiones y activa o vuelve atrás con mundo vacío, CAS y exclusión del actualizador.
Dos clientes nuevos verificaron el mismo modelo/colisiones antes de entrar; canario real 6/6 sin errores,
incluidos rechazo con jugadores, rollback y generación antigua. Borrador restaurado por CAS r19→r21.
Runtime `2006667` sano; gen3 canaria → gen4/mapa base, volumen durable y timer activo.
Integración alpha.35 175/175; regresión histórica alpha.34 308/308; actualizador Linux 22/22 independiente.
Solo decoraciones y colisiones estáticas; terreno, objetos funcionales y migración entre runtimes siguen
para cortes posteriores. GM03b2 no requiere otra migración SQL ni cambia la autoridad de gameplay M5.

**AREA03 PRG01d, 2026-10-10 — SQL026 confirmado; taller y Tala públicos verificados:**
[contrato](briefs/prg01d-starter-workshop.md) y [entrega/evidencia](delivery/prg01d-starter-workshop.md).
Encargo personal de diez tablas, crédito único, caja por kit en banco, tabla 2:1, palmera 3–6
y mochila con volumen/masa; sin barrera de Tala 60 ni comunidad.
Construcción/capacidad/reconexión: 33 comprobaciones públicas en alpha.37, antes de que el recorrido
fallara al navegar a la palmera. Tala aislada: 6/6 en alpha.38/protocolo 46, con desafíos reales,
rechazos sin mutar, recompensa durable, replay y tabla en banco. La repetición combinada posterior
alpha.39/protocolo 47 pasó 36/36 por WSS autenticado; perfil/Auth QA retirados y veinte recibos conservados.
SQL026 corrigió el ID real de balsa; alpha.38 `d962055` alineó el baseline económico antes de Tala.
Ambas recuperaciones conservaron perfil/mundo; sus cuentas QA se eliminaron y recibos se conservaron.
[Verificación independiente VPS](delivery/prg01d-starter-workshop/activation/timing-deployment-independent.json):
revisión/imagen y hashes Git confirmados, salud pública 200, una autoridad, timer activo,
cero errores, pendientes o datos sin guardar. Local final 20/20; imagen 28/28. Conteos solapados.
[Navegador autenticado alpha.40/protocolo 47](delivery/prg01d-starter-workshop/activation/browser-alpha40-20261011-0247/README.md): 8/8,
entrega UI durable y progreso tras recargar; perfil/Auth QA retirados y un recibo conservado.
Capturas ES escritorio/EN portrait inspeccionadas: panel legible; el solapamiento de fondo
observado entonces quedó corregido en el [corte HUD posterior](delivery/hud-portrait/README.md).
Revisión `88f61ea` e imagen fijadas antes/después, cero errores/pendientes y una autoridad.
Entrada pública histórica 14/14 conserva su alcance anterior.
[Checkpoint](delivery/prg01d-starter-workshop/activation/README.md). No requiere otro SQL.
Mundo común suelo/perlas/muerte sin adoptar/activar; SIGKILL propio, pausa offline nueva,
balance y teléfono físico pendientes. INV01–03 (huecos/pilas, Carga y sobrepeso) continúa aparte.

**AREA15, 2026-10-10 — adopción SQL023 preparada, montaje apagado:**
[entrega](delivery/m5-ground-world-adoption.md), [contrato](briefs/m5-ground-world-adoption.md). Snapshot/versión exactos, reloj inicial desde el
tick de recursos y recibo inmutable sin reescribir mundo; cerco persistente de escritores legacy.
V1 rechaza perlas/suelo/botín previo. Regresión 235/235 en 34 archivos y final GM 74/74 en doce,
solapadas; 22 casos propios y dos SIGKILL de adopción. Integra GM03b2, I18N04b, L03d y SQL022.
VPS `9266c40` sano alpha.34/protocolo 43: 107/107 de imagen, 11/11 focales sin red y entrada
pública 6/6. SQL023 instalado y readiness confirmado durante PRG01d; no se adopta el mundo real ni se activa el montaje común.
Sigue composición perlas/muerte/botín, transición detenida con exclusión del writer anterior,
recuperación y canario autenticado VPS.


**AREA17 L03d-b, 2026-10-10 — Mis compañeros publicado, alpha.34/protocolo 43:**
[entrega](delivery/l03d-owner-center.md), [contrato](briefs/l03d-owner-center.md). Entrada ingame
ES/EN para listar y detener personajes ya vinculados a la cuenta autenticada. Revisión exacta,
cola de entradas vaciada y proyección privada retirada al cerrar sesión. Stop es de proceso y se
pierde al reiniciar; no hay provisioning, proveedor/inferencia o SQL nuevo. El siguiente tramo es
configuración durable por cuenta/conexión/personaje y límites conjuntos antes del canario L03d.
VPS `ee88690` sano, una autoridad y temporizador activo; 107/107 de release, 22/22 en esa imagen
con hashes Git, WSS público 12/12 y navegador público 7/7. Regresión local corregida 111/111;
navegador local 14/14. Stop entre dos dueños usa auth simulada; no es activación de agentes públicos.

**AREA12 I18N04b, 2026-10-10 — publicado, invitado ES/EN y reconexión verificados:**
[Entrega/evidencia](delivery/i18n04b.md).
Cierre público `822ddc2`, alpha.35/protocolo 44; primera aceptación histórica `1f0f158` alpha.32.
Selector desde arranque/cuenta/ajustes; cliente/editor GM y feedback en caliente conservan datos y
solicitudes. QA local: 11 grupos cliente/20 capturas y 6 editor/8 capturas; integración 86/86 y
regresión final 20/20 (solapadas). HUD real post-intro: seis combinaciones ES/EN, escala 1.3, scroll
y antorcha sin solapes. Público: tres grupos, once capturas, WebSocket/reconexión y ajuste real de
tamaño, cero errores; imagen 109/109 y salud/Supabase verificadas. Auth/firma, permisos GM y
operaciones durables conservan aceptación propia; CAS remoto local simulado. Sin SQL/flags propios.
Sigue I18N04c: promoción ES/EN.

El recorrido completo pertenece a `bbbf39e`; `822ddc2` añade tres traducciones de oficios,
con [muestreo público NPC propio](delivery/i18n04b/public-npc/evidence.json) y nombres intactos.

**AREA07 RNV04, 2026-10-10 — combustible privado, alpha.31 / protocolo 42:**
[Entrega](delivery/rnv04-fire-fuel.md), [contrato](briefs/RNV04-fire-fuel.md).
Luces municipales infinitas; antorcha de mano 20 min, faroles/antorchas privadas 60 min por madera,
fogata/parrilla 30 min provisionales. Un slot, apagar conserva combustible; panel N/V ES/EN y tres piezas
del editor. SQL022 aplicada, canario real 8/8; 91/91 integración, 107/107 selección de imagen y
33/33 de composición GameHost/diario común (selecciones solapadas). PC/móvil emulado bajo/alto
aceptados localmente. VPS `fe50ab1`, alpha.32/protocolo 42, publicado y fuego habilitado; imagen
107/107 y 30/30 focales. Navegador público autenticado 9/9: combustible/madera persistentes,
reencendido sin repetir cobro y mapa/minimapa. Cuenta/perfil QA eliminados; recibos retenidos.
No activa artesano ni montaje de reloj común. Sigue agua costera/reembarque y después provisiones/hogar.
Revalidado públicamente en `ee88690`, alpha.34/protocolo 43: 9/9 con capturas inspeccionadas,
cuenta/perfil QA eliminados y cuatro recibos retenidos. Identidad cliente/agente 35/35.

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

**Evaluación inicial AREA17, 2026-10-10 — Inference Center/Hermes:**
[propuesta de arquitectura](briefs/l03d-inference-center.md). Adaptar Nitro sin Nango a conexiones/modelos
por cuenta y ficha del compañero; API acotada recomendada primero, conexión local opcional después.
Nitro actual configura un operador compartido; copiarlo no aísla jugadores. AgentMind/M5 conservan
autoridad y memoria propias. Sin proveedor/modelo elegido, consumo o activación; tramos propuestos
dentro de L03d/L05c. El autor aprobó avanzar; L03d-b implementa solo el primer tramo de estado/stop.

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
  L04b tiene administración local verificada; L04c añade captura/refresco/resumen acotados del Studio local
  ([entrega](delivery/l04c-companion-continuity.md)); montaje central y L05–L06 conservan sus puertas, con demostración
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
  [L04c](delivery/l04c-companion-continuity.md) añade continuidad del Studio local y ledger durable local;
  sigue contabilidad central, montaje ingame y encuentro/aceptación humana/calidad.
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
