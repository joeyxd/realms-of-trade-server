# IC03a — La mente emparejada en el cuerpo de presencia (L03g-b, servidor y cliente)

Ticket T-1020-02 (AREA17, 2026-10-20), alpha.79 / protocolo 63. Sin SQL nuevo: reutiliza SQL039.
Continúa [L03g-a](l03g-companion-presence/README.md) y su [contrato](../briefs/l03g-companion-presence.md)
(líneas 71-76: reconectar una mente al mismo cuerpo sin recrear la identidad).

## Comportamiento

- Con `MN_COMPANION_PRESENCE=1` y SQL039 listo, un HELLO emparejado (`agent: true` y token `mncp_`) se ata
  al cuerpo de presencia activo del dueño (`server/companionPresence.mjs` `attach`, `server/host.mjs` `join`).
  No crea entidad, perfil, plaza ni un segundo nombre: el id del cuerpo es la única identidad en el mundo.
- Percepción: la del cuerpo. El WELCOME lleva `you` = entidad del cuerpo, el grant en `control` y la misma
  política `perception` que ya usa el emparejamiento (radio 24, tope 64). Snapshots, eventos propios y chat
  que el servidor manda al cuerpo llegan al socket de la mente (`host.sendTo`); sin mente se descartan como antes.
- Chat: lo que la mente envía (con su época de control) lo dice el cuerpo, con su id y su nombre
  "<nombre> [IA]", por la sesión de chat normal del cuerpo y con los límites de un jugador. El chat local
  cerca del cuerpo, el de mundo y los susurros al cuerpo llegan a la mente.
- Órdenes: solo `AGENT_COMPANION_PRESENCE` con `load` (lectura), `follow`, `wait` y `return`, con las mismas
  claves exactas, el CAS `expectedRevision`, el límite de 60/min y la regla de una operación a la vez del dueño.
  `join` y `retire` responden `forbidden`. INPUTS, AGENT_TASK, AGENT_CANCEL, AGENT_RELEASE, AGENT_CONTROL, CMD
  y el resto de comandos del mundo se rechazan: el cuerpo solo se mueve con `companionPresence.step()`.
  "Seguir" siempre es seguir al dueño.
- Grant del emparejamiento: exactamente `["chat","presence"]` con la presencia encendida y exactamente
  `["chat"]` con ella apagada.

## Reglas del ciclo de vida

- Emitir un código exige el cuerpo activo del personaje; si no, `presence_body_required` (también si el cuerpo
  se va mientras se recarga el registro). Con la presencia encendida sustituye a la exclusión de L03g-a.
- Un HELLO emparejado con el cuerpo ausente, retirándose, en otra operación o a punto de autorretiro recibe
  `ERROR auth` y no aparece nada. Una mente por cuerpo: un segundo controlador se rechaza y su cierre no revoca
  a la primera.
- Retiro del dueño, autorretiro, fallo de perfil del cuerpo, valla del mundo y cierre del servidor revocan el
  emparejamiento del dueño: códigos y tokens fuera y la mente cerrada con 1008 `pairing revoked`. Un HELLO con
  el token viejo se rechaza.
- Cerrar o revocar la mente deja el cuerpo activo con su orden: no cura, no teletransporta, no reinicia
  enfriamientos, no carga ni consume. Un código nuevo ata otra mente al mismo cuerpo.
- Desconexión del dueño: como hoy (orden `return`, autorretiro al llegar) más la revocación existente.
- Una orden de una mente revocada o sustituida la rechaza la época de control (`forbidden`, orden y revisión
  intactas).
- Con la bandera apagada (producción hoy) emparejamiento, HELLO, chat y entidades siguen igual que en L03f.

## Cliente

- "Conectar en mi PC": con la presencia encendida, el botón de código solo se activa con el cuerpo presente; si
  no, muestra "Invoca primero a tu compañero" / "Summon your companion first" (también como motivo cuando el
  servidor responde `presence_body_required`).
- Tarjeta de presencia: "Mente conectada: …" o "Ninguna mente conectada a este cuerpo." (EN "Mind connected: …"
  / "No mind is connected to this body."), leído de la lista del dueño que el panel ya refresca cada 5 s.
- `/status`: `storage.companionPresence.minds` (mentes atadas), solo con la presencia encendida.

## Pruebas

- `tests/companion-body-mind-network.test.mjs`: 12 casos contra un host real con stores en memoria y presencia
  encendida (atar, chat, rechazos, órdenes, cierre de la mente, retiro, desconexión, sin cuerpo, segundo
  controlador, valla y cierre, época de control) más el caso con la bandera apagada.
- `tests/companion-body-mind-ui.test.mjs`: 3 casos de cliente y paneles en ES y EN.
- `tests/companion-presence-network.test.mjs`: cuatro casos afirmaban la exclusión de L03g-a y se ajustaron
  (detalle en HANDOFF). Los tests de emparejamiento con la bandera apagada pasan sin cambios.
- Suite del área: 943 tests, 930 pasan y los 8 fallos ya estaban en la base previa (0 nuevos). Gate de
  despliegue 29 ficheros 202/202. i18n 80/80.

## Cómo probarlo en local

- Automático: `node --test --test-concurrency=1 tests/companion-body-mind-*.test.mjs`.
- A mano, en un servidor propio: `MN_COMPANION_CREATION=1 MN_COMPANION_PAIRING=1 MN_COMPANION_PRESENCE=1`, con
  cuentas y un store durable con SQL027, SQL034 y SQL039 aplicados (el arranque normal no usa el modo memoria).
  En el juego: Mis compañeros → Permitir conexión → Salir conmigo desde el punto de llegada → Conectar en mi PC
  → Generar código. El runner de hoy (`tools/agent/pair-companion.mjs`) todavía rechaza el grant `presence`
  (IC03b), así que el HELLO de la mente solo se prueba con el test de red.

## Lo que no está

- Lado runner (IC03b): `tools/agent/contract.mjs` (`NETWORK_CAPABILITIES`) no conoce `presence`,
  `paired-companion.mjs` fija `["chat"]` y la mente no traduce sus verbos a follow/wait/return.
- Verbos nuevos (go_to, keep_distance, atacar, recolectar, cocinar: IC05), observación v2 (IC04), política de
  muerte y persistencia del estado de la mente.
- SQL039 sigue sin aplicar en producción y la bandera sigue apagada; no hubo canario ni prueba con un modelo real.
