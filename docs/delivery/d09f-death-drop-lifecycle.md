# D09f-2b.26 — recogida y expiración durable de botín ordinario

Implementado y aceptado localmente sobre 14510ff. Objetos/pociones de muerte tienen estado actual
separado de su creación histórica. Pickup confirma inventario y retirada del suelo junto con un recibo;
expiry confirma una retirada terminal. Reintentos exactos no entregan el botín otra vez ni revierten
progreso posterior. Reglas de perlas y muerte existentes quedan conservadas.

[Contrato y límites](../briefs/m5-death-drop-lifecycle.md).
[Evidencia fija y hashes](d09f-death-drop-lifecycle-evidence.json).

## Implementación

SQL011 añade estados ground/picked/expired y recibos de transición, solo service_role. Cada UUID queda
excluido de familias anteriores e intenciones, también por insert/update directos. Locks/CAS verifican
perfil completo y fuente; triggers y checks diferidos impiden resultados parciales o fuera de ventana.
Después de un fallo en la escritura del estado, el perfil previamente actualizado también se revierte.

Objetos públicos reciben un nuevo UID del receptor, incluso al recuperar equipo propio; orden de bolsa
y campos del objeto quedan conservados. Capacidad 24 objetos/5 pociones. Pickup es inclusivo hasta
expiresAt y expiry requiere superarlo. Oro, XP, maestría/perlas no cambian por esta operación.

loadDeathDrop/listCurrentDeathDrops devuelven estado actual y solo filas ground; listDeathDrops
conserva historia completa. Un drop nuevo de SQL009 recibe ground/version 1 en la transacción de muerte.
Filas anteriores a SQL011 quedan fuera del suelo actual: podrían haberse recogido antes sin registro de
retirada. Replay y reapply no las adoptan ni reabren estados terminales. No hay backfill silencioso.

Memoria/Supabase exponen commitDeathDrop y loadDeathDropOperation con DTO/resultado/lecturas estrictos.
No se modifica schema de perfil, protocolo, CLI ni sim. La nueva familia todavía no entra al journal/cola.

## Verificación

**1430/1430**, **111 archivos**, sin fallos/canceladas/skipped/todo, Node v24.14.0. **54 nuevas**.
Network 2/2, concurrency 1: 6818.2697 ms. Core 1428/1428, concurrency 2: 144677.2971 ms.
Total 151495.5668 ms. **362 fuentes** LF SHA-256 verificadas antes/después: 361 del repositorio y
three.module.js de la copia privada de Three. SQL001–011 local, reapply011 y upgrade de historia previa.

Casos: delta/UID/orden/capacidad, CAS y baseline exacto, metadatos, ventanas, terminal version 2,
UUIDs/RLS/escrituras directas, rechazo de éxito imposible del proveedor, páginas actuales, replay con
progreso, reapply sin reapertura y rollback después de actualizar perfil. La expiración directa con
resultado completo falsificado falla específicamente el check diferido de ventana (MNP01).
Dos procesos Node independientes reabren PGlite en disco tras respuesta de pickup perdida; perfiles,
recibos y estados picked/expired sobreviven y no se listan como suelo.

Revisión acotada independiente más revisión del principal; se corrigieron paridad de terminal CAS y
una prueba SQL que podía rechazar por sintaxis de múltiples statements en vez de por la ventana.
Three 0.160.0 privado: 954 archivos verificados; PGlite 0.5.8 y SDK 2.117.2 por versión.
Las demás dependencias son junctions y no se afirma hash completo. PGlite serializa consultas;
no acredita contención real de conexiones PostgreSQL independientes. Las fuentes aceptadas usan el
protocolo fijo 19; el checkout compartido tiene trabajo ajeno concurrente.

Comprobación focalizada en el checkout compartido: **54/54**, 15851.6821 ms; 105 fuentes relevantes
estables durante el proceso. Solo 15 rutas propias integradas, todas antes iguales a HEAD o ausentes.
No acepta por extensión el resto del trabajo naval/chat/recursos/arte concurrente.

## Continuidad

Aplicar [SQL011](../../server/migrations/011_death_drop_lifecycle.sql) después de 001–010.
SQL010 está aplicada según el autor; SQL011 aún no tiene aceptación en Supabase real.
Este corte acepta almacenamiento y lectura tras restart, no restauración de World ni pickup del host.
Sigue diario/reservas/reconciliación, staging/apply en tick y hooks, hidratación con reloj estable,
ensamblaje del piloto y restart/reconexión de extremo a extremo. Afinidad permanente y su escalado
siguen abiertos. Sin env, canario externo, push/deploy ni reinicio del servidor; trabajo paralelo conservado.
