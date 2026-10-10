# PLAN M6 — «La Balsa»: tu barco es tu casa

Entregas jugables y pruebas de arte: [PLAN-DELIVERY.md](PLAN-DELIVERY.md), D04–D06/D08 y mar D10–D12.

**Continuidad AREA07, 2026-10-10:** [plan operativo](docs/briefs/area07-naval-action-plan.md).
PRG02a/b completan lección y Pilotaje II permanente (+15 % al timón desde el siguiente embarque,
una sola concesión y CAS M5 existente); [entrega alpha.23/protocolo 36](docs/delivery/prg02b-pilot-learning.md).
174 pruebas integradas, 38 de agentes y tres vistas UI; 22 recursos/naval con solapamiento.
Git `4c6743b` publicado; VPS observado en `a5b8f12` a las 19:02 UTC, sano y libre.
**RNV01 implementado y activo, alpha.24/protocolo 37:** [techo/puerta funcionales](docs/delivery/rnv01-naval-refuge.md),
soporte vivo, materiales/HP, V/toque, colisión/predicción, apertura por instancia y perfil del dueño.
516 casos tras integrar Tala, 107 del actualizador con solapamiento y tres vistas UI repetidas;
VPS `29a9e46` sano a las 19:24:26 UTC, imagen 107/107 y entrada pública/mapa/protocolo comprobados.
Tala conserva su activación opt-in aparte del refugio; detalle y límites en la entrega.
**RNV02 implementado y activo:** [farol funcional](docs/delivery/rnv02-naval-lantern.md),
integración alpha.27/protocolo 39. Editor B con doce piezas, V/toque, luz móvil y estado por instancia en perfil M5.
Coste/soporte vivo/HP, replay, visitante y reparación sin encendido automático; sin SQL ni consumo de combustible.
631/631 integradas, 107/107 release (solapamiento), cuatro vistas y probe real F/E/V aceptados localmente.
VPS `e648d1b` sano hasta las 20:15:21 UTC; imagen 107/107, timer activo y entrada pública WSS,
mapa/minimapa y catálogo comprobados. Evidencia/límites en la entrega.
**Sigue:** noche casi negra sin fuente de luz, luego agua costera/reembarque.
No oscurecer la noche antes de disponer de luces. Luego natación, provisiones/hogar, rutas, rival y cooperación.

Checkpoint 2026-10-08: **D08c.7d cierra herramientas y minería**, alpha.16/protocolo 32.
[Entrega](docs/delivery/d08c7d-tools.md): banco con madera/hacha/pico, dos ranuras de cinturón
guardadas y selección contextual conservando arma de combate. 24 rocas/6 vetas nuevas,
pico/grietas/impactos/audio, mineral bruto separado del hierro. 206 nodos, conserva 176 anteriores
y terreno S21. Recogida manual → madera → herramientas → tala/minería → materiales de balsa.
**121 casos únicos verificados** (120/121 + 5/5 focal tras whitelist nueva), **3/3 vistas emuladas**
desde mochila vacía, reentrada firmada y capturas inspeccionadas. Sin texturas nuevas/SQL/publicación;
árboles y minas siguen de sesión. Mantener/timing y metalurgia/aprendizaje regional aún pendientes.

Checkpoint 2026-10-08: **D08c.7c reparte recolección por la isla**, alpha.14/protocolo 30.
[Entrega](docs/delivery/d08c7c-harvest.md): 96 palmeras cortables, 69 piedras recogibles y 11
troncos sueltos; tres F/touch → dos troncos con hacha, audio, astillas, caída y tocón. Los materiales
entran a la mochila y al banco existente para construir/reparar la balsa. Catálogo de estado
en admisión/cambios, sin repetir el bosque en cada snapshot. **87/87 seleccionadas en serial +
3/3 vistas emuladas**, capturas inspeccionadas y reentrada firmada. Reutilización S05/S02/S19/S14,
cero texturas nuevas. Nodos/golpes/regeneración son de sesión; persistencia del bosque abierta.
Prioridad explícita del autor antes del contrato de aportes comunitarios. Sin SQL/publicación,
cambio de terreno o cupo; conserva L02c. Incidencias y límites en la entrega.

Checkpoint 2026-10-08: **D08c.7b mejora preparación de materiales**, alpha.13/protocolo 29.
[Entrega](docs/delivery/d08c7b-workbench.md): panel F/touch con cantidad/materiales/espacio y tandas
de la receta actual; consumo/producción completos, una revisión y replay exacto al reabrir/reintentar.
**61/61 seleccionadas + 3/3 vistas emuladas**, capturas inspeccionadas y reentrada firmada.
Banco S19/S14 existente, cero assets nuevos. No crea proyecto comunal ni receta aprendida.
La progresión de pueblos aprobada se concreta en [PLAN-ALFA-MUNDO](PLAN-ALFA-MUNDO.md#81-continuación-concreta--banco-de-materiales-y-contrato-de-aportes):
primero commit atómico inventario/proyecto/recibo, después tablero/artesano/aprendizaje.
Sin SQL/publicación; navegación y autoridad de agentes L02c se conservan.

Checkpoint 2026-10-08: **D08c.12 da un objetivo y salvas que esquivar**, alpha.12/protocolo 27.
[Entrega](docs/delivery/d08c12-naval-route.md): ensayo opcional desde el timón, tres boyas
en orden y regreso con Amarrar real. Batería anclada con marca fija y aviso de dos segundos;
daño real por instancia viva del casco girado, 6 HP/impacto, hasta 24 HP y piso del 50%.
Plano/carga conservados, daño guardable/reparable; costa mantiene su riesgo anterior.
Sin recompensa/XP. Progreso/salvas/resultados son de sesión; cancelar o desembarcar termina el ensayo.
**15/15 nuevas + 371 previas seleccionadas + 9/9 host**, 395 casos únicos entre pases documentados,
**3/3 vistas emuladas** y capturas inspeccionadas; fixtures/incidencias en la entrega.
Unreal intacto, runtime reutilizado y cero texturas nuevas.
Sin SQL/publicación. Sigue armamento naval y rival móvil/derrotable; D09/M5 conserva su gate de pérdidas públicas.

Checkpoint 2026-10-08: **D08c.11 conserva daño y posición al reentrar**, alpha.11/protocolo 26.
[Entrega](docs/delivery/d08c11-raft-recovery.md): condición por ID/tupla y última pose confirmada
guardadas en perfil. La balsa reaparece estacionada sin tripulación; costa válida permite reembarcar
y puerto permite recuperar la misma nave dañada/cargada. Pose incompatible vuelve al amarre sin sanar.
**617/617 pertinentes + 3/3 vistas emuladas**, capturas inspeccionadas y cero errores finales.
HMAC guest y cuenta/CAS en memoria locales, ventana periódica/replay guest conservados, sin exposición
offline o Supabase live. Sin publicación ni SQL. Sigue primera ruta/amenaza PvE limitada, manteniendo
D09/M5 antes del riesgo económico público permanente.

Checkpoint 2026-10-07: **D08c.10 repara piezas con materiales**, alpha.10/protocolo 25.
[Entrega](docs/delivery/d08c10-raft-repair.md): conserva daño al atracar y remontar en la sesión,
reconstruye misma instancia, cobra una vez y mantiene refuerzos/retiros coherentes con HP.
Stock/plano intactos, piezas destruidas dejan de producir y no aportan porte.
**355/355 + 3/3 vistas emuladas**, capturas inspeccionadas, sin errores finales.
Daño/pose aún no son durables entre sesiones: sigue esa conservación antes de amenaza naval.
Sin publicación ni SQL; balance humano y dispositivos siguen pendientes.

Checkpoint 2026-10-07: **D08c.9 implementa porte operativo y refuerzo del casco**, alpha.9/protocolo 24.
[Entrega](docs/delivery/d08c9-raft-load-limits.md): estructura/desplazamiento seguro y tripulación real,
límite de zarpe/carga, refuerzo de cimiento 1:1 con costo/HP/cinchas y recuperación excedida sin pérdida.
**344/344 pertinentes**, **3/3 vistas emuladas** con rechazo de zarpe, refuerzo real, reentrada firmada
y timón/HUD; capturas inspeccionadas. No publicación ni SQL, cifras para calibración.
Sigue reparación material y luego persistencia del viaje/daño y primera amenaza; tiers/puerto posteriores.

Checkpoint 2026-10-07: **D08c.8 separa masa/volumen y muestra porte nominal**, alpha.8/protocolo 23.
[Entrega](docs/delivery/d08c8-raft-capacity.md): catálogo independiente con volumen legacy conservado,
masa de bienes compartida economía/rig, lectura privada por dueño y previsión de colocación sobre copias.
**208/208 focales** y **3/3 vistas emuladas** pasan: transferencia, preview/colocación real,
guardado/reentrada y timón/HUD, con capturas inspeccionadas. La cámara no sigue aim de combate
al construir. El porte es nominal por flotación
actual: no implementa aún estructura por material/refuerzo, reserva, masa corporal/tripulantes,
mochilas de invitados ni rechazo de carga/salida. Ese límite y primer refuerzo se añaden en D08c.9.
Fuentes Unreal intactas; reutiliza UI/modelos sin texturas nuevas. No publicación ni SQL.

Checkpoint 2026-10-07: **D08c.7 implementa la primera recolección/receta**, alpha.7/protocolo 22.
Troncos/piedra de nodos compartidos → mochila → banco en puerto (1 tronco → 1 madera)
→ editor/bodega y guardado existentes. **154/154 focales**, con construcción/reentrada
y recogida durante exploración terrestre que refresca masa al reembarcar.
[Entrega](docs/delivery/d08c7-resource-loop.md): **3/3 recorridos emulados** PC/móvil/vertical rotado
pasan, con capturas inspeccionadas y fixture de posición/encuadre declarada. Nodos de sesión,
sin tiers ni receta de piedra, crafting de nave completa, reparación o pérdidas durables.
Sigue lectura única de masa/volumen y porte restante, con enfoque aprobado en la hoja naval.

Checkpoint 2026-10-07: **D08c.6 integra el circuito costero en la partida ordinaria**, alpha.6/protocolo 21.
Timón, cubierta móvil, corrientes/ráfaga, carga real, contacto/HP por pieza y vista naval se conectan
a LocalServer/Worker/fallback/host. Desembarcar estaciona la misma balsa; reembarcar requiere proximidad;
volver despacio permite atracar. [Contrato](docs/briefs/d08c6-live-coastal-loop.md) y
[entrega](docs/delivery/d08c6-live-coastal-loop.md). Pose/daño son de sesión y el amarre/plano/bodega
permanecen guardados. Publicación, dispositivos, recolección/crafting y P5/P6 completos siguen abiertos;
D09 conserva la puerta de bienes/pérdidas durables y D10 la de encuentros/rutas.

Checkpoint 2026-10-06: **D08b.4a HUD aceptado visualmente por el autor** («quedó muy bien»),
fuente `825e96e`, 89/89 pertinentes y cinco tamaños revisados. [Entrega](docs/delivery/d08b4a-reference-hud.md).
En ese checkpoint el manejo/look seguían en la bahía aislada y la balsa de partida continuaba amarrada. El
[puente D08c de autoridad/pilotaje/cubierta móvil](docs/briefs/d08c-live-navigation-bridge.md) ya tiene
D08c.0–2 implementados como ensayos delimitados, sin activar viajes públicos. M5 D09 conserva su checkpoint en `PLAN-M5.md`;
D06b móvil, dispositivos/FPS y riesgo persistente no se cierran con la aceptación del HUD.

Checkpoint 2026-10-05: **P1–P3 implementados y aceptados localmente en software**, versión `0.6.0-alpha.2`, protocolo 14.
Identidad/migración, amarre, snapshot y renderer; [P1](docs/delivery/d04p1-raft.md).
Pasarela/cubierta, bloqueos y escaleras compartidos; [P2](docs/delivery/d04p2-raft-walk.md), 383/383 y PC/móvil emulado.
Editor con siete piezas, compras de materiales en Aldea y retirada segura; [P3](docs/delivery/d05-raft-editor.md),
413/413 y 24 capturas PC/móvil emulado.
Checkpoint D06a: **bodega interactiva aceptada localmente**, `0.6.0-alpha.3`, protocolo 15; H/botón táctil,
transferencias por peso con propiedad/revisión/preflight, mochila y estadísticas; mercados de Aldea/Cala.
[Informe](docs/delivery/d06a-cargo-market.md): 8 pruebas nuevas, 493/493 sobre commit `bcd0886` y 45 capturas
PC/móvil horizontal/vertical. Producción sigue en [D06b](docs/briefs/d06b-production.md); P4 permanece parcial.
No es aceptación de mar/pérdidas, rendimiento físico ni publicación.

Checkpoint D06b: **red/parrilla y fracciones guardadas implementadas localmente**, alpha.4/protocolo 16.
Nueve piezas en editor; H/Bodega → Producción. Fuente `5b253a4`, 16 pruebas nuevas y 547/547 sobre commit aislado;
[entrega](docs/delivery/d06b-production.md). Escritorio aceptado; móvil D06b pendiente. P4 sigue parcial:
agua/huertos, hamaca/reaparición y luces abiertos. Cerrar móvil y seguir D08; fuentes Unreal intactas,
atlas existente 1024/512 y build local verificado, sin publicación.

Checkpoint D08a: [bahía de manejo aislada](docs/delivery/d08a-handling-lab.md), fuente `eab3e5c`.
Simulación/medidas e inputs comprobados: 26 propias, 695/695 regresión fijada. Peso/acomodo/inercia,
viento constante y lastre expulsable de prueba; renderer/atlas/agua reutilizados. **Visual pendiente**
por revisión automática de Chrome/límite de uso; D06b móvil sigue abierto. No activa pilotaje en partida,
no cambia bienes/perfiles/protocolo, ni cierra P5/P6. Primero aceptación móvil/bahía, luego integración.

Prueba de arte solicitada por el autor (2026-10-05): [material cómic de la balsa](docs/delivery/raft-comic-material.md),
atlas original de cuatro superficies y derivados WebP para escritorio/móvil. Se integra sobre P1;
P2 se acepta por separado mediante recorrido/pruebas. El atlas no equivale a importar un kit FAB modular.

> Idea del autor (referencia: *Raft*): **empiezas con cuatro tablones y una vela** y la vas haciendo crecer, pieza a
> pieza en una cuadrícula, hasta una fortaleza flotante. La balsa es tu casa, tu taller, tu bodega y lo que te lleva
> de pueblo en pueblo a comerciar (M7). Une las dos patas de la estructura: **construcción y barcos**. Los solares en
> los pueblos (M8) quedan para más adelante y para los edificios grandes.
>
> «De una balsa a cualquier parte.»

## 0. Qué hay ya en el código

| Pieza | Dónde | Estado |
|---|---|---|
| 29 piezas: cimiento, piso, pilar, pared, puerta, ventana, barandilla, techo, escalera, escala, vela, vela mayor, motor, ancla, bodega, cofre, caja, huerto, cañaveral, purificador, red, parrilla, alambique, mesa de cartas, hamaca, litera, farol, cañón giratorio, adorno | `src/data/raftparts.js` | ✅ |
| Reglas de construcción: cimientos conectados (12 × 12 máx.), pisos con soporte (pilar o pared debajo, o un voladizo de una casilla), piezas sobre cubierta libre, bordes junto a una cubierta, la red al borde, 3 niveles | `src/sim/economy/raft.js` (`canPlace`) | ✅ |
| Colocar pagando con una bodega, quitar devolviendo la mitad (sin tirar lo que sostiene algo ni partir la balsa) | `place` / `remove` | ✅ |
| Lo que hace la balsa: flotación contra peso (sobrecarga = se arrastra), velocidad por velas y motores, bodega, tripulación, cañones, reaparición | `raftStats` | ✅ |
| Producción por módulo: red/parrilla, lote completo, fracciones guardadas y espera de materiales/espacio | `raftProduction.js` + reloj económico | D06b vivo; agua/cultivos/alambique/combustible antiguos siguen laboratorio inactivo |
| Guardado en el perfil (`p.eco.ships`: identidad, revisión, amarre, base privada de amarre, plano, bodega, puerto, HP y aspecto) | `trade.js` (`sanitizeEco`) | ✅ |
| Viajes entre pueblos (ruta, horas por velocidad, eventos con semilla), bodegas | `voyage.js`, `cargo.js` | ✅ |
| Barcos clásicos (balandra… galeón) para más adelante | `src/data/ships.js` | ✅ datos |
| Modelos externos por pieza (`part:<id>` en el manifiesto) | `docs/ASSETS.md` | gancho por añadir (P2) |

## 1. Base de la primera entrega (detalles a confirmar con el autor)

- Todo pirata empieza con la **balsa inicial** (`STARTER_RAFT`: 2 × 2, una vela, una caja) amarrada al muelle de la
  Aldea.
- Se construye **con lo que llevas a bordo**: la madera, la lona y el hierro salen de la bodega de la balsa (o de tu
  mochila al estar en ella). Se consiguen comerciando (M7), pescando con la red, recogiendo restos flotantes
  (P5) y saqueando.
- **Se camina por la balsa**: la cubierta es suelo (y los pisos superiores, con escaleras); las paredes chocan. En el
  muelle es una zona más de la isla. El formato del mar/abordaje sigue abierto; ver la recomendación regional abajo.
- **Viajar** (fase A): desde el timón, elegir destino en la carta (mesa de cartas) → travesía con el tiempo de
  `voyageHours(leguas, raftStats.speed)` y los eventos de la ruta; la balsa produce mientras viaja.
- **Resolver encuentros** (fase B, formato pendiente): amenazas NPC y navales se prototipan por rebanadas.
  Topología, combate de cubierta y controles de cañones siguen abiertos. Reutilizar el kit del personaje donde
  encaje, con balance naval específico; alternativas en `docs/NAVAL-ROADMAP.md` §§3–4.
- **Personalizar**: bandera y pintura (`RAFT_LOOKS`), adornos.

### 1.1 Dirección acordada con el autor, 2026-10-04

- Materiales de calidad y navegación condicionan tamaño/capacidad útil. Carga/peso penalizan claramente giro
  y velocidad; skill mejora manejo sin eliminar las desventajas del grande. Posible nivel de barco pendiente.
- Distribución de módulos importa: equilibrio, resistencia al giro y arcos, con estadísticas explicables en el editor.
- Soltar carga para acelerar/maniobrar; bienes retirados realmente, disputables/perdidos y sin recuperación automática.
- Reservas locales de puerto seguras; mercancías/recursos a bordo de la casa-nave expuestos en rutas de combate.
- Rendición por carga, patrullas/notoriedad y recuperación con costes sin duplicación; políticas en M5/M7.
- Balsa/vela/motor/buque y regiones con tecnologías distintas comparten construcción/logística; aire después.

Fórmulas, límites por tier, patrimonio vinculado, pérdida de carga y controles no están cerrados. Recomendación:
mar compartido en regiones acotadas, zoom de navegación/combate sobre el mismo estado, acción naval con inercia
y proyectiles esquivables; abordaje sobre dos cubiertas reales enganchadas a baja velocidad primero.
Alternativas y criterios de aceptación: `docs/NAVAL-ROADMAP.md` §§2–5 y 8.

## 2. Pasos

- [x] **P1 La balsa en el muelle.** Al crear perfil, `p.eco.ships = [{ kind: 'raft', grid: newRaft(), … }]`.
  Entidad `vehicle` en el ECS enlazada a su cuadrícula; el servidor la manda en el snapshot (piezas al
  entrar; lista pública completa para reparar entrada tardía/bajas, acuse privado `raftEdit` en P3).
  Render: piezas en su casilla, geometría procedural agrupada por color y caja FAB con fallback, balanceo visual
  leve. Los perfiles marcados vacíos no reciben otra starter; solo la balsa primaria amarrada en Aldea es visible.
- [x] **P2 Caminar por ella.** `RaftDeck` aporta suelo/bloqueos a movimiento y aterrizajes compartidos.
  Pasarela de amarres adyacentes, cubierta/pisos, puertas cerradas, paredes/barandillas y escaleras en cuatro
  direcciones; predicción instala geometría antes del replay. PC/móvil emulado muelle→cubierta→piso→muelle,
  14 pruebas nuevas y regresión 383/383. Amarres remotos, puertas interactuables y escalas quedan abiertos;
  [informe y límites](docs/delivery/d04p2-raft-walk.md).
- [x] **P3 Modo construcción** ([informe D05](docs/delivery/d05-raft-editor.md), B / botón táctil). Siete piezas,
  fantasma verde/rojo, coste, motivo, nivel y orientación; R rota solo dentro del editor, Esc cierra.
  Fuera, R sigue habilidad e I inventario. Retirada con selección y confirmación explícita.
  Comandos `raft` `place/remove/quote/supply` con identidad/revisión/UUID → acuse privado `raftEdit`;
  plano y perfil confirmados antes de desbloquear UI. Costes bodega→mochila y mitad de devolución sin pérdida.
  Compras acotadas de madera/hierro al precio y stock reales de Aldea; no reemplazan el panel M7.
  Protección de ocupantes/salida/pasarela, amarre estable al reentrar y preflight de guardado firmado.
  Máximos técnicos: base 12×12, tres niveles y 600 piezas para no superar el saneado de persistencia;
  no son un presupuesto móvil medido. Renderer/atlas existentes y caja FAB con fallback; sin nuevo kit exportado.
  12 pruebas nuevas, regresión 413/413 y escritorio/móvil horizontal/vertical aceptados en software.
- [ ] **P4 Vivir en ella.** La producción en el reloj (`stepRaftWork` en `Economy.onAdvance` para las balsas de los
  jugadores conectados), panel de la balsa (bodega, agua, lo que produce, peso / flotación, velocidad), cofres,
  hamaca como punto de reaparición, faroles de noche (luces locales).
  **D06a aceptado:** bodega compartida por cajas, transferencia privada mochila↔balsa y panel de capacidad,
  peso/flotación/velocidad teórica. **D06b implementado, escritorio aceptado/móvil pendiente:** red/parrilla,
  receta/progreso, motivos de espera y guardado/reentrada de fracciones. Agua/huertos, hamaca y luces
  pendientes; no marcar P4 completo.
- [ ] **P5 Zarpar.** D08c.6 conecta la travesía física por la costa de la isla actual: timón →
  navegar → frenar/desembarcar → explorar → reembarcar → atracar. La partida usa el mismo estado naval,
  con carga real y sin pérdidas aleatorias del viejo viaje abstracto. Recolección de madera/piedra y
  crafting de materiales son la siguiente rebanada del loop; restos/gancho y otras regiones/mercados (M7)
  siguen después. Riesgo persistente requiere D09 y encuentros/rutas requieren D10.
- [ ] **P6 (fase B) El mar.** Movimiento por timón/propulsión, proyectiles, daño por pieza y reparación.
  **D08a.1 implementado en bahía aislada:** manejo arcade, corrientes y captura de vela con timing,
  espuma anclada al mundo, estela/spray, cómic/cámara y audio acotados. [Entrega y límites](docs/delivery/d08a-arcade-navigation.md).
  **Tacto confirmado por el autor, 2026-10-06:** el control funciona y se siente el peso; no implica balance,
  audio ni rendimiento físico aceptados. **D08b.1 — primer corte de la nueva referencia:** cámara trasera 3/4,
  paleta fría del mar/cielo, crestas y horizonte rocoso en la misma bahía. [Guía y fases B1–B5](docs/briefs/d08b-reference-look.md).
  [Fuente y pruebas B1](docs/delivery/d08b-reference-look.md): 60/60 iniciales; conexión recuperada y
  capturas de la composición actual guardadas durante B2/B3, viewport restablecido.
  La espuma/corriente/tinta ya tienen primer corte B3; el HUD sigue por capas. Fidelidad visual final,
  móvil físico, pilotaje autoritativo y cubierta móvil siguen abiertos.
  **D08b.2 — material del autor preparado e integrado como candidato:** tablones marrón/gris de la lámina
  aportada, UV por pieza, normal suave de escritorio y lona gris verdosa; comparación con atlas anterior.
  [Brief](docs/briefs/d08b2-author-raft-material.md) y [entrega con gates abiertos](docs/delivery/d08b2-author-raft-material.md).
  Color 1024/512, móvil 79.054 B sin petición de normal; 73/73 pertinentes y fuentes/derivados verificados.
  Capturas en juego, carga real 1024/512 y lectura en móvil emulado revisadas durante B3. Signo del normal,
  bordes con mipmaps a varias distancias y rendimiento móvil físico siguen abiertos.
  **D08b.3 — estela blanca histórica de 4 s, abanicos/spray de proa, corriente cyan fragmentada y tinta negra**
  periférica con centro libre; ruido compartido sin nueva descarga de textura. [Entrega y evidencia](docs/delivery/d08b3-foam-current-ink.md).
  80/80 pertinentes; boost/giro/escritorio/móvil revisados. Fixture casa corregido: paredes en nivel 1
  junto a su suelo/techo; masa/inercia iguales, altura y estabilidad recalculadas. El autor reaccionó
  favorablemente al look B3 («se ve fantástico»); no cierra rendimiento físico ni calibración del normal.
  **D08b.4 — HUD naval con datos reales:** dial naranja en u/s y aro de boost, brújula de proa/viento/flujo,
  ventana de ráfaga con banda de perfecto, tarjetas de ráfaga/lastre y avisos de cómic.
  [Entrega y evidencia](docs/delivery/d08b4-navigation-hud.md), fuente `a58ed80`, 88/88 pertinentes.
  Escritorio y móvil emulado revisados; espacio propio para controles en vistas estrechas/cortas.
  Sin textura nueva ni cambio de manejo. El autor acepta su aspecto y pide acercarlo a una nueva referencia.
  **D08b.4a — vista de navegación y refinamiento de HUD:** mar a pantalla completa, Ajustes plegables,
  tarjetas oscuras/iconos blancos, brújula sobria y dial segmentado con llama durante boost real.
  [Entrega y evidencia](docs/delivery/d08b4a-reference-hud.md), fuente `825e96e`, 89/89 pertinentes.
  Cinco tamaños revisados, controles ≥44 px sin solapes medidos y Ajustes móvil visible; foco/teclado
  corregidos. Sin raster nuevo ni cambios de simulación. Aspecto B4a aceptado; dispositivos físicos pendientes.
  Preparación del [puente D08c](docs/briefs/d08c-live-navigation-bridge.md): conectar cuerpo de navegación,
  autoridad/predicción y cubierta móvil en cortes comprobables, antes del viaje/encuentro D10.
  **D08c.0 — daño modular y choque costero en la bahía:** identidad/HP por instancia, plano conservado,
  piezas rotas fuera del renderer/rig y recálculo de masa/flotación/vela sin salto del origen.
  Barra de casco agregada, impacto según velocidad perpendicular, deslizamiento/rebote y audio/spray acotados.
  [Contrato y siguiente estructura](docs/briefs/d08c0-modular-damage.md), [entrega](docs/delivery/d08c0-modular-damage.md).
  114/114 pertinentes; no activa navegación/daño en World ni pérdidas/recuperación persistentes.
  El autor reserva su playtest conjunto para después de estructura/features; no bloquear cada corte por él.
  **D08c.1 — cuerpo de prueba en el tick del World:** copia del plano propio con HP/IDs efímeros,
  control de sesión mediante handle opaco, ejes/secuencias validados, timeout y baja inmediata en detach.
  Daño interno aplicado en tick; plano/bodega/HP guardados intactos. Opción server-only apagada por defecto;
  pose pública y cubierta siguen amarradas hasta conectar piloto/soporte/predicción juntos.
  [Contrato](docs/briefs/d08c1-naval-authority.md), [entrega](docs/delivery/d08c1-naval-authority.md).
  259/259 pertinentes aisladas sobre `5068d77`, incluidas 18/18 nuevas; límites de la pasada general en la entrega.
  **D08c.2 — puesto de mando y cubierta móvil en ensayo local:** entrada/salida de sesión,
  piloto anclado a su propia cubierta, proyección transitoria pública, epoch/ACK naval separado y
  predicción/reconciliación. Dos clientes comparten pose de barco/piloto; heartbeats de ticks retenidos
  por M5 no cambian autoridad. Navegación ordinaria sigue apagada; salir restaura el amarre y conserva bienes.
  [Contrato](docs/briefs/d08c2-pilot-deck.md), [entrega](docs/delivery/d08c2-pilot-deck.md).
  Prueba local en `PROBAR-PILOTAJE.cmd`, con balsa/casa, cámara/agua/material/espuma/audio reutilizados.
  301/301 pertinentes aisladas sobre `d47353b` (26 nuevas de pilotaje); 73/73 de compatibilidad
  con M5 `39edbe8`. Navegador: escritorio y móvil vertical/horizontal emulado, controles táctiles reales del UI,
  embarque/giro/blur/salida y conservación; casa de 29 piezas en escritorio. No es aceptación de móvil físico/FPS.
  En D08c.2 aún no había pasajeros ni caminata; la barrera de terreno no equivale a choque/daño continuo.
  **D08c.3 — locomoción relativa y pasajeros en el mismo ensayo local:** alternar timón/caminata sin
  empuje pendiente, suelo/paredes/escaleras con el movimiento existente en marco local, invitación y
  aceptación por sesiones separadas, ACK/epoch de caminata y anclas públicas. Protocolo 18; máximo técnico
  propietario + tres pasajeros. Nave/ocupantes usan la misma pose renderizada; blur frena también al caminar.
  [Contrato](docs/briefs/d08c3-relative-crew.md), [entrega](docs/delivery/d08c3-relative-crew.md).
  384/384 pertinentes aisladas integrando M5 `2651957`, incluidas 21 nuevas; escritorio y móvil vertical/horizontal
  emulado con entrada táctil, invitado y conservación, más caseta en escritorio. Sin textura nueva ni
  activación del juego ordinario; no incluye PvP/editor/producción/lastre humano ni red o móvil físico.
  El contacto/HP pendiente de D08c.3 se cierra en D08c.4; P5/P6 siguen abiertos.
  **D08c.4 — contacto costero y HP por pieza en el ensayo local:** barrido por cimientos vivos contra
  costa/muelle/borde del mapa, envolvente conservadora de giro, rebote/deslizamiento y daño localizado
  confirmado en tick. Rig/cubierta/predicción eliminan piezas rotas y conservan el origen del plano;
  ACK/replay no duplica HP ni efectos, y soporte perdido rescata a los ocupantes vivos. Protocolo 19,
  feedback privado de splash/audio y casco/HP públicos durante el ensayo.
  [Contrato](docs/briefs/d08c4-coastal-hull.md), [entrega](docs/delivery/d08c4-coastal-hull.md).
  437/437 pertinentes aisladas sobre `155390a` + montaje M5 `14ede6d`, más 67/67 de compatibilidad
  con recuperación antes de admisión `6a56b3f`; cuatro recorridos de navegador
  en escritorio/móvil vertical/horizontal emulado y caseta, con perfiles/pose fuente conservados.
  Ocho capturas revisadas; sin nuevas texturas, navegación pública ni pérdidas durables.
  El terreno dibujado es una fixture acotada, no la pasada de arte del puerto; dispositivos/FPS/audio
  físicos y balance permanecen abiertos. Sigue delimitar D10, primera travesía/encuentro NPC y rutas,
  con cableado público y operaciones de bienes/recuperación M5/D09 separados.
  **D08c.5 — timón articulado, vela y doble stick en los ensayos locales:** palanca con agarre de
  ambas manos y pala en el agua; vela/vergas/cabos/ojales giran con el viento relativo y la lona se
  curva durante el boost. Stick izquierdo para movimiento, derecho para cámara independiente;
  controles circulares translúcidos con acciones cercanas y cancelación segura de contactos.
  [Contrato y cruce FAB](docs/briefs/d08c5-helm-touch.md), [entrega](docs/delivery/d08c5-helm-touch.md).
  78/78 pertinentes aisladas sobre `9bf5826`, cuatro recorridos de navegador pasados y siete
  composiciones revisadas en escritorio/móvil vertical/horizontal emulado; 15 fuentes con hashes.
  El avance paralelo M5 `c72a78f` no modifica las rutas del harness. Sin texturas descargables
  nuevas ni activación pública; el timón visual aún no es un módulo económico colocable.
  P5/P6, dispositivos reales y la puerta M5/D09 permanecen abiertos; continúa delimitar D10.
  **D08c.6 — circuito costero integrado en la partida:** los módulos aceptados de manejo,
  cámara/audio/VFX/material/timón/vela/touch salen del harness a rutas runtime. Mochila y bodega aportan
  masa real; no hay lastre ficticio ni expulsión de bienes. Estacionar permite explorar una costa real;
  reembarcar renueva los epochs y refresca la mochila desde el servidor; atracar cierra la sesión.
  Construcción/producción/transferencias quedan bloqueadas durante la travesía, incluso en tierra.
  Muerte/desconexión/pérdida de soporte recuperan el amarre y ocupantes sin modificar el plano ni la
  bodega. [Entrega y verificación](docs/delivery/d08c6-live-coastal-loop.md), alpha.6/protocolo 21.
  No publica la demo ni activa daño/pérdidas durables. La primera recolección/receta continúa en D08c.7;
  D09 y D10 siguen abiertos.
  **D08c.7 — primera recolección y madera preparada:** nodos compartidos de tronco/piedra, mochila,
  banco del puerto y consumo en el editor existente. 154/154 focales y 3/3 recorridos emulados con
  guardado/reentrada; [entrega](docs/delivery/d08c7-resource-loop.md), alpha.7/protocolo 22.
  Puede recoger durante la exploración terrestre y reembarcar con masa refrescada; preparar materiales
  requiere haber atracado. Nodos de sesión, sin recetas de piedra/tiers ni crafting de la nave completa.
  Sigue masa/volumen y porte restante; P5/P6 completos, pérdida/reparación durable y dispositivos abiertos.
  El autor propone una pasada posterior de luz/reflejos para gráficos altos: **Q1**, separada del HUD,
  con A/B del pipeline SSR/bloom existente y perfil ligero conservado; todavía no implementada.
  B5 requiere encuentro real y autoridad; no sustituirlo por una barra/radar de enemigo de adorno.
  Dividir en rebanadas: estadísticas de carga/giro y jettison → encuentro NPC → dos jugadores con huida/rendición
  → patrulla/notoriedad → abordaje de dos cubiertas. Topología y costes pendientes; M5 es puerta de persistencia.
- [ ] **P7 Progresión y aspecto.** Mesa de cartas: investigar piezas (vela mayor, motor, alambique) con muestras
  que se traen de cada isla. Banderas y pintura. Las cinco etapas de la referencia: balsa desnuda → refugio →
  ampliada (huertos, bodega) → avanzada (motor) → mega balsa.
  Incluir tiers de materiales y navegación, con vista vacío/cargado. No convertir nivel de barco en bonus
  universal que anule peso o haga desaparecer roles. No es necesario cerrar todas las tecnologías en M6.

## 3. Notas

- La cuadrícula y las reglas son del servidor; el cliente solo pide y dibuja. `sanitizeRaft` rehace la balsa
  guardada pieza a pieza, así que una partida editada no puede colocar lo imposible.
- `RAFT.maxCells` (12 × 12) y 3 niveles son límites técnicos actuales; los límites por materiales/skill son
  trabajo futuro dentro de un presupuesto medido. Fusionar mallas no prueba por sí solo rendimiento de combate.
- Los barcos clásicos (`data/ships.js`) quedan como alternativa de compra en el astillero (M8), o como enemigos.
- Separar plano de daño operativo antes de persistir destrucción; no usar `sanitizeRaft` para borrar partes
  domésticas porque perdieron soporte en combate. Identidades estables de piezas/carga y recuperación en M5.
