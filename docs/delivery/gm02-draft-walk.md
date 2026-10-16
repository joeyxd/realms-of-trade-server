# GM02 — decoración existente y prueba caminando

Estado: **publicado y verificado en producción en alpha.25/protocolo 37**.
El corte parte de `883d35e` (alpha.23/protocolo 36); la integración `c4ada55` conserva refugio naval
y Tala de upstream `7ca767e`, sin activar SQL016 ni cambiar flags.
[Brief previo](../briefs/gm02-draft-walk.md) · [Plan GM](../../PLAN-GM-EDITOR.md).

## Resultado

La pestaña **Escena / Scene** permite buscar y seleccionar decoración base segura: rocas naturales y
costeras, flores y guijarros. También incluye los modelos nuevos del borrador. La selección enfoca el
modelo; el manipulador y los campos permiten mover, girar y escalar. Una pieza base puede ocultarse,
duplicarse o restaurarse exactamente al original, con deshacer/rehacer.

El documento v2 guarda overrides con IDs ligados a seed, revisión, índice original y fingerprint.
Los documentos v1 migran conservando objetos y revisión CAS. Guardar/reabrir, exportar/importar y
recuperar conservan los overrides; una referencia base ausente o incompatible se rechaza antes de
alterar la escena o sobrescribir el borrador. El guardado continúa en IndexedDB por navegador/cuenta/mundo.

Las instancias base permanecen en sus batches. El editor aplica matrices privadas y conserva las matrices
originales exactas; cierre, fallo de entrada o revocación las restauran. No modifica `map.props`, los
colliders originales ni los IDs/estado de recursos. Un círculo base se edita solo si la asociación
prop/collider tiene un único dueño en ambas direcciones. Se conservan también los colliders independientes.

El inspector ofrece **Ninguna / Círculo en XZ** para las piezas nuevas, con radio inicial estimado del
modelo y ajustable; la huella muestra el radio escalado. Las piezas base conservan su círculo proporcional
a la escala. Los círculos bloquean a cualquier altura: no representan mallas, interiores ni superficies
transitables. Se excluyen rocas volcánicas, palmas, arbustos, recursos, NPC, edificios funcionales, muelle
y barcos. No hay edición de terreno en este corte.

**Probar caminando / Walk test** crea un World local descartable con un personaje, terrain y colliders
del borrador. Usa el movimiento real `stepMover`, sin entrar al servidor ni enviar comandos o conceder
progreso. WASD camina; Escape o Volver al editor restaura cámara, selección y documento. Blur libera
teclas; logout/cierre elimina el preview, sus listeners y sus materiales/skeleton propios. No libera
geometrías o texturas compartidas. Los nombres flotantes del gameplay se ocultan durante la edición.

## Reutilización y coste

Se reutilizan geometrías/materiales de vegetación, modelos GM00 bajo demanda y el personaje actual.
El brief contrasta el inventario Unreal/FAB y `SM_StoragePart_03`; no hace falta exportar o crear arte.
No se añaden modelos, texturas, dependencias de runtime, migraciones SQL ni protocolo de red del editor.
La búsqueda de círculos del preview recorre una lista acotada, evitando expandir una cuadrícula para
radios heredados extremos. No se midieron FPS en hardware móvil físico ni se habilitó edición táctil.

## Evidencia local

- Suite seleccionada integrada: **162/162**, incluidas **51 GM**, en [test-evidence.json](gm02/test-evidence.json).
  Cubre Three.js real, matrices exactas, duplicación, propiedad ambigua de colliders, migración v1,
  historial/CAS/recuperación, movimiento real y limpieza del preview.
- Navegador: **28/28** con autenticación simulada y servidor loopback. Cuatro calidades por tres modos
  de gizmo, arrastre real, edición/ocultación/restauración de base, duplicación sin doble transformación,
  guardado/reapertura/export/import y rechazo de fingerprint obsoleto. Caminar usa WASD real y comprueba
  bloqueo circular, blur, cámara/documento idénticos al volver, tres ciclos sin acumular vistas/texturas,
  conflicto entre pestañas, revocación durante preview y entrada normal al juego. Contadores de errores
  del loop y de página vacíos. [Recibo](gm02/browser-evidence.json).
- Capturas inspeccionadas: [edición base ES](gm02/gm02-base-edit-es.png) y
  [prueba caminando EN](gm02/gm02-walk-preview-en.png), además de las cuatro calidades del gizmo.
  La selección queda encuadrada, el círculo es visible y el personaje aparece fuera del proxy nuevo.

## Publicación

La release verificada es `e2ff69ecf814056dbeaed4d202c5cdd6d5d67d61`, imagen
`marea-negra:alpha-e2ff69ecf814` / `sha256:e6701a415003812dbebc0e0464f91a4792adb0a9c8cd7a287f35c409a40391a1`,
sana desde 2026-10-10T19:37:56Z. El actualizador pasó **107/107** offline antes de sustituir la única
autoridad. La comprobación final a las 19:39:17Z confirmó `/health` 200, versión alpha.25, Supabase durable
con cuentas, economía/recursos listos, tick avanzando y cero errores/jugadores/sockets/guardados pendientes.
Tala continúa apagada y SQL016 pendiente; no se alteraron flags, SQL, secretos ni la autoridad M5.
[Recibo de despliegue](gm02/deployment-evidence.json).

El navegador público pasó **12/12** con Supabase real: invitado sin permiso, entrada normal WSS,
modelo optimizado con bytes/hash correctos, sesión GM y gizmo en calidad alta con contornos, colocación,
edición privada de roca base, guardar/cerrar/reabrir/restaurar, duplicación y radio automático,
WASD en preview privado, cámara/documento/mapa intactos al volver y logout durante preview con limpieza.
Errores de página y del loop vacíos. [Recibo público](gm02/public-evidence.json).
Las cinco capturas públicas fueron inspeccionadas, especialmente [edición base](gm02/production-gm02-base.png)
y [recorrido](gm02/production-gm02-walk.png). Se canceló el formulario de contraseña: no se cambió la del
autor. El token de prueba fue consumido, borrado del URL y eliminado del archivo temporal; el logout fue
solo de esa sesión QA. No se tocó el borrador del navegador del autor.

La integración en el workspace compartido conserva los cambios concurrentes de idioma. Pasó además
27/27 pruebas enfocadas y navegador 28/28 allí. Ese árbol aún declara alpha.17 y contiene otros cambios
sin commit: no constituye la release publicada ni se empaquetó entero.

Sigue **GM03**: borradores remotos durables y publicación controlada. GM02 permite experimentar
localmente; todavía no cambia el mundo compartido de los jugadores.
