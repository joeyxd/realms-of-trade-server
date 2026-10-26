# D08c.7 — costa → mochila → madera → construcción

Fecha: 2026-10-07. Implementación local `0.6.0-alpha.7`, protocolo **22**.
Contrato: [brief](../briefs/d08c7-resource-loop.md). Sin commit/push/publicación en este corte.

## Comportamiento

Hasta 16 nodos claros y accesibles de troncos/piedra alrededor de la costa, incluidos varios
en la playa inicial. F / Recoger concede una unidad a la mochila económica; se agota para todos
y vuelve tras 3.600 ticks (60 s a 60 Hz). Marca dorada para troncos, cian para piedra y gris
para nodos agotados. Ni palmas ni el clutter ambiental se convierten en recursos.

El banco de carpintería en tierra junto al puerto, identificado en el mundo, ofrece F / Preparar:
1 tronco → 1 madera del catálogo de construcción. Madera, troncos y piedra usan la bodega y
guardado de perfil existentes. El editor consume esa madera real para cimientos, pisos,
paredes, pilares, cajas y otras piezas disponibles. No se paga oro por recoger/preparar.
La piedra permanece material recolectable, sin receta o tier de piedra activado en este corte.

Los controles son los mismos en PC y móvil: F y el botón contextual. Sonido de recogida
existente, aviso de contenido/capacidad y confirmación privada; sin conceder material por
predicción. Una respuesta perdida permite reenviar el mismo request tras cinco segundos.

## Autoridad

- Sesión admitida y gate del mundo en LocalServer; perfiles/cuentas no salen por el catálogo público.
- Nodo, revisión, posición terrestre, distancia, jugador vivo, calma y acción estacionaria;
  capacidad y guardado candidato antes de agotar nodo/cambiar mochila.
- Crafting verifica revisión de mochila, insumos, cercanía al banco y salida completa.
  Construcción/crafting no se habilitan durante una travesía. Recoger en la exploración terrestre
  sí funciona; reembarcar reconstruye la masa de mochila con el puente ya aceptado.
- Reintentos exactos por `opId` conservan un resultado; solicitudes distintas con el mismo ID se
  rechazan. 64 recibos por jugador, hasta 256 propietarios, limpiados al detach. Ventana de sesión,
  con revisiones que siguen rechazando requests antiguos fuera de ella; no diario durable D09.
- Agotamiento y regeneración dependen de ticks y son de sesión. Reiniciar host puede regenerar
  nodos. El guardado conserva bienes del perfil, no la disponibilidad durable de los recursos.
- Valores de radio, pausas, regeneración y receta iniciales para probar, sin afirmar balance
  económico final. El porte aprobado y la separación masa/volumen todavía no se implementan.

## Reutilización y coste

Auditoría Luna sobre inventario Unreal/FAB y entregas S02/S09: roca costera auditada
`model:coast-rock-v1`, tronco `model:beach-debris-log-v1` y tablas `model:beach-debris-planks-v1`,
todos ya presentes en registry, más fallbacks. Banco compuesto con las tablas existentes.
Sin export ni cambio a `C:\Unreal`, manifiesto o texturas nuevas. Geometrías/materiales
compartidos y dibujo de nodos hasta 30 u (marcas elevadas hasta 18 u); banco hasta 38 u.
Reutiliza `sfx.pickup()`: no hay un cue de recoger Unreal auditionado/verificado.

## Verificación

**154/154 pruebas focales**, sin fallos/skips: 10 propias de recursos y 5 de integración
de servidor, más economía, editor/bodega/guardado/producción, navegación y gates existentes.
El test integrado usa navegación real hasta una costa sin modificar queries del terreno;
recoge en tierra, rechaza crafting durante el viaje y demuestra más masa al reembarcar.
Otro recorre recoger → preparar → construir barandilla → save HMAC → servidor nuevo,
con consumo conservado y oro intacto. No es una suite completa de todo el checkout.

Logs locales: `.scratch/d08c7-tests.log`, `.scratch/d08c7-boundary-tests.log`,
`.scratch/d08c7-loop-tests.log`. Syntax y `git diff --check` pertinentes pasan.
Build de artefacto local genera página de 153.734 B y 262 módulos/assets; incluye los cuatro
módulos nuevos. No se publica ese build ni se aplica SQL.

**3/3 recorridos de navegador emulado pasan**, con Chrome normal sin forzar SwiftShader,
calidad Baja y heartbeat del host intacto. PC usa F; móvil usa el botón contextual y toque
real sobre la cubierta en el editor. Dos troncos y una piedra → preparar una madera →
colocar una barandilla → esperar el nuevo save firmado exacto → recargar conserva el
tronco y piedra restantes, la pieza y el oro inicial. Cero errores de JS/consola en las tres vistas.

| Vista | Resultado | Evidencia visual |
| --- | --- | --- |
| PC 1280×720 | F, banco, editor y reentrada | [Banco](d08c7-resource-loop/resource-desktop-1280x720-02-bench-crafted.png), [barandilla](d08c7-resource-loop/resource-desktop-1280x720-03-raft-railing.png) |
| Móvil 844×390 | Recoger/Preparar y colocación con toque | [Banco](d08c7-resource-loop/resource-mobile-844x390-02-bench-crafted.png), [barandilla](d08c7-resource-loop/resource-mobile-844x390-03-raft-railing.png) |
| Vertical 390×844, stage rotado | Mismo loop y guardado | [Banco](d08c7-resource-loop/resource-portrait-390x844-02-bench-crafted.png), [barandilla](d08c7-resource-loop/resource-portrait-390x844-03-raft-railing.png) |

[JSON consolidado](d08c7-resource-loop/resource-loop-evidence.json) y runner
`tools/qa-resource-loop.mjs`. Capturas inspeccionadas por el principal. Los tres IDs de
roca/tronco/tablas están efectivamente cargados; catálogo de recursos en snapshot de
2.173–2.186 B en las muestras. No mide FPS en teléfono ni coste total de la escena.

Fixture: host memory de loopback independiente por vista, sin `.env` ni almacenamiento externo;
reubica jugadores en posiciones reales y espera calma/cooldown del servidor. El segundo participante
de PC usa HELLO/CMD WebSocket real sin escena: disputa con la revisión original, un solo éxito y
mochila llena rechazada sin agotar el nodo. La prueba de simultaneidad también está en la suite de servidor.
La cámara se encuadra tras la reubicación al barco en móvil/vertical (`cameraSnapForAcceptance`);
apuntar/colocar siguen siendo toques reales con hit-test de canvas, sin inyectar target del editor.
No verifica el seguimiento natural de cámara durante una travesía. Solo la mochila del segundo
participante recibe una fixture llena; no se inyectan materiales ni oro al propietario.

Los intentos fallidos previos se conservan separados en el JSON: cierre 1006 al forzar SwiftShader,
esperas de prewarm y errores del propio recorrido de prueba (calma, competencia por el prompt,
proyección/encuadre y cero de mercancía eliminada). No se modificó el heartbeat de producción.
La aceptación funcional corresponde a las tres corridas finales, no a esos intentos.

## Continuidad

Primera receta y recolección cierran la conexión de materiales con el editor existente.
Sigue la lectura única de masa/volumen y porte restante al construir/cargar; después
tiers/recetas regionales y crafting de barco. El daño operativo continúa de sesión,
con pérdidas/recuperación durables detrás de D09 y encuentros/rutas detrás de D10.
Dispositivos físicos/FPS, balance del autor y publicación mantienen sus puertas.
