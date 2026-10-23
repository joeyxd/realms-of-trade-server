# Demo integrada actualizada — 2026-10-06

Fuente comprobada y subida: `f89bec5fdd89cf1f0ceb04cb4e131832052bfee5`, rama `claude/loving-lovelace-ptbif7` / PR #1.
Versión **0.6.0-alpha.4**, protocolo **16**. [Evidencia](demo-update-20261006-evidence.json).
El commit posterior de este informe solo añade documentación; no cambia el runtime comprobado.

## Para probar

- **Juego con amigos:** https://glennie-uninferable-bitingly.ngrok-free.dev. Pasa el aviso de ngrok si aparece y elige invitado o una cuenta confirmada.
- **En este PC:** http://localhost:5173/. En la Aldea, sube a la balsa; **B** abre construcción y **H** bodega/producción.
  Compra materiales en el mercader, construye/retira piezas, mueve carga y prueba red/parrilla.
- **Bahía de manejo experimental, solo en este PC:** http://127.0.0.1:5180/. Compara vacío, carga y acomodo;
  W/S/A/D, viento y soltar lastre. Es el laboratorio D08a; el pilotaje todavía no está conectado a la partida.

Mantén el PC encendido y conectado. `DETENER-JUEGO.cmd` cierra el juego/túnel con guardado;
`JUGAR-CON-AMIGOS.cmd` permite volver a iniciarlo. El laboratorio tiene un proceso independiente.
Recarga la página si tenías una sesión de una versión anterior.

## Comprobaciones

- **745/745 pruebas**, 74 archivos, cero fallos/omisiones, sobre un árbol aislado del commit exacto;
  duración de proceso 181673 ms. GPT-6 Luna ejecutó la regresión; el principal revisó log y resultado.
- Paquete local `dist/0.6.0-alpha.4-f89bec5fdd89`: **146 archivos / 2.133.583 bytes**, hashes verificados.
- Host nuevo arrancado desde ese checkout con el túnel ngrok existente, **sin abrir navegador**.
  Configuración existente de Supabase/Auth y mundo `marea-negra` conservada; DEV apagado, cuatro plazas.
  Mundo cargado y listo; cero errores al comprobar. No se aplicaron migraciones.
  Este corte probó invitados; no repitió login ni persistencia de perfiles de cuentas.
- **153 archivos públicos** coinciden con el commit: página original con marcador del servidor, módulos,
  CSS y assets. Textos comparados normalizando LF/CRLF; modelos/imágenes comparados por bytes.
  El paquete generado incrusta CSS; el host PC sirve la página/CSS del checkout, ambos del mismo commit.
- Canario en localhost y **HTTPS/WSS público**: dos identidades distintas, spawns mutuos,
  movimiento compartido y despawn. Archivos privados devuelven 404. Las conexiones temporales se cerraron.
- Laboratorio 5180 iniciado y entrada HTTP 200. Regresión incluye sus contratos de manejo, controles y servidor.

## Alcance y siguiente paso

La demo reúne los sistemas activos actuales: isla/combate/tatuajes/perlas existentes, balsa transitable,
editor, materiales, bodega, comercio y primera producción. El staging durable de perlas sigue server-only;
006 real, recuperación/hooks/adopción/leases y activación conservan sus pendientes de M5.

Es una actualización del host PC de pruebas. No es un despliegue VPS ni republicación del Artifact de Claude.
No hay nuevas capturas ni mediciones físicas de FPS en este corte: aceptación móvil D06b y visual/humana
D08a siguen pendientes. Sigue probar la demo juntos, registrar sensación/errores, cerrar esas aceptaciones
y avanzar los cortes de autoridad/predicción/cubierta móvil sin activar prematuramente riesgo persistente.
