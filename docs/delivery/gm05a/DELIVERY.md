# GM05a — pinceles de escultura del terreno

**Publicado y comprobado en alpha.45/protocolo 51; escultura privada y cadena de publicación aceptadas.**
Continúa [GM04b](../gm04b/DELIVERY.md) y el [contrato previo al código](../../briefs/gm05a-terrain-sculpt.md).
[Resumen de aceptación y capturas inspeccionadas](acceptance.json).

La pestaña **Terreno** permite subir, bajar, aplanar, suavizar y construir una rampa con dos clics.
Radio 2–24 m, fuerza, caída suave y cota de aplanado. Arrastrar aplica un trazo; soltar lo conserva como
una operación de deshacer. Escape o pérdida de foco cancela el preview completo. La prueba caminando
usa la proyección del borrador, sin ganancias ni cambios de gameplay persistidos.

El primer corte trabaja sobre suelo seco existente. Costa, muelles, servicios, recursos, rutas y áreas
funcionales tienen protección también en el servidor. Un trazo bloqueado se rechaza completo. Las
decoraciones seguras conservan su offset vertical mediante transformaciones explícitas del documento.
GM05b añadirá pintura de familias de suelo; GM06 cubrirá nueva tierra, costa y expansión del dominio.

Documento v3: deltas enteros en milímetros sobre 561×561 muestras, ordenados y únicos, hasta 20.000
entradas y ±12 m. Los documentos v1/v2 conservan su normalización y forma anteriores. SQL031 extiende
el guardado privado SQL020 y conserva sus recibos históricos. **SQL aplicado por el autor y readiness
live verificado desde el servicio del VPS:** terreno 1 y contrato anterior 1. [Resultado](sql-live.json).
El archivo se renombró de 029 a 030 y después a 031 al integrar Carga y agua dulce; su contenido/hash es idéntico.
La preparación firma las alturas Float32 completas; el cliente las recompila y verifica antes de entrar.
El catálogo de recursos mantiene IDs/alturas base. Activación y rollback usan la autoridad, exclusión,
CAS y guardas de perfiles, drops y balsas existentes; no hay otra autoridad de guardado.

La malla canónica y el sampler comparten triangulación en las celdas editadas. Fuera de ellas se conservan
las funciones base exactas. Preview privado para geometría, agua y cartografía; cerrar restaura los recursos
visuales originales. Se reutilizan las familias de suelo actuales, sin mapas 2K/4K nuevos ni cambios a
fuentes Unreal. [Candidatos revisados](../../briefs/gm05a-terrain-assets.md). Con deltas, la malla completa
usa 560×560 celdas; su coste supera el anterior. FPS en teléfono físico y optimización por sectores/LOD
no están aceptados en este corte.

La integración previa alpha.44 pasó **275/275 en 51 archivos**, con hashes de fuentes estables:
[resumen](integration-final-lighting/regression.json) y [TAP](integration-final-lighting/regression.tap). Incluye la cadena HTTP real save→prepare→register→activate,
cliente nuevo con alturas exactas, rechazo de hash alterado, admisión WebSocket y rollback; además SQL031
en PGlite, replay v2/v3, reejecución y ACL, más la compatibilidad con el corte concurrente de Carga.
Las regresiones anteriores alpha.43 (238/238) y alpha.44 (274/274) se solapan. La final incluye el panel
desplazable con controles primero, colocación/apoyo de modelos sobre la altura editada y la prueba de
guardado pendiente que conserva un aviso posterior de rechazo. El foco de iluminación del editor también
usa el terreno proyectado.

La release integrada alpha.45/protocolo 51 conserva el corte concurrente de agua dulce y sus condiciones
de activación. El manantial queda protegido contra cambios de altura y colisiones añadidas. La regresión
conjunta de terreno, Carga, inventario y agua pasó **308/308 en 56 archivos**, con fuentes estables:
[resumen previo al último merge de host](integration-publish/regression.json) y [TAP](integration-publish/regression.tap).
Tras integrar la circulación de perlas del suelo, la selección se repitió: **309/309 en 56 archivos**,
sin fallos/omisiones y con fuentes estables: [resumen final](integration-final-release/regression.json)
y [TAP](integration-final-release/regression.tap). El piloto de perlas permanece sin montar en público;
su composición con activación GM sigue excluida. La [revisión de evidencia upstream](upstream-ground-integration.json)
separa sus 246 casos históricos de esta ejecución final; los conteos se solapan.

El [navegador local de release](local/release/local-browser-evidence.json) pasó **10/10**, sin errores:
gestos reales de los cinco pinceles, terraza elevada 1 m, rampa recorrida a pie, undo/redo, rechazo atómico,
Escape, export/import/reapertura v3 y colocación de un modelo real a 4,585267 m (base 3,585267 m).
Las cinco capturas ES/EN, escritorio y 844×390 fueron inspeccionadas; el control de radio funciona en
la vista estrecha. QA sitúa el inicio caminable en el extremo bajo y después usa teclado real: cinco muestras
cruzan la rampa y una pasa a 0,31 m del extremo alto. La carrera de guardado usa un temporizador de QA
de 5 s que llama al guardado real; blur despacha explícitamente ese evento sobre un trazo de puntero real. No son pruebas
de foco nativo, latencia física ni rendimiento móvil. La compilación conserva las texturas actuales.

El primer intento de regresión pasó 231/235 mientras las fuentes cambiaban; no se cuenta como aceptación.
Reveló la lista de archivos de runtime incompleta del registro. Los intentos iniciales de navegador
revelaron supuestos de idioma, comparación insuficiente de cambios y un extremo de rampa debajo del
inspector; se conserva la evidencia de diagnóstico, pero no acredita el recorrido completo.

El [navegador público](public/final/public-browser-evidence.json) pasó **11/11 controles**, sin errores,
con entrada invitada real y sesión GM autenticada. Repitió los cinco pinceles, cancelación/undo,
recorrido de la rampa y colocación del modelo sobre la terraza, más guardado/reapertura/import/export
privados en IndexedDB. El recorrido cruzó la rampa en cinco muestras y llegó a 0,20 m del extremo alto.
Estas comprobaciones del editor no son una prueba de los botones de guardado remoto del panel Online.

La [cadena HTTP autenticada con Supabase real](public/final/public-chain-evidence.json) sí guardó el
documento v3: borrador r23→r24, replay y recarga exactos, preparación válida, registro y activación
en generación 5. Un navegador invitado nuevo compiló la rejilla 561, comprobó el hash completo
`8c17383da5e0956405d31a628cc8dc82935d951945d17ec432de04d7860956ca` y la muestra a 1,9244766 m
**antes de HELLO**; WELCOME confirmó generación/revisión. Después cerró el peer y verificó rollback
a **generación 6/mapa base**. El borrador original quedó restaurado por CAS en r25, con su hash exacto;
revisiones y recibos canarios se conservan. No se dejó la elevación de ensayo activa.

El [primer intento público](public/attempt1/public-chain-evidence.json) guardó/preparó, pero detectó
una conexión abierta antes de activar. No cambió el mapa activo y restauró r21→r22→r23. Se conserva
como diagnóstico, no como canario completo; el segundo esperó de forma acotada a un mundo vacío,
sin desconectar jugadores ni relajar la guarda del servidor.

[Despliegue tras rollback](deployment.json): revisión `839393ae15cd154311d9571a6a0d01635becd7f8`,
imagen `sha256:44964a19c4617e831c2f0a975a838155bb968d01927d1fbda9ada01c80d2c2b5`, una autoridad sana,
health 200, cero jugadores/conexiones/errores en la captura, Supabase durable, Carga y agua habilitadas/listas,
mapa base en generación 6 y timer activo. Los [28 hashes del runtime activo](public-runtime.json)
coinciden con Git y con la imagen integrada probada `ea982f8`. Esa imagen pasó [20/20 focales](image-focal.json)
y el actualizador [127/127 en 17 archivos](image-updater.json); TAP [focal](image-focal.tap) y
[actualizador](image-updater.tap). Las revisiones posteriores de documentación/herramientas conservan
esas 28 fuentes. La comparación no sustituye las pruebas de navegador ni acredita FPS físico.

El [primer ensayo de imagen](image-focal-attempt1.json) pasó 20/21: la suite de publicación importaba
el módulo de paseo gráfico y no pudo cargar `three`, dependencia de desarrollo ausente en producción.
La suite sí está cubierta por Windows 309/309; la selección Linux final explicita esa exclusión.
No se añadió una dependencia de render al servidor para cambiar el resultado de QA.

Las capturas originales [públicas nocturnas](public/final/terrain-es-closeup-1440x900.png) conservan
la iluminación heredada del juego; `tod=day` sin `debug` no fija el día. La revisión visual de relieve,
modelo y controles usa cinco [capturas con luz de referencia](public/daylight-reference/evidence.json)
en ES/EN, escritorio y 844×390. Solo se fija el renderer en el editor privado, con `gameplay=false`;
no se escribe la hora del mundo ni se activa el borrador importado. No acredita visibilidad nocturna
ni un control horario nuevo dentro del editor. Siguen pintura GM05b y expansión GM06.

La integración posterior con los controles de Carga INV02c conserva la escultura y su autoridad:
alpha.46/protocolo 52, merge `31f7ff5` sobre upstream `2a51c8d`. La selección conjunta pasó
**336/336 en 58 archivos**, sin fallos/omisiones y con fuentes estables:
[resumen](integration-attributes/regression.json) y [TAP](integration-attributes/regression.tap).
WELCOME mantiene la identidad del contenido GM al añadir la capacidad privada de atributos.
Este checkpoint no sustituye ni cambia la versión de la aceptación canaria alpha.45 anterior.
El [editor público integrado](public/integration-alpha46/public-browser-evidence.json) repitió
**11/11 controles sin errores** en alpha.46/protocolo 52: invitado, autenticación GM real y cambios
locales privados. La cadena remota quedó intencionadamente sin ejecutar; no se volvió a activar
el canario ni se escribió el borrador online. Sus capturas nocturnas confirman controles/scroll;
la revisión visual de relieve sigue siendo la referencia alpha.45 indicada arriba. La
[entrada WebSocket real](public/integration-entry-alpha46.json) recibió WELCOME, snapshot y perfil.
La [imagen pública alpha.46](public/integration-runtime-alpha46.json) coincide con Git en 28/28
archivos y tres módulos INV02c adicionales; 24/28 fuentes siguen idénticas a alpha.45, con cambios
exactamente en host, main, metadata y protocolo. [Salud tras cerrar QA](public/integration-deployment-alpha46.json):
una autoridad sana, Supabase durable, sin jugadores/conexiones, contenido base generación 6.
