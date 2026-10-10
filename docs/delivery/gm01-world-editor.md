# GM01 — borrador local del editor del mundo

Estado: **GM01 está desplegado en el host y verificado en producción; el borrador sigue siendo local y no hay publicación de mapas**. Imagen activa `marea-negra:alpha-d3159949f9ef` (`d3159949f9ef6fbbab51ce7e7a1b928d25f428a0`), sana desde 2026-10-10T16:20:39Z.

GM01 incorpora una entrada de editor del mundo dentro del juego. El editor crea y modifica un documento de borrador aislado con instancias decorativas nuevas; no cambia el mapa base ni el estado de gameplay. Permite volar por la escena, buscar los assets preparados, colocar un fantasma sobre el terreno, transformar objetos con gizmo o campos numéricos, ajustar snap, apoyar el objeto en el terreno y deshacer/rehacer. El editor y sus mensajes están disponibles en español e inglés.

Cada objeto del documento tiene un ID estable, `assetId`, posición XYZ, rotación XYZ y escala uniforme, además de metadatos de colisión `none` o `circle`. Estos metadatos no incorporan colisión al gameplay. No se seleccionan ni se editan decoraciones ya existentes en el mapa; tampoco hay prueba caminando, edición de terreno ni edición en vivo.

## Permiso y límites de autoridad

En línea, la entrada consulta `GET /api/gm/session` con el bearer de la sesión autenticada. El servidor resuelve la identidad mediante el verificador existente y compara la cuenta con `GM_ACCOUNT_IDS`; la URL, los parámetros de consulta, el nombre visible y `DEV` no otorgan el permiso. El permiso cubre esta entrada del editor; no es un rol de administración general. La interfaz revalida la capacidad y cierra el editor al revocarla. Una sesión real de la cuenta GM permitida pasó el recorrido de producción en el host desplegado; no se registra aquí ningún identificador ni secreto.

Las pruebas locales seleccionadas pasaron 100/100, incluidas 30 pruebas GM. El navegador local pasó 13/13 comprobaciones en alpha.18 con autenticación simulada; la confirmación/actualización de contraseña también se comprobó en ese modo. Por separado, el navegador real de producción pasó 6/6 comprobaciones con Supabase (`production: true`, `simulatedAuth: false`): salud/versión/storage, invitado rechazado, hash/bytes del asset optimizado, entrada normal de invitado, recuperación de sesión real con pantalla de contraseña y colocación/guardado local GM, y cierre del editor al cerrar sesión. La prueba de producción no envió una contraseña nueva: queda a elección del dueño de la cuenta.

En modo local `?solo`, el editor se ofrece como herramienta local sin autoridad compartida. En ambos modos, el borrador vive en IndexedDB del navegador, aislado por cuenta y mundo. Los guardados usan revisión compare-and-swap; dos pestañas que intenten guardar sobre revisiones distintas reciben conflicto en vez de sobrescribir el documento ajeno. Exportar e importar JSON permite mover una copia manualmente. Si IndexedDB rechaza una escritura por cuota, el editor mantiene un fallback en memoria para la sesión actual; ese fallback desaparece al recargar o cerrar la página.

Al cerrar de forma forzada, salir por revocación o recargar mientras hay cambios sin guardar, el editor persiste una recuperación en otra clave de IndexedDB, separada del borrador normal. Guarda la revisión base esperada y restaura el documento sin promoverlo silenciosamente sobre un guardado normal más reciente; una discrepancia conserva el conflicto. La limpieza de recuperación también usa CAS para no borrar una recuperación más nueva creada desde otra pestaña.

La sesión de juego conserva M5 como autoridad del personaje, economía y gameplay. Abrir el editor no crea un cuerpo de jugador ni envía comandos de gameplay; cerrar retira las instancias de la escena y conserva intacto el mapa base. No existe una ruta GM de guardado remoto, publicación, activación o rollback en este corte.

## Verificación y assets

La evidencia local [browser-evidence.json](gm01/browser-evidence.json) corresponde a `0.6.0-alpha.18` (2026-10-10T16:15:55.923Z UTC): 13 comprobaciones, autenticación simulada. La evidencia real [public-evidence.json](gm01/public-evidence.json) se capturó el 2026-10-10T16:21:48.614Z UTC: 6 comprobaciones, Supabase real y cero errores. El despliegue se documenta en [deployment-evidence.json](gm01/deployment-evidence.json): las 107 pruebas del actualizador pasaron antes de sustituir el contenedor. Las capturas locales y de producción fueron inspeccionadas; la comprobación de producción llegó hasta la pantalla de contraseña, pero no la envió. La evidencia no contiene identificadores privados ni secretos.

GM00 preparó cuatro candidatos colocables a partir de dos originales: roca tropical con texturas WebP 2K y 1K, y coral reducido a aproximadamente 200K y 50K triángulos. Los archivos originales permanecen intactos. La roca 1K ocupa 1.546.948 bytes frente a 8.836.372 (−82,5%); el coral 200K ocupa 8.596.920 frente a 61.741.336 (−86,1%). La biblioteca inicial ofrece 21 modelos y solo descarga el seleccionado. En comparación de dos ángulos con el loader real y la misma cámara, la roca 1K es casi idéntica a la fuente actual toon; el coral 200K mantiene silueta y color pero pierde detalle fino; el coral 50K se ve más facetado. Rendimiento físico móvil no medido. `visualReview: pending` se conserva en el recibo reproducible; la revisión independiente está en [visual-review.md](../art/gm00/visual-review.md). Ningún candidato queda aceptado como asset de gameplay.

## Siguiente trabajo

- **GM02:** seleccionar y editar decoración ya presente, definir proxies compatibles y hacer una prueba caminando en un estado descartable sin escribir en M5.
- **GM03:** implementar borradores remotos durables y el flujo de revisiones inmutables, autorización de publicación, activación controlada, admisión con el mismo hash de contenido y recuperación/rollback. La activación del mundo compartido requiere una ventana de mantenimiento con host vacío y coordinación con el actualizador.
- **GM05–GM06:** edición y ampliación del terreno permanecen posteriores.

La edición simultánea en línea no está habilitada. Los borradores de GM01 son privados al navegador y no hay mecanismo para compartirlos en directo ni para sincronizar cambios entre editores.

El flujo de recuperación de cuenta usa un enlace de un solo uso en el fragmento de la URL. El cliente retira ese fragmento antes de verificar la sesión con Supabase y solo después muestra la pantalla para elegir una contraseña. En producción se verificaron la recuperación de sesión, la pantalla de contraseña, la entrada GM, la colocación/guardado local y el cierre de sesión; el cambio de contraseña se probó únicamente con autenticación simulada local. No se guardan tokens, contraseñas ni identificadores privados en Git. El permiso GM sigue resolviéndose en el servidor.
