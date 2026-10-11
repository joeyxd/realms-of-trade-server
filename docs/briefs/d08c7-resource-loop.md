# D08c.7 — recursos de costa y primera madera preparada

Fecha: 2026-10-07. Continúa el loop D08c.6; no activa riesgo durable D09.

## Entrega

Recoger troncos/piedra en tierra con F o la acción táctil contextual. Troncos y piedra entran
en `eco.pack`, se pueden guardar en la bodega existente y sobreviven el guardado del perfil.
Un banco en tierra junto al puerto convierte un tronco en una madera del catálogo actual,
con F / Preparar. Esa madera paga las piezas del editor B / Construir sin comprar materiales.
La piedra es un material recolectable para recetas/tiers posteriores; este corte no inventa
una fundición de piedra a hierro ni añade una receta de piedra sin función acordada.

## Autoridad y conservación

- Nodos escasos y propios, generados determinísticamente sin consumir RNG compartido. El servidor
  publica posición, tipo, revisión y disponibilidad; el cliente no concede cantidades ni recursos.
- Proximidad, tierra/altura, vida, calma, acción estacionaria, espacio, revisión y tamaño de guardado
  se verifican antes de cambiar mochila o nodo. Reintentos exactos con `opId` no duplican el resultado;
  cambiar el request con el mismo identificador se rechaza. Recibos acotados de sesión.
- Agotamiento compartido y regeneración por tick de sesión, sin reloj de pared ni persistencia
  durable del nodo. Reiniciar un host puede regenerar nodos; no es una economía pública antifarming.
- Recoger durante exploración terrestre conserva el viaje estacionado; reembarcar recalcula masa
  de mochila con el puente existente. Preparar materiales requiere haber atracado.
- Crafting consume y produce en copia, verifica capacidad/preflight y solo entonces aplica ambos.
  Rechazos no consumen tronco ni agotan recursos. Guardado/confirmación reutilizan el perfil actual.
- Cantidades, radio, pausa y regeneración son valores iniciales para probar; no balance aceptado.
  Porte por masa/volumen y tiers de materiales, aprobados conceptualmente, siguen después.

## Reutilización y presentación

Luna revisó inventario Unreal/FAB y entregas S02/S09: reutilizar la roca costera auditada,
el tronco y la pila de tablas del kit de playa ya presentes en registry, con sus fallbacks.
Los props decorativos actuales conservan su semántica. Nodos separados con marca dorada/cian,
agotamiento visible y banco identificado, sin atlas/texturas nuevos. Geometría/materiales
compartidos, máximo 16 nodos y distancia de dibujo acotada; no afirmar FPS físicos.
Reutilizar `sfx.pickup()` sintetizado; no hay cue Unreal de recolección auditionado/verificado.

## Equipo y aceptación

Principal: catálogo, colocación, transporte/protocolo, renderer, UI e integración/aceptación.
GPT-6 Luna: auditoría de reutilización y rutas; módulo de autoridad y pruebas en archivos propios;
runner de navegador/evidencia en archivos propios. Un escritor por archivo, una GPU a la vez.

Comprobar disputas entre jugadores, capacidad/rechazos sin pérdida, replay, preflight,
agotamiento/regeneración, crafting, saneado/guardado y consumo real en construcción.
Navegador con host memory de loopback, entradas reales F/touch, PC y móvil rotado/horizontal;
capturas inspeccionadas y errores del cliente. Sin `.env`, SQL, migraciones, push ni publicación.
