# GM05b — pintura de terreno y formas de pincel

Publicado y verificado inicialmente en **alpha.48/protocolo 53**, release `0a2dfc0b6b8a9797f756b42e7b1d51a972393dd5`.
También verificado tras la integración concurrente en **alpha.49/protocolo 54**; evidencia separada abajo.
Continúa [GM05a](../gm05a/DELIVERY.md) y el [contrato previo al código](../../briefs/gm05b-terrain-paint.md).

La pestaña **Terreno** añade **Pintar** y **Borrar**, con hierba, tierra, arena y roca. Los pinceles
circular, cuadrado y elíptico comparten radio, fuerza, borde suave y giro con la escultura;
la elipse permite ajustar su proporción. La rampa conserva su corredor entre dos extremos.
Un trazo es una operación reversible: preview privado, Escape, deshacer/rehacer, guardado y
prueba caminando. Borrar mezcla progresivamente hacia el acabado automático.
El acceso GM comparte la fila de Ajustes/Controles del menú inicial para quedar visible en móvil horizontal.

Solo se edita suelo seco existente. Se protegen también los vecinos que reciben interpolación;
costa, caminos, servicios, muelles, recursos y zonas funcionales conservan las guardas del host.
Un trazo bloqueado se rechaza completo. Pintar conserva alturas, props, colisiones y recursos;
esculpir después conserva la pintura. No incorpora islas nuevas, importación de imágenes ni dispersión.

Documento v4/terreno v2: alturas anteriores y cuatro canales enteros de 8 bits por muestra;
el residual mantiene el acabado automático. Rejilla 561², índices ordenados/únicos, hasta
20.000 entradas de altura y 20.000 de materiales. V2/v3 mantienen su forma histórica.
Preparación/compiler 2 firma por separado alturas completas y materiales canónicos;
el cliente verifica ambos antes de entrar. Renderer y cartografía comparten la interpolación
de triángulos de la malla. El host continúa siendo la única autoridad del mundo.

**SQL033 aplicada por el autor y readiness real verificado desde el servicio del VPS:** materiales
1/terreno 2, terreno anterior 1 y borradores 1. [Evidencia](sql-live.json). Conserva los recibos
anteriores, admite reejecución y no reescribe perfiles ni documentos. El adaptador bloquea
guardados v4 si falta readiness; v3 no necesita la nueva función.

Se reutilizan atlas de hierba/tierra, arena Dry y roca actuales. No hay texturas ni dependencias
nuevas. Atlas móvil 1024²: 2.231.340 bytes; arena móvil 512²: 584.252 bytes. La pintura añade
un atributo RGBA de 8 bits, 1.258.884 bytes en la rejilla completa. Las pasadas de solo pintura
actualizan ese atributo y conservan buffers de altura/normal/máscaras y textura de agua.
La malla completa heredada de GM05a sigue pendiente de sectores/LOD; bytes y emulación
no acreditan FPS en un teléfono físico. Los [candidatos Unreal/FAB](../../briefs/gm05b-terrain-paint.md)
se revisaron sin modificar las fuentes.

La regresión acotada pasó **267/267 casos en 52 archivos**, con ejecución secuencial; [resumen](regression/summary.md)
y [manifiesto exacto](regression/files.txt). Cubre formas/pesos, compatibilidad, guardado/replay/ACL SQL, protecciones,
restauración visual y cadena HTTP/WebSocket con fixture de almacenamiento. El navegador usa
puntero real para cuatro materiales, borrado gradual, cancelación, undo/redo, escultura posterior,
paseo privado y reapertura exacta de IndexedDB. Sus fixtures locales no acreditan Supabase público.
La aceptación [local](local/release-accepted/local-browser-evidence.json) pasó **11/11** con siete capturas
ES/EN inspeccionadas: tres detalles y dos vistas generales de escritorio, dos vistas generales móviles.
Registró cero errores de página/WebGL y las cuatro URLs/resoluciones reales por dispositivo;
las respuestas 503 del fixture local sin almacén durable están identificadas por endpoint.

La imagen Linux aceptada, `sha256:dd62a49baaed2c76400509bb5bed563e486a474b21504e91ba378e8404df246a`,
pasó **37/37 pruebas focales**, con **35/35 archivos** iguales al commit. Son comprobaciones adicionales
con solapamiento, no 37 casos únicos añadidos a los 267. [Resultado de imagen](image-focal.json),
[salida](image-focal.tap) y [comparación del contenedor activo](public-runtime.json).

El [navegador público autenticado](public/final/public-browser-evidence.json) pasó **11/11 controles**,
con siete capturas ES/EN inspeccionadas, incluidas vistas de detalle móviles. Confirmó las URLs y dimensiones
de las variantes móviles realmente cargadas, sin errores JavaScript de página ni WebGL. Conserva un evento
de red `GET /api/gm/draft` cancelado (`net::ERR_ABORTED`); la evidencia no registra su instante ni permite
atribuirlo con certeza al cierre del contexto. No se oculta ese evento ni se equipara a una prueba de fallo
de escritura: la cadena durable independiente siguiente completó guardado y recarga exactos.
En móvil horizontal el panel tiene desplazamiento vertical: las capturas de detalle muestran proporción
y giro, mientras herramienta/material/forma quedan arriba, fuera de esa vista. Se inspeccionó ese estado
y la vista de escritorio con los controles completos; el check automático no exige que todos sean visibles
simultáneamente. Cerrar el editor cancela las lecturas remotas activas, compatible con el evento observado.

La [cadena pública con Supabase real](public/final/public-chain-evidence.json) guardó v4 en r26,
verificó replay y recarga exactos, preparó con compiler 2, registró y activó una revisión temporal en
generación 7. Un cliente nuevo verificó ambos hashes antes de entrar; recibió la altura y roca pintadas
y el WebSocket admitió esa misma revisión. Al terminar se restauró el **mapa base en generación 8**
y el **borrador original en r27**, con su hash anterior exacto. El canario queda retenido como revisión
inactiva; no sustituye el mapa del autor. La sesión de QA no cambió contraseña ni envió correo.

[Salud y despliegue](deployment.json): contenedor sano, almacenamiento Supabase durable, cero errores
y guardados pendientes al cierre. La [entrada real posterior](public-entry.json) recibió bienvenida,
snapshot y perfil sobre el mapa base restaurado. Las pruebas con navegador y móvil emulado acreditan
este flujo funcional y visual; la medición de FPS en teléfono físico conserva su aceptación propia.

La integración concurrente de INV02d y continuidad de muerte conserva los módulos de terreno,
publicación y SQL033 sin cambios. Sobre el checkout integrado `6604e49`, cinco suites focales pasaron
**31/31**, incluidas la cadena HTTP/WS de terreno y la exclusión explícita de cambios GM cuando la
autoridad experimental de muerte está montada: [salida](regression/integrated-49.txt). No son casos
únicos adicionales a las comprobaciones anteriores. Esa composición experimental sigue sin montar
en el VPS; el contrato GM no se amplió para admitirla silenciosamente.

El [navegador público integrado](public/integrated-49/public-browser-evidence.json) repitió **11/11**
controles en alpha.49/protocolo 54, con siete capturas ES/EN inspeccionadas, sin errores de página/WebGL.
Conserva el mismo evento aislado de lectura remota cancelada, con los límites de atribución ya descritos.
Esta pasada no repite el canario de publicación ni modifica el borrador remoto. La [imagen activa](public-integration-runtime.json)
`sha256:4ea631063a9ab6046c35c0e3c7c8eac02b8b5dde1ba3704372c90fd476020002`, release `8c9743a`,
coincide con **35/35 archivos de su Git**; 32 coinciden además con alpha.48 y los otros tres son
`src/main.js`, versión y protocolo de INV02d. [Salud posterior](public-integration-deployment.json)
y [entrada WebSocket real](public-integration-entry.json): mapa base generación 8, bienvenida/snapshot/perfil,
Supabase durable, cero errores o guardados pendientes y cero jugadores/sockets tras cerrar la entrada.

Sigue optimización reutilizable de modelos y dispersión controlada; después, generación/importación
de terreno por sectores y costa en GM06. El sistema de modelos optimizados existente permanece
disponible para colocación individual y plantillas.
