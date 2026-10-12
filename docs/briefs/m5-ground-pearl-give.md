# AREA15 — regalar una perla con el recibo común

Contrato previo a implementación, 2026-10-12. Siguiente corte de
[M5](../../PLAN-M5.md) y de [leave](m5-ground-pearl-leave.md).
Estado: **implementado bajo montaje común explícito; piloto público apagado**.
[Entrega y evidencia](../delivery/m5-ground-pearl-give.md). El contrato siguiente conserva los criterios del corte.

## Procedencia y resultado

Continúa [el staging de entrega](m5-pearl-game-staging.md), la
[selección gestionada](m5-pearl-managed-request.md), el
[acceso a comandos](m5-pearl-command-access.md) y el sobre
[SQL018](m5-ground-transactions.md)/[diario SQL019](m5-ground-transaction-journal.md).
El staging aislado ya tiene give; falta componerlo con el dueño común, no crear
un segundo coordinador activo en el mismo host.

Regla del autor registrada en M5/M4.8: regalar solo una perla del inventario
`pearls.bag` del dueño. **Give es gratuito**. La perla tragada queda ligada hasta
morir. La compraventa entre jugadores es otra entrega: precio/pago y propiedad
deben confirmarse juntos; NPC sigue sin comprar perlas.

Resultado esperado: dos cuentas autenticadas, conectadas al mismo mundo, pueden
entregar un UID de bolsa con las reglas actuales de `transferPearl`: entidades
distintas, vivas, en calma, distancia permitida y capacidad de bolsa receptora.
Conservar esas reglas ejecutándolas en una vista separada. No cambia el balance,
el límite de bolsa ni el formato de la perla; no transfiere afinidad del personaje.

## Frontera de autoridad

El socket selecciona UID y entidad receptora. El servidor resuelve ambos endpoints
actuales, cuentas, kind, versión de perfiles y generación durable. No admite
holder, precio, snapshots, UUID de recibo o generación elegidos por el cliente.
Rechazar self, invitado/no admitido, destino desconectado/reciclado y UID tragado,
ajeno, duplicado o ausente antes de preparar el efecto.

El único dueño común reserva **las dos cuentas y todos sus UIDs capturados** antes
del primer await. Asienta progreso ECS/autosaves previos de ambos perfiles dentro
de esa reserva. Congela el candidato/UUID una vez; contrasta ledger y ubicación
actuales con el origen y generación elegidos bajo reserva. No usa generación 1
como supuesto, ni acepta una ubicación de otro mundo o un UID aún en suelo.

Preparar no quita ni otorga perla, cambia oro/XP, publica eventos o confirma éxito.
La promesa de almacenamiento prepara una finalización; apply es síncrono, bajo el
único límite de tick, después del recibo confirmado. Revalidar identidades,
referencias de hooks/dueño, versiones y baseline de ambos participantes.

## Transacción y aplicación

Reutilizar familia `ground` con `from=cuentaOrigen`, `to=cuentaDestino`,
`ground:null`, ambos perfiles CAS ordenados por cuenta y la generación actual.
SQL004 confirma perfiles/UID/ubicación; SQL018 añade mundo/reloj y SQL019 conserva
la petición exacta. La ubicación sigue siendo tombstone de suelo, con generación
nueva. **No se prevé SQL nuevo**; comprobar la cadena instalada y su contrato real
antes de cambiar esa conclusión durante implementación.

El apply instala juntos ambas bolsas y metadatos confirmados de sesión, ledger,
dirty flags y eventos existentes `pearlChanged(give)`/`pickup`. Verifica que
ningún otro campo, UID, drop, asignador o RNG cambió. Un fallo de la segunda
escritura/evento debe poder restaurar toda la proyección local y cercar el host;
nunca deshacer SQL ni completar después sobre una entidad nueva.

Desconexión, muerte, cierre, pérdida de callback, deriva o respuesta incierta
mantienen el cerco/reserva hasta resolución segura. Recuperación reenvía solo el
mismo UUID/request y carga perfiles/ledger/ubicación actuales. Un recibo histórico
no restaura perfiles antiguos ni reemite la entrega.

## Aceptación necesaria

1. Planner y comando real: entrega de bolsa válida; tragada/ajena/self/far/combat/full/
   invitado/destino reciclado rechazados sin mutar. El montaje ausente conserva su ruta actual.
2. Reserva antes de IO de ambas cuentas/UIDs; progreso anterior de ambos conservado;
   CAS de dos perfiles, holder, generación, tombstone, mundo/reloj y recibo coherentes.
3. Commit retenido: cero éxito antes de drain; apply único. Dos entregas que compiten
   por UID/cuenta no pueden ganar. Respuesta perdida y reintento exacto no duplican.
4. Rollback/fence por fallo en segunda sesión o evento, deriva de cualquiera de los
   participantes, muerte/desconexión/cierre y callback reemplazado o nulo.
5. Dos SIGKILL con PGlite persistido: tras preparar intención y tras commit antes
   de apply. Reabrir sin migraciones; un dueño actual, una copia, cero eventos
   históricos. Entregar luego desde el nuevo dueño prueba generación posterior.
6. Regresión pertinente de leave/pickup/retorno/mint/muerte, economía/recursos,
   Carga/necesidades/comidas y gates GM/compañeros. Registrar fuentes/conteos sin sumar solapamientos.

El corte entrega código probado con montaje común apagado. La composición GM/
compañeros, adopción y canario de reinicio/caída pública son puertas posteriores
de la [matriz](../CONTINUITY-MATRIX.md); no se eliminan exclusiones para aceptar give.

Reutilización: `transferPearl`, PearlStaging como referencia, GroundPearlLeave,
GroundHostAuthority, ProfileSessions y recibos existentes. El inventario
[ActionRPG](../research/unreal-assets/actionrpg/FINDINGS.md) identifica
`BP_InventoryComponent`/`BP_JigServerSave`; son paquetes Blueprint, sin ejecución
Node/Postgres ni ahorro de CAS demostrable. Sin arte nuevo, exportación o cambios
a fuentes Unreal. No requiere UI/protocolo nuevo por el resultado previsto;
revisar ese supuesto si la implementación cambia mensajes/snapshots.
