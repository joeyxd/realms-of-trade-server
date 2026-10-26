# D08c.2 — piloto, cubierta móvil y predicción

2026-10-06. Ensayo local delimitado del puente [D08c](d08c-live-navigation-bridge.md), sobre el cuerpo
autoritativo D08c.1. No activa viajes públicos ni cambia custodia de bienes. El autor reserva su playtest
conjunto para después de completar estructura/features; la QA técnica continúa por corte.

## Contrato de este corte

- `NavalPilotServer` es un servidor dedicado al laboratorio. El LocalServer ordinario, el worker y
  GameHost siguen sin activar navegación. World admite `navalPilot: true` solo en servidor.
- La sesión resuelve al propietario. Solo puede montar su propia balsa, vivo, conectado, sin bot,
  con los pies sobre cubierta y sin ataque/dash/cast ni invitados. Máximo cuatro pilotos en este ensayo;
  es un límite técnico, no un presupuesto móvil demostrado.
- El puesto conserva posición y orientación locales. El tick publica una pose transitoria del barco,
  actualiza RaftDeck y transporta el cuerpo ECS del piloto juntos. La entidad fuente y su amarre guardado
  permanecen canónicos para el fence de D08c.1; la proyección no es otra balsa ni inventario.
- No hay pasarela mientras está montado. Movimiento terrestre y combate del piloto quedan aparcados;
  editor, producción y otros comandos de jugador se rechazan durante el puesto. No hay caminar a bordo
  ni pasajeros en este corte: un invitado que entra después hace volver a ambos al muelle.
- Entrada/salida explícitas. Salir, perder asiento/soporte, morir, desconectar, cambiar la fuente o
  abandonar la zona de prueba cancela el cuerpo transitorio y restaura el amarre. El rescate no revive
  al personaje. Plano, bodega y HP guardados se conservan; esta política de retorno no será la política
  de pérdidas de un viaje público.
- La barrera de zona comprueba esquinas de foundations contra límite de mapa y altura de tierra.
  No es colisión costera continua, daño por choque ni barrido de casco; puede omitir terreno estrecho
  entre muestras. El contacto/HP de D08c.0 sigue pendiente de conectar a esta autoridad.

## Red y cliente

Protocolo 17. `SHIP_INPUT` del ensayo lleva epoch, secuencia y ejes acotados; campos de propietario o
pose enviados por el cliente no deciden autoridad. El ACK naval es separado del ACK terrestre y avanza
cuando el tick aplica la entrada coalescida. La política existente neutraliza controles tras timeout.

`NavalPilotPrediction` usa el mismo step determinista, retira comandos confirmados y reproduce los
restantes. Epochs, ticks y ACK antiguos no reactivan puestos ni retroceden el cursor. Piloto y barco
local usan exactamente la misma pose interpolada; barcos remotos y sus pilotos comparten una pose
interpolada de snapshot. El harness emplea mensajes clonados y encolados entre GameClient y el servidor.
La prueba de dos clientes valida el contrato; no representa un ensayo de red WAN ni lag real.

Snapshots/heartbeats son de solo lectura y publican el último cuerpo/ACK confirmado cuando M5 retiene
un tick. El hook de apply M5 precede admisión. Las comprobaciones de ciclo de vida ocurren en prepare/sync
del World. Un fallo inesperado de step cerca el servidor del ensayo de forma permanente, cierra cuerpos
y rechaza reintentos: no se promete rollback del pump que ya consumió colas.

## Reutilización y ejecución

Antes de implementar, Luna revisó las rutas reales de `BPI_PlayerMovement.uasset` (12.258 B) e
`IA_Move.uasset` (1.590 B) de Dreamrise_SMSK, y `NS_Spline_WaterSplash.uasset` (5.381.446 B) de MyProject.
Los nombres no prueban un contrato naval portable; el splash es candidato visual, no autoridad.
Se reutilizan rig/dinámica, RaftDeck, renderer/atlas/caja FAB, personaje, cámara, agua, espuma y audio
de la bahía. Sin nuevas texturas ni exportaciones; fuentes Unreal intactas.
[Revisión previa D08](../research/unreal-assets/D08-REUSE.md).

Raíz del repo: `node tools/naval-lab.mjs --port=5180`, luego
`http://127.0.0.1:5180/tools/naval-pilot/`. W/S acelera/frena, A/D gira; también botones táctiles.
Subir/Bajar son acciones explícitas. Ambiente requiere gesto del usuario. Cierre/blur neutralizan el
control. La escena crea fixtures locales de balsa y casa en un amarre exterior sobre perfiles temporales; no carga cuentas
ni guarda progreso. La velocidad se expresa en unidades de simulación/s, no nudos inventados.

Luna aporta geometría, predictor, harness y pruebas en archivos separados. El principal conserva
integración World/red/cliente, revisión, QA y entrega. Arte/arena y M5 concurrentes se preservan.

## Siguiente corte

Cubierta móvil con pasajeros y locomoción relativa, salida segura y cámara del juego. Después integrar
contacto costero/HP por pieza al tick con predicción/feedback y contrato de recuperación. Activación
pública, carga disputable, reparación y viaje D10 requieren sus puertas M5/D09; ancla/remolino y
encuentros siguen sus cortes posteriores. No marcar P5/P6 completos por este laboratorio.
