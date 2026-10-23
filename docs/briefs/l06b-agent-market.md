# L06b-2a — inventario y cotizaciones para decidir

Implementación autorizada, 2026-10-10. Lecturas privadas del agente; compra/venta y presupuesto
de bienes se mantienen en L06b-2b sobre la autoridad económica M5 existente.

## Contrato

- Capacidad explícita `market_read`, independiente de `inventory_read`. Piloto autenticado opt-in.
- Solicitud `agent_market`: `requestId`, `epoch`, `sessionId`, `op: list|quote` y, solo para
  `quote`, `g`, `n` (1–500) y `side: buy|sell`. No acepta dueño, cuenta, entidad ni pueblo.
  El servidor deriva actor y pueblo del socket autenticado y `townAt`.
- `readCommerce` comparte las reglas físicas/precios del comercio humano sin escribir recibos,
  eventos, perfiles, stock ni RNG. La respuesta privada proyecta solo filas del pueblo actual
  o artículo/cantidad/lado/total/promedio/ley. Oro/carga se consultan por inventario, no mercado global.
- 64 consultas distintas por sesión/epoch, una pendiente por runner y timeout explícito.
  Un ID repetido conserva la foto y el tick originales; un ID con otra petición se rechaza.
  Permisos, vida, sesión, puerta M5 y presencia en el servicio se comprueban también antes del replay.
- Tick del servidor y edad máxima local de observación (por defecto 1500 ms) delimitan el uso en
  contexto. Una cotización es informativa; ningún tick/ID autoriza una compra futura sin recotizar.
  Datos históricos quedan en el ledger de inspección y no recuperan frescura desde un replay.
- Snapshot de mente detached: solo vistas actuales válidas, procedencia, tick y caducidad. Las
  herramientas de lectura se anuncian dentro del grant vigente; el CMD genérico sigue bloqueado.
  Stop, revocación, muerte, sesión/epoch nuevos y falta de observación fresca retiran las vistas actuales.
  Movimiento XZ retira mercado hasta otra lectura, incluso si vuelve a su posición; una denegación
  retira la vista anterior. Los IDs de solicitudes se retiran al archivar una sesión.
- CLI de ensayo: `inventory_read`/`market_read` con `query`; `inventory`/`market` inspeccionan.
  `context` y la mente usan el mismo ensamblador. Sin polling nuevo, modelo real o gasto de bienes.

## Integración y aceptación

Rama aislada desde upstream `b95f49a`, actualizada a `b84c2da` para la primera regresión y a `70205bd`
para conservar la lección naval antes de publicar. Versión integrada alpha.20/protocolo 35.
Se incorporan únicamente prerrequisitos locales de agentes
L05/L06a/L06b-1; se conserva el upstream publicado y se excluye el trabajo dirty ajeno de recursos
SQL015, progresión, UI y otros frentes. Protocolo 35
coordina host/cliente/runner. El entrypoint mantiene el piloto apagado por defecto.

Pruebas: reglas compartidas sin efectos; wire adversario y dos cuentas; localidad, presupuesto de
consultas, replay/cambio de petición, puertas M5, muerte/revocación/reentrada; runner WebSocket real;
contexto con datos actuales y sin campos privados; límites de prompt y regresión humana/agentes/M5.
Pruebas locales, publicación inerte y activación real se registran por separado en la entrega.

Reutilización Unreal/FAB: `ActionRPGStarterSystem/InventorySystem`, identificado en
[el inventario](../research/unreal-assets/SUMMARY.md), sirve como referencia conceptual de vendor/UI.
Este corte reutiliza catálogos, `townAt`, cotización, control, runner y contexto existentes; no necesita
Blueprints, arte ni UI nuevos. Fuentes Unreal intactas.
