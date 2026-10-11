# L03a — mente intercambiable verificada con modelos simulados

El runner puede solicitar una decisión estructurada, aplicar una propuesta válida mediante el cuerpo
existente y seguir atendiendo inputs y stop mientras la inferencia espera. Cada consulta cuenta la
envoltura completa, instrucciones, esquema, contexto seleccionado, reserva de salida y margen;
reserva consumo antes de I/O. La integración y sus fronteras están verificadas localmente con modelos
simulados. Conexión a un modelo real, tokenizer, tarifas, factura y operación durable siguen pendientes.

[Contrato y uso](../agents/mind-runner.md), [brief y cruce Unreal](../briefs/l03a-agent-mind.md),
[manifest de verificación](l03a-agent-mind-verification.json).

## Resultado

- `AgentMind` acepta adaptadores intercambiables con payload exacto preparado y respuesta JSON acotada.
  Los IDs/scope/epoch y revisiones los fija el runner; la propuesta se valida contra el estado original
  y otra vez contra el actual. Stop, tarea/capacidades/archivos cambiados, muerte y estado obsoleto la descartan.
- Se reutilizan la poda, selección pertinente y compactado mecánico de L00/L01. El mínimo obligatorio
  conserva reglas/metas/pendientes e incertidumbre; si no cabe, se omite la consulta. Los historiales
  de 10.000 y 20.000 registros permanecen bajo el mismo tope de petición sin borrar fuentes.
- `InferenceBudget` separa confirmado, reservado en curso y sin resolver. Error/timeout tras dispatch
  no devuelve cuota supuesta; recibos tardíos pueden resolver consumo sin ejecutar la decisión.
  Entrada/salida/coste reales sobre reserva se registran y bloquean siguientes llamadas.
- Timeout/cancel retiran la capacidad de actuar. Si un adaptador ignora abort, se conserva el slot
  hasta su terminación para evitar dos consultas pagadas a la vez. No hay retries automáticos.
- CLI opt-in `--mind simulated`, con `think`, `mind` y `mind_cancel`, límites configurables y stop
  responsivo. El default sigue sin inferencia. No se añaden capacidades del mundo ni consultas por tick.

## Evidencia local final

```powershell
node tools/qa-agent-mind.mjs agents
node tools/qa-agent-mind.mjs regression
node tools/qa-agent-mind-evidence.mjs
```

| Suite | Resultado final |
|---|---|
| 23 archivos de agentes, incluidos cuatro nuevos de L03a | 212 pruebas: 211 aprobadas, una omitida, cero fallos |
| 18 archivos de regresión del host/red/chat/autoridad/combate/persistencia | 206/206 aprobadas |

La omisión es la prueba de symlink de `agent-owner-files`: Windows devolvió EPERM al crear el enlace.
No se cuenta como aprobada. Los nuevos ensayos suman **48/48**, incluidos ledger, wrapper/poda,
respuestas inválidas, salida sobre presupuesto, latencia, consumo desconocido y descarte por estado.

El ensayo por WebSocket usa resolver autenticado local inyectado, cuentas distintas de dueño/agente
y política L02c. Comprueba movimiento mientras una respuesta está retenida, stop del dueño con recibo
de cola/carry vacíos y descarte de la propuesta tardía con uso conciliado. Otro ensayo convierte una
decisión simulada en tarea acknowledged y desplazamiento observado del servidor. Esto no prueba
impacto, utilidad táctica, frecuencia física ni un proveedor de autenticación en producción.

La CLI se ejecuta como proceso real: una consulta aceptada, segunda bloqueada por límite de llamadas,
cuota insuficiente sin dispatch, inferencia desactivada por defecto, stop con salida 0, token ausente
de stdout y archivos del dueño intactos. El registro de uso del simulador cuenta bytes como tokens
simulados y unidades de coste de laboratorio; **no se midió ahorro monetario ni factura real**.

Los TAP completos y metadatos están en [agentes](l03a-agent-mind/agents-tests.tap),
[regresión](l03a-agent-mind/regression-tests.tap), con hashes anteriores/posteriores. Ambas capturas
finales tienen cero cambios de dependencias durante el ensayo y fueron cotejadas otra vez al generar
el manifest. La primera captura provisional también pasó las pruebas, pero detectó cambios
simultáneos ajenos en UI/render; se conserva identificada como provisional y no respalda la aceptación.
La captura final cubre gameplay/auth/storage/agentes y el grafo de imports relativos de las pruebas,
además del lock de dependencias; no afirma inmovilizar todo el checkout compartido.

Las 22 líneas de acuerdo/demostración y D-A3 permanecen iguales al
[baseline](l03a-agent-mind/baseline.json). El checkout probado usa protocolo 29 por workbench
concurrente; este corte no lo modifica y conserva órdenes L00 v1.
Las regresiones existentes incluyen SQL local embebido; no se aplicaron migraciones a servicios
externos, no se hizo despliegue ni se activó un proveedor. Sin commit/push de esta misión.

## Límites y siguiente corte

El ledger es por proceso y ámbito dueño/personaje/mundo, sin periodos, persistencia ni contabilidad
global de cuenta. El adaptador de confianza debe transmitir exactamente lo medido, respetar caps,
acotar su lectura y registrar toda operación facturable. Las etiquetas de conteo medido/estimado
son parte de su contrato, todavía sin verificación de un modelo real. Un transporte que nunca
termina requiere reparar/cerrar ese transporte; no se libera el slot para volver a cobrar.

La memoria persistente con exportación/borrado conserva L04; conversación inteligente L03b,
selección/ajuste autónomo de metas L03c, gasto durable/BYOK/panel L05 y percepción/PvP/economía L06.
No se cerró la modalidad de operación/custodia D-A3. Fuentes Unreal intactas: BehaviorTree y Blackboard
verificados como referencias conceptuales y descartados para el código Node/WebSocket.

Siguiente: **L03b**, conversación con personalidad por C01. Adaptador y pruebas de un modelo real
mantienen una puerta de evidencia propia antes de afirmar uso, costes o calidad reales.
