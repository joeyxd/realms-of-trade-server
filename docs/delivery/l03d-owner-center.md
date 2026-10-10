# L03d-b — Mis compañeros ingame

2026-10-10. [Brief](../briefs/l03d-owner-center.md) · [Dirección del centro](../briefs/l03d-inference-center.md).

## Implementado

«Mis compañeros» permite consultar personajes configurados para la cuenta y detener su control.
La sesión autenticada del servidor determina el dueño; otra cuenta y los invitados no reciben sus filas.
La interfaz usa nombres públicos, estados claros, actualización explícita y consulta cada cinco segundos
solo mientras está abierta y visible. Español/inglés, cierre con Escape, foco de teclado y stage móvil.

La detención revoca el grant existente y vacía la cola de entradas. Requiere la revisión que se mostró:
una pestaña antigua no puede detener un personaje recién admitido. También admite detener un binding
que aún no se conectó. El control actual vive en memoria de proceso; **reiniciar el servidor pierde
la detención**, como indica el panel. Logout, cambio de cuenta y desconexión limpian la proyección.
No reenvía mutaciones después de un timeout ni acepta respuestas de otra sesión.

Versión alpha.31, protocolo 41 revisado: dos mensajes opcionales; no cambia snapshots/`you`, perfil,
SQL o flags. Integra AREA15 `5df2e88` con el montaje común y artesano apagados. Conserva M5/GameHost.
La configuración de conexiones aún no está disponible en el juego. No configura proveedor/modelo,
instala Hermes, consume inferencia, concede presupuesto ni activa agentes públicos.

## Verificación local

Pruebas de cliente, UI y WebSocket en `tests/companions-*.test.mjs`; cubren aislamiento de dos cuentas,
invitado, host deshabilitado, revisión nula/antigua, admisión posterior, stop idempotente, entradas pendientes,
logout/relogin y respuesta tardía. [Suite de agentes](l03d-owner-center/agent-tests.tap) y
[regresión de release](l03d-owner-center/release-tests.tap) conservan sus resultados separados;
los casos se solapan y no se suman como aceptación independiente.

[Navegador local](l03d-owner-center/browser-evidence.json), reproducible con
`node tools/qa-companions.mjs`, usa identidades/auth locales simuladas y memoria de fixture.
No acredita Supabase real, memoria semántica ni persistencia de los bindings. Capturas en la misma carpeta.

## Publicación y siguiente tramo

Pendiente de registrar revisión/imagen exacta y entrada pública después de aceptar las pruebas locales.

Sigue configuración durable por cuenta/personaje, conexión admitida con referencia privada, modelo
y límites conjuntos. Después adaptador y canario L03d social/PvE/memoria con uso/coste observados.
Hermes local conserva su evaluación separada. El proveedor/modelo y cantidades siguen por elegir;
el ledger local previo no se presenta como cuota central multiusuario o factura externa.

## English

In-game owner-only companion status and stop. Exact displayed epochs fence stale controls; logout
and account changes clear private rows. Stop is process-local and is lost on a server restart.
No provider, inference, new SQL, provisioning or public agent activation in this cut.
