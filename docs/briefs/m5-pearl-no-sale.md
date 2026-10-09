# M5 / D09f-2b.38 — perlas encontradas, sin venta a NPC

Base b9d13d465bf24de0a221709be99c00fc7dcf57de. Corrección y aprobación del autor del 2026-10-09.
[Dirección de obtención marina](m48-sea-salvage-direction.md), todavía por implementar.

## Contrato

- La venta de una perla nunca consume el UID, altera su dueño/ubicación, acredita oro, avanza
  RNG/allocator, cambia ECS o marca el perfil para guardado.
- Mantener el helper y comando antiguo como denegación explícita `notForSale`, sin validar
  precio/distancia ni iniciar una operación durable. El preflight de reservas del host permanece.
- Quitar precio, botón e instrucciones de venta de perlas. El panel solo envía swallow/leave/give;
  conserva el bloqueo de otra perla mientras haya una tragada.
- Una respuesta histórica de venta no muestra monedas, ganancia ni mensaje de acción nueva.
  La denegación actual explica que ningún puesto compra/vende perlas.
- Conservar vendor de objetos/pociones, entrega entre jugadores, loot/cofres, recoger/dejar,
  muerte y retorno. No define un mercado de perlas entre jugadores ni una fuente marina automática.
- Perfiles, snapshots, protocolo, SQL, recibos y recuperación histórica no cambian de formato.

## Verificación

Comprobar los cuatro tipos en el vendor, lejos/en combate, bag/swallowed/UID desconocido,
replay y falta de perfil. Comparar perfil/aliases, columnas ECS, drops/ledger existentes,
dirty, RNG y contadores antes/después; solo se permite el evento privado de denegación.
Enviar CMD real a LocalServer con otro pirata conectado: ninguna perla/oro cambia ni el
payload de guardado, y el otro cliente no recibe la denegación privada.

Regresión seleccionada: vendor ordinario, circulación/poder/muerte, comandos y tick, staging
swallow/leave/pickup/return y request gestionado. SQL de pickup/return local como regresión,
sin llamar Supabase real ni modificar migraciones.

Chrome con módulos reales CharPanel/pearlHtml/Rewards y CSS existente: escritorio y móvil
emulado, acciones click/touch, slot vacío/ligado, rechazo de botón antiguo, textos/sin desborde,
capturas inspeccionadas. Fixture de panel, no recorrido de host ni teléfono físico.

## Reutilización y siguiente parte

Unreal/FAB revisado por candidato, fuentes read-only: BP_InventoryComponent 24.878.603 bytes,
BP_VendorMain 482.913 y VendorItems 7.737. Inventario y vendor Blueprint son referencias;
no se necesitan arte nuevo ni ejecución Unreal para retirar una regla de venta. Reutilizar
helper/comando de denegación y UI existentes. Metadatos no acreditan semántica ni portabilidad.

Seguir con composición del lifecycle/startup y gates M5: UIDs de creación, dominio/reloj,
política offline/crash, recuperación/autoridad, afinidad y finalizador. La obtención marina
acordada no adelanta estos requisitos. [Entrega](../delivery/d09f-pearl-no-sale.md).
