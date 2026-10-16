# GM05a — escultura de terreno en borrador

Fecha: 2026-10-10, hora de México. Dirección aprobada por el autor después de GM04b.
Continúa [el plan GM §9](../../PLAN-GM-EDITOR.md#9-edición-y-ampliación-del-terreno).

## Resultado y secuencia

Dentro del editor: pestaña Terreno, pinceles subir, bajar, aplanar, suavizar y rampa entre dos puntos.
Radio, fuerza y caída suave; círculo de preview; Escape/blur cancela el gesto completo; un undo por trazo.
Probar caminando consume el terreno del borrador. Guardar/reabrir/exportar/importar conserva las alturas.
La publicación usa la misma compilación en host y clientes y las verificaciones Online existentes.
GM05b añade pintura de las familias de suelo; GM06 cambia costa, crea tierra o amplía los bounds.

## Representación y compatibilidad

Los documentos v1/v2 continúan normalizándose exactamente como antes. Solo un documento con terreno usa
v3: campos anteriores más `terrain: {version: 1, samples: [[index, deltaMm], ...]}`. Índices ordenados,
únicos, sobre la rejilla base de 561×561; deltas enteros en milímetros, no nulos, hasta ±12 m y 20.000
muestras. El resultado completo, no una reproducción indefinida de gestos, es la fuente de verdad.
La semilla y revisión base siguen siendo obligatorias. Validación estricta y pura compartida; no reloj,
GPU ni RNG para compilar. Las revisiones antiguas conservan su documento/hash.

SQL031 extiende el validador de SQL020 para guardar v3 y conserva el camino v2 y sus recibos.
La preparación añade el hash SHA-256 de las alturas Float32 completas y el tamaño de rejilla;
el cliente recompila y verifica ese hash antes de admitir el contenido. Los recursos conservan
el catálogo base, incluidos sus IDs y alturas. No se añade estado de perfil.

## Límites del primer corte

Solo suelo seco existente y dentro del dominio actual; alturas base/resultantes ≥0,75 m. Sin cambio del
nivel del mar ni de costa. Radio 2–24 m. Se bloquean muestras y un margen de interpolación alrededor de
spawn, servicios, recursos, muelle, arena, volcán, PvP, rutas/checkpoints y props funcionales. El servidor
comprueba esta política también al guardar/preparar, independientemente del cliente. Un gesto inválido
se rechaza completo. Las zonas protegidas no se recortan silenciosamente.

La decoración segura apoyada en suelo conserva su offset vertical mediante transformaciones explícitas
en el mismo documento/trazo. Los elementos funcionales y flotantes permanecen protegidos; no se crean
superficies nuevas para GLB. No se mueve estado dinámico ni se añade otra autoridad persistente.

## Render, simulación y recursos

Una proyección privada contiene alturas/sampler/groundAt/materialAt del borrador; nunca modifica la base.
La malla editada usa la rejilla canónica y su triangulación, con normales/bounds actualizados. El sampler
usa esos triángulos en las celdas afectadas por un delta; fuera de ellas conserva exactamente las funciones
base. Un terreno vacío conserva también los arrays y funciones originales. Agua recibe una textura de altura actualizada.
La cartografía lee la proyección nueva; cerrar/cancelar restaura la escena activa y libera recursos propios.
Reutilizar las familias de arena/suelo existentes. El inventario Unreal/FAB se revisa para herramientas y
materiales: paquetes Landscape no sustituyen el heightfield/sampler determinista de Three.js. No exportar
fuentes ni añadir mapas 2K/4K a este corte; registrar candidatos concretos y decisión antes de implementarlos.

El preview con deltas usa una malla completa de 560×560 celdas frente a las 250/320 anteriores: aumenta
triángulos, sin texturas nuevas. Este corte verifica funcionamiento y lectura en viewport estrecho;
no acredita rendimiento en teléfono físico. Chunks/LOD requieren otra medición y corte de optimización.

## Aceptación

- Deltas canónicos, límites/corrupción/base equivocada rechazados, sin mutar alturas/props de origen.
- Subir/bajar/aplanar/suavizar/rampa, continuidad de trazo, cancelación y undo/redo exactos.
- Borradores v1/v2, plantillas y edición de decoración conservados; v3 persiste local/remoto y exporta.
- Zonas funcionales/costa protegidas en cliente y host; preparación/activación comparten altura real.
- Navegador ES/EN y viewport estrecho, capturas inspeccionadas y recorrido real sobre rampa.
- Comprobaciones pertinentes, publicación por actualizador con mundo vacío, revisión/imagen/salud y
  entrada pública verificadas antes de declarar desplegado. FPS de teléfono físico sigue pendiente.
