# GM05b — pintura de terreno y formas de pincel

Implementado localmente en **alpha.48/protocolo 53**. Publicación y aceptación del VPS en curso.
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

Sigue optimización reutilizable de modelos y dispersión controlada; después, generación/importación
de terreno por sectores y costa en GM06. El sistema de modelos optimizados existente permanece
disponible para colocación individual y plantillas.
