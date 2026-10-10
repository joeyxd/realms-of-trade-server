# Presupuesto nativo de inferencia — L03d-a

El runner y el panel habituales conservan `--mind simulated`. Esta API prepara la contabilidad
del futuro adaptador real; no hace inferencia ni carga credenciales. El presupuesto es local y
cooperativo, separado del presupuesto de bienes M5/SQL017 y de la facturación de una cuenta externa.

## Inicialización explícita

`node tools/agent/manage-budget.mjs --files C:/ruta/presupuesto-nativo --owner owner-lab --character brisa-lab --world world-lab`
lee JSON por stdin. El directorio debe existir y ser distinto del ledger simulado anterior.
`initialize` conserva v1; `initialize_native` añade `metering` y crea v2. Campos de política:

| Campo | Significado |
|---|---|
| `providerId`, `modelId` | Identidad fijada del transporte/modelo; sin clave, querystring ni credencial |
| `unit` | Siempre `nano_usd`; 1 USD = 1 000 000 000 unidades |
| `inputNanoUsdPerToken`, `outputNanoUsdPerToken` | Enteros no negativos por token; al menos uno positivo |
| `priceRef` | ID local de la evidencia de tarifa revisada; no una URL con secretos |
| `priceCheckedAtMs` | Fecha declarada de esa revisión; la API no verifica precios ni actualidad |

El comando conserva `allowanceId`, `period:{startsAtMs,endsAtMs}` y
`limits:{maxCalls,maxTokens,maxCostUnits,maxEntries}`. En v2 `maxCostUnits` está en nano USD.
No se incluye una tarifa de ejemplo que pudiera confundirse con un precio vigente.
La tarifa debe cubrir de forma conservadora todos los tokens de entrada y salida del modelo,
incluido razonamiento si lo cobra; descuentos de caché no reducen esta reserva.
Modelos con costes adicionales no representables quedan fuera hasta ampliar/verificar su contrato.

`inspect`, `configure`, `reconcile`, `mark_unknown` y `cancel_reserved` conservan los contratos
existentes. Configure cambia enabled/límites mediante CAS; no cambia tarifa/modelo ni reinicia
periodo/consumo. Reconcile es una declaración manual `owner_supplied`, exige coste consistente
con los contadores y no prueba una factura. El modelo no accede a estas operaciones.
La conciliación manual rechaza una llamada todavía `inflight`; primero debe existir evidencia
de interrupción/uso desconocido. Así no libera una reserva mientras el adaptador sigue activo.

## Adaptador programático

El adaptador conserva [la API de mente](mind-runner.md#api-de-adaptación) y añade `metering` con la
misma política exacta del ledger. Debe usar `PersistentInferenceBudget`; un ledger de proceso o v1
no sirve para un adaptador con esta política. `assertAdapter` compara el hash declarado antes de dispatch
y antes de aplicar una propuesta. `prepare` devuelve el body final y la reserva calculada por
`meteredCost(metering,inputTokens,maxOutputTokens)`; v2 rechaza un importe inferior o arbitrario.

Esa comprobación compara la política completa declarada por el adaptador. `adapter.id` es una
etiqueta local de implementación, independiente de proveedor/modelo. El ledger no autentica un
endpoint ni verifica de qué modelo proceden los contadores; el canario debe aceptar ese enlace
antes de habilitar un transporte real.

`complete` obtiene contadores del recibo nativo, nunca del JSON generado, y devuelve
`usage:{inputTokens,outputTokens,costUnits}`. El ledger recalcula costUnits con su tarifa inmutable.
El contador de texto sirve para contexto/selección; no reemplaza los tokens nativos de salida.
El límite de bytes de respuesta y los validadores de gameplay siguen activos.

La vista identifica `usageSource:adapter_native`, `chargeSource:pinned_rate_calculation` y
`invoiceCostUnits:null`. El origen de contadores es una declaración del adaptador de confianza;
solo el canario de un proveedor concreto podrá aceptar su traducción. La tarifa es declarada
por el dueño, no contrastada automáticamente. `confirmedCostUnits` significa cálculo liquidado
en este ledger, no pago/factura confirmados, ni tope global para otras aplicaciones de la cuenta.

Uso ausente, inválido, error o respuesta perdida retienen el máximo como pendiente/desconocido,
incluso tras reiniciar. No hay resend ni reconciliación automática. Revocar bloquea nuevas llamadas
y propuestas pendientes; uso conocido tardío todavía se liquida. Superar una reserva registra
el consumo válido, bloquea futuras admisiones y descarta la propuesta. Los archivos locales no
son una defensa frente a su propio dueño reescribiéndolos; no hay servicio remoto ni custodia.

El panel de laboratorio devuelve `native_budget_panel_unsupported` para lectura de presupuesto,
configure/start/think con v2; conserva stop y administración de los archivos del personaje.
El CLI simulado rechaza v2 antes de conectar. No puede etiquetar gasto nativo como ensayo.

## English

L03d-a adds an explicitly initialized, separate v2 durable ledger. It pins provider/model and
owner-reviewed conservative rates in integer nano USD. Native token counters, rate-derived
charges, and provider invoices remain distinct. No provider, model, credential, endpoint, price
lookup, paid request, or automatic retry is configured. Existing v1 simulated history is unchanged.

A programmatic adapter must supply the exact pinned `metering` policy and a persistent v2 budget.
Reservations cover estimated/measured input plus the maximum output. Settlement uses trusted
native counters and recomputes the charge; missing/invalid usage keeps the full hold and prevents
gameplay proposals. Late usage still settles after interruption. Manual reconciliation stays
owner-supplied. The lab panel/CLI cannot operate native budgets. Real provider acceptance and
memory/conversation quality remain the next part of L03d.
