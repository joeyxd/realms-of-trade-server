# A1a — contrato local de aportes comunitarios

Estado: brief para un primer subcorte aislado. Su aceptación demuestra el contrato y la atomicidad en memoria; **no completa A1 ni habilita aportes en el juego**. El store no es durable.

## Objetivo y límites

Definir una solicitud estricta de aporte y ensayar una única operación atómica que debite bienes del perfil completo de un personaje, acredite progreso de un proyecto y emita un recibo exacto. El store local debe modelar las garantías que necesitará la transacción durable posterior.

El alcance termina en contrato, validación y store de memoria aislado. No montar en host, `LocalServer`, sesiones de perfil, simulación, protocolo, UI o tablero; no añadir ni modificar perfiles del juego, SQL, migraciones, archivos de mundo o configuración. No adjudicar recompensas, recetas ni desbloqueos, y no fijar costes de gameplay. La información de requisitos llega de una fuente confiable del servidor y queda inmutable para el proyecto durante su vida.

## Identidad y versiones

Cada solicitud tiene exactamente `operationId`, `worldId`, `worldEpoch`, `characterId`, `projectId`, `good`, `amount`, `expectedCharacterVersion` y `expectedProjectVersion`. Operación, época y personaje usan UUID canónico no nulo; mundo y proyecto usan claves ASCII de hasta 100 caracteres. Se aporta un bien por operación, con cantidad entera positiva hasta un millón; es un límite técnico, no el coste de una obra. Las versiones esperadas van de 1 a 2.147.483.646. `worldEpoch` distingue una vida del mundo de otra; personajes y proyectos quedan delimitados por mundo y época. El ID de operación no se puede reutilizar en otro ámbito. El caller debe resolver la identidad autorizada: este módulo no autentica al jugador ni demuestra acceso físico.

Las versiones esperadas comparan la operación contra el perfil y el proyecto cargados. Una versión obsoleta produce rechazo sin mutar perfil ni progreso. El proyecto conserva una revisión propia que aumenta una vez por aporte aceptado; el personaje aumenta una vez por el débito aceptado. El recibo conserva la solicitud original con sus versiones esperadas y el resultado completo. Un rechazo conserva su motivo terminal; no pretende ofrecer una observación nueva de las revisiones actuales.

## Catálogo confiable y cálculo

Al crear el proyecto, el servidor proporciona una copia validada e inmutable de sus requisitos por bien. Solo se admiten bienes presentes en el catálogo común `GOODS` y en los requisitos de ese proyecto. La solicitud no define requisitos, cuotas, precios ni premios. Las cantidades deben ser enteros positivos dentro de límites de contrato; se rechazan claves repetidas, bienes desconocidos, valores no finitos, ceros, negativos y desbordamientos.

Para el bien solicitado, el store calcula la cantidad efectiva como el menor valor entre lo solicitado y lo que aún falta para completar su requisito. El débito y el crédito usan exactamente esa cantidad efectiva. Si el perfil no tiene la cantidad efectiva completa, el aporte se rechaza sin cobros parciales. Si el requisito ya está cubierto, se rechaza sin cobro. La respuesta devuelve `accepted` y los estados confirmados de personaje/proyecto; la solicitud del recibo conserva lo solicitado. No hay bonificación ni conversión de bienes. Un lote de varios bienes queda fuera de este subcorte.

## Atomicidad, recibos e idempotencia

Una operación aceptada confirma conjuntamente:

1. El débito de `eco.pack.goods` del perfil de personaje, conservando los otros campos; si existe `eco.tradeRev`, avanza una vez como en el inventario ordinario.
2. El crédito de progreso del proyecto por las cantidades efectivamente aceptadas.
3. Las revisiones nuevas de ambos agregados.
4. El recibo exacto asociado al request.

Una solicitud mal formada se rechaza con `ContributionError('input')` antes de reservar un ID. Si una solicitud válida incumple una precondición, no se debita ni acredita nada y se registra un recibo de rechazo con motivo estable. La primera respuesta —aceptada o rechazada— es definitiva para ese `operationId`: el replay idéntico devuelve el resultado original con `replay:true` sin aplicar ni volver a decidir. Si el ID se reutiliza con otro contenido o identidad, devuelve `why:'operation'` sin alterar el recibo original. La forma del recibo consultable es `{request,result}`; las respuestas y cargas son copias independientes.

La escritura del recibo comparte la frontera atómica con el cambio aceptado. El fixture de memoria permite ensayar la frontera y la recuperación consultando por identidad/request ID mientras el proceso vive. No representa persistencia tras reiniciar el proceso.

## Aceptación esperada

- Contrato cerrado; identidad, versiones y cantidades se validan antes de operar.
- Catálogo por proyecto confiable, validado e inmutable; solicitudes de catálogo, bienes o requisitos ajenos se rechazan.
- Aporte válido debita solo los bienes aceptados de `eco.pack.goods`, acredita exactamente esos bienes y conserva intactos los campos no relacionados del perfil.
- Exceso solicitado se limita al remanente; falta de bienes para cubrir el efectivo, proyecto completo, revisión obsoleta o cualquier precondición fallida no produce débito/crédito parcial.
- Dos solicitudes concurrentes con la misma revisión no pueden gastar o acreditar dos veces: como máximo una confirma y la otra obtiene rechazo con recibo.
- Replay idéntico de recibo aceptado y de recibo rechazado devuelve el resultado original sin reaplicar ni reevaluar; colisión del ID con contenido distinto no reemplaza el recibo.
- Validación, falta de bienes y CAS obsoleto no dejan débito, progreso o revisiones a medias. Todos los clones/resultados se preparan antes de las escrituras sincrónicas de memoria; no hay `await` dentro de esa frontera. No ofrece API de inyección de fallos ni demuestra resistencia a caída del proceso.
- Tests de store aislados con procesos/fixtures de memoria, sin importar el host ni conectarse a servicios externos.

## Reutilización y arte

No requiere arte nuevo ni Unreal. La auditoría de assets ya identifica la caja de almacenamiento `prop:storage-crate` y el banco procedural S19/materiales S14 para usos visuales posteriores; no forman parte de este contrato. El futuro tablero puede coordinarse con las anclas de arte de Salty Shore cuando el montaje autoritativo esté autorizado.

## Puertas que siguen abiertas

Este ensayo no ofrece durabilidad, recuperación tras caída, acceso desde el juego ni aislamiento real por mundo. Antes de host, tablero o artesano se necesita un store transaccional durable, CAS, recibos durables y recuperación tras respuesta perdida/reinicio; verificar la convivencia con el acceso al perfil, guardados, bodega y admisión del mundo. También falta demostrar aislamiento entre mundos y épocas en la infraestructura autoritativa. La revisión de catálogo/progreso no puede aceptar estado del cliente. Después de esas puertas, el orden de A1 sigue siendo montaje del proyecto/tablero, artesano y aprendizaje personal con defaults/saneado/guardado, y una primera pieza aprendida usada en la balsa.
