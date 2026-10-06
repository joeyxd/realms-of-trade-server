# D09f-2b.2 — swallow durable y efecto ECS en tick

Base `d7398d8`, 2026-10-05. [Brief/reutilización](../briefs/m5-pearl-swallow-staging.md).
Resultado server-only dormant, sobre CAS 006 existente. [Evidencia aislada](d09f-swallow-staging-evidence.json).

## Resultado

`PearlStaging.swallow` prepara un UID gestionado bag→swallowed vacío usando el helper de gameplay real
sobre un perfil y una fila ECS separados. La cuenta/entidad/kind se resuelven desde autoridad del servidor;
UUID una vez, generación positiva. Rechaza reemplazo, otra perla swallowed, invitados y UIDs no gestionados.

Give y swallow usan la misma secuencia de reserva común → baseline CAS → request congelado → diario →
commit ground → cierre de diario → finalización pendiente. Una Promise nunca modifica World. Reserva
de gameplay mantiene cuenta/UID protegidos incluso cuando la cola storage ya liberó sus lanes.

`drain()` síncrono comprueba sesión/perfil/ECS.clientId, vida, ledger, slots, versión confirmada y lanes.
Actualiza solo pearls sobre progreso vivo; no reemplaza un perfil completo ni copia el ECS de preflight.
La elegibilidad transitoria de calma se acepta al comando, como give: combate posterior puede continuar;
death/close/despawn/recycle exige invalidación sticky y fence, incluso si revive antes del drain.

`pearlEcsEffect.mjs` crea una fila numérica separada con buffers del constructor real para conservar la
conversión tipada. Lee otras filas para calma pero rechaza sus escrituras; `brain` no comparte objetos.
En apply prepara desde el estado actual los resets G/agua y `refreshStats` real. HP conserva fracción,
guard conserva la regla de cap actual, gear/mastery/loadout usan progreso actual y el resto de columnas
(movimiento, ataques, casts, otros cooldowns) siguen avanzados. Verifica filas/referencias antes de escribir.

El evento privado único `pearlChanged(op=swallow)` se decora con `elem` posterior en un buffer separado.
Solo después de apply y enqueue de save entra en eventos vivos. Verificaciones de perfil/ledger tras
decoración y perfil tras enqueue detectan callbacks que cambien autoridad. Un error revierte perfil,
ledger, columnas ECS escritas, dirty y eventos **solo si comenzó el apply local**, y cerca sin repetirlo.
No revierte el commit durable. Lectura/reconciliación posterior no autoriza una aplicación histórica.

Los tres resets se reproducen en este adaptador para conservar archivos sim con su dueño D08. Paridad
con `swallowPearl` para los cuatro kinds comprueba el efecto completo. Extraer un efecto compartido con
ese dueño es requisito del parche de integración; el informe no afirma que ya exista tal extracción.

## Evidencia

**356/356** pruebas pertinentes, **50 nuevas**, 23 archivos, concurrencia 2. Git archive de `d7398d8`
más cinco archivos propios de código/tests, junction de dependencias local, sin env. JSON conserva
comando, counts y hashes LF de archivos propios y módulos compartidos intactos; log completo ignorado.

- Cero cambio en World mientras commit o cierre del diario esperan; reserva común dura hasta apply.
  Una cuenta/UID, bag restante ordenado, mismo ledger local, sin drops/RNG ni publicación anticipada.
- Paridad del helper en Brasa/Escarcha/Tormenta/Tinta con progreso/gear/mastery/HP/stamina/cooldowns
  actuales; movimiento y combate avanzados conservados. Saves previos/posteriores y comando mutable.
- CAS atrasado, respuesta perdida dos veces y recuperación por recibo exacto; muerte/revival, close,
  identidad reciclada y bypass cercados. Error de evento/enqueue/release restaura todas las columnas.
  Cambios externos antes de iniciar apply se conservan al cercar; no se deshacen como si fueran propios.
- SDK sobre PostgreSQL embebido aplica 001–006: cambio+recibo+diario, progreso posterior guardado,
  generaciones una vez, holder/tombstone conservados, cero recibo hijo 003; retries sin segundo efecto.
- Autoridad nueva de sesiones/World sobre la misma DB carga swallowed/elem actuales sin otro commit ni
  evento histórico. Es reconstrucción en el mismo proceso de test, **no restart real de GameHost**.
  La regresión conserva además los seis procesos SQL/diario del corte anterior.

Revisión GPT-6 Luna de solo lectura; arquitectura, cambios y aceptación verificados por principal.
Sin Supabase live, jugadores existentes, browser, versión/protocolo/env ni host/reinicio/publicación.
No modifica ni acepta código naval/LocalServer/sim del otro dueño; se incluye su base commiteada intacta.

## Continuación

No hay nueva SQL en este corte. **006 sigue pendiente de confirmación/aplicación/verificación en Supabase**;
no repetir 003–005 ni cambiar env. Staging continúa sin imports en host/LocalServer y no activa gameplay.

Siguiente corte propio: lote atómico real de varios UIDs para death/reemplazo, con CAS de perfil/ledger/
ubicaciones/recibo y diario. Gate multi-UID actual no hace esa transacción. En paralelo, acordar escritor
único para efecto común y [hooks completos](../briefs/m5-pearl-common-gate.md); restauración de World,
scope/namespace, reloj, adopción/invitados y leases preceden activación. P4/P6 siguen parciales.
