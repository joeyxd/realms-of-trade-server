# Continuidad de servidor — AREA15

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
rechazos sin mutar, recompensa durable, replay y tabla en banco. No son un canario combinado completo.
SQL026 corrigió el ID real de balsa; alpha.38 `d962055` alineó el baseline económico antes de Tala.
Ambas recuperaciones conservaron perfil/mundo; sus cuentas QA se eliminaron y recibos se conservaron.
[Verificación independiente VPS](delivery/prg01d-starter-workshop/activation/timing-deployment-independent.json):
revisión/imagen y hashes Git confirmados, salud pública 200, una autoridad, timer activo,
cero errores, pendientes o datos sin guardar. Local final 20/20; imagen 28/28. Conteos solapados.
Navegador autenticado ES/EN histórico 8/8 y entrada 14/14 conservan su alcance anterior.
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


**AREA15, 2026-10-10 — GameHost común publicado, montaje apagado:**
[economía y checkpoints](delivery/m5-ground-host-authority.md). Un dueño de tick/época y sesión
SQL018/019, con I/O separado del drain síncrono/ACK; WorldState escribe mundo/reloj juntos.
355/355 en 44 archivos, doce casos nuevos y dos SIGKILL nuevos de GameHost. Readiness SQL018–021
real confirmada; el dominio actual tiene recursos v2 y aún carece de reloj común. El montaje exige
filas coherentes existentes y queda sin activar. Sigue adopción atómica legacy y perlas/muerte/botín,
sin otro writer ni creación de reloj a cero. Artesano continúa apagado; SQL021 ya está disponible.
VPS `cf5857f` sano a 22:04:34 UTC, alpha.30/protocolo 41: 107/107 de imagen, 8/8 del montaje
sin red en Node 22.23.3 y entrada pública 6/6; pruebas solapadas, sin canario durable del nuevo montaje.

**GM03b1, 2026-10-10 — publicado alpha.30/protocolo 41, release `6e6f421` sana:**
[preparar revisión](delivery/gm03b1/DELIVERY.md), [contrato](briefs/gm03b1-prepared-revision.md).
Online valida el head privado exacto y descarga documento/dependencias/base/colisiones por hash.
Errores enfocan objetos; cambios invalidan el paquete y conflictos conservan diseños. Proyección de
colisiones compartida con caminar, todos los assets base y variantes móviles fijados, sin escrituras
de gameplay/SQL/flags. 183/183 regresión, navegador local simulado 41/41, actualizador 107/107 y
navegador público Supabase real 23/23. 57 dependencias base; ES/EN inspeccionados y borrador previo
restaurado por CAS r6→r13. [Evidencia pública](delivery/gm03b1/public-evidence.json).
Sigue GM03b2: registro durable, activación/rollback con admisión exacta y exclusión del actualizador.

**AREA03 PRG01c, código publicado, mecánica apagada:** [enseñanza y Bodega](delivery/prg01c-artisan.md), alpha.29/protocolo 41.
Recibo económico con baseline de perfil exacto para aprender/colocar/retirar storage; coste, cargo,
condición e IDs conservados. 114/114 integradas y 32 checks de navegador. Nueva migración SQL021
después de 001–020; `MN_ARTISAN_OPERATIONS` sigue apagado hasta verificar SQL y aceptar canario
autenticado. No amplía la aceptación a todas las piezas del editor, perlas/muerte/botín o persistencia
global. VPS `67e307e` sano a 2026-10-10 21:12 UTC: una autoridad, imagen 107/107 y entrada pública 8/8.
Entrega separa pruebas, publicación y activación. Precio de enseñanza dos maderas provisional.

**GM03a publicado, 2026-10-10 — alpha.28 / protocolo 40 integrado:** [borradores remotos privados](delivery/gm03a/DELIVERY.md).
Online permite guardar/cargar explícitamente por cuenta/mundo, CAS, recuperación exacta y exportación de
ambas copias; conflictos conservan el diseño local. SQL020 aplicada y canario real 14/14. Suites locales
102/102 y regresión 113/113 (solapadas), navegador local 35/35, imagen 107/107 y navegador Supabase real
17/17, cero errores. Runtime `9f23be3` sano; copia remota previa restaurada por CAS. No activa mapas ni
escribe gameplay; sigue GM03b publicación/activación/rollback bajo M5.

2026-10-10, hora de México. M5/GameHost mantiene una sola autoridad de persistencia.

**AREA07 RNV03 observado, 2026-10-10 20:56:35 UTC:** alpha.28/protocolo 40, `9f23be3`.
[Noche y farol portátil](delivery/rnv03-dark-night.md), reloj compartido y N/toque público.
Sesión solamente, apagado en muerte/reentrada; sin SQL/perfil/writer nuevo. Una imagen sana, 107/107 de imagen,
entrada real WSS/reloj/mapa, cero errores/pendientes y timer activo. SQL018/019 siguen sin montar;
GM03a y L03d-a preservados. No prueba persistencia autenticada del farol ni activa coordinadores opcionales.

**AREA17 L03d-a, herramienta publicada 2026-10-10:** [ledger de inferencia nativa](delivery/l03d-native-metering.md),
separado de M5 y de la factura externa. `agent-inference-budget/v2` persiste `metering` con IDs
de proveedor/modelo declarados, unidad nano USD, tarifas/referencia/fecha fijadas y hash por reserva/
liquidación. V1 sigue simulado, sin migración automática. Contadores `adapter_native` o manuales
`owner_supplied`, cargo derivado y `invoiceCostUnits:null` quedan diferenciados. Uso desconocido
retiene reserva tras reinicio; configure no renueva saldo ni tarifa. No añade campos de gameplay,
SQL, flags ni activación de proveedor; canario y calidad de memoria siguen pendientes. Fuente
`e614ca4` integrada con alpha.28/protocolo 40; `tools/agent` no entra en la imagen VPS.

**AREA15, diario SQL019:** [petición exacta y recuperación](delivery/m5-ground-transaction-journal.md).
Dueño M5, scope mundo y una intención pending; confirmación con operación/mundo/reloj/recibos en un commit.
Sin campos de perfil ni defaults nuevos; migración SQL001–019 y opt-in de GroundTransactionSession.
Startup resuelve pending y carga filas actuales; no emite ACK ni instala snapshots históricos.
266/266 pruebas y tres SIGKILL locales cubren preparación/commit/confirmación. No montado en GameHost ni aplicado live.
Sigue dueño de tick/época/adopción legacy; preparación no es ACK ni lease frente a otros writers.
Publicado/verificado en `6748f9a`, alpha.27/protocolo 39: imagen sana con APIs Node 22, 107/107 offline
y entrada pública 6/6. Coordinadores opcionales siguen `null`; este corte no activa SQL018/019.

**AREA07 RNV02 observado, 2026-10-10 20:12:06 UTC:** `e648d1b`, alpha.27/protocolo 39.
Farol por instancia en el perfil del dueño y CAS ordinario, sin SQL ni diario nuevo. Una imagen sana,
107/107 offline, recursos/economía listos, `logging:true` ya presente antes de este despliegue,
cero errores/guardados pendientes y timer activo. [Revisión/imagen/status](delivery/rnv02-naval-lantern/deployment.json).
Este corte no aplica SQL016/017/018 ni activa flags. El status de Tala no sustituye su aceptación autenticada.
El ACK del interruptor no demuestra commit durable; la prueba de reentrada del farol usa store de memoria.
[Alcance, navegador y evidencia](delivery/rnv02-naval-lantern.md).
Entrada pública real WSS, mapa/minimapa y catálogo doce piezas comprobados; status posterior
20:15:21 UTC conserva revisión/imagen y cero jugadores/errores/pendientes tras cerrar QA.

**Siguiente corte implementado localmente:** [SQL018: gameplay, mundo y reloj juntos](delivery/m5-ground-transactions.md),
con sesión detenida/recibos/reconciliación y pruebas de proceso. No montado ni aplicado live. SQL017
conserva su función de presupuesto de agentes; continúa integración de un dueño de tick/diario/legacy.
Código publicado, presente en imagen sana `e648d1b`/alpha.27/protocolo 39: 107/107 de imagen, import
Node 22 y entrada pública 6/6. Coordinadores opcionales `null`; sin activación SQL018 por este corte.

| Recorrido | Cobertura | Próximo cierre |
|---|---|---|
| Comercio, materiales de balsa, carga y aportes | SQL014, perfil/mundo/recibo y aceptación publicada | Caída VPS y nuevas operaciones |
| Comercio autorizado de agentes | [L06b-2b/SQL017](delivery/l06b-agent-trade.md), código publicado inerte en alpha.26: mandato + consumo + vínculo al recibo SQL014/015/016 | SQL017 y canario autenticado live; agentes/comercio públicos apagados |
| Recolección, golpes parciales, crafting y herramientas | [SQL015/alpha.23](delivery/m5-resource-authority.md), activa en Supabase; 57/57 runtime, 107/107 offline VPS, 8 acciones confirmadas y 23 replays tras dos reinicios ordenados y SIGKILL | Otras operaciones/features M5; la durabilidad de recursos no acredita cortes eléctricos ni restauración de disco |
| Reloj de recursos | Tick lógico en commit/checkpoint; reinicio ordenado con pausa offline real de 12 918 ms y espera recalculada exacta de 43,9 s | El tiempo de simulación sin checkpoint puede retroceder ante caída abrupta |
| Aprendizaje y otros campos del perfil | [PRG01b2/SQL016](delivery/prg01b2-logging.md) activa: reparto 7/3 y beneficiario offline, hito/cadencia, perfiles/nodos/ledger tras reinicio y nueve replays sin duplicación; cleanup conserva nueve recibos | Enseñanza personal del artesano PRG01c; scope por personaje/mundo/época pendiente |
| Mercados y producción autónoma | Snapshot periódico y operaciones económicas cubiertas | Ventana desde último checkpoint |
| Construcción, pose y custodia de balsa | Perfil; carga y compra de materiales con recibo | Nuevas operaciones durables y custodia offline |
| Puertas y faroles operativos | RNV01/RNV02: identidad/condición y estado en perfil del dueño por CAS; visitantes reciben ACK privado y snapshot público | Ventana antes del save confirmado y aceptación autenticada específica; no aportan presencia offline ni nuevo recibo económico |
| Perlas/muerte/botín | Contratos M5 opcionales y transacción común SQL018 local; no compuestos con economía activa | Dueño común de tick, diario del sobre, adopción legacy y aceptación VPS |
| Operación y respaldo | Updater de una autoridad, perfiles y mundo en Supabase | Ensayo de restauración y pérdida de disco |
| Borrador del editor GM | [GM03a](delivery/gm03a/DELIVERY.md): SQL020 remoto privado por cuenta/mundo, CAS y recibos/retry exactos; UI explícita, local 35/35, público real 17/17, canario 14/14 | GM03b publicación/activación/rollback coordinados con M5; preview caminando descartable, sin bienes ni progreso |

**Runtime actual observado, 2026-10-10 19:58:30 UTC:** `cafff18208235b7149682e5ce6de34c3fc0704b5`,
alpha.26/protocolo 38 con [L06b-2b inerte](delivery/l06b-agent-trade.md), conservando GM02/refugio/Tala.
Imagen sana, una autoridad, 107/107 offline y smoke público 10/10 con entrada normal WSS; M5 económico
y recursos habilitados/listos. Tala figura activa en status por el otro frente: su aceptación específica
se registra en [PRG01b2](delivery/prg01b2-logging.md). AREA17 no cambió flags, SQL ni secretos.
SQL017 y canario económico de agentes pendientes; piloto/comercio/proveedor públicos apagados.

**Checkpoint específico Tala, 2026-10-10 20:08:38 UTC:** `454e2dabf44a1f97b1f7d514fda3844b980c8348`,
alpha.26/protocolo 38; una instancia sana, Tala activa, timer activo y cero errores/pendientes.
[Activación](delivery/prg01b2-logging/activation.json), [reinicio](delivery/prg01b2-logging/restart.json)
y [canario/cleanup](delivery/prg01b2-logging/logging-live-acceptance.json) verifican SQL016 y nueve replays.
El plazo de la palmera ya había vencido al apagar: este corte verifica consistencia del plazo, sin una
nueva medición de pausa offline v2. La pausa medida anteriormente en AREA15 conserva su alcance.

La aceptación anterior de recursos usó `a5b8f127340c1febbd4c0b29cb83bbc2fa83fe98`, alpha.23/protocolo 36; la
activación inicial fue en `4c6743b87b71ba765e316cd1652d1e4f23991501`. El status de esa aceptación confirma `/health` 200, un
contenedor sano, timer activo, tick avanzando, ambos flags habilitados y cero errores, jugadores,
sockets, operaciones pendientes o guardados sin confirmar. La imagen pasa 107/107 offline.
Los ocho gathers/crafts
se confirmaron mediante commit/recibo; el checkpoint periódico registra el reloj/mundo, no sustituye
esa confirmación. Los recibos se reprodujeron 7+8+8 veces tras dos reinicios ordenados y SIGKILL
después del ACK. La prueba local cubre cuatro ventanas antes/después de commit. En VPS, el contenedor
terminó con exit 137 y se inició manualmente; no se demuestra autoreinicio Docker. El corte no prueba
tolerancia a pérdida eléctrica, disco perdido/restauración ni durabilidad de otras features M5.

El [status final](delivery/m5-resource-authority/final-live-status.json), [SIGKILL](delivery/m5-resource-authority/crash-restart.json)
y [cleanup](delivery/m5-resource-authority/cleanup-verification.json) registran el estado desplegado,
la recuperación y la eliminación de la cuenta QA: Auth/perfil ausentes y ocho recibos/recursos conservados.

El aprendizaje `pilot_coastal` de AREA07 es una concesión de progresión distinta; no es un grant de
recursos ni amplía el alcance de aceptación de AREA15.

Cada feature que concede progreso debe declarar dato/dueño/scope, defaults/migración, confirmación,
ID estable, recibo/replay y recuperación. Material, práctica y recompensa derivados de una acción
pertenecen a su misma transacción; no concederlos luego de confirmar por un autosave independiente.
Registrar por separado implementación, pruebas, SQL, publicación y activación. Ver el
[contrato de recursos](briefs/m5-resource-authority.md) y [PLAN-M5](../PLAN-M5.md).

PRG01b2 declara `progression` como dato del perfil de cuenta en el único mundo alfa. M5 reserva
cuentas/UIDs conectados; SQL016 compara los perfiles actuales de todos los contribuyentes y confirma
su práctica con nodo/reloj/recibo. Ausencia legacy sigue representando cero sin reescribir recibos;
recursos v1 se adoptan una vez sin inventar autoría en ciclos parciales. Replay histórico no instala
estado antiguo y la recuperación local se comprueba terminando el proceso antes/después del commit.
Scope por personaje/mundo/época y aceptación de una caída real del VPS permanecen pendientes.

L06b-2b registra `buyGoldUsed` y `sellUnitsUsed` en SQL017, con defaults cero y scope
mundo/dueño/personaje. `budgetId` no cambia y los límites no se renuevan; revocar es definitivo.
`economicOperationId(world,character,opId)` conserva la identidad existente: el mismo commit confirma
perfil, mercado y consumo, y un vínculo inmutable añade dueño/presupuesto. Replay no concede bienes
ni hidrata perfiles históricos. La reapertura PGlite prueba almacenamiento local; SQL017 live y caída
de proceso/disco de esta nueva política requieren evidencia aparte. Publicación inerte no activa grants.
