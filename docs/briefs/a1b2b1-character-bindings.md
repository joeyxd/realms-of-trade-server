# A1b2b1 — pertenencia durable y admisión del personaje

2026-10-09. Primer subcorte de A1b2b, después de A1b2a. Implementación opcional de servidor; todavía no sustituye el guardado M5 de GameHost.

## Resultado

Una cuenta verificada admite únicamente el personaje previamente asignado a ella en el mundo y época configurados por el servidor. El vínculo no se deriva de `HELLO`, un perfil de navegador ni una selección de personaje enviada por el cliente. Guardados y aportes siguen usando la misma fila delimitada del backend comunitario.

Contrato exacto: `{accountId,worldId,worldEpoch,characterId}`; UUIDs canónicos en minúsculas y no nulos, mundo ASCII de 1–100 caracteres. Una cuenta tiene un vínculo por mundo/época; un personaje delimitado tiene un solo propietario. Los mismos UUIDs pueden aparecer en otro mundo/época sin compartir inventario. No selecciona automáticamente la época más reciente ni define wipe/adopción de partidas anteriores.

## Almacenamiento y provisión

Migración opcional `server/migrations/community/003_character_bindings.sql`, después de comunitarias 001 y 002. `mn_comm_character_bindings` tiene claves únicas por cuenta y personaje delimitados y FK a `mn_comm_characters`. RLS, sin DML directo para `service_role` ni acceso público; RPCs calificados con `search_path=''`. Un trigger impide UPDATE/DELETE. No tiene dependencia de `auth.users`: el vínculo guarda identidad ya verificada por el servidor, sin decidir todavía borrado/retención de cuentas.

`initializeBinding(binding)` es provisión confiable de servidor sobre un personaje **existente**: éxito `{ok:true,binding}`, o `{ok:false,why:'missing'|'conflict'}`. Replay exacto conserva la fila; cambiar propietario/personaje no sobrescribe. La comprobación de existencia, locks, FK e INSERT ocurren en una transacción READ COMMITTED. Cuenta y personaje tienen locks compartidos entre inicializaciones de vínculos. No crea/importa personajes, no cobra/aporta, no hay endpoint de reclamación pública. `loadBinding(accountId,worldId,worldEpoch)` devuelve vínculo exacto o `null`; el SDK valida alcance, campos y respuesta, conserva timeout y no reintenta automáticamente.

La provisión requiere que el futuro propietario establezca la procedencia de la fila existente; esta API por sí sola no demuestra legitimidad de una importación. Los roles de servicio son confiables. No es una autorización para que un cliente reclame una fila sin dueño.

## Admisión autenticada

`BoundProfileSessions(store,{worldId,worldEpoch,resolveIdentity})` encapsula `ScopedProfileSessions`. `resolveIdentity(clientId)` es código confiable y síncrono del host: devuelve una referencia **estable, congelada y exacta** `{accountId}`, creada después de verificar la cuenta. Cada conexión/incarnación usa una referencia nueva; un resultado vacío, Promise, dato mutable o campo adicional se rechaza. El host actual usa `createAccountResolver` y verifica `getUser`, pero el montaje de este nuevo contexto queda pendiente.

`open` reserva cuenta/clientId antes del lookup asíncrono, consulta el vínculo durable en el scope fijo, valida la respuesta y carga el personaje actual. No inicializa una fila ni adopta claims en admisión. Cierre, carga fallida o sustitución del contexto impiden publicar una admisión tardía. Cerrar durante lookup retiene las reservas hasta que la lectura termina; limpieza comprueba identidad y no borra otro propietario.

`view`, `canMutate`, `save`, `contribute`, `recover` y `drain` conservan los contratos de A1b2a. Las operaciones vuelven a comprobar el contexto; cambio/revocación detectados quedan latched para esa admisión aunque reaparezca la referencia anterior. Una vista revocada/cerrada no muestra binding, perfil, request pendiente ni token. Los mapas internos y el resolver del vínculo no son mutables desde fuera del controlador.

Writes inciertos retienen las reservas al cerrar. Recuperación de una sesión cerrada puede resolver/reintentar su request original sin publicar al cuerpo anterior; es API **interna del servidor**, no una ruta seleccionable por clientId remoto. `drain` conserva publicación síncrona, guard reentrante y revalidación de identidad; un `close` solicitado dentro de la publicación se difiere hasta terminar ese drain. El callback es confiable y atómico: no puede modificar el resolver/contextos de autenticación durante su ejecución y debe reparar sus propias escrituras si falla. Rechazar async/thenables no cancela trabajo asíncrono ya iniciado por un caller incorrecto.

## Límites y continuidad

La pertenencia es durable; exclusividad de sesión y fence siguen siendo locales al proceso. No aporta lease entre hosts, barrera de admisión tras crash con writes pendientes, diario de saves/aportes ni autorización de proximidad. Reentrada limpia/datos actuales no acreditan recuperación de una petición todavía en vuelo de otro proceso. Se requiere un host autoritativo por scope para este controlador aislado.

No monta GameHost, cambia `ProfileSessions`/`mn_profiles`, valida todos los mutations ECS, adopta personajes legacy ni mueve perlas/muerte/UIDs a la nueva autoridad. No modifica perfil, protocolo, costes, `.env`, SQL live, terreno o arte; conserva alpha.16/protocolo 32. A1b2 sigue parcial.

Siguiente dependencia: provisión inicial con procedencia explícita, intención durable/startup cerrado hasta resolver operaciones y transacción elegida de autoridad; después coordinación de snapshots/autosave y todos los mutations/UIDs, publicación ECS atómica y montaje de una sola autoridad en host. Tablero/receptor/artesano/aprendizaje siguen después de ese recorrido.

## Reutilización

Se contrastó [Survival/FINDINGS](../research/unreal-assets/survival/FINDINGS.md), en particular `SM_RepairBench`, `SM_StoragePart_03` y widgets/Blueprints de inventario: pueden aportar arte de banco/acopio, pero no una identidad verificable ni transacción web/PostgreSQL. Se reutilizan los validadores/stores y el controlador A1b2a; el patrón de identidad/reserva/publicación M5 guía el contrato. No necesita generar arte ni modificar fuentes Unreal.
