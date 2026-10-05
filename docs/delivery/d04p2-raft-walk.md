# D04 P2 — cubierta transitable

Fecha: 2026-10-05. Base inicial `6402462`; integración sobre D09a `d028a42`. Estado: aceptado localmente en software.
Brief: [cubierta transitable](../briefs/d04p2-walkable-raft.md).

## Resultado

La balsa amarrada aporta suelo al movimiento compartido. Se cruza del muelle mediante una pasarela visible,
se camina por fundamentos/pisos y se sube o baja por escaleras. Paredes, ventanas, barandillas y puertas
cerradas bloquean el radio del personaje. Marcha, dash, empujes y desplazamientos de habilidades consultan
la misma geometría. No hay editor ni navegación en esta entrega.

`src/sim/raftGeometry.js` compila geometría por plano/pose y reutiliza la compilación mientras no cambien.
La autoridad actualiza al amarrar/retirar; el cliente instala las superficies del snapshot antes de reproducir
comandos pendientes. El suelo superior se selecciona por la Y autoritativa ya reconciliada, sin elegir siempre
el piso más alto. No hay nueva columna de ECS ni datos privados en snapshots; protocolo 13 conservado.

Las escaleras tienen ocho peldaños y cuatro orientaciones compartidas con su renderer. Sus laterales bloquean
la entrada; los extremos conectan cubierta y piso vecino. La pasarela cubre únicamente el pequeño hueco de los
amarres adyacentes al muelle, con pendiente desde Y=1,05 a Y=0,72. No vuelve transitable el agua circundante.

También se corrige la reconciliación que ignoraba un error exclusivamente vertical y se descartan snapshots
anteriores antes de restaurar posición o geometría. Abordaje consulta soporte de balsa al planear/aterrizar;
los pasos y efectos de dash se emiten sobre madera a la altura de cubierta. Si un dueño desconecta, visitantes
sobre su balsa —o en Abordaje hacia ella, incluso sobre agua sin soporte— vuelven al muelle con movimiento/cast
limpiados. Coordenadas de salto antiguas de otra habilidad no activan ese rescate.

## Verificación

- 14/14 pruebas nuevas en `tests/raft-movement.test.mjs`: conexión real al servidor local y pasarela en ambos
  sentidos, agua/huecos, bloqueos con radio/dash, pisos superpuestos, escaleras válidas en cuatro direcciones,
  replay cliente/servidor, snapshots antiguos con `you`/ack, corrección vertical, visitante al desconectar y
  Abordaje real entre dos pisos superiores separados por agua, idéntico en autoridad/predicción, desconexión
  durante vuelo sin soporte y protección frente a un destino de salto obsoleto de otra habilidad.
- 19/19 pruebas previas de balsas/tatuajes y 2/2 pruebas de red aisladas, incluido RTT de 100 ms.
- Regresión completa: **383/383**, con `node --test --test-concurrency=2 --test-timeout=60000 tests/*.test.mjs`.
  Registro: `shots/review/d04p2/regression-final.log`. Incluye el trabajo M5 concurrente, conservado en D09a.
  La concurrencia acotada evita sobrecargar los casos de red.
  Después se reforzó la aserción de destino obsoleto de otra habilidad y se repitió el archivo final: 14/14,
  `shots/review/d04p2/targeted-final.log`, sin cambiar código runtime.
- Revisión independiente GPT-6 Luna de transformaciones, pendientes, alturas, orientación y caché.
- Recorrido de navegador aceptado: PC 1280×720/high y móvil emulado 844×390/low, DPR 1; teclado WASD/Space
  y joystick/botón Dash reales de la UI. Pasarela, cubierta, subida/bajada, vuelta al muelle, pared y dash al borde.
  Las 18 capturas se inspeccionaron. Worker normal, sin errores de página/juego; error de predicción 0 en muestras.
- Atlas realmente cargado: 1024×1024 en PC y 512×512 en móvil, solo una variante por contexto. Dos peticiones
  de la misma variante por contexto título/recarga, sin descargar ambas resoluciones.
- Evidencia local: `shots/review/d04p2/desktop-final/evidence.json` y
  `shots/review/d04p2/mobile-accepted/evidence.json`; hashes y resumen durable en [registro](d04p2-evidence.json).
  Se preservan los intentos fallidos del arnés: ruta lateral de escalera y pulsos móviles largos, corregidos antes
  de aceptar. En cada sesión quedaron tres mensajes de consola `ERR_FAILED` con fuentes externas bloqueadas
  deliberadamente por el arnés; no se capturó su atribución individual por URL.

`tools/look-raft-walk.mjs` usa un Worker normal, un perfil local nuevo y un plano de 17 piezas validado por el
saneado del juego; ese plano no modifica perfiles ni mundos online. La starter normal se revisa aparte.
El jugador solo se teletransporta inicialmente al muelle; luego se mueve con teclado o el joystick de la UI.
Para registrar imágenes en SwiftShader, la lógica/frame y Worker continúan, y el dibujo GPU se ejecuta al
capturar. Esta programación de QA no acredita fluidez sostenida, teléfono físico ni FPS.

## Assets de construcción revisados

La [investigación existente](../research/unreal-assets/SUMMARY.md) no identifica un kit modular listo para
pisos/paredes/escaleras. Se conserva el kit procedural y su atlas cómic: WebP 1024 de escritorio, 512 móvil,
una variante cargada. La caja Dreamrise ya exportada sigue integrada y tiene fallback procedural.

| Candidato existente | Uso concreto | Preparación pendiente |
|---|---|---|
| `SM_StoragePart_03` | Caja visual ya integrada: GLB de 51.684 B / 204 triángulos | Almacenamiento/interacción pertenece a D06 |
| `SM_RepairBench` | Mesa de taller, candidato para D06 | Exportar, ajustar escala/pivote, comprobar materiales y presupuesto |
| `SM_SmallWoodeHut` | Prefab terrestre, candidato para M8 | Es una choza completa; no equivale a paredes/pisos modulares |
| `BP_Holdable_BuildHammer` | Referencia del flujo de fantasma/rotación/requisitos de D05 | Reimplementar comportamiento en JS con validación del servidor |

Rutas fuente y nivel de evidencia: [candidatos](../research/unreal-assets/CANDIDATES.csv) y
[portabilidad](../research/unreal-assets/PORTABILITY.md). No se abrió ni modificó Unreal ni se importó un nuevo pack.
Se confirmó la presencia de las cuatro fuentes `.uasset` el 2026-10-05 mediante consulta de archivos de solo lectura.

## Límites y continuidad

Los amarres remotos del prototipo P1 (berth 2+) no tienen conexión al muelle: la distribución del puerto necesita
su propio corte antes de afirmar acceso a pie de muchas balsas. La puerta se mantiene cerrada en P2; abrirla
requiere interacción posterior. Escalas verticales (`ladder`), colisión detallada de muebles, combate entre alturas,
plataformas móviles y mar no están aceptados aquí. La starter y las partidas existentes no reciben el plano de QA.

Siguiente entrega: **[D05 / M6 P3, editor autoritativo](../briefs/d05-raft-editor.md)**; empezar con fundamentos, piso, pared/barandilla,
escalera, soporte y caja visual. Almacenamiento/interacción pertenece a D06. Después D06 y la
[bahía de manejo](../briefs/d08-navigation-feel.md), con sus puertas
de custodia antes de riesgo persistente. No se reinició el host público del PC ni se publicó esta entrega.
