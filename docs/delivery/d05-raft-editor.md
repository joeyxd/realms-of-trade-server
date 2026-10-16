# D05 — editor autoritativo de balsas

Fecha: 2026-10-05. Base de trabajo `15bfb44`; integración local `12a6854`. Versión `0.6.0-alpha.2`, protocolo 14.
Brief: [editor acotado de balsas](../briefs/d05-raft-editor.md). Estado: implementado y aceptado localmente en software.

## Resultado

El jugador puede ampliar su balsa primaria amarrada en Aldea con siete piezas permitidas: cimiento, piso, pilar,
pared, barandilla, escalera y caja. El plano de inicio y sus cuatro cimientos, vela y caja no cambian al activar
el editor. Los controles de escritorio son B para entrar/salir, R para rotar solo dentro del contexto explícito,
Esc para cerrar e I para el inventario. Un botón táctil abre el editor; en móvil tocar el mundo solo selecciona
la casilla y el botón de acción confirma la colocación o retirada. En escritorio, el clic coloca; en modo de
retirada, tanto escritorio como móvil requieren pulsar el botón explícito de confirmación. Al entrar/salir se
limpian entradas de combate y las acciones táctiles de combate se ocultan durante el modo.

El panel muestra pieza, coste, materiales presentes en bodega/mochila, oro, capacidad de ambos almacenes,
coordenadas de cuadrícula, nivel, orientación, motivo orientativo y devolución prevista. La previsualización es
una geometría barata con orientación; no construye ni cambia el plano local. `canPlace` solo guía al jugador:
costes, propiedad, plano, bodega, mochila, oro y reglas de seguridad los decide el servidor. Cada operación se
envía con balsa, revisión esperada, UUID y tupla/índice esperado. El cliente conserva la operación pendiente,
reintenta con el mismo UUID si se pierde la respuesta y no la desbloquea hasta recibir acuse y observar la
revisión nueva tanto en el registro público como en el perfil. El servidor guarda recibos de operaciones para
que la repetición no cobre ni devuelva dos veces.

La bodega del jugador es limitada. Cuando hacen falta bienes, el editor ofrece únicamente compras unitarias de
madera o hierro con cotización vigente de Aldea; no crea ni regala materiales. El servidor comprueba stock,
precio, oro y capacidad conjunta antes de comprar. La balsa recibe primero la compra y la mochila recibe el resto.
El jugador debe estar quieto y en calma durante tres segundos para comprar. Construir descuenta primero de la
bodega y luego de la mochila. Retirar devuelve la mitad del coste actual, primero a bodega y después a mochila;
la retirada se rechaza si no cabe la devolución completa. El editor no publica estas existencias en snapshots.

## Autoridad y límites

La orden `raft` se resuelve contra la balsa primaria exacta del jugador, viva y amarrada en Aldea. Se requiere
estar sobre su cubierta o en el acceso permitido junto a la pasarela. Visitantes, identificadores falsificados,
revisiones obsoletas, comandos malformados y operaciones duplicadas no mutan estado. Colocación y retirada
trabajan sobre copias de plano y almacenes y confirman conjuntamente después de verificar la balsa, el coste,
la capacidad, la geometría y el tamaño del guardado. La revisión no puede superar `2^31 - 1`.

Los límites heredados siguen vigentes: hasta 12 × 12 cimientos, tres niveles y la geometría existente de cada
pieza. La huella se calcula en el servidor; la balsa no puede crecer sobre el muelle ni invadir otra balsa y,
si ya tiene pasarela válida, debe conservarla. Los cambios deben preservar el soporte de ocupantes, incluidas
escaleras, aterrizajes activos de Abordaje y una salida segura. La búsqueda conservadora de ruta usa una malla de
0,25 unidades, hasta 20.000 nodos; un caso desconocido se rechaza de forma segura, sin afirmar que el límite sea
un presupuesto de rendimiento.

El saneado existente examina hasta 600 candidatos; D05 añade un techo de edición de 600 piezas para que ninguna
pieza aceptada se descarte al guardar. No es un presupuesto de rendimiento móvil ni ajuste de balance medido.
Antes de mutar se verifica el guardado firmado de invitado contra
`MAX_SAVE` (32 KiB); el almacenamiento de perfiles de cuenta tiene su propio límite. Los recibos conservan hasta
64 operaciones por dueño y limitan la memoria a 256 dueños, con limpieza al desconectar.

La versión nueva es `0.6.0-alpha.2` con protocolo 14 para que el cliente del editor no se conecte al servidor
anterior sin compatibilidad con estas operaciones. No se afirma interoperabilidad entre servidor/clientes de
protocolo distinto ni despliegue del host público.

## Verificación y aceptación visual

- Pruebas específicas: **12/12** (10 de editor y 2 de entrada). Regresión completa: **413/413**, sin fallos,
  omitidos ni cancelados, con concurrencia 2 y timeout por archivo de 60 s (74,5 s totales).
- El flujo cubierto incluye compra real cotizada, saldo/capacidad compartidos, fallos atómicos, soporte y retirada,
  límite de revisión, persistencia de invitado y protección del tamaño del guardado, además de supresión de
  controles de combate del editor. [Registro durable de evidencia y hashes](d05-evidence.json).
- El principal inspeccionó **24 capturas finales**, ocho por caso, con Worker normal, entrada real de UI,
  perfil aislado con oro de QA y una teletransportación inicial de QA al muelle:
  `shots/review/d05/desktop-accepted/`, `shots/review/d05/mobile-accepted/` y
  `shots/review/d05/portrait-accepted/`. Los tres recorridos secuenciales están aceptados. Desktop 1280×720;
  móvil horizontal 844×390; vertical 390×844 con la rotación horizontal existente y coordenadas táctiles correctas.
  En las superficies pequeñas el panel desplaza su contenido para acceder a los controles inferiores.
- La captura usa dibujo de software; la simulación y el Worker siguen activos. Esto permite inspeccionar el
  encuadre de la cámara, controles, compras y ediciones sin afirmar FPS, rendimiento en GPU ni aceptación en un
  teléfono físico. El atlas mantiene una variante por contexto: 1024 en escritorio y 512 en móvil.
- Cero errores de página/juego y error de predicción 0 en las muestras finales. Cada recorrido contiene dos
  fallos de red/consola de Google Fonts bloqueado deliberadamente; se registran, no se cuentan como consola limpia.
- `styles/raft-editor.css` está en la ruta que incluyen los builders de release y artefacto. Las capturas
  desktop cargaron sus mismos bytes antes de mover el archivo; los recorridos móviles cargaron la ruta final.
- La revisión Luna encontró un rechazo innecesario al retirar una caja con carga mixta. Se sustituyó la
  transferencia voraz por una búsqueda acotada de pesos transferibles a la mochila, comprobando la devolución
  completa en copias. Esta corrección de servidor fue posterior a las capturas, sin cambios de UI/atlas;
  su caso de madera/agua está cubierto por una prueba nueva y la regresión final.

## Recorrido observado de QA

En un perfil aislado con oro de prueba, el recorrido del editor compró 19 de madera mediante el mercado de Aldea,
usó las siete piezas, retiró la caja y terminó con 12 piezas, la revisión 28 y la capacidad de bodega ajustada a
6 por la retirada. El plano starter original no se modificó. Este es un resultado del recorrido local de QA, no
un cambio de economía inicial: el oro y la compra pertenecen al fixture aislado. Son 19 compras de madera,
100 de oro gastados (1200→1100) y una madera devuelta. El guardado coincide en revisión, piezas, oro y recursos.

No se reinició el host activo del PC, no se publicó ni desplegó esta integración y no se modificó una partida
online. Los perfiles de QA quedan aislados del guardado habitual.

## Assets y continuidad

No se exportó un nuevo paquete FAB. Las siete piezas usan el renderer procedural y el atlas cómic ya integrado;
la caja conserva el GLB existente y su fallback. El siguiente corte es D06: interacción de bodega, transferencias,
producción y relación más completa con mercaderes, con el banco de taller como candidato de asset. Después puede
prototiparse el manejo de D08; no se adelanta aquí navegación ni balance naval.
