# L03d-a — contabilidad durable antes del proveedor real

2026-10-10. Primer tramo de L03d, después de L06b-2b. La entrega de L03d sigue siendo
conversación/PvE con proveedor real, recuerdo con fuentes y consumo medido. Este tramo prepara
su frontera de gasto; no selecciona modelo, consulta un proveedor ni acepta calidad de memoria.

## Problema y resultado

El ledger v1 solo acepta `simulated_tokens`, etiqueta su consumo `adapter_simulated` y usa unidades
de laboratorio. Reutilizarlo para un modelo real mezclaría historias y permitiría llamar "factura"
a una cifra sin evidencia. Se añade un ledger v2 explícito y separado, con tarifa/modelo fijados,
reservas antes de dispatch y liquidación desde contadores nativos del adaptador de confianza.

La tarifa, la moneda y el modelo son inmutables durante la vida del ledger. No hay actualización
automática de precios, renovación del periodo ni migración silenciosa. Configure conserva sus
contadores y reservas. El consumo de bienes SQL017 sigue siendo otra política dentro de M5.

## Contrato y aceptación

- Conservar lectura/replay v1 byte compatible y sus etiquetas simuladas.
- v2 fija proveedor/modelo, precios por token, referencia y fecha de verificación; hash por reserva
  y liquidación. Enteros nano USD con cálculo BigInt; cero tarifas en conjunto y coste por llamada
  fuera de rango se rechazan. Overflow agregado conserva hold y evidencia durable de overrun.
- Reservas v2 exigen conteo medido/estimado y coste calculado para toda la entrada/salida máxima.
  El adaptador debe demostrar que la reserva cubre framing y dimensiones facturables reales.
- Una respuesta sin uso nativo válido conserva el máximo reservado y no produce una acción. Uso
  válido se liquida incluso si el JSON es inválido, fue cancelado, revocado o llega tarde.
- Native token counters, cargo calculado por tarifa y factura son evidencias distintas. Una
  conciliación manual conserva `owner_supplied`; nunca se presenta como recibo del proveedor.
- Reinicio, revocación, límite agotado, modelo/tarifa incompatibles y corrupción fallan cerrados.
- CLI de administración inicializa v2 explícitamente. Panel y runner simulados no operan v2.
  Stop sigue disponible. Sin endpoint, credencial, SDK, SQL, protocolo ni flag nuevo.

## Reutilización

Revisados [inventario Unreal/FAB](../research/unreal-assets/SUMMARY.md) y
[VibeUE](../research/unreal-assets/myproject/FINDINGS.md): el candidato es un plugin Editor Win64
para Unreal, no un transporte ni ledger portable al runner Node. Se reutilizan `AgentMind`,
`InferenceBudget`, el journal/CAS local y los contratos de conversación/memoria existentes.
No necesita arte, Blueprint ni modificaciones de las fuentes Unreal.

## Puerta siguiente

Elegir proveedor/modelo y credencial local por nombre de variable/ruta, verificar endpoint,
tokenizer/framing, límites y tarifa de ese modelo. Después integrar un adaptador acotado y medir
un canario social/PvE: latencia, uso, errores, stop/reentrada, recuerdos pertinentes y contradicciones.
No se acepta calidad semántica ni gasto real con fixtures de contadores.

[Contrato operativo](../agents/native-metering.md) · [Entrega/evidencia](../delivery/l03d-native-metering.md).
