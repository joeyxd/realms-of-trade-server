# D09f — aceptación real del commit same-holder de SQL 006

006 ya fue aplicada por el autor y sus validadores pasaron 6/6 probes de solo lectura. Este corte
comprueba la transacción nueva con SDK/Supabase y recuperación de ProfileSessions entre procesos
Node independientes. Es una prueba de almacenamiento; no conecta staging al host ni al juego.

## Alcance y fixture

`node tools/verify-pearl-same-holder.mjs --live` usa credenciales del servidor únicamente después
de validar fase y manifest local. Genera dos perfiles sintéticos, cuatro UIDs `canary-swallow-*`
y UUIDs distintos. Verifica ausencia de todos los IDs exactos antes de escribir. No crea usuarios
Auth, ni lee/modifica jugadores existentes, economía mundial o estado del host.

Un perfil tiene tres perlas gestionadas con tombstones; el otro tiene un UID gestionado 003 sin
ubicación previa. En cada uno se prueba bag→swallowed vacío con un solo endpoint: conserva dueño,
`since`, progreso y orden restante; avanza una vez perfil/UID/ubicación y conserva recibo ground.
No genera recibo hijo 003 para swallow. No implementa afinidad ni concede aprendizaje sintético.

Rechazos por oro indebido, versiones de perfil/UID incorrectas, mundo/kind incorrectos y reordenar la mochila deben
dejar perfiles/ledger/ubicaciones y recibos intactos. Repetir el UUID exacto devuelve el recibo;
el mismo UUID con otro payload se rechaza. Un recibo histórico no retrocede progreso posterior.

Preparar→confirmar→salir sin cerrar diario simula pérdida del resultado del proceso. Otro proceso
recupera ese commit solo leyendo y conserva otro request preparado sin envío. Reanudarlo explícitamente
envía su solicitud exacta una vez. Un tercer proceso carga estado actual sin dispatch; cliente público
no puede ejecutar el RPC. No equivale a restart de GameHost ni prueba concurrencia multi-host/leases.

Solo tras completar verificación y cerrar ambos journals se eliminan los IDs sintéticos enumerados:
recibos, ledger/ubicaciones y perfiles. Se retienen dos auditorías terminales inmutables. Cualquier fallo
conserva manifest/estado exactos para recuperación; no se inicia limpieza de una operación pendiente.
Salida estructurada sin mensajes/cuerpos de errores de proveedor ni credenciales.

## Reutilización revisada

Se revisó `actionrpg/FINDINGS.md` y se comprobó existencia de `BP_InventoryComponent`,
`ServerSlotInfoArray` y `BP_JigServerSave` en ActionRPGMultiplayerStart. Son paquetes Blueprint,
sin código Node portable ni aceptación equivalente de CAS/recibos. Se reutilizan SDK/store/diario,
ProfileSessions y el patrón de fases del canario D09e; no se repite inventario ni se exporta arte.
Fuentes Unreal intactas, sin assets nuevos ni cambios de sim/cliente/protocolo/host.

## Después

Lotes atómicos de varios UIDs para muerte/reemplazo, efecto común con sim, todos los hooks de reserva,
restauración/scope/reloj/adopción y leases según decisiones pendientes. La afinidad permanente confirmada
en [su contrato](m48-pearl-affinity.md) requiere defaults/saneado/crédito/escalado/UI y pruebas propias.
