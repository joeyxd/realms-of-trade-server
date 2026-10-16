# D09f-2b.6 — diario de lotes y ProfileSessions verificados en Supabase

2026-10-06. SQL008 aplicada por el autor; runtime `a9913c6` conservado, checkout de aceptación
`b2b2b1`. [Contrato local](d09f-pearl-batch-journal.md), [evidencia](d09f-pearl-batch-journal-live-evidence.json).

## Resultado

**18/18 comprobaciones reales**, SDK/Supabase y cuatro procesos Node nuevos:
prepare → recover → verify → cleanup. Scope generado
`canary-j8-75aeb5ba-a7a2-414e-8b3f-51d5f0fbe2f5`.
Dos perfiles sintéticos y seis UIDs gestionados; ninguna creación de usuarios Auth.
Fixtures de juego eliminadas y ausencia comprobada. Tres intenciones terminales conservadas:
dos batch `committed` y una ground `rejected`, con los UUIDs en la evidencia.

- Reemplazo de dos UIDs legacy 003 mediante **ProfileSessions, cola compartida y journal batch**.
  Builder una vez; los dos envíos contienen el mismo request concreto. SQL confirma el primero,
  el segundo lee su replay y el adaptador descarta ambas respuestas deliberadamente. También
  simula indisponibilidad de lectura de recibo para mantener la intención y sus reservas pendientes.
  Es una inyección controlada después del commit real, no una caída real de Supabase.
- Intención de muerte de tres UIDs tracked preparada sin enviar. El proceso siguiente reconstruye
  sus tres reservas y la cuenta; comprueba que el recibo sigue ausente y bloquea la admisión.
  En esa misma recuperación, el reemplazo ya confirmado se cierra **sin reenviar el commit**.
- Reanudación explícita de la muerte: un envío del request persistido completo, sin builder nuevo;
  perfil, todos los ledgers y ubicaciones coinciden antes de cerrar el diario y liberar las reservas.
  Un segundo resume ya cerrado se rechaza. El estado terminal exacto sigue siendo idempotente.
- Misma identidad de UUID/scope/request; cambiar geometry o scope se rechaza. Intención batch
  excluye 003/004; recibos 003/004 e intención ground excluyen batch. No hay cambios parciales.
- Un tercer proceso carga solo terminales, sin dispatch. Guarda XP posterior por ProfileSessions,
  recoge una perla de la muerte vía 004 y repite los recibos históricos: no revierte progreso,
  propiedad, suelo ni generaciones. Conserva el timestamp del UID que sigue con el dueño.
- Clave pública: prepare, resolve, list, validador del journal y lectura de su tabla denegados con
  `42501`. La rama authenticated sigue cubierta por SQL local; aquí no se creó una cuenta real.

La muerte máxima de nueve UIDs y generaciones mezcladas ya tiene [aceptación SQL007 real](d09f-pearl-batch-live.md).
Este canario acotado comprueba el nuevo camino de journal/cola; no repite aquel inventario de casos.

## Runner, limpieza y aceptación local

[verify-pearl-batch-journal.mjs](../../tools/verify-pearl-batch-journal.mjs) requiere `--live`.
Valida fase, rutas reales, UUIDs disjuntos, mapa exacto de operaciones y manifiesto derivado antes
de cargar credenciales. Comprueba ausencia de todas sus filas/suelo antes de sembrar. Procesos hijos
ocultos, timeout por petición/fase y salidas limitadas a labels/tipo/código de error; no imprime claves,
mensajes del proveedor ni stderr de hijos. Logs/evidencia únicos por token, creados con `wx`.

El cleanup deriva cada fila esperada desde las fixtures generadas, valida el estado completo y persiste
su plan antes del primer DELETE. Revalida todos los presentes contra ese plan; cada borrado filtra todos
los campos proyectados, incluidos JSON, versión, propietario y timestamp. Verifica la ausencia de cada
fila; los guards/cascade existentes retiran ubicaciones junto al ledger. Respuestas de borrado perdidas
permiten continuar solo con filas exactamente iguales o ausentes. Una fila cambiada se conserva.
Las tres auditorías terminales quedan intactas; después de retirar los recibos, sus requests no pueden
volver a despacharse, aunque prepare exacto siga devolviendo el terminal committed.

Una fase fallida detiene las siguientes y retiene manifiesto/fixtures. No hay cleanup automático ante
incertidumbre. `--phase cleanup-partial <manifest>` admite únicamente un prefijo exacto de siembra
anterior a `since:null`; no promete resolver cualquier interrupción posterior.

**8/8 pruebas nuevas aisladas**, incluyendo cuatro procesos Node reales sobre PGlite durable:
las 18 comprobaciones del runner, perfil ajeno intacto, manifiesto/ruta alterados, junction rechazado
antes de credenciales, drift antes de borrar, siembra parcial y DELETE confirmado/respuesta perdida
con reanudación y repetición. Archive fijo más cuatro archivos propios, dependencia por junction,
sin `.env` ni red externa. Se corrigió un conteo esperado del harness (19 → 18); no cambió runtime/SQL.

Los cuatro archivos del canario y 28 fuentes seleccionadas mantuvieron hashes antes/después de las
pruebas aisladas y del live. El runner ejecutado y el aceptado son la misma versión. No se repitieron
las 579 pruebas del runtime: ya estaban aceptadas y ese runtime no cambió en este corte.

Luna revisó el diseño y el runner; el principal verificó fuente, pruebas y evidencia. Candidatos Unreal
consultados por ruta exacta, intactos: `BP_InventoryComponent` (24.878.603 B), `BP_JigServerSave`
(580.554 B), `S_ServerSave` (20.800 B), `SaveData` (21.213 B), bajo ActionRPG/InventorySystem.
Son Blueprints sin un canario Node portable; se reutilizaron SDK/DTO/journal/cola y las guardas propias.
No hubo inventario completo, exportación de arte ni cambios a las fuentes Unreal.

## Alcance y siguiente

**SQL008 real y recuperación de cola batch aceptadas.** No es un reinicio de GameHost, conexión del
staging/tick al juego, deploy, prueba visual o aceptación de leases/carreras multi-host.
Host, LocalServer, sim, protocolo y SQL001–008 no se editaron. El trabajo paralelo se conservó.
P4/P6 siguen parciales: falta aplicar/publicar el lote en tick y conectar hooks/restauración.

Sigue [staging de reemplazo de dos UIDs](../briefs/m5-pearl-batch-staging.md). La muerte completa todavía
necesita coordinar sus efectos de equipo/oro/mundo; no se habilita parcialmente.
Afinidad permanente sigue acordada por personaje/tipo y pendiente de implementación; conservar
XP/maestrías no equivale a otorgar afinidad, tasas o poderes nuevos. No hace falta otra SQL para este corte.
