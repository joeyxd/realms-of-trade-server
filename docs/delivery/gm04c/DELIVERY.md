# GM04c — pincel de decoración y costes de modelos

Implementado sobre GM05b. [Contrato previo al código](../../briefs/gm04c-decoration-brush.md).
Estado de publicación y aceptación final al pie de esta entrega.

En **Biblioteca**, elegir un modelo y abrir **Dispersión**. Activar el pincel y arrastrar sobre suelo
seco: circular, cuadrado o elíptico, con radio, borde suave, giro, densidad, separación, semilla y
rango de escala. Cada copia tiene giro Y sembrado. Soltar conserva todo el trazo como una operación;
Escape, pérdida de foco o cancelación del puntero lo descartan. Las copias conservadas son objetos
normales independientes: selección, transformaciones, undo/redo, guardado y publicación existentes.

Las copias son **decorativas, sin colisión ni tala/recolección**. El pincel omite con un contador las
muestras sobre costa/agua, pendientes, rutas, servicios, recursos y zonas funcionales, comprobando
la huella completa a escala máxima. Un exceso de presupuesto rechaza el gesto completo. Semilla
local reproducible; no consume el RNG del mundo ni cambia recursos, economía, alturas o colliders.

Límites del pincel: 120 copias, 250.000 triángulos y 256 primitivas visibles por gesto; 1.000 cambios
publicables. El total de adiciones del borrador no puede superar 1.000.000 triángulos o 1.024 primitivas.
Se miden las geometrías y grupos visibles preparados, con sus rangos reales de dibujo. Son guardas
de esta herramienta cliente: la colocación manual autorizada sigue el contrato histórico del servidor,
que permite decoración visual en otros lugares y no impone estos nuevos presupuestos globalmente.
No se presentan como ACL, garantía de rendimiento ni restricciones de recursos del host.

El panel muestra triángulos/primitivas por copia, geometrías/materiales compartidos, bytes del archivo,
ahorro frente al original cuando existe recibo, dimensiones de las texturas realmente cargadas y
estimación RGBA8 con mipmaps por modelo único. No multiplica memoria de textura compartida por copia.
El coste del trazo y el acumulado excluyen mundo base, sombras, contornos y otros pases del renderer;
no predicen FPS. Las copias comparten buffers/materiales existentes, pero todavía no usan instancing.

## Reutilización comprobada

Se reutilizan los modelos web existentes: arbustos de 424/512/440 triángulos, palmeras de
1.016/1.064/1.112 y bases de 410/540. El arbusto redondo pesa 24.720 bytes, con dos mapas 512²
cargados; estimación RGBA8+mips 2,80 MB. La palmera baja pesa 128.208 bytes y carga dos mapas 1024²
(11,18 MB estimados). En móvil emulado el arbusto carga dos mapas 256²: 0,70 MB RGBA8+mips estimados,
frente a 2,80 MB en escritorio; se comprobó la dimensión cargada, sin acreditar FPS físico.
La roca GM de 1024 conserva 19.469 triángulos y pesa 1.546.948 bytes frente
a 8.836.372 originales: ahorro de archivo **82,5 %** ya existente. El acabado toon carga un mapa
1024² en ese modelo (5,59 MB estimados); no se confunde con todos los mapas almacenados en su GLB.

El inventario Unreal y los archivos concretos `SM_Tree_Green_01.uasset` se revisaron en
`C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes`
(289.283 bytes) y `C:\Unreal\MyProject\Content\Dreamrise_SMSK\Assets\Meshes` (289.514 bytes).
Son candidatos de árboles, pero requieren exportación y comprobar dependencias, estilo y presupuesto
antes de reemplazar vegetación que ya funciona en web. En el inventario local revisado no se encontró
un candidato FAB concreto mejor para este corte. Fuentes Unreal y originales intactos; no hay assets ni dependencias nuevas.
No entrega otro optimizador automático, KTX2, LOD, hierba nueva ni comparación de fidelidad de nuevos
derivados; expone los modelos ya optimizados para colocación individual y dispersión.

## Compatibilidad y evidencia

Documento v2–v4/compiler 2 y SQL033 conservados; **sin migración GM nueva ni mensajes propios**. La integración
`gm-scatter-publication.test.mjs` usa el mapa y arbusto reales: valida referencias, compila ambos
documentos, deduplica el GLB, reproduce el hash y conserva hash de recursos y colisiones. También
hace explícita la diferencia entre la política del pincel y la colocación manual GM autorizada.

El navegador de aceptación usa el editor real y puntero real: tres formas con cancelación, arrastre,
IDs de preview iguales al commit, un undo/redo, guardar/reabrir IndexedDB, arbusto/palmera/roca cargados,
traducción ES/EN y móvil horizontal emulado 844×390. El panel móvil tiene desplazamiento vertical;
editor táctil completo y FPS en teléfono físico mantienen su aceptación propia.

El fixture local simula identidad GM y almacenamiento de servidor en memoria: sus lecturas durables
no disponibles se registran como 503, no como errores WebGL. No escribe el borrador remoto ni activa
un mapa de ensayo. Intentos previos del harness quedan fuera de la evidencia aceptada.

## Aceptación final

La [regresión previa](regression/summary.json) pasó **293/293 en 57 archivos** sobre `f26aae2`,
alpha.53 local, con [salida completa](regression/regression.txt) y [manifiesto](regression/files.txt).
Después se integraron los cambios concurrentes de bucanero/carga de `fb4276f` y el rechazo temprano de
presupuestos densos. La [integración final](integration/summary.json) pasó **60/60 en 14 archivos**,
alpha.55/protocolo 55, sin fuentes modificadas durante la ejecución; contiene hashes de fuentes/pruebas
y [salida TAP](integration/regression.tap). Los conteos se solapan, no son 353 casos únicos.

Una segunda integración conserva creación de compañeros de `d91bc66`, incluido su protocolo 56;
ese corte conserva su instalación/activación SQL034 separada, sin habilitarla desde GM04c.
La [aceptación de release](integration-release/summary.json) pasó **81/81 en 19 archivos**, alpha.56,
con hashes y fuentes estables; incluye la cadena HTTP/WS GM, entry/session y clientes/red/UI de compañeros.
Sus casos se solapan con las rondas anteriores. [Salida](integration-release/regression.tap).

La [integración actual](integration-current/summary.json), sobre `056d275` alpha.57/protocolo 56,
pasó **87/87 en 21 archivos** con fuentes estables y hashes registrados. Incluye el personaje/idle
concurrente y conserva el núcleo GM aceptado en alpha.56. [Salida TAP](integration-current/regression.tap).
La integración opcional de acuñación de perlas conserva sus propias verificaciones y activación;
GM04c no instala SQL ni activa esa funcionalidad.

El [focal de imagen Linux](image-focal.json) pasó **19/19 en tres archivos** sobre la imagen exacta
de `96af1aa` alpha.56 (`sha256:87905bb51c5b96a028fad40e82933a0c778fcd109b01ed946f791050a1607963`).
Fue una ejecución offline de pruebas puras, sin servidor, red, credenciales ni montaje del mundo;
no crea otra autoridad ni acredita por sí sola el comportamiento público de alpha.57.
[Salida TAP](image-focal.tap). Todos estos conteos se solapan.

El [navegador local final](local/release/browser.json) pasó **10/10**, con ocho capturas ES/EN
de escritorio/móvil inspeccionadas y arrastre real; cero errores de página/WebGL y ninguna mutación remota.

**Publicado y aceptado en alpha.57/protocolo 56.** El [navegador público autenticado](public/accepted/browser.json)
pasó **10/10** sobre `056d275bc858d1d29a758f218d301a0f9f75f786`: seis copias tras arrastre real,
preview/commit con los mismos IDs, cancelación de las tres formas, undo/redo único y reapertura local exacta.
Ocho capturas ES/EN de escritorio y móvil emulado inspeccionadas; cero errores de página, consola o WebGL,
y cero escrituras `/api/gm/*`. Una lectura de revisiones quedó abortada al cerrar el contexto; no falló
ninguna comprobación. Three/GSAP del CDN se sirvieron desde copias locales de las mismas versiones;
los módulos del juego, identidad GM, modelos y texturas se cargaron del origen público.
La prueba no guardó un borrador remoto ni activó un canario. El mapa sigue base, generación 8, sin revisión activa.

[Identidad de runtime](public-runtime.json): una autoridad sana, imagen/revisión exactas, **21/21 archivos**
del contenedor y **15/15 archivos públicos** iguales al Git aceptado. El núcleo del editor y publicador
GM no cambió entre `96af1aa` y `056d275`; las integraciones concurrentes conservan su propio alcance.
[Despliegue](deployment.json) y [entrada real](public-entry.json) confirman salud 200, Supabase durable,
cero errores o pendientes, timer activo y entrada WSS con welcome/snapshot/profile. Las capturas y
el estado describen la revisión comprobada, sin acreditar rendimiento en teléfono físico.

Sigue el adaptador de recursos para palmeras talables y el pipeline reutilizable de optimización;
generación/importación de terreno y nueva costa continúan en GM06, con su contrato previo propio.
