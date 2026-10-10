# Continuidad de servidor — AREA15

2026-10-10, hora de México. M5/GameHost mantiene una sola autoridad de persistencia.

**AREA17 L03d-a, corte local 2026-10-10:** [ledger de inferencia nativa](delivery/l03d-native-metering.md),
separado de M5 y de la factura externa. `agent-inference-budget/v2` persiste `metering` con IDs
de proveedor/modelo declarados, unidad nano USD, tarifas/referencia/fecha fijadas y hash por reserva/
liquidación. V1 sigue simulado, sin migración automática. Contadores `adapter_native` o manuales
`owner_supplied`, cargo derivado y `invoiceCostUnits:null` quedan diferenciados. Uso desconocido
retiene reserva tras reinicio; configure no renueva saldo ni tarifa. No añade campos de gameplay,
SQL, flags ni activación de proveedor; canario y calidad de memoria siguen pendientes.

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
| Borrador del editor GM | [GM02](delivery/gm02-draft-walk.md): IndexedDB privado por navegador/cuenta/mundo, documento v2 con migración v1, CAS y recuperación/export local | GM03 debe integrar guardado remoto y publicación con M5; preview caminando descartable, sin bienes ni progreso |

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
