# L03d-a — frontera durable para uso nativo

2026-10-10. [Brief](../briefs/l03d-native-metering.md) · [Contrato/CLI ES/EN](../agents/native-metering.md).

## Implementado

Ledger v2 separado y explícito: proveedor/modelo declarados, tarifa conservadora inmutable,
hash por reserva/liquidación y cálculo entero BigInt en nano USD. Historial v1 sigue simulado,
sin migración ni cambio de etiquetas. Se distinguen contadores nativos del adaptador de confianza,
cargo calculado por tarifa y factura desconocida; no se verifica un proveedor con estos fixtures.

AgentMind exige presupuesto durable compatible para uso nativo. Uso ausente/inválido mantiene
la reserva completa y no aplica propuestas; uso válido se liquida aun si el JSON es inválido,
la llamada se cancela o el presupuesto se revoca. Los fences existentes impiden aplicar respuestas
tardías. Conciliación manual rechaza `inflight` y preserva `owner_supplied` para uso desconocido.

CLI de administración añade `initialize_native`. El panel de ensayo rechaza presupuesto nativo
en lectura/configure/start/think y conserva stop. El runner normal continúa simulado/desactivado.
No cambia SQL, protocolo ni perfiles; integra el upstream alpha.27/protocolo 39 y conserva M5/GameHost
como única autoridad de gameplay. La contabilidad local no es un tope global de facturación externa.

## Verificación

[Verificador reproducible](l03d-native-metering/verify.mjs),
[resultado y hashes de fuentes](l03d-native-metering/verification.json) y
[TAP](l03d-native-metering/verification.tap): **569 aprobadas, cero fallos y cinco omisiones de
symlinks Windows**, 64 archivos y hashes estables durante la ejecución sobre base `91957a3`.
Contadores/tarifas de fixture, sin proveedor externo ni gasto. Pruebas de red usan localhost.

Revisión independiente detectó y cerró la liberación manual de una reserva todavía en curso;
el ensayo verifica hold intacto, respuesta nativa posterior y rechazo de replay manipulado.
`adapter.id` es etiqueta local: solo se compara la política declarada del adaptador, sin autenticar
su transporte. El cálculo por llamada fuera del rango seguro se rechaza; overflow agregado conserva
la reserva y registra overrun durable.

## Pendiente y publicación

L03d continúa abierto: elegir proveedor/modelo y ubicación de credencial, verificar framing,
tokenizer, tarifa/dimensiones cobradas e integrar el transporte. Después canario social/PvE,
recuerdos con fuentes/contradicciones, stop/reentrada, latencia, errores y coste real observado.
No se acepta calidad semántica ni factura con fixtures. Sin activación pública de proveedor/agentes.

Estado de publicación/despliegue se registrará con su evidencia. Este archivo describe el corte
local hasta que exista revisión publicada y comprobación de la imagen.

## English

Separate durable native metering groundwork; no real provider is configured or called. v1 simulated
history remains unchanged. Declared native counters and owner-pinned rate calculations are not
provider invoices. Manual reconciliation cannot release an in-flight native hold. Real adapter,
provider identity, memory/conversation quality and live canary acceptance remain open.
