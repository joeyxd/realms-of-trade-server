# M5 / D09f-2b.37 — retorno persistente de perlas

Objetivo: relocalizar una perla proyectada cuyo plazo ya venció, conservar UID y semántica de
returnPearl, y confirmar la ubicación antes de publicar suelo/RNG/eventos. Base 7a6be456ed5e408e682c2dc28385c658f0d03a3f.

## Autoridad y aceptación

- Selector trusted exacto {dropId}; cuenta, UID, tipo, reloj, versión, destino y UUID no vienen del cliente.
- Requiere GroundDeadlineClock auténtico del mismo mundo y fuente con marker válido. Plazo estricto:
  clock.at(tick) > ground.returnAt; en igualdad todavía puede recogerse.
- Reserva exacta de un UID para la cola ground-only, más claim local compartido del World durante
  captura/I/O/apply. El caller retiene el tick completo: esta clase no pausa ni monta el host.
- Capturar RNG/allocator/fuente/terreno y ejecutar helper real detached. Un destino/request/recibo
  privados; la respuesta perdida repite exactamente UUID y destino, sin otra búsqueda.
- World intacto hasta drain. Apply reversible cambia suelo, ledger, allocator, RNG y eventos al final;
  rollback conserva orden de drops, identidad/marker fuente y RNG original. Error deja fence sticky.
- SDK/SQL001–013: leave → retorno → replay → checkpoint → World0/startup → destino único → pickup.
  Segundo caso: reply perdido y fallo de decoración local, recuperación del destino sin RNG/eventos antiguos.

## Reutilización y límites

Inventario Unreal/FAB verificado read-only: BP_InventoryComponent 24.878.603 bytes,
BP_MainPickupClass 370.913, BP_PickupComponent 586.537 y SM_Potion 117.402. Son referencias de
organización/pickup o visual de poción; no implementan reloj/SQL ni proporcionan arte de perla.
Reutilizar returnPearl, mulberry32, sesiones/gate/ground/journal/reloj/hidratación/SDK existentes;
cero assets nuevos, fuentes Unreal intactas. Metadatos no prueban portabilidad ni semántica Blueprint.

No decidir política offline sin respuesta del autor. Dominio legacy, atomicidad reloj/gameplay/crash,
leases, venta/oro, afinidad permanente, finalizador y montaje host siguen separados. Sin migración,
env, protocolo, defaults, SQL live, publicación o reinicio. Un claim local no es lease ni RNG durable
entre procesos. Evidencia en [entrega](../delivery/d09f-pearl-return-staging.md).
