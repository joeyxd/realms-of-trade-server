# L03d-e1 — Conexión, modelo y límites preparados

El autor eligió preparar la configuración y decidir proveedor/límite después. Su endpoint local
podrá servir para el adaptador posterior; no se copia ninguna credencial al juego.

Una configuración privada por mundo–cuenta, con una revisión CAS, guarda un techo conjunto en
nano USD, conexiones con su techo y asignaciones personaje–conexión–modelo. Dos personajes que
usan la misma conexión referencian una sola fila de límite; no reciben dos saldos. Los límites son
configuración preparada: todavía no hay ledger central, gasto disponible, reserva o generación.
Son techos anidados, no asignaciones aditivas: los subtechos pueden sumar más que el techo padre;
el futuro ledger deberá reservar contra ambos simultáneamente y jamás superar el agregado de cuenta.
Sin fila, revisión cero/config null/fecha null. Sin importe implícito ni modelo preseleccionado.

El catálogo estático del operador contiene sólo referencias, etiquetas, proveedor, modelos admitidos
y máximo configurado; se filtra por cuenta antes de enviarlo. No contiene URL, clave, token ni estado
de generación. Es admisión de configuración, no prueba de disponibilidad de un proveedor. En VPS
permanece vacío hasta la elección posterior. No provisiona bindings ni cambia capacidades/control.

Load/save privados usan la sesión humana autenticada y admitida. El servidor deriva mundo/dueño;
rechaza campos extra, invitados, agentes, personajes ajenos, modelos fuera del catálogo y límites
superiores al máximo admitido. Guardar requiere todos los compañeros vinculados detenidos; nunca
reanuda. Borradores se conservan ante conflicto, timeout o resultado incierto y se retiran al salir.
El slot de I/O real se conserva tras timeout. Una respuesta tardía no confirma una solicitud nueva.

SQL028 sólo añade metadata privada y RPC de servicio, RLS y ACL sin acceso directo de service_role.
CAS serializa escritores por mundo/cuenta y retry inmediato exacto devuelve el mismo head.
No modifica perfil/economía/recibos M5 ni escribe configuración de Nitro/Hermes. Se reutiliza la
subvista DOM existente; VibeUE (inventario Unreal/FAB ya contrastado en el brief del centro) no es
portable ni necesario. Sin assets nuevos.

Aceptar: aislamiento de dos cuentas, dos personajes con un único techo de conexión, CAS/replay,
reinicio/base en disco, grants/readiness, catálogo revocado, stop, sesiones/tardías, UI ES/EN en PC
y móvil emulado. Publicación exige revisión/imagen/salud y entrada real. Guardar con dueño público
real tiene aceptación propia. SQL no instalado debe cerrar sólo esta superficie.

Sigue ledger central de reservas/uso incierto, adapter/modelo real y presupuesto elegido; después
personalidad/metas y memoria con eventos confirmados. No presentar este corte como memoria o
inferencia operativa, factura, conexión probada ni techo de gasto ya aplicado.
