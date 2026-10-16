# D08c.12 — aceptación de navegador

Validación local con GameHost efímero, WebSocket real del juego y Chrome emulado. Cada host respondió `GET /health` con HTTP 200 antes de abrir el cliente. Se usaron tiendas en memoria, dependencias visuales servidas localmente y protocolo 27; sin `.env`, SQL, servicios externos ni despliegue.

## Pasadas finales

Las tres vistas recorrieron la ruta completa: iniciar desde el timón, cruzar Boya 1, 2 y 3 en orden, recibir el aviso real de la cañonera, esperar la resolución autoritativa, volver y completar con la acción normal **Amarrar**.

| Vista | Resultado real del host | UI final | Errores JS / consola / requests / HTTP | Overflow |
|---|---|---|---|---|
| Escritorio 1280×720 | `route:1:shot:1`, primera lectura 1255→caída 1374 (119 ticks restantes); 1 impacto, 0 esquivados, 6 HP | `Ensayo completado` · `1 impacto · 0 esquivados · 6 HP`; `complete` por `dock` | 0 / 0 / 0 / 0 | No |
| Touch horizontal 844×390 | `route:1:shot:1`, primera lectura 1299→caída 1417 (118 ticks restantes); 1 impacto, 0 esquivados, 6 HP | `Ensayo completado` · `1 impacto · 0 esquivados · 6 HP`; `complete` por `dock` | 0 / 0 / 0 / 0 | No |
| Touch vertical 390×844 | `route:1:shot:1`, primera lectura 1247→caída 1365 (118 ticks restantes); 1 impacto, 0 esquivados, 6 HP | `Ensayo completado` · `1 impacto · 0 esquivados · 6 HP`; `complete` por `dock` | 0 / 0 / 0 / 0 | No |

Las salvas, el daño, los contadores de ruta y el atraque provienen del GameHost. El fixture QA solo recoloca el cuerpo de prueba en los puntos autoritativos de la ruta después de iniciar desde la UI; así hace deterministas las tres boyas y la proximidad a la cañonera. Esta pasada muestra un impacto confirmado, no un dodge. Las tres capturas de resolución muestran el daño aplicado; la UI informa el resultado agregado.

Cada ejecución mostró las tres boyas en orden y acabó mediante el comando normal de atraque, después del reposicionamiento de fixture declarado. En los JSON, `salvo.launchedAt` representa el tick de la primera lectura QA y `warningTicks` el tiempo restante observado; el contrato completo de 120 ticks se verifica en las pruebas de simulación. La práctica anuncia antes de iniciar que no hay botín ni XP y que el daño es reparable; las pruebas de autoridad comprueban conservación de carga y economía.

## Capturas finales

Cada vista conserva controles/primera boya, aviso de salva, resolución, regreso y resultado:

- Escritorio: `naval-route-desktop-1280x720-2026-10-08T13-24-23-160Z-01-buoy-one.png` a `...-05-complete.png`.
- Touch horizontal: `naval-route-touch-844x390-2026-10-08T13-25-54-162Z-01-buoy-one.png` a `...-05-complete.png`.
- Touch vertical: `naval-route-portrait-390x844-2026-10-08T13-24-53-635Z-01-buoy-one.png` a `...-05-complete.png`.

Los JSON de cada ejecución (`evidence-2026-10-08T13-24-23-160Z.json`, `evidence-2026-10-08T13-24-53-635Z.json` y `evidence-2026-10-08T13-25-54-162Z.json`) contienen dimensiones, nombre del barco fixture, IDs y orden de boyas, coordenadas/tiempos de la salva, contadores, estado final, grupos de errores y lista de capturas.

## Ajustes y trazas previas

La primera pasada completa de escritorio llegó a `complete/dock`, pero la aserción QA exigía la palabra plural `impactos`; se corrigió para admitir `impacto` y `impactos`. Se afinó el anillo de alcance de las boyas: el tubo de 0.032 unidades locales queda de unos 0.29 m al escalar al radio de 9 m, discreto y con profundidad, en vez de un aro luminoso grueso. La aserción de UI también verifica el botón animado **JUGAR** mediante un clic de mouse en su centro, sin forzar la acción ni esperar estabilidad de una animación pulsante. Los fallos anteriores de arranque frío/calidad baja, composición vertical rotada y esperas del botón quedan conservados con sus JSON y capturas; no se cuentan como pases ni sustituyen las tres ejecuciones finales anteriores. Retrato usa la rotación CSS horizontal existente; las tres pasadas usan calidad baja.

`tests/naval-route-ui.test.mjs` incluye cobertura para impedir impactos visuales fantasma al cambiar de ensayo y volver a presentar avisos cuando una reconexión reutiliza IDs de salva.

Esta es aceptación en navegador emulado. No acredita pilotaje humano sin fixture, pantalla/dispositivo físico, FPS real, balance ni escucha de audio; tampoco implica publicación.

[Pruebas, incidencias y artefacto local](verification.md).
