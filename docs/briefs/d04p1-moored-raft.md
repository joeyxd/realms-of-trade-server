# D04 P1 — balsa propia visible en el muelle

Base: `da757d3`, 2026-10-05. Entrega acotada M6 P1; P2 cubierta transitable sigue después.

El principal fija propiedad, migración, pose, réplica e integración. Tres agentes GPT-6 Luna implementan
saneado económico, renderer y comprobaciones en archivos disjuntos; un solo recorrido de navegador.
Checkout de trabajo: `C:\DEV\real of trade\raft-d04`; conservar los cambios anteriores de HANDOFF en la rama principal.

- Perfil v1 conservado. `eco.raftV:1` registra la concesión/migración inicial; no se reponen flotas ni planos
  explícitamente vacíos. Los legacy conservan sus barcos/carga; si no tienen balsa y hay hueco reciben una.
- `eco.id` y `ship.id` se asignan por la autoridad con un namespace creado fuera de la simulación y se guardan.
  Una copia concurrente de la misma identidad/barco se rechaza dentro del proceso. No demuestra custodia durable.
- Solo la primera balsa operativa amarrada en `aldea` de cada perfil conectado tiene presencia mundial.
  Un vehículo ECS lleva pose, sin mezclarse con spawns de personajes. Al salir se retira la vista activa;
  el perfil conserva barco, piezas, bodega y amarre preferido. Si está libre se reutiliza al regresar.
- Amarre de prototipo elegido por servidor: coordenadas derivadas del muelle y tamaño del plano. Sin pose
  cliente ni teleport de barcos desde otros puertos/mar. Cubierta visual Y=0,72; niveles separados 2,6 u.
- Protocolo 13: lista completa `rafts` con id/entidad/propietario público/revisión/nombre/amarre/pose/piezas/aspecto.
  Nunca bodega, eco.id, cuenta ni perfil. Snapshots recientes reparan altas/bajas; antiguos no revierten la lista.
- Renderer procedural por piezas y colores, caché por id/revisión/contenido; usa la caja FAB ya cargada y
  vuelve a caja procedural sin asset. Repetir snapshot no recrea geometría. Ausentes se eliminan y limpian.

Aceptación: migración/reconexión sin duplicar, dos propietarios y entrada tardía coherentes, privacidad,
guardado/carga con bodega intacta, vehículo visible día/noche en escritorio y low móvil, fallback de caja.
Evidencia de software/emulación no acredita GPU, teléfono real, FPS ni servicio Supabase real.

Fuera del corte: caminar/subir pisos/colisiones de balsa (P2), editor (D05), producción y UI de bodega (D06),
zarpar/combate/pérdidas/recuperación. M5 conserva su puerta para bienes persistentes en riesgo; las decisiones
navales abiertas no se cierran mediante esta entrega. No abrir ni escribir proyectos Unreal ni importar nuevos packs.
