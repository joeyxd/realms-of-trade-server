# D09f — SQL007 y recibos de lote verificados en Supabase

2026-10-06. Fuente de storage `85f2010`, comprobada contra `fa226d2`; el autor aplicó SQL007.
[Contrato de storage](../briefs/m5-pearl-batch.md), [evidencia](d09f-pearl-batch-live-evidence.json).

## Resultado

**31/31 comprobaciones reales**, SDK/Supabase y cuatro procesos Node nuevos:
prepare → recover → verify → cleanup. Scope sintético
`canary-batch-088ff7ac-e38d-4629-849f-f10ec51aeabb`.
Dos perfiles nuevos, trece UIDs gestionados, sin usuarios Auth ni jugadores/mundos existentes.
Fixtures de juego eliminadas y ausencia verificada; una intención 005 terminal `rejected`
retenida como auditoría de la prueba de exclusión de familias.

- Muerte de nueve perlas (bolsa llena + tragada), con generaciones independientes 1/2/3
  después de reemplazar y recuperar una. Un CAS de perfil y cada UID/ubicación avanzan una vez.
- Reemplazo de dos UIDs 003 gestionados sin ubicación previa: entrante sigue con el personaje,
  saliente pasa al suelo; el resto de bolsa conserva orden, holder, generación y ausencia de ubicación.
- Timestamps `since` conservados para quien sigue con el dueño y eliminados al caer al suelo.
  Metadatos de posición/tiempo confirmados tal como los aporta el caller.
- CAS de perfil/último UID, dueño/tipo/mundo incorrectos, muerte parcial, oro/XP/maestría
  alterados, orden restante y metadata incorrectos rechazan todo el lote. Estado y recibos intactos.
- El segundo commit real se confirma y su respuesta se descarta deliberadamente en el adaptador SDK.
  Otro proceso lee el recibo exacto sin enviar mutaciones durante esa comprobación.
  Esto simula una respuesta perdida después de confirmar, no una caída real del proveedor.
- Replay exacto y payload distinto con el mismo UUID; ningún segundo avance de CAS/UID/suelo.
  Progreso posterior conserva su XP y versión; recoger por 004 una perla caída no se revierte
  al repetir el recibo histórico de muerte.
- Exclusión simétrica con 003/004/005, incluidos INSERT directos de recibos antiguos.
  Los recibos 004 conservan sus hijos 003 legítimos; el lote no crea esos hijos.
- Clave pública: commit, lectura del recibo, validador y tabla batch denegados con `42501`.
  La rama authenticated se cubre en la aceptación SQL local previa; no se creó un usuario real.

## Runner y aceptación local

[tools/verify-pearl-batch.mjs](../../tools/verify-pearl-batch.mjs) requiere `--live`.
Valida fase, ruta real, manifiesto de UUIDs disjuntos y nombres exactos antes de credenciales.
Reconstituye los perfiles/UIDs/requests desde sus IDs; verifica ausencia de cada fila y suelo del scope
antes de sembrar. Nunca imprime claves, cuerpos/mensajes del proveedor ni stderr de procesos hijos.
Logs/evidencia local por token con `wx`, sin sustituir corridas anteriores.

Cleanup comprueba el estado final completo, incluidos recibos 003/004/007 e intención 005, y congela
un plan exacto antes del primer borrado. Cada DELETE filtra todos los campos de la fila: contenido del
recibo, versión/propietario/timestamp del ledger o JSON/versión del perfil. Una fila cambiada se conserva.
El ledger elimina su ubicación por el cascade existente; sus guards mantienen la misma generación.
Una respuesta DELETE perdida admite repetir cleanup: filas exactamente iguales o ya ausentes.
La sintaxis de filtros sigue el [contrato PostgREST](https://postgrest.org/en/stable/references/api/tables_views.html).

Si falla una fase, la ejecución se detiene y retiene el manifiesto/fixtures; no hay borrado automático.
`--phase cleanup-partial <manifest>` permite limpiar explícitamente solo un prefijo exacto de la siembra
anterior al checkpoint `since:null`, incluso si un commit se confirmó antes de persistir el checkpoint.
Una interrupción posterior requiere revisar sus recibos/estado exactos antes de resolverla; esa fase
parcial no promete recuperación general de cualquier punto del canario.

**7/7 pruebas locales del runner final**, SDK/PGlite en archive de `fa226d2` más sus dos archivos,
sin `.env` ni red externa. Incluyen ciclo de 31 checks, perfil ajeno intacto, drift antes de limpiar,
siembra parcial, DELETE confirmado/respuesta perdida/reanudación y junction rechazado antes de escribir.
La revisión Luna encontró dos problemas de recuperación y una guarda de ruta; el principal los corrigió
y verificó con SQL/tests. Un stub de prueba perdió métodos del SDK al copiar su instancia: corregido;
no fue un fallo del RPC. No se repitió la regresión 481/481 de storage porque el runtime no cambió.

Los 26 archivos de runtime seleccionados coinciden con el commit base y no cambiaron durante el live.
El hash del runner ejecutado está separado del runner final: después del live se añadieron guardas de
ruta real antes de crear el manifiesto/leerlo, y se aceptaron las siete pruebas locales de esa versión.
No hubo otro canario remoto ni cambios al comportamiento de los commits tras esas guardas.

## Alcance y siguiente

**SQL007 real aceptada como almacenamiento de perlas.** No conecta lote a diario/cola/ProfileSessions,
staging/tick, host, LocalServer ni cliente. No representa reinicio de GameHost, gameplay durable activo,
deploy, pruebas visuales, carreras forzadas entre backends independientes o leases multi-host.
La muerte completa todavía afecta equipo/oro/mundo fuera de este contrato.

Afinidad permanente sigue confirmada por personaje/tipo, pendiente de defaults/saneado/crédito/poder/UI.
La conservación de XP/maestrías no equivale a una afinidad implementada.
Siguiente corte: [diario, reservas y recuperación del lote](../briefs/m5-pearl-batch-journal.md), luego staging
de muerte/reemplazo y hooks/restauración con dueño exclusivo de sim/host. P4/P6 conservan gates abiertos.

Reutilización acotada: revisados `actionrpg/FINDINGS.md` y rutas concretas intactas de
`BP_InventoryComponent` (24.878.603 B), `ServerSlotInfoArray` (7.212 B), `BP_JigServerSave` (580.554 B).
Referencias Blueprint de UID/slots/save, sin transacción/recibo Node portable. Reutilizados SDK, DTO/guards
y patrón de canario 006 propios; ninguna exportación, nuevo arte o modificación en `C:\Unreal`.
