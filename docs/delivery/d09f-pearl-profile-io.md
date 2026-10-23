# D09f-2b.10 — perfiles y guardados protegidos en el host

2026-10-06. Base congelada `8f5a50a9fc8a45e90e1ba8d6aafb8f78ddbea4a8` más tres archivos propios.
[Contrato](../briefs/m5-pearl-profile-io.md), [evidencia reproducible](d09f-pearl-profile-io-evidence.json).

## Resultado

GameHost consulta la autoridad común antes de sincronizar/publicar perfiles o guardar snapshots.
Cuenta desde sesión autenticada; UIDs desde inventario y ledger asociados a la entidad actual, incluidos
invitados. Busy conserva dirty, profT, saveAt y blob; la revisión existente puede reintentar con el estado
actual cuando la lane queda disponible. Campos de identidad enviados por el cliente no cambian la cuenta.
Worker sin hooks conserva su flujo. Los snapshots ECS de movimiento/combate y ACK continúan; no llevan
inventario de perfil, UIDs de perla, blobs o recibos. PROTOCOL_VERSION permanece 16.

Desconexión invalida cuenta/UID antes del detach. Si el snapshot final está bloqueado, se conserva una
copia privada aislada con el progreso ECS final; no se guarda ni se combina con un recibo. El host
detiene sim/admisión, health deja de estar disponible y close reporta flush fallido. Status solo expone
storage.unsaved. La copia es memoria de recuperación local, **no un guardado durable**: terminar el
proceso puede perder ese último progreso. El finalizador durable sigue pendiente; no se promete cierre
conservador completo ni auto-resume a partir de la copia con inventario anterior.

## Verificación

**786/786 checks pertinentes**, **17 nuevas**, 60 archivos; cero fallos,
cancelaciones, skips o TODO. Node v24.14.0, concurrency 2; 69826.7965 ms.
Archivo Git fijo, overlay de solo host/LocalServer/test propio, junction de dependencias, sin .env.
175 fuentes con SHA-256 normalizado LF comprobadas antes/después.
Comando, lista exacta, fuentes y SHA del log están en el JSON; log local ignorado: `shots/review/m5-pearl-profile-io-accept.log`.

- Cuenta, UID de inventario y UID presente solo en ledger bloquean antes de sync; estado/scheduling
  intactos y reintento posterior. Queue busy, datos falsos de cliente e invitados con HMAC cubiertos.
- Snapshots/ACK del jugador afectado y perfil del otro jugador continúan. onSave false/throw y fallo
  de publicación no anticipan consumo del scheduling/blob. Hooks accidentales async se rechazan.
- Staging real manual: commit confirmado con respuesta pausada; queue libera su lane y el gate sigue
  bloqueando PROFILE/SAVE hasta drain explícito. Después, publicación/guardado conservan oro, mastery
  de arma y XP ECS actuales; receipt/generación/evento de swallow no se duplican. No acredita afinidad.
- Cierre con reserva retiene copia aislada, invalida antes de Map.delete, deniega nuevas conexiones y
  falla flush sin write contradictorio. Cierre real después de commit con recibo tardío no aplica ni
  publica éxito; inventario durable confirmado conserva su generación. El último progreso queda
  explícitamente sin garantía durable. Cierre normal guarda el estado final como antes.
- Regresión de combate/sim/Worker/perfiles/cuentas/host, inventario/mercado/producción y rutas de
  gate/queue/staging/startup en memoria. Las pruebas existentes de host incluyen WebSockets reales
  locales y restauración en otra instancia; no son aceptación de restart del nuevo gameplay durable.

No se repitieron SQL, canarios Supabase, procesos de recuperación durable ni navegador/GPU: adaptadores,
migraciones y diario no cambian. No es la suite completa del repo ni se suman los 814 checks anteriores
como ejecutados en este corte. Antes de aceptar, revisar source/log/contrato y preservar trabajo ajeno.

## Reutilización y siguiente corte

Inventario Unreal/FAB revisado y candidatos BP_JigServerSave (580.554 B) y BP_InventoryComponent
(24.878.603 B) re-verificados de solo lectura. Referencia Blueprint sin autoridad Node/CAS portable;
se reutilizan gate, sesiones, staging, syncProfile y scheduling. Ningún asset importado/modificado.

Sin SQL/env nueva, cambios de perfil/protocolo, despliegue, reinicio del servicio o consulta Supabase.
El host ya tiene guards de salida/desconexión; **no conecta todavía comandos durables de perla**, startup
ni apply automático de staging en el tick. Siguen hooks de mutación/autónomos, orden del snapshot
canónico/apply, scope/reloj/adopción, finalización durable y muerte completa con equipo/oro/mundo.
Afinidad permanente por personaje/tipo y familias animal/cuerpo elemental continúan como cortes
posteriores. P4/P6 siguen parciales, una autoridad por mundo hasta leases.
