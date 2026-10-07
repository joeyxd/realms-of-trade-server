# PLAN M6 — «La Balsa»: tu barco es tu casa

Entregas jugables y pruebas de arte: [PLAN-DELIVERY.md](PLAN-DELIVERY.md), D04–D06/D08 y mar D10–D12.

Checkpoint 2026-10-06: **D08b.4a HUD aceptado visualmente por el autor** («quedó muy bien»),
fuente `825e96e`, 89/89 pertinentes y cinco tamaños revisados. [Entrega](docs/delivery/d08b4a-reference-hud.md).
El manejo/look siguen en la bahía aislada; la balsa de partida continúa amarrada. El
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
- [ ] **P5 Zarpar.** El timón abre la carta; travesía (`planVoyage` + `stepRaft` acelerado); restos flotantes que
  recoger con un gancho por el camino (madera, lona, barriles); llegar a puerto abre su mercado (M7).
  Este viaje abstracto es fase A; sus pérdidas aleatorias no sustituyen el combate naval interactivo de fase B.
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
  Sin pasajeros ni caminar a bordo; barrera de terreno no equivale a choque/daño continuo.
  Próximo corte: locomoción relativa y pasajeros, después integrar contacto/HP a autoridad; P5/P6 abiertos.
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
