# AREA15 — intención exacta y recuperación del sobre

2026-10-10. [Contrato](../briefs/m5-ground-transaction-journal.md).

SQL019 registra el sobre antes del efecto y confirma su cierre junto a SQL018. La sesión detenida
puede resolver la intención pendiente al arrancar, cargar filas actuales y adoptar su época en drain.
Reintentos no duplican efectos; conflictos terminales no dejan una operación eternamente pendiente.
Las reservas conservan el namespace legacy y permiten varias operaciones al mismo tick.

## Verificación local

**266/266 pruebas en 33 archivos**, sin fallos/omisiones, Node v24.14.0; base `91957a3` y hashes sin
cambios durante la suite. Incluye 27 casos nuevos (12 SQL, 12 contrato/sesión y 3 proceso), con regresión
de SQL018/reloj/recursos/Tala/economía/presupuesto de agentes y los recorridos del actualizador.
La [aceptación reproducible](m5-ground-transaction-journal/acceptance.json) registra comando, hashes,
revisión base y [salida TAP](m5-ground-transaction-journal/acceptance.tap). Incluye contratos, sesión,
SQL001–019 con Supabase SDK/PGlite, migración repetida, permisos, namespace, same-tick, conflictos,
rollback al finalizar y respuestas perdidas de preparación/commit/confirmación.

Tres pruebas terminan un proceso real con SIGKILL y abren la base local desde otro, sin volver a
migrar: tras guardar `pending`, con todos los cambios provisionales dentro de BEGIN y después del
commit. Antes de recuperar se comprueba el conjunto antiguo o confirmado completo. Startup retoma
solo el pendiente; después hay una perla, un recibo de familia y versiones de perfil/mundo/reloj 2.
El reloj queda en 1010 y conserva 590 ticks hasta la reaparición. Un replay posterior no modifica filas.
Es prueba de proceso/SQL local, sin GameHost, corte eléctrico, pérdida de disco o caída VPS.

## Publicación y alcance

Código y runtime publicados en `6748f9a9fd1046a391dcb8fdc58855affe5a944d`, alpha.27/protocolo 39.
VPS aceptado el 2026-10-10 después de las 20:46 UTC: una imagen sana
`sha256:8c04a7adf587789b64e0087ebf25dc971ed04ace562ec058aff4617ce04723a5`, timer activo,
economía/recursos/Tala listos y cero errores/guardados pendientes. Journal/sesión/recovery importan
dentro de esa imagen con Node v22.23.3. [Revisión, imagen y status posterior a entrada](m5-ground-transaction-journal/deployment.json).

La imagen pasó [107/107 pruebas offline](m5-ground-transaction-journal/vps-validation.json), con
solapamiento respecto a la suite local. [6/6 públicas](m5-ground-transaction-journal/public-smoke.json):
health, M5 sano, protocolo, WSS ordinario, snapshot y perfil; la conexión QA queda cerrada.
[Sonda reproducible](m5-ground-transaction-journal/public-smoke.mjs). No ejecuta una acción durable.

SQL019 y el journal son opt-in; este corte no aplica/activa SQL018/019 en Supabase ni acredita gameplay
durable de perlas/muerte/botín en el servidor público. No cambia flags, secretos ni el protocolo.

Sigue el dueño común de `beforeTick`, época compartida y adopción legacy; después composición de
candidatos/ACK y aceptación autenticada de reinicio/caída en el VPS. La economía agente SQL017,
XP/misiones, supervivencia, producción autónoma, custodia offline y backups conservan sus límites.
