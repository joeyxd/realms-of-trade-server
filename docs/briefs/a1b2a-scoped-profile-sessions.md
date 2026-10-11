# A1b2a — una autoridad de perfil para guardados y aportes

2026-10-09. Subcorte de A1b2 después del backend A1b1. Implementar y verificar el contrato de sesión antes de sustituir el guardado de la partida.

## Resultado y límite de montaje

El backend comunitario admite guardados ordinarios sobre **la misma fila y revisión** que debita el aporte. `ScopedProfileSessions` administra admisión, exclusividad local, tokens de revisión, bloqueo de mutación, confirmación y publicación síncrona. Se verifica con memoria y con el SDK Supabase contra PostgreSQL local PGlite.

Este controlador es una autoridad opcional independiente y candidata a la transición futura. **No coordina todavía `ProfileSessions` M5 ni reemplaza `mn_profiles` en GameHost**. Montar simultáneamente ambas autoridades para una mochila sigue siendo incorrecto. No se cambia el host, simulación, protocolo, UI, perfiles actuales, configuración o SQL real. A1b2 continúa parcial; tablero/artesano/aprendizaje quedan después de la transición autoritativa.

## Almacenamiento

Aplicar opcionalmente `server/migrations/community/002_character_saves.sql` después de la migración comunitaria 001, conservando su carácter independiente de SQL001–013. `mn_comm_save_character(jsonb)` valida el perfil completo y usa el mismo lock `mn-community-char:` y fila `FOR UPDATE` que el aporte. Revisión esperada, actualización e incremento son un CAS; un aporte confirmado hace perder a un guardado anterior. `service_role` puede ejecutar el RPC; no obtiene DML directo. Los roles públicos no pueden ejecutarlo.

`saveCharacter(row)` interpreta `row.version` como revisión esperada. Éxito: `{ok:true,character}` con revisión incrementada y datos exactos. Rechazo: `{ok:false,why:'missing'|'conflict'}`. No crea recibo de guardado. El adaptador valida respuesta/identidad/revisión/datos y no reintenta automáticamente. El store de memoria ofrece el mismo contrato y ahora inicialización exacta sin sobrescritura.

La API permite snapshots completos de servidor; no demuestra que una actualización arbitraria sea una acción de gameplay válida. El futuro propietario debe capturarlos desde estado autoritativo y conservar las reglas de perlas, muerte, comercio y construcción.

## Sesión y publicación

- `open(clientId)` obtiene `{accountId,worldId,worldEpoch,characterId}` exclusivamente de un `resolveBinding` síncrono y confiable. Solo admite filas existentes; no importa un perfil del navegador ni inicializa desde claims del cliente. Reserva tanto cuenta como personaje delimitado por mundo/época durante la carga.
- `view` entrega clones del estado confirmado y un token opaco por referencia; ese token pertenece al servidor y no es un campo de protocolo. `save` requiere el token actual y el snapshot capturado con él. Tras publicar una revisión, el token anterior se rechaza; no se rebasa un autosave antiguo sobre una revisión nueva.
- `contribute` recibe solo ID de operación, proyecto, bien, cantidad y revisión de proyecto. La sesión añade identidad y revisión del personaje. Si ya existe un recibo del mismo intento, conserva su request original; otro intento con ese UUID se rechaza sin revelar el recibo ajeno.
- Iniciar un write invalida el token y bloquea `canMutate` de inmediato. El propietario futuro debe bloquear **todas** las mutaciones del personaje durante ese intervalo y capturar/guardar progreso pendiente antes de aportar. El controlador no intercepta por sí solo sistemas ECS o autosaves del host actual.
- Las Promises solo preparan datos internos. `drain(publish)` se llama en el límite síncrono del tick y vuelve a comprobar la identidad. Publica filas actuales cargadas desde el store, nunca los snapshots históricos del recibo. La metadata del resultado contiene aceptación/replay, sin aquellos snapshots. Un guard global y estado `publishing` impiden publicación reentrante.
- `publish` es código confiable, síncrono y atómico. Debe reparar sus propias escrituras al lanzar una excepción. Se rechazan funciones async y se fencea un thenable; esa detección **no cancela** código async que un caller incorrecto ya haya iniciado. El montaje debe cumplir ese contrato y comprobarlo con ECS real.

## Ambigüedad, cierre y recuperación

Fallo SQL/transporte no acredita rechazo: la sesión permanece fenceada y conserva el request/snapshot congelado y las reservas. No publica, cobra de nuevo ni genera otro UUID. `recover()` consulta evidencia sin enviar otro commit; `recover({retry:true})` es un reintento explícito del mismo request o CAS original.

Para aportes, recibo exacto más filas actuales permiten preparar la publicación. Un recibo ausente mantiene la reserva. Para un guardado sin recibo, leer la revisión original no demuestra que la petición haya terminado: mantiene el bloqueo. Una revisión superior hace inocuo el CAS atrasado; se adopta el estado actual sin atribuir a un proceso concreto ese guardado. El reintento explícito conserva snapshot y revisión original, por lo que solamente una escritura puede ganar.

Cerrar no libera un write incierto. Una respuesta tardía de un dueño cerrado puede confirmar almacenamiento pero no publicarse en su cuerpo anterior. Tras resolver, una admisión nueva carga la fila actual. Un conflicto terminal de guardado o fallo de publicación mantiene bloqueada la sesión viva; requiere cierre y admisión nueva. Cambio de identidad/época impide publicación.

Las reservas e intentos del controlador son **locales al proceso**. No hay diario durable de sus intentos, lease entre hosts ni protección de admisión ante un commit de otro proceso todavía en curso. La reapertura de disco probada usa cierre limpio y una sesión nueva sobre estado confirmado. No acredita recuperación automática de intención desconocida tras crash ni failover. PGlite serializa las llamadas; las carreras probadas acreditan CAS/conservación, no scheduling de conexiones PostgreSQL reales.

## Siguiente transición

A1b2b: admisión cuenta → personaje/mundo/época persistida y verificada; elección de una sola autoridad de perfil en el host; coordinación de capturas/guardados/mutaciones, perlas/muerte y lifecycle; intención/startup recuperables y publicación ECS con rollback. Verificar cuenta autenticada, reentrada y commit incierto sin reactivar un dueño anterior. Después receptor/proximidad, bootstrap/prerrequisitos y tablero de Carpintería. No habilitar esta API como ruta de cliente antes de esas comprobaciones.

## Reutilización

Se contrastó [Survival/FINDINGS](../research/unreal-assets/survival/FINDINGS.md): `SM_RepairBench` y `SM_StoragePart_03` siguen siendo candidatos visuales; Blueprints/widgets de inventario no portan una autoridad PostgreSQL/web. Se reutilizan los contratos/validadores/stores comunitarios existentes y el patrón M5 de reserva, fence y publicación síncrona como referencia, sin modificar su implementación ni fuentes Unreal. No necesita arte nuevo.
