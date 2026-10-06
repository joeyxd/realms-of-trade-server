# D09f-2b.1 — tragar una perla gestionada con recibo durable

Dueño M5: server/SQL/DTO/cola/diario y pruebas aisladas. LocalServer/sim/host/cliente/protocolo
permanecen con su dueño de gameplay; no activar una ruta mientras otras ignoren la reserva común.

## Contrato del corte

Ampliar la familia `ground` existente: `from === to !== null` representa exclusivamente mover un UID
gestionado de bag a un swallowed vacío en **un** perfil CAS. No hay reemplazo, salida al suelo, mint,
crédito de oro ni cambio de progreso. Conservar orden y contenido del resto de la mochila, el dueño,
kind, mundo y `since`; incrementar una vez perfil/ledger/tombstone y guardar el recibo en la misma
transacción. Un UID 003 gestionado sin ubicación puede adquirir un tombstone de perfil en su scope.

La cola deduplica la cuenta, drena guardados previos, congela el request, prepara el diario y rebasa
progreso posterior. Usa las reservas/permisos y recuperación de la familia ground; reintentar el UUID
devuelve el recibo sin repetir el efecto. Las lecturas de recuperación comparan estado actual, sin
publicar historia ni habilitar apply tardío. La migración 006 amplía 004/005 sin editar las aplicadas.

Pruebas: memoria, SDK sobre PostgreSQL embebido, permisos/RLS, CAS de perfil/UID, conservación exacta,
UUID compartido, rollback íntegro, guards diferidos, reintentos/respuestas perdidas, diario/recuperación,
guardados anteriores/posteriores y reserva común. No requiere credenciales ni llamadas al proyecto real.

## Reutilización revisada antes de implementar

`actionrpg/FINDINGS.md` y candidatos `BP_InventoryComponent` (`EquipItemBySlot`, `DeepFindItemByUID`),
`ServerSlotInfoArray` y `BP_JigServerSave`: referencias de slot/UID/guardado, sin código Node portable
ni evidencia de CAS/recibo. Se reutilizan `sanitizeProfile`, DTO ground, cola, diario y guards de 003/004.
No nuevos assets, exportación ni cambios a las fuentes Unreal. La regla actual `swallowPearl` exige
calma y confirmación para reemplazo; storage no decide elegibilidad y este corte excluye reemplazo.

## Después de este corte

Staging del efecto ECS (`refreshStats`, cooldowns, agua) con elegibilidad real y apply de tick; contrato
atómico de varios UIDs para death/reemplazo; hooks completos con dueño de gameplay; hidratación de World,
scope/reloj/adopción/invitados y leases según sus decisiones. El recibo de storage solo no activa M5 P4/P6.
