# Antorcha en fabricación, panel de fuego del kit y luz de proyectiles

Fecha: 2026-10-11. Estado: **sobre alpha.50 (`5da58e9`) como alpha.51; protocolo 55 sin cambios. Sin SQL nuevo.**
Pedido del autor: la antorcha (N) no dejaba crearla con troncos, su panel debía pasar al kit azul, la antorcha tenía
que estar en el menú de fabricación y en el banco, y las balas debían alumbrar de noche.

## Qué cambia para el jugador

- **La antorcha pide 1 tabla básica, no troncos.** Así funcionaba ya la operación `fire` (RNV04, SQL022), pero el panel
  decía «1 madera» sin explicar que es la tabla del banco (2 troncos → 1 tabla). Ahora el panel lo dice: tarjeta de
  material «Tabla básica 0/1», aviso «Sin tablas: prepáralas en el banco de materiales, 2 troncos por tabla. Llevas N
  troncos» y botón **Abrir fabricación**, que abre la receta de la tabla.
- **Panel de fuego (N, y los fuegos de la balsa) en el kit azul**: placa marina, icono pintado (antorcha o fogata),
  hueco de combustible con brillo cuando arde, pincelada naranja para «Crear y encender» y botones de acero para
  apagar/encender. Con combustible cargado solo queda el botón de apagar/encender. Compacto en móvil apaisado.
- **Antorcha en el menú de fabricación** (TAB, y el mismo menú en el banco): pestaña Herramientas, receta a mano,
  «Fabricar y encender» con 1 tabla. Envía la misma intención inmutable que el panel (`fire`/`load`/`handTorch`) y se
  resuelve con su evento `fire`; no pasa por `resource craft`. Mientras arde, la receta lo dice (tiempo restante) y el
  cinturón muestra la antorcha encendida. Deja de figurar como «Por descubrir».
- **Los proyectiles alumbran**: cada bala, perdigón, disparo reflejado y proyectil enemigo en vuelo es una luz
  móvil del color de su trazo (más fuerte de noche, mitad de día). Usa solo los huecos de luz que dejan libres las
  luces fijas y los destellos, los más cercanos primero (hasta 4), así que nunca apaga un farol ni cambia el
  presupuesto por calidad. Además, cada disparo y descarga deja un destello de boca de 0,12–0,16 s.

## Contrato y despliegue

1. **Sin SQL y sin protocolo nuevo.** La antorcha usa la operación `fire` existente; los invitados siguen recibiendo
   `account_required` como antes.
2. `FIRE_FUEL` (`src/data/fire.js`) documenta el coste (1 `madera`); la autoridad sigue en `fireProfileDelta` y SQL022.
3. `WorkbenchPanel` acepta `torch` (lectura de `client.fire`) y `submitFire`; `FirePanel` acepta `openCraft`.
4. `ProjectileView` publica `glow`/`glowColor`/`glowCount`; `LocalLights.setShots()` los lee (un fotograma de retraso,
   imperceptible). Sin objetos de luz de three.js ni recompilación de shaders.
5. Corregido de paso: la etiqueta del hueco vacío decía «No queda combustible» (la clave `empty` estaba duplicada en
   el texto del panel); ahora dice «Vacío».

## Pruebas y QA

- [torch-light](../../tests/torch-light.test.mjs) 6: receta y vista previa, intención `fire` y su respuesta,
  bloqueos (ardiendo, sin tabla, sin fuego), panel con tarjeta/aviso/enlace, luces móviles en huecos libres y
  luces fijas intactas.
- Pruebas del panel de fuego y de la antorcha actualizadas al texto «tabla».
- Suite completa (`node --test tests/*.test.mjs`): **4721 / 4743**, 17 fallos. En origin `5da58e9`, a la vez:
  4714 / 4737 y 18 fallos. Ningún fallo exclusivo de esta rama.
- Selección del actualizador del VPS (25 archivos) más las pruebas nuevas y de fuego: **195 / 195**.
- QA de navegador [`tools/qa-torch-light.mjs`](../../tools/qa-torch-light.mjs) (servidor y cuenta desechables, de
  noche): 1280×720 ES y 844×390 EN aprobadas; fabrica y enciende desde el menú (gasta exactamente 1 tabla), apaga
  desde el panel y captura la bala de cañón de práctica con y sin luz.
- `tools/qa-fire-fuel.mjs`: escritorio aprobado completo. El caso móvil EN falla en origin igual (título del panel
  en español con el documento en inglés: el panel lee el idioma guardado, no el `lang` del documento).

## Pendiente

- En 1280×720 el botón grande de fabricar tapa la última fila de estadísticas (también con el hacha; ya estaba).
- Fabricar tablas sigue necesitando el banco; si el autor quiere antorchas sin banco, haría falta otra receta o
  cambiar el combustible en SQL022.
