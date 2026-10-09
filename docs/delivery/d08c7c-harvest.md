# D08c.7c — recolección por la isla

Fecha: 2026-10-08. Build local **0.6.0-alpha.14**, protocolo **30**.
[Contrato](../briefs/d08c7c-harvest.md).

## Implementado

La isla del seed actual tiene **176 nodos**: 96 palmeras cortables, 69 piedras recogibles
(64 nuevas + 5 anteriores) y 11 troncos sueltos. Distribución en tierra entre aproximadamente
x −128…128 y z −132…128; no mueve la isla ni el pueblo del agente de arte. Son 96 de las 234
palmeras existentes, seleccionadas determinísticamente. Las restantes conservan su papel decorativo.

Acercarse, detenerse y usar **F / Cortar** tres veces: hacha contextual, movimiento del personaje,
golpes secos, marcas, astillas, hojas y caída. Cada golpe tiene recuperación de 0.9 s. El último
entrega **2 troncos** y deja tocón durante 60 s de simulación. Las piedras usan **F / Recoger**,
con sonido, partículas y agotamiento compartido. Marcadores solo próximos al personaje.
La mochila necesita espacio para los dos troncos antes de cualquier golpe; una negativa no daña
el árbol. Banco existente permite preparar esos troncos por lotes como madera para la balsa.

Servidor decide inventario/revisiones/proximidad/calmas/espacio. Repetir el mismo opId no duplica
golpes, materiales o efectos. Catálogo enviado al admitir y al cambiar estado; no se repite
todo el bosque en cada snapshot de movimiento. Cambia el protocolo por estado/eventos de palmera,
conservando banco, navegación y autoridad de agentes.

## Reutilización

Tres GLBs S05, atlas/normal y materiales/geometry compartidos con la vegetación estática.
Seis meshes instanciados para palmeras, dos para tocones y dos pools de partículas acotados.
Piedra S02 con pintura natural; banco S19/S14. No assets descargados/generados ni texturas nuevas.
Hacha de primitivas con colores existentes; audio sintetizado respeta volumen/mute de SFX.
Auditoría Unreal concreta y descartes en el brief; fuentes intactas.

## Verificación

**87/87 pruebas seleccionadas aprobadas**, ejecutadas con `--test-concurrency=1` sin navegador
en paralelo: harvesting, render Three en CPU, banco, red, autoridad de agentes, comercio,
editor y producción de balsa. **3/3 vistas de navegador aprobadas**: PC 1280×720, táctil 844×390
y retrato 390×844 con la rotación actual del juego. Cero errores de consola/JS; capturas
inspeccionadas de golpe, caída/tocón y recogida. Sintaxis de los archivos del corte y whitespace
de los parches comprobados. Esto no mide FPS ni sensaciones en un teléfono físico.

```powershell
node --test --test-concurrency=1 tests/harvest-palm.test.mjs tests/harvest-render.test.mjs tests/resources.test.mjs tests/resource-loop-server.test.mjs tests/workbench-batch.test.mjs tests/net.test.mjs tests/palm-family.test.mjs tests/palm-materials.test.mjs tests/coast-rocks.test.mjs tests/agent-authority-network.test.mjs tests/commerce.test.mjs tests/raft-editor.test.mjs tests/raft-production-server.test.mjs
node tools/qa-harvest.mjs
```

Resultados finales y capturas en [evidence.json](d08c7c-harvest/evidence.json).
La herramienta [qa-harvest](../../tools/qa-harvest.mjs) levanta hosts efímeros loopback, sin .env,
SQL, proveedores ni publicación. Reloca ECS como fixture para evitar recorridos largos; los
golpes, recogida, banco y guardado se ejecutan con F o el botón táctil real. Mercancías/capacidad
reales: 2 troncos + 1 piedra ocupan 8/10. Otra palmera se rechaza sin cambiar su nodo.
Reentrada firmada conserva dos maderas preparadas, una piedra, revisión y oro.

Incidencia resuelta en la primera revisión de navegador: el catálogo podía haberse enviado antes
de que el navegador registrara el listener mientras cargaba assets. HELLO ahora invalida esa caché
para que la admisión reenvíe el catálogo. No se relajó la autoridad ni se aumentaron materiales.
Revisión adicional corrigió hits intermedios en snapshots, índices de tocones por variante,
regeneración visual y vencimiento de partículas, cubiertos por pruebas de runtime Three en CPU.
La regresión explícita de snapshot previo a HELLO verifica catálogo completo tras WELCOME.
El aviso de recuperación se acortó para móvil y mochila insuficiente explica los dos troncos.
Las capturas fijan la cámara de seguimiento después de cada relocalización del fixture.

Un pase de pruebas concurrente con el navegador obtuvo 86/87: el test previo de expiración
de agentes observó tick 1 frente al tick 0 del WELCOME antes de detener el timer.
La ejecución serial final obtuvo 87/87, incluido ese caso, sin cambiar su prueba ni la autoridad
de agentes. La carrera de admisión/timer bajo carga es la explicación probable; no se trata
como evidencia de rendimiento.

## Límites y continuación

Materiales guardan bajo los mecanismos actuales; golpes/nodos/recibos y su reloj siguen siendo
de sesión. Reiniciar el host vuelve a preparar el catálogo. La espera respeta pausas/ticks,
sin avance offline. No cierra economía persistente antifarming, SQL del reloj, herramientas
fabricables/durabilidad, respawn durable del mundo ni FPS en teléfono físico.
El collider de cada palmera permanece en su tocón; caída es visual sin daño físico.

Contrato atómico de aportes y tablero/artesano/recetas de pueblo continúan en
[PLAN-ALFA-MUNDO §8.1](../../PLAN-ALFA-MUNDO.md#81-continuación-concreta--banco-de-materiales-y-contrato-de-aportes).
Este corte sigue la petición de recolección antes de volver a ese contrato. Integración local;
no commit, push, despliegue, cambio de cupo ni SQL aplicado.
