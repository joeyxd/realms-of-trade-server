# L01a — personaje por red normal

Dirección acordada; implementación de software autorizada por «lets do it», 2026-10-07.
Continuidad: [plan](../../PLAN-EXTRA-LLM.md#4-cortes-de-desarrollo-y-aceptación),
[L00](../delivery/l00-agent-interface.md). Corte local antes de L01b/chat y del LLM.

## Resultado y límites

Cliente Node sin renderer: HELLO/WELCOME/snapshot propio, plaza normal, personaje independiente
visible a otro cliente, inputs normales de movimiento/apuntado/ataque PvE y feedback textual.
Leer archivos reales por directorio explícito del dueño, contenido/revisiones/hashes y alcance exacto;
refrescar al consultar. Mantener contexto opcional acotado. Ningún proveedor ni gasto nuevo.

Hoy cada cuenta tiene un solo perfil/sesión. Este corte admite invitados con identidad local de dueño;
no crea perfiles secundarios, auth de dueño, permisos/revocación de servidor ni control exclusivo.
L02c/L06a conservan esas puertas. No reclamar presencia humana física, WAN, balance o despliegue.

## Reutilización comprobada

- `GameClient`, `WsTransport`, constante de protocolo, `PLAYER_FIELDS`, `BTN.AIM`, mapa por seed
  de WELCOME y reglas de simulación existentes. Sin cambiar snapshots ni protocolo.
- Candidatos Unreal/FAB: `ActionRPGStarterSystem/InventorySystem/**` y UMG/`ItemImages` del
  [inventario](../research/unreal-assets/CANDIDATES.csv) son Blueprint/UI para gameplay/economía;
  no aportan un cliente Node, transporte o lector Markdown/JSON/JSONL. Descartados para este corte.
  Fuentes Unreal intactas; no dependencia adicional ni nueva ilustración.

## Verificación

Pruebas de aislamiento/frescura/source, secuencias/eventos antes de dedup visual, targets por ciclo,
plaza llena/version incorrecta, neutralización y snapshots confirmados frente a predicción.
Dos clientes ordinarios por WebSocket en host efímero `dev:false`; recorrer hasta práctica con
órdenes cortas sin teleport/god/level. Un cliente navegador comprueba personaje/movimiento y
captura inspeccionada. Archivos originales no cambian; tests de contenido/scope/límites y rutas.
ACK informa procesamiento de inputs; swing confirma ejecución, no impacto. Movimiento informa
desplazamiento observado posterior, sin inventar llegada ni causalidad exclusiva.

Raíz integra/revisa y mantiene protocolo/entrypoints; workers Luna tienen archivos separados.
Sin SQL, cuentas live, proveedor, staging Git, publicación o despliegue. Entrega y siguiente corte
se registran con la evidencia efectiva, dejando abiertos los requisitos no demostrados.
