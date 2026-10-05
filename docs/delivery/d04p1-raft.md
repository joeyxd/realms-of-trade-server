# D04 P1 — tu balsa visible en el muelle

Aceptación local, 2026-10-05. Base `da757d3`; versión `0.6.0-alpha.1`, protocolo **13**, perfil v1.
Este corte completa M6 P1. D04 también incluye P2, que sigue pendiente: la cubierta todavía no es suelo.
Brief: [contrato y alcance](../briefs/d04p1-moored-raft.md). Evidencia resumida: [d04p1-evidence.json](d04p1-evidence.json).

Un perfil nuevo recibe cuatro cimientos, una vela y una caja. La autoridad asigna identidad estable y
amarre, replica el plano a los demás jugadores y conserva piezas/bodega al guardar. La caja reutiliza el
modelo FAB A02 ya aceptado; el resto se dibuja por piezas con agrupación por color y fallback procedural.
Tres agentes GPT-6 Luna implementaron y revisaron tareas acotadas; el principal fijó el contrato, integró
y comprobó la evidencia. No se abrieron ni modificaron proyectos Unreal ni se importaron packs nuevos.

## Contrato que queda probado

- Migración inicial única: se conservan barcos y bienes legacy; flota o plano explícitamente vacíos con
  marcador no vuelven a recibir starter. HP cero tampoco se restaura al cargar.
- Identidad de propietario/barco guardada. Copias concurrentes se rechazan en el mismo proceso; huecos
  de IDs y duplicados dentro del perfil se reparan sin robar un ID posterior ya guardado.
- Solo la primera balsa operativa en Aldea de cada perfil conectado tiene presencia mundial. El servidor
  deriva la pose del muelle/plano, evita amarres ocupados y remapea amarres fuera del mapa. Sin hueco válido
  se conserva el barco guardado sin vista. Salir retira la entidad activa; volver conserva el barco y,
  si está libre, su amarre preferido. Las flotas en otros puertos no se teletransportan.
- Lista completa de snapshots, entrada tardía, dos propietarios y reconexión coherentes. Snapshots viejos
  no revierten la lista. Los vehículos no pasan por el renderer de personajes. Comandos de editar/pose
  no están habilitados en P1; el cliente no decide dónde está la balsa.
- Solo plano/aspecto/pose/propietario ECS público salen en `rafts`: no bodega, perfil, cuenta ni `eco.id`.
  El propietario público es una entidad de sesión, no una clave de cuenta persistente.
- La capacidad de la bodega se recalcula desde las piezas; el saneado anterior la inflaba a un millón
  al recargar. Se corrigió conservando los bienes legacy, incluso si exceden la nueva capacidad.
  Editor/carga futura deberá impedir aumentarla mediante operaciones que dejen sobrecarga.
- El renderer reutiliza la vista con snapshots idénticos, elimina ausentes y libera geometría propia;
  no destruye recursos compartidos de assets. Flotación visual leve, sin navegación simulada.

## Verificación

**304/304 pruebas** en el árbol aislado: regresión 302/302 (41,693 ms) y red 2/2 (7,559 ms), con el
navegador detenido. Incluye ocho pruebas nuevas: migración/identidad/amarres/privacidad/cliente, WebSocket
real y guardar/cerrar/reabrir `GameHost` con memoryStore. Logs locales:
`shots/review/d04p1/regression.log` y `net.log`. El recorrido de almacenamiento usa identidad confiada
simulada; no demuestra Supabase real ni concurrencia entre procesos.

Capturas inspeccionadas de escritorio high y móvil low emulado, día/noche; una balsa, sus seis piezas,
caja FAB y recarga desde el SAVE normal del Worker. Sin errores de página/juego; dos errores de consola
por fuentes Google bloqueadas deliberadamente por el harness. El fallback sin assets conserva el mismo
plano y muestra una caja procedural. Evidencia local en `shots/review/d04p1/<caso>/evidence.json` y PNGs.
`tools/look-raft.mjs` pausa el Worker y ajusta cámara/hora visual para fotografía; no fabrica partidas
ni asigna snapshots o perfiles. Oculta etiquetas en estas fotos para evitar proyecciones congeladas.

SwiftShader y viewport táctil son aceptación visual de software: sin afirmaciones de FPS, GPU real o
teléfono físico. Los contadores de geometrías/texturas no son mediciones de VRAM. El árbol de cuentas
M5 P2 que evoluciona en el checkout principal no forma parte de estas 304 pruebas ni del artefacto fijado.

## Siguiente corte

**D04 P2**: consultas compartidas de suelo/bloqueos para muelle → cubierta, paredes y escaleras con altura,
predicción y autoridad concordantes. Después D05 editor y D06 bodega/producción. Todavía no se puede
habitar, editar, zarpar ni combatir con esta balsa. M5 mantiene su puerta antes de bienes persistentes
en riesgo: blobs anónimos siguen siendo reproducibles fuera del proceso; P1 no ofrece custodia durable.
No se realizó push, despliegue ni publicación.
