# GM01 — borrador local del editor del mundo

Estado: **implementado y verificado localmente en 0.6.0-alpha.18; no publicado ni desplegado**.

GM01 incorpora una entrada de editor del mundo dentro del juego. El editor crea y modifica un documento de borrador aislado con instancias decorativas nuevas; no cambia el mapa base ni el estado de gameplay. Permite volar por la escena, buscar los assets preparados, colocar un fantasma sobre el terreno, transformar objetos con gizmo o campos numéricos, ajustar snap, apoyar el objeto en el terreno y deshacer/rehacer. El editor y sus mensajes están disponibles en español e inglés.

Cada objeto del documento tiene un ID estable, `assetId`, posición XYZ, rotación XYZ y escala uniforme, además de metadatos de colisión `none` o `circle`. Estos metadatos no incorporan colisión al gameplay. No se seleccionan ni se editan decoraciones ya existentes en el mapa; tampoco hay prueba caminando, edición de terreno ni edición en vivo.

## Permiso y límites de autoridad

En línea, la entrada consulta `GET /api/gm/session` con el bearer de la sesión autenticada. El servidor resuelve la identidad mediante el verificador existente y compara la cuenta con `GM_ACCOUNT_IDS`; la URL, los parámetros de consulta, el nombre visible y `DEV` no otorgan el permiso. El permiso cubre esta entrada del editor; no es un rol de administración general. La interfaz revalida la capacidad y cierra el editor al revocarla. La cuenta GM se provisionó y la allowlist privada se preparó fuera del repositorio; no se registra aquí ningún identificador ni secreto.

La verificación de navegador registrada usa autenticación simulada y marca `production: false`. El flujo de setup exige confirmar la contraseña, actualiza la sesión firmada y limpia los campos. La suite seleccionada pasó 100/100 pruebas pertinentes, incluidas 30 pruebas GM; el recorrido de navegador pasó 13/13 comprobaciones tras añadir setup a las doce anteriores. Las comprobaciones automatizadas del servidor cubren la ruta autenticada, rechazo de cuentas no permitidas y ausencia de autorización por query. Esto no acredita despliegue, configuración de la allowlist en producción, salud ni comportamiento positivo de una sesión de producción.

En modo local `?solo`, el editor se ofrece como herramienta local sin autoridad compartida. En ambos modos, el borrador vive en IndexedDB del navegador, aislado por cuenta y mundo. Los guardados usan revisión compare-and-swap; dos pestañas que intenten guardar sobre revisiones distintas reciben conflicto en vez de sobrescribir el documento ajeno. Exportar e importar JSON permite mover una copia manualmente. Si IndexedDB rechaza una escritura por cuota, el editor mantiene un fallback en memoria para la sesión actual; ese fallback desaparece al recargar o cerrar la página.

Al cerrar de forma forzada, salir por revocación o recargar mientras hay cambios sin guardar, el editor persiste una recuperación en otra clave de IndexedDB, separada del borrador normal. Guarda la revisión base esperada y restaura el documento sin promoverlo silenciosamente sobre un guardado normal más reciente; una discrepancia conserva el conflicto. La limpieza de recuperación también usa CAS para no borrar una recuperación más nueva creada desde otra pestaña.

La sesión de juego conserva M5 como autoridad del personaje, economía y gameplay. Abrir el editor no crea un cuerpo de jugador ni envía comandos de gameplay; cerrar retira las instancias de la escena y conserva intacto el mapa base. No existe una ruta GM de guardado remoto, publicación, activación o rollback en este corte.

## Verificación y assets

La evidencia de navegador `browser-evidence.json` corresponde a `0.6.0-alpha.18` (2026-10-10T15:57:00.632Z UTC) e incluye 13 comprobaciones, incluida la creación/confirmación de contraseña y actualización de la sesión firmada. La captura `account-setup.png` registra el flujo; `editor-es.png`, `editor-en-placed.png` y `draft-conflict.png` conservan la cobertura visual del editor. La comprobación de recuperación cubre cierre forzado/recarga, persistencia aparte del documento normal y conservación de la revisión base. La prueba de navegador usa autenticación simulada; véase el límite anterior.

GM00 preparó cuatro candidatos colocables a partir de dos originales: roca tropical con texturas WebP 2K y 1K, y coral reducido a aproximadamente 200K y 50K triángulos. Los archivos originales permanecen intactos. En comparación de dos ángulos con el loader real y la misma cámara, la roca 1K es casi idéntica a la fuente actual toon; el coral 200K mantiene silueta y color pero pierde detalle fino; el coral 50K se ve más facetado. Rendimiento físico móvil no medido. `visualReview: pending` se conserva en el recibo reproducible; la revisión independiente está en [visual-review.md](../../art/gm00/visual-review.md). Ningún candidato queda aceptado como asset de gameplay.

## Siguiente trabajo

- **GM02:** seleccionar y editar decoración ya presente, definir proxies compatibles y hacer una prueba caminando en un estado descartable sin escribir en M5.
- **GM03:** desplegar/verificar la configuración de la cuenta permitida, y diseñar el flujo durable de revisiones inmutables, autorización completa, publicación y activación controlada, admisión con el mismo hash de contenido y recuperación/rollback. La activación del mundo compartido requiere una ventana de mantenimiento con host vacío y coordinación con el actualizador.
- **GM05–GM06:** edición y ampliación del terreno permanecen posteriores.

La edición simultánea en línea no está habilitada. Los borradores de GM01 son privados al navegador y no hay mecanismo para compartirlos en directo ni para sincronizar cambios entre editores.

La activaci?n inicial de cuenta usa un enlace de recuperaci?n de un solo uso en el fragmento del URL. El cliente retira ese fragmento antes de verificarlo con Supabase, habilita el formulario solo tras validar la sesi?n y permite elegir una contrase?a propia. No se env?an enlaces por correo desde este corte ni se guardan tokens, contrase?as o identificadores privados en Git. El permiso sigue resolvi?ndose en el servidor.
