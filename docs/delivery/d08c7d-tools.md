# D08c.7d — fabricar herramientas y minar

2026-10-08 · **0.6.0-alpha.16 / protocolo 32 · implementación y verificación locales**.
El autor aprueba continuar desde la propuesta de herramientas y minería. Este corte cierra
el arranque desde mochila vacía hasta hacha/pico guardados y materiales para la balsa. La
interacción entregada es clásica por golpes F/touch; mantener y bonus de timing siguen pendientes.

## Recorrido jugable

| Acción | Coste / resultado inicial |
|---|---|
| Recoger a mano | 11 troncos sueltos y 69 piedras pequeñas conservados |
| Preparar madera | 1 tronco → 1 madera; tandas hasta 10, como antes |
| Fabricar hacha de piedra | 1 madera + 1 piedra → ranura de hacha |
| Fabricar pico de piedra | 1 madera + 2 piedras → ranura de pico |
| Cortar palmera | Hacha, 3 golpes → 2 troncos; 96 palmeras |
| Picar roca grande | Pico, 4 golpes → 2 piedras; 24 rocas nuevas |
| Extraer hierro | Pico, 5 golpes → 1 mineral de hierro bruto; 6 vetas nuevas |

Las herramientas viven en dos ranuras fijas de cinturón, una de cada tipo, fuera del arma
de combate y del volumen de mochila. Son permanentes en este corte: no se acumulan, comercian
ni rompen. Fabricar una ya poseída se rechaza antes del débito. El banco muestra ingredientes,
espacio después de consumirlos y propiedad confirmada; el cliente no concede herramientas.
Las cifras son tuning inicial, no balance de economía aceptado.

`mineral_hierro` es un bien bruto separado del `hierro` existente, volumen 3 / masa 6 en unidades
abstractas. Se recoge, carga y guarda con el catálogo de bienes actual. No añade stock/recetas
a mercados ni transforma automáticamente mineral en hierro. La fundición y recetas regionales
se conectarán al desarrollo de pueblos; estas seis vetas son depósitos iniciales de aprendizaje,
sin sustituir la especialización futura de Bahía Ceniza.

## Autoridad, compatibilidad y estado compartido

- Recetas cerradas en `CRAFT_RECIPES`; una receta de herramienta por operación, sin campos
  de herramienta/tier/rendimiento impuestos por cliente. Herramientas con defaults y saneado
  estricto 0/1; perfiles antiguos sin el campo entran sin herramientas, conservando sus otros datos.
- Insumos, cinturón, revisión de comercio, preflight de guardado y recibo se confirman juntos.
  Replay exacto devuelve el recibo; reutilizar ID con otra solicitud se rechaza. Costes/revisión
  no cambian ante materiales insuficientes, revisión vieja, duplicado o preflight false/throw.
- El servidor comprueba herramienta poseída, distancia, tierra, vida, calma, inmovilidad,
  cooldown, revisión y espacio para **todo** el rendimiento antes de cada golpe. Progreso
  público compartido; sólo el último golpe concede bienes y avanza la revisión de comercio.
  Cada golpe aceptado avanza revisión de nodo y emite un impacto fresco; replay no repite FX.
- El bosque anterior conserva 176 IDs, orden y XZ del terreno S21. Las 30 posiciones mineras se
  añaden después de proyectar el terreno: 206 nodos en GAME.seed, sin consumir RNG de mundo ni
  cambiar props/colisiones/terreno. Se excluyen agua, pendientes fuertes, props, caminos,
  servicios, entrenamiento y landmarks protegidos. Rocas minables son nodos interactivos sin
  nuevos bloqueadores de movimiento.
- Agotamiento/progreso y regeneración de 3600 ticks siguen siendo **de sesión**. Herramientas y
  bienes usan el guardado firmado existente; el reinicio del host vuelve a poblar los nodos.
  No se activa SQL, reloj offline, persistencia durable del bosque ni nuevos permisos de agentes.
- Protocolo 32 por cinturón, recetas y nuevos tipos/progreso/eventos de minería. Host/peers
  necesitan el mismo build; versión de perfil 1 conservada con migración aditiva por defaults.

## Arte y feedback

Se cruzó este corte con la auditoría Unreal del [brief](../briefs/d08c7d-tools.md):
`SM_StoneHatchet` de Dreamrise, candidato estático de 199214 bytes, aún necesita exportación/
preview de materiales; `SK_Axe` de ActionRPG, 745285 bytes, añade dependencias esqueléticas.
Se mantiene el hacha nativa existente y se añade un pico de piedra con el mismo lenguaje,
sin importar fuentes no verificadas. No se encontró candidato inequívoco de pico/veta por nombre.
Fuentes Unreal intactas, sin generación de imágenes/proveedores ni texturas nuevas.

La minería reutiliza S02 `coast-rock-v1.glb`, 7964 bytes / 64 triángulos, con pintura de vértices.
Rocas grises y vetas azul grisáceo con manchas de óxido, escala 2.4 (~1.25 de radio / 1.87 de alto);
escombros a 30% tras agotar. Grietas compartidas de 9 segmentos por nodo dañado y sacudida breve.
El pool existente de 32 astillas / 16 hojas permanece acotado. Marcadores cercanos y 30 unidades
de distancia limitan dibujos de minería; metadatos cuentan mallas/markers/grietas visibles.
Pico contextual de 0.68 s, restauración del look/arma actual y golpes sintéticos de roca/metal
en el bus SFX existente. No se infiere FPS físico de estas cuentas o de las vistas emuladas.

## Comprobaciones

**121 casos pertinentes únicos verificados**, en dos pases documentados: selección serial de
19 archivos dio **120/121**; el único fallo era la lista blanca de snapshot de la prueba antigua,
que no admitía `hits/remaining` de roca/mineral. Tras añadir exactamente esos campos, su archivo
se repitió con **5/5**, conservando el rechazo de carga/oro/perfiles públicos. No falló una
comprobación de mecánica en ese pase. Se incluyen arranque vacío firmado, partidas antiguas,
recetas/insumos, preflight false/throw, carreras/revisiones, replay, minado/regeneración, render CPU,
carga/masa, editor, producción, red con RTT y autoridad de agentes.

```powershell
node --test --test-concurrency=1 tests/harvest-tools.test.mjs tests/tools-ui.test.mjs tests/harvest-palm.test.mjs tests/harvest-render.test.mjs tests/resources.test.mjs tests/resource-loop-server.test.mjs tests/workbench-batch.test.mjs tests/save.test.mjs tests/net.test.mjs tests/map-revamp.test.mjs tests/palm-family.test.mjs tests/palm-materials.test.mjs tests/coast-rocks.test.mjs tests/agent-authority-network.test.mjs tests/commerce.test.mjs tests/raft-editor.test.mjs tests/raft-production-server.test.mjs tests/raft-capacity.test.mjs tests/raft-capacity-server.test.mjs
node --test tests/resource-loop-server.test.mjs
node tools/qa-tools-mining.mjs
```

**3/3 recorridos de navegador emulado**: PC 1280×720, móvil 844×390 y retrato 390×844
(stage landscape rotado existente). Host localhost efímero/memoryStore/guest firmado; sólo
posición ECS reubicada como fixture. Sin inventario/herramientas concedidos por fixture:
recogida manual → banco → hacha → palmera → madera → pico → roca → veta → mochila llena
rechazada sin dañar otra roca → SAVE → recarga/reentrada. Terminan con ambos útiles,
1 madera + 2 piedras + 1 mineral, revisión 11 y arma de combate conservada; cero errores.
33 capturas y [evidencia JSON](d08c7d-tools/evidence.json), inspeccionadas en los tres formatos;
PC refrescado después del ajuste de color de vetas. 14 archivos de runtime/QA pasan sintaxis.

Incidencias durante implementación: los primeros recorridos tuvieron una espera de QA que
podía adelantarse al recibo touch y un fallo real del banco al faltar `qtyLabel()` después del
refactor. Se corrigieron espera y método, y se añadieron pruebas que ejecutan `confirm/retry`
reales para madera y herramientas; no sólo el cálculo de preview. Un segundo ajuste hizo que
el preview descontase el volumen de ingredientes de herramientas. Captura fallida conservada
en la carpeta de evidencia. El antiguo `qa-harvest.mjs` ahora declara un hacha como fixture de
su ensayo sólo de palmeras; el nuevo recorrido anterior prueba su fabricación real desde cero.

Local, sin publicación, push, cambios SQL ni servicios externos. Balance/sensaciones y rendimiento
en teléfono físico quedan para el playtest del autor. Siguen mantener/timing opcional y luego
metalurgia/recetas por pueblos, sin declarar implementados aprendizaje o aportes comunitarios.
