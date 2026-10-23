# HUD naval de la partida ordinaria y publicación del avance

2026-10-09 · **0.6.0-alpha.16 / protocolo 32**.

El autor pidió subir el avance acumulado porque al pilotar en la partida ordinaria aparecía
la barra grande de información. El HUD compacto ya estaba en touch, pero escritorio conservaba
esa composición anterior. Ahora ambos usan el instrumento y las lecturas del HUD de referencia.

## Resultado

- Escritorio: velocímetro abajo a la derecha, tarjetas abajo al centro, rumbo/viento arriba a
  la derecha, objetivo/capacidad arriba a la izquierda e integridad del casco junto a las barras
  del personaje. La barra antigua y los sticks táctiles quedan ocultos.
- Las tarjetas muestran la tecla de su acción: **Q** ráfaga, **I** mochila y **E** cubierta/timón.
  Al asignar centrar cámara o mapa, la letra pasa a **V** o **M**. Mantener una tarjeta abre el
  selector existente; no ejecuta la acción anterior. Los atajos conservan el comportamiento
  normal de mochila/mapa fuera de navegación y se restauran al desmontar la vista.
- Touch conserva timón pequeño, stick de cámara y botones en arco alrededor del velocímetro;
  las letras se ocultan. Chat y avisos se separan de las barras y controles.
- Caminar por cubierta conserva el cuerpo naval autoritativo. El HUD ahora distingue ese estado
  del pilotaje: oculta captura y práctica de ruta, muestra «Toma el timón» y ofrece E para volver.
- Todas las cifras vienen de viento, carga, capacidad e integridad reales. Se mantienen unidades
  del juego **u/s**, **uM** y **uV**; no se inventan enemigos, habilidades, nudos ni porcentajes de carga.

## Verificación

`node tools/qa-live-hud.mjs`: **3/3 recorridos**, escritorio 1365×768, touch 844×390 y
390×844 con stage horizontal rotado. Host aislado `dev:false`, almacén en memoria, partida
ordinaria y comandos reales; el fixture únicamente coloca al propietario ante el timón de su
balsa inicial. No lee `.env`, no aplica SQL ni llama proveedores externos.

Los recorridos verifican montar, ausencia de barra antigua, bounds del HUD, dos sticks sólo en
touch, letras Q/I/E, teclado Q e I, reasignación a V y centrado con esa tecla, cubierta, regreso
al timón con E, pausa/reanudación, amarre G/touch y limpieza de punteros/atajos al disponer la
vista. **12 capturas**; montado/cubierta revisados visualmente en escritorio y touch.
[Manifiesto](live-hud-publication/evidence.json).

Pruebas focales: **21/21** en `naval-touch-helm`, `naval-route-ui` y `naval-recovery-ui`.
La ejecución completa previa al cierre del HUD pasó **3042 pruebas**, **0 fallos**, **3 omitidas**;
los cambios posteriores de UI se comprobaron con esas pruebas focales y los tres recorridos.
No demuestra balance, rendimiento físico ni aceptación multijugador humana.

## Alcance de publicación

El avance acumulado ya se subió en `1a3ef18`, seguido del contrato comunitario aislado `be1634f`.
Este informe registra la corrección posterior del HUD. **Push de Git y prueba local son estados
distintos del despliegue de una URL pública**. El servidor ordinario revalida sus archivos estáticos
con `no-cache`; una pestaña abierta necesita recarga para recibir estos módulos y estilos.

No cambia simulación, perfil, protocolo, persistencia, proveedores, permisos ni políticas de pérdida.
Se reutilizan SVG y componentes nativos del HUD ya aceptados; no hace falta una textura alpha nueva
ni un modelo del inventario Unreal/FAB para este cambio de composición y controles.
