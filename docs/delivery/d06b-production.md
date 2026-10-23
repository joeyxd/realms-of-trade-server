# D06b — red, parrilla y trabajo persistido

Estado: implementado localmente; escritorio aceptado en software, móvil pendiente. Fecha: 2026-10-05.
Fuente `5b253a43add406e8f9bcfa881ab428b52234184f`, integrada sobre `312747d`; **0.6.0-alpha.4, protocolo 16**.
Build local verificado: `dist/0.6.0-alpha.4-5b253a43add4`. Host/publicación sin actualizar.

La balsa permite construir una red y una parrilla desde B/botón Construir. H/botón Bodega → Producción
explica qué hace cada módulo, cuánto falta y por qué espera. El reloj del servidor conserva fracciones
y confirma lotes completos; retirar carga permite reanudar una red detenida sin perder bienes.
Datos actuales: dos pescados → dos galletas de barco; receta/tasas siguen siendo prototipo.

## Verificación

- 16 pruebas nuevas: conservación, capacidad posterior al consumo, módulos independientes, reordenación/retirada,
  fracciones saneadas, HMAC/reentrada sin producción offline, privacidad, límites y rechazo/throw del preflight.
  Incluye una prueba de producción real después de restaurar el mundo en GameHost: conserva `onAdvance`
  junto con `payUpkeep`. Las 23 pruebas dirigidas de producción/mundo pasan.
- Regresión **547/547** sobre el árbol commiteado `5b253a4`, exportado a una carpeta aislada:
  63 archivos, cero fallos/omitidas, concurrencia 2, timeout 60 s por archivo; 103066 ms.
  La suite previa de trabajo pasó 508/508 antes del ajuste de restauración y la integración de D09f.
- Escritorio 1280×720: **12 capturas inspeccionadas**. Red/parrilla colocadas por editor real, costes de materiales
  comprobados y tres compras adicionales cobradas (oro 1000→961). Fracción de 0,4375 guardada/restaurada exacta,
  primer pescado, inicio/lote de parrilla, bodega 6/6 congelada y retirada de 2 galletas por UI que reanuda red.
  Final: bodega 4 galletas + 1 pescado, mochila 2 galletas; cero errores JS de juego, atlas 1024 cargado.
  Google Fonts se bloqueó intencionalmente; sus fallos de red se registran por separado.
- Móvil 844×390: ensayo incompleto, llegó a previsualizar la red. El botón de acción quedaba por debajo del
  scroll; se añadió `scrollIntoViewIfNeeded` al harness antes de cada tap, sin repetir para aceptarlo.
  Producción móvil y reentrada táctil no se completaron; vertical 390×844 sin ejecutar. La revisión automática
  del arranque de Chrome devolvió límite de uso, sin evaluar el riesgo; el bloqueo no se eludió.
- [Evidencia durable](d06b-evidence.json): hashes de fuente, suite del commit, capturas y build verificado.

`tools/look-raft-production.mjs` usa partida solo aislada y controles reales para construir red/parrilla,
pagar materiales adicionales, abrir paneles y retirar carga. Comprueba primero el reloj normal del Worker.
Después un hook exclusivo del HTTP de QA congela el mundo, entrega respuestas/perfiles/snapshots y adelanta
la economía real en pasos de cinco segundos. No introduce comandos QA en el juego publicado ni otorga
producción directamente. La reentrada congelada compara la fracción guardada. No prueba interacción durante
la pausa ordinaria, rendimiento físico ni latencia online. Render software solo al capturar.
El recorrido visual precede al ajuste de GameHost y de scroll del harness; no cambió el cliente aceptado.

## Reutilización y continuidad

[Revisión Unreal/FAB](../research/unreal-assets/D06B-REUSE.md): sin export listo para red/parrilla.
Modelos actuales, caja Dreamrise y atlas cómic reutilizados; ninguna textura/modelo/audio nuevo.
Revisiones privadas no reconstruyen geometría GPU; una prueba protege reutilización y liberación al editar.
El build conserva atlas WebP de escritorio (308536 B) y móvil (82878 B).
El ensayo móvil pidió solo su URL, pero resolución decodificada y aceptación visual de Producción siguen
pendientes. Dispositivos físicos/FPS también.

[Contrato](../briefs/d06b-production.md). M6 P4 sigue parcial: agua/huertos, hamaca/reaparición y luces abiertos.
El viejo `stepRaft` continúa como laboratorio sin llamador; solo red/parrilla usan el nuevo motor vivo.
Mercado/perfil/carga no se anuncian como transacción durable conjunta ni custodia pública.

Siguiente exacto: repetir D06b móvil horizontal/vertical con el harness corregido e inspeccionar capturas.
Luego [D08 bahía de manejo](../briefs/d08-navigation-feel.md), revisión Unreal primero,
aceleración/frenado/giro y comparación vacío/cargado, antes de viento/clima, combate y riesgo público.
