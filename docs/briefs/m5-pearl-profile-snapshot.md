# D09f-2b.14 — captura canónica de progreso para staging

El perfil conserva inventario, oro, equipo, maestrías y tatuajes; nivel, XP, pociones y checkpoint pueden
estar más recientes en ECS. Guardar una copia del perfil sin leer esas columnas puede dejar un
baseline CAS viejo y perder progreso al confirmar una perla.

## Contrato

`capturePearlProfile(world, entity)` reutiliza `syncProfile` sobre un perfil separado. Captura únicamente
sus cuatro campos existentes (`lvl`, `xp`, `pot`, `cp`), con el redondeo/checkpoint actuales. Devuelve
objetos separados; no cambia perfiles/ECS/dirty/eventos/ledger/drops/RNG ni publica o guarda. Perfil o
progreso ECS no canónico falla; no se clampa ni se resetea silenciosamente el baseline.

`PearlStaging(..., { captureProfile: (clientId, entity) => ... })` acepta un adapter trusted síncrono,
read-only, configurado una vez. Solo recibe selectores del endpoint validado. El resultado debe ser
canónico e idéntico al perfil vivo salvo los cuatro campos anteriores: no puede sustituir inventario,
identidad, oro, equipo o aprendizaje. Promise/thenable, reentrada de comandos/save/drain/enqueue o una
mutación del perfil durante la captura se rechazan. Un rechazo accidental de Promise se consume.

- Tras elegibilidad/reserva y antes de programar cualquier Promise, captura cada baseline. Los guardados
  anteriores drenan como antes y el builder usa la versión CAS resultante. No vuelve a leer ECS desde
  continuaciones async. Si la captura falla sin invalidación, libera la reserva sin registrar/enviar
  trabajo; si la identidad fue invalidada, conserva fence para reconstrucción de autoridad.
- En `drain`, verifica lifecycle/ledger/recibo, vuelve a capturar el progreso actual y compone el delta
  confirmado de `pearls`. Aplica los cuatro campos al mismo objeto vivo junto a ese delta, conserva
  referencias de los demás campos y encola el save CAS antes de liberar. Los efectos de stats/HP siguen
  la regla compartida; no cambia reglas de poderes ni vuelve a comprobar la elegibilidad tras commit.
- Fallo de captura tras recibo cerca sin escrituras locales. Fallo durante apply revierte sus cuatro
  campos/slots/ECS/drop/ledger/eventos propios y conserva fence; no revierte SQL ni reintenta el efecto.
- `staging.save` reservado acepta el snapshot separado canónico, difiere su escritura y captura lo más
  reciente en apply. Un snapshot obsoleto distinto se rechaza. No publica el inventario anterior.

Sin adapter (`captureProfile=null`, default), conserva el contrato previo de autoridad del perfil y
su baseline desde el perfil vivo en la tarea async. Los fixtures/consumidores anteriores no se migran
silenciosamente a autoridad ECS. Tampoco se añade un campo nuevo de afinidad.

## Puente del host y límites

`GameHost.capturePearlProfile(id, entity)` comprueba cliente actual, sesión/cuenta activa y propiedad
`account:<key>` antes de usar el helper. Puede leer una cuenta reservada: esta lectura no autoriza
mutaciones ni publicación. No acepta huéspedes, identidad legacy ni selectores de otra conexión.
Los tests inyectan explícitamente este adapter y `beforeTick`; GameHost todavía no construye staging/
startup, configura diario o despacha comandos durables automáticamente.

La captura protege el dato enviado, no convierte el progreso posterior al recibo en parte de ese
recibo. El save de apply es un CAS posterior normal; un crash antes de completarlo puede perder ese
último progreso. Finalizador durable/muerte completa siguen pendientes. Un callback trusted que escribe
fuera de su contrato no tiene rollback genérico; invalidaciones conservan fence, nunca conceden apply.

No cambia SQL/env, perfil/snapshot/you/EVENT, protocolo 16, tasas de XP, curva de afinidad ni poder.
Scope/namespace/reloj/adopción, epoch de inputs, integración automática del host y leases siguen abiertos.

## Reutilización y aceptación

Inventario Unreal/FAB cruzado y dos candidatos concretos comprobados de solo lectura:
BP_JigServerSave (580.554 B), BP_InventoryComponent (24.878.603 B). Son referencias de inventario/guardado;
no aportan ejecución Node/CAS. Se reutilizan `syncProfile`, DTOs, cola, gate y apply del repo sin importar
assets ni modificar Unreal.

Cubrir baseline anterior a await, progreso nuevo en apply, transferencias sin prestar aprendizaje,
reemplazo con ground/RNG congelados, save separado, invalidez/Promise/reentrada, rollback y lifecycle.
Memoria, SDK con SQL006/008 local y adapter del GameHost real durante pausa. Regresión desde `d47353b`
con cuatro overlays propios, excluyendo trabajo naval/visual paralelo.

[Mapa común](m5-pearl-common-gate.md), [frontera de apply](m5-pearl-tick-apply.md),
[afinidad pendiente](m48-pearl-affinity.md), [entrega](../delivery/d09f-pearl-profile-snapshot.md).
