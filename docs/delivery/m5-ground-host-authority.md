# AREA15 — GameHost comparte reloj y diario con economía

2026-10-10. Base integrada `6e6f421`, alpha.30/protocolo 41. Se conservan GM03b1,
artesano/Bodega, Tala cooperativa, noche/faroles y comercio de agentes del upstream.
[Contrato](../briefs/m5-ground-host-authority.md).

## Implementado

La opción de confianza `groundTransactions: { journal }` de GameHost/createGameServer monta un
solo dueño de tick para operaciones económicas y checkpoints de mundo. Confirma el sobre SQL018
y su diario SQL019; aplica el candidato síncronamente en `beforeTick` antes de liberar reservas o
enviar ACK. Un recibo económico hijo no permite saltar la conciliación del sobre.

WorldState conserva su cola/CAS, pero sus escrituras pasan por la familia `checkpoint`: mundo y
reloj se guardan juntos. Tick, comandos y admisión esperan el I/O y su drain. El cierre detiene
el pump y asienta el trabajo confirmado; una respuesta desconocida cerca el mundo para recuperar
desde el diario al arrancar. Los plazos usan pasos de simulación y se pausan durante el apagado.

Startup recupera intenciones pendientes antes de cargar las filas actuales. Exige reloj existente,
tick igual al de recursos, seed y snapshot exactos, sin creación automática ni adopción legacy.
Este montaje acotado admite cuentas autenticadas, cero bots y economía/recursos; rechaza invitados,
importación legacy, diario antiguo de perlas y control/comercio de agentes. SQL017 y el runtime normal
conservan sus caminos. No añade flags, campos de perfil, protocolo ni migraciones.

## Pruebas

**355/355 pruebas en 44 archivos**, cero fallos/omisiones; fuentes sin cambios durante la suite,
Node 24.14.0 local. La aceptación integrada y sus hashes están en [acceptance.json](m5-ground-host-authority/acceptance.json)
y [TAP](m5-ground-host-authority/acceptance.tap). Incluye doce casos nuevos: ocho gates/cola/cierre,
dos recorridos SDK/PGlite con SQL001–021 y dos caídas SIGKILL del GameHost real.

- Tala cooperativa con dos cuentas, aporte que completa carpintería, crafting, enseñanza personal,
  comercio, checkpoint, respuesta perdida, reinicio y replay sin cambiar filas/versiones/recibos.
- Colocar y retirar Bodega por el editor normal: misma balsa/IDs/condición, coste seis maderas,
  capacidad +20 y devolución exacta de tres; un recibo SQL014/018 y una intención SQL019 por acción.
- Proceso terminado tras prepare durable y tras commit SQL, ambos antes de ACK. El nuevo proceso
  abre la misma base sin migraciones, recupera como máximo un efecto y reintenta la petición original
  sin duplicar el tronco ni mover las versiones. No se invoca el cierre ordenado antes de SIGKILL.

También incluye regresiones de reloj/diario/familias anteriores, cuentas/recursos/Tala/artesano,
WorldState y la conexión HTTP/servicio de GM03b1. Es PGlite y proceso local: no certifica
concurrencia de múltiples backends PostgreSQL, corte eléctrico, disco perdido ni lease entre hosts.

## SQL y despliegue

El autor aplicó las migraciones. La consulta de capacidades real confirmó SQL018, SQL019, SQL020
y SQL021, todas `{version:1}`; [readiness](m5-ground-host-authority/sql-readiness.json).
La inspección del dominio real a las 21:38:31 UTC encontró recursos v2/tick 605768 y mundo v1562,
pero ninguna fila de reloj común; [dominio legacy](m5-ground-host-authority/legacy-domain.json).
Son lecturas: este corte no escribe datos del juego ni activa artesano o el montaje común.

La publicación de código y su verificación de imagen/entrada pública se registran aquí al terminar
el despliegue. Tener SQL aplicado o importar la API no prueba que esta opción esté montada.

## Siguiente corte

Adopción atómica del dominio existente: snapshot actual, reloj inicial y suelo legacy bajo un solo
dueño, con exclusión del writer anterior. Después componer perlas/muerte/botín en la misma frontera,
y aceptar acciones autenticadas y reinicio/caída del VPS. No crear un reloj a cero ni conectar otro
autosave contra el mismo mundo. La pausa offline ya acordada se conserva.

La reutilización de GameHost/M5 y el descarte por portabilidad de los candidatos Unreal se documentan
en el contrato. Fuentes Unreal intactas; ninguna UI o arte nuevos.
