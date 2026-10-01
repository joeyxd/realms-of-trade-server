# MAREA NEGRA — Documento de diseño (Milestone 0)

> Nombre de código temporal. El título vive en **un solo lugar**: `src/data/meta.js`.
> Todos los números de este documento salen de `src/data/tuning.js`. Si cambias uno, cambia el otro
> (el panel de debug F4 de M2 edita `tuning.js` en vivo).

Rebanada vertical 1: **Isla tropical + Arena «La Caldera»**. Action-RPG isométrico para navegador
(Three.js 0.160), arquitectura MMO-ready, todo procedural (geometría, texturas, shaders, audio).

---

## 1. Loop principal

```
                ┌────────────────────────── repetir (dificultad adaptativa, mejor loot) ──┐
                ▼                                                                         │
 [Playa: spawn] → tutorial (mover · dash · atacar · parrear cañonazo de práctica)          │
        → [Aldea Coralina] capitán (misión) · vendedora · bots/chat · muelle (ZARPAR: próx.)│
        → [Sendero del Humo] 3–4 enemigos de calentamiento (misión «Limpia el camino»)     │
        → [La Caldera] portón se cierra · 5 oleadas · jefe HELLFIRE (3 fases)              │
        → cofre del jefe (secuencia Highlight de 5 etapas) → loot/XP/oro → aldea ──────────┘
```

- **Bucle de 30 segundos (combate):** leer la forma del proyectil → decidir (destruir / reflejar / esquivar)
  → recompensa inmediata (hitstop, sonido, número, multiplicador de cadena) → el reflejo vuelve como daño x2.
- **Bucle de 5 minutos (oleada):** sobrevivir una oleada → 6 s de respiro → recoger loot → equipar.
- **Bucle de sesión (25–35 min la primera vez):** Lv 1 → ~Lv 6–7 al vencer a Hellfire; Lv 10 tras ~3 vueltas.
  Siempre hay un «siguiente premio» visible: barra de XP, próxima habilidad bloqueada en la barra de acción,
  logro cercano, misión activa.

## 2. Convenciones del mundo

- 1 u ≈ 1 m. Eje **X = este**, **Z = sur**, **Y = arriba**. Nivel del mar `y = 0`.
- Cámara al **sureste** del jugador mirando al **noroeste** (yaw 45°). En pantalla:
  «arriba» = noroeste `A = (-0.707, 0, -0.707)`, «derecha» = noreste `B = (0.707, 0, -0.707)`.
- La isla se diseña en el marco `(u, v)`: `u` = distancia a lo largo de `A` (hacia arriba en pantalla),
  `v` = a lo largo de `B`. El jugador **sube por la pantalla** desde la playa hasta el volcán.

```
      u ▲  (arriba en pantalla, NO)
   +150 │            costa norte
    +82 │        ▲ VOLCÁN (pico 36 u, cráter con lava y humo)
    +25 │      ( LA CALDERA )  arena r=19, borde de basalto, portón al SE
     +4 │         ╲ portón
        │          ╲  SENDERO DEL HUMO (curva en S, sube de 2.4 a 4.6)
    -55 │           ╲   selva: palmeras, arbustos, rocas
    -95 │     [ ALDEA CORALINA ] chozas, fogata, capitán, vendedora
   -132 │  · spawn · PLAYA DE LA MAREA      ════ muelle ════► barco anclado (u=-176)
   -150 │  costa sur-este
        └──────────────────────────────────────────► v (derecha en pantalla, NE)
```

| Zona | id | Detección | Ambiente | Luz |
|---|---|---|---|---|
| Playa de la Marea | `playa` | costa (coastT < 0.12) en el tercio sur | olas fuertes, gaviotas | día |
| Aldea Coralina | `aldea` | < 30 u del centro de la aldea | fogata, aves, marimba | día |
| Sendero del Humo | `camino` | < 9 u de la polilínea del sendero | viento, aves de selva | día |
| Selva Esmeralda | `selva` | resto de tierra firme | viento, insectos | día |
| La Caldera | `caldera` | < 27 u del centro de la arena | crepitar de lava, rumor | **hora dorada** (transición 2 s) |
| Mar | `mar` | agua > 0.65 u (no caminable) | — | — |

## 3. Cámara (MOBA semi-bloqueada)

| Parámetro | Valor |
|---|---|
| Tipo | `PerspectiveCamera`, FOV 35°, pitch 48° (más perspectiva: se ven caras y horizonte cercano), yaw 45° fijo |
| Zoom (rueda) | 3 distancias: 15 / **20** (defecto) / 27 u → personaje adulto (~1.9 u) ≈ 13 % del alto de pantalla en 20 u |
| Seguimiento | `damp(pos, objetivo, λ=9, dt)` |
| Look-ahead | hacia el cursor, `0.3 × (cursor − jugador)` limitado al 20 % de la altura visible, λ=4 |
| Rotación opcional | pasos de 90° con **Z / X** (tween 0.35 s). *Q/E quedan para habilidades.* Desactivada por defecto en Ajustes. |
| Shake | trauma ∈ [0,1], decae 1.6/s, intensidad = trauma²; offset máx 0.6 u, roll máx 2.5°, ruido 22 Hz |
| Punch | impulso a lo largo de la vista, decae λ=12 |
| Slow-mo | dolly-in 8 % mientras `timeScale < 1` |
| Accesibilidad | todo × slider «Shake» (0–100 %) y × 0.3 con `prefers-reduced-motion` |
| Naval (gancho) | `camera.setMode('naval')` → distancia 46 u, pitch 50° (sin uso en esta rebanada) |

Oclusión: vegetación, chozas y rocas grandes entre la cámara y el jugador se **disuelven con dithering**
(cilindro de 1.8 u alrededor del segmento cámara→jugador), y también todo lo que queda a menos de 13–17 u de la
cámara (copas de palmera en el borde de la pantalla). El jugador nunca queda tapado.

## 4. Controles

| Acción | Teclado/ratón | Táctil | Disponible |
|---|---|---|---|
| Mover (8 dir., relativo a cámara) | WASD / flechas | joystick flotante (mitad izquierda) | M1 |
| Apuntar | cursor (raycast al plano del jugador) | auto-apuntado al enemigo más cercano | M1 (look-ahead) / M2 |
| Combo melee 3 golpes | LMB | ATAQUE | M2 |
| Parry / reflejar | RMB | PARRY | M2 |
| Dash | ESPACIO | DASH | M1 |
| Habilidades | Q / E / R | botones Q E R | Lv 3 / 5 / 7 |
| Interactuar / recoger | F | botón contextual | M1 (NPC) |
| Inventario · Mapa · Stats | I · M · TAB | menú | M4 |
| Zoom | rueda | pellizco | M1 |
| Pausa | ESC | botón ❚❚ | M1 |
| Stats de rendimiento · Debug | F3 · F4 | — | M1 · M2 |

- **Buffer de inputs: 130 ms**, dentro de la simulación (determinista: cliente y servidor lo ven igual).
- **Coyote de parry: 60 ms.** El daño de un proyectil *parreable* se aplica con 60 ms de retraso; si llega un
  RMB en esa ventana se anula el daño y se convierte en parry **normal** (nunca perfecto).

## 5. Movimiento y dash

| Parámetro | Valor | Nota |
|---|---|---|
| Velocidad base | 6.5 u/s | SPD del equipo la modifica en % |
| Aceleración / frenado | 70 / 50 u/s² | frena distinto a como empuja: llega a tope en 0.09 s, para en 0.13 s |
| Giro | damp λ=20 hacia la dirección de movimiento | al atacar/parrear gira al cursor |
| Radio de colisión / hurtbox | 0.40 / 0.36 u | hurtbox algo menor que el cuerpo (perdona) |
| Vadeo | profundidad > 0.15 u: velocidad × (1 − 0.35·prof/0.6) | > 0.65 u: bloquea |
| Pendiente máx. | 1.0 (45°) | |
| **Dash** | 0.22 s, 5.5 u, curva `d(t)=D·(1−(1−t)²)` | velocidad pico 50 u/s, termina suave |
| i-frames | toda la duración (0.22 s) | |
| Cargas | 1 (Lv1) · **2 (Lv2+)** | recarga 0.9 s por carga, secuencial |
| Salida | si hay input: velocidad = dir × 6.5; si no, × 0.35 (deslizamiento) | |
| Afterimages | 4 fantasmas a 0 / 0.05 / 0.10 / 0.15 s, se desvanecen en 0.25 s | |

## 6. Proyectiles (el corazón)

Codificados por **FORMA** primero, color después (accesibilidad). Todo proyectil nace con **150 ms de
«armado»** (sin daño, flash de spawn). Velocidad máxima legible 14 u/s.

| Tipo | Forma / color | Radio | Vel. (u/s) | Daño base | LMB (destruir) | RMB (reflejar) | Esquivar |
|---|---|---|---|---|---|---|---|
| **Parreable** | orbe/diamante con anillo, ámbar `#FFB02E` | 0.28 | 6–11 | 8 | ✔ ventana 120 ms (frames activos del golpe), +combo | ✔ ventana 180 ms; primeros 80 ms = **PERFECTO** | ✔ |
| **Pesado** | orbe grande pulsante, naranja-rojo `#FF5A1F` + halo | 0.65 | 4.5 | 22 | ✘ «clunk» (sin efecto) | solo **PERFECTO** o habilidad E; RMB normal = bloqueo (50 % daño + empujón) | ✔ |
| **Imparable** | púa alargada violeta `#9B4DFF` con marca «✕» | cápsula 0.22 × 0.9 | 9–12 | 14 | ✘ | ✘ castigo: stagger 0.3 s + daño | ✔ dash a través = **FANTASMA** |
| **AoE de suelo** | círculo rojo que se llena | 1.5–3.5 | — | 18 | ✘ | ✘ | ✔ telegraph 0.8–1.5 s |
| **Láser / carril** | línea de telegraph → barrido | ancho 0.9 | barrido 40–60 °/s | 10 / 0.2 s | ✘ | ✘ | ✔ telegraph 0.6 s |

**Reflejo (RMB):** el proyectil cambia de dueño, color al acento del jugador (`#3BF0FF`), daño
`2 × max(dañoBase, 0.8·ATK)`, velocidad × 1.4, homing suave 4 rad/s al enemigo más cercano dentro de un cono de 60°,
vida 2.5 s, trail luminoso. Los reflejos **ignoran blindaje** (cangrejo) y **rompen escudos** (jefe).

**Parry:** sector de 110° frente al jugador, radio 1.6 u. Whiff (sin nada que parrear): 0.35 s sin poder
volver a parrear. Parry exitoso: sin recuperación (premia encadenar).

**Graze (ROCE):** proyectil hostil que pasa a < 0.35 u del borde de la hurtbox sin tocar → +2 XP, +4 % RIPOSTE,
toast «ROCE». Una vez por proyectil.

**Feel**

| Evento | Hitstop | Otros |
|---|---|---|
| Destruir (LMB) | 70 ms | chispas, «tic» metálico |
| Reflejar (RMB normal) | 110 ms | whoosh + trail |
| **PERFECTO** | 110 ms | slow-mo 0.35× durante 0.25 s, flash, onda de choque 3 capas (ancha-tenue / media / fina-brillante), toast «¡PERFECTO!», «clang» que sube un semitono por parry encadenado |
| Cadena | — | ≤ 1.2 s entre parries → multiplicador x1→x5 |
| Medidor RIPOSTE | — | perfecto +18, normal +10, destruir +4, roce +4, fantasma +8 (máx 100). R lo libera: onda radial r=6 u que refleja TODO |

**Implementación:** typed arrays (pos, vel, tipo, dueño, vida, radio, estado, semilla) con capacidad 1500;
`InstancedMesh` por tipo con atributo por instancia (color/pulso); colisión círculo-vs-cápsula con spatial hash
(celda 2 u). Los proyectiles **no se sincronizan uno a uno**: el servidor emite *eventos de patrón*
(`pattern {tick, emisor, patrón, semilla, ángulo}`) y el cliente los simula de forma determinista; solo los
reflejos, destrucciones y homing se corrigen por evento. Los golpes los decide siempre el servidor.

## 7. Enemigos

Cada uno con silueta, pose y «cara» distintas. IA = steering (acercarse a rango, orbitar, retroceder), sin
pathfinding. Reacción: flash blanco 80 ms + knockback 0.6 u. Muerte: se desarma en piezas + chispas.

| Enemigo | HP | Vel. | Rango | Ataque | Wind-up | CD | XP |
|---|---|---|---|---|---|---|---|
| Arquero esqueleto pirata | 40 | 3.2 | 9–12 | ráfaga de 3 flechas parreables apuntadas, 0.12 s entre flechas, 10 u/s | 450 ms (brillo del arco + pose) | 2.2 s | 25 |
| Diablillo de fuego | 28 | 5.5 | orbita a 6 | espiral de 8 orbes parreables en 0.8 s, 7 u/s | 400 ms | 2.8 s | 20 |
| Chamán de coral | 60 | 2.4 | 8–10 | anillo de 12 orbes alternando parreable/imparable, 6 u/s | 600 ms | 3.5 s | 40 |
| Cangrejo mortero | 80 | 2.0 | 7–11 | 3 AoE r=2.2 alrededor del jugador, telegraph 1.1 s | 500 ms | 3.0 s | 50 |

Cangrejo: **blindado por delante** (120°): daño × 0.2 de frente; × 1 por flanco/espalda; reflejos ignoran blindaje.

**Oleadas** (gong + banner «OLEADA n/5», 6 s de respiro, la música sube una capa):

| Oleada | Composición |
|---|---|
| 1 | 3 arqueros |
| 2 | 2 arqueros + 3 diablillos |
| 3 | 2 chamanes + 2 diablillos + 1 arquero |
| 4 | 2 cangrejos + 2 arqueros + 2 diablillos |
| 5 | (a) 2 cangrejos + 2 chamanes · (b) a los 10 s: 3 diablillos + 2 arqueros |

## 8. Jefe «HELLFIRE» (HP 2400)

Cada cambio de fase: 2.0 s invulnerable, se **limpian todos los proyectiles hostiles** (fairness), banner,
stinger musical, luz más roja, nueva pose.

**Fase 1 (100–70 %)** — ciclo `A1, A1, A2, A3`

| Ataque | Telegraph | Detalle |
|---|---|---|
| A1 Ráfaga apuntada | 500 ms (cañones brillan) | abanico de 5 parreables, 30°, 9 u/s |
| A2 Espiral | 400 ms | 2 brazos, 24 orbes parreables en 2 s, 6.5 u/s |
| A3 Embestida | línea 0.7 s, ancho 2.2 | carga a 18 u/s durante 10 u; contacto 20 daño |

**Fase 2 (70–35 %)** — **escudo**: absorbe el 80 % del daño.

| Ataque | Telegraph | Detalle |
|---|---|---|
| Invocación | 600 ms | 2 diablillos al entrar y cada 20 s (máx 2 vivos) |
| Láser doble rotatorio | 0.6 s | 2 rayos opuestos, 50 °/s durante 4 s |
| Anillos alternados | 450 ms | 3 anillos de 16 (parreable/imparable alternos), 6 u/s, 0.5 s entre anillos, desfase 11.25° |
| **ORBE PESADO** | 800 ms (gran brillo) | cada 12 s; reflejarlo (PERFECTO o E) → **rompe el escudo 3 s, daño × 2** |

**Fase 3 (35–0 %) — HELLFIRE**

| Ataque | Telegraph | Detalle |
|---|---|---|
| Meteoros | círculos r=1.8, 0.9 s | 6–10 por lluvia, escalonados 0.15 s; 1 de cada 3 apunta al jugador |
| Carriles de fuego | 0.6 s | 3 carriles de 3 u de ancho barren la arena |
| Lluvia de balas | sombra en el suelo 0.5 s | filas de parreables desde arriba con huecos de 2.5 u |
| Lava de los bordes | visible | el radio útil encoge de 19 a 11 u (0.12 u/s); lava 6 daño / 0.5 s |
| Orbe pesado | 800 ms | cada 14 s; reflejarlo = ventana × 2 de 3 s + stagger del jefe |

**Muerte:** slow-mo 0.3× durante 1.2 s, flash blanco ≤ 0.8, cae el COFRE → secuencia Highlight (§12).

**Dificultad adaptativa invisible:** factor `k ∈ [0.85, 1.15]` (empieza en 1). Cada muerte en los últimos 10 min
→ −0.05. Cada 45 s sin recibir daño → +0.03. Escala cadencia de disparo (`CD / k`) y HP enemigo (`× k`).

## 9. Progresión

**Stats por nivel:** HP `100 + 12·(Lv−1)` · ATK `10 + 2·(Lv−1)` · DEF `2 + (Lv−1)` · SPD 6.5 (solo equipo) ·
CRIT 5 % (equipo) · ventana de parry 180 ms (± arma).

**Daño:** `max(1, round(ATK · mult · (crit ? 1.75 : 1) · (1 − DEF/(DEF+40))))`. Combo: 1.0 / 1.15 / 1.6 (360°).

| Lv → Lv+1 | XP | Acumulado | Desbloqueo al llegar |
|---|---|---|---|
| 1 → 2 | 100 | 100 | 2ª carga de dash |
| 2 → 3 | 180 | 280 | **Q «Tajo Giratorio»** (destruye parreables en r=2.6 u, CD 6 s) |
| 3 → 4 | 280 | 560 | |
| 4 → 5 | 400 | 960 | **E «Guardia de Marea»** (escudo 2 s que refleja todo, CD 14 s) |
| 5 → 6 | 550 | 1510 | |
| 6 → 7 | 720 | 2230 | **R «Riposte Tormenta»** (consume RIPOSTE 100) |
| 7 → 8 | 920 | 3150 | |
| 8 → 9 | 1150 | 4300 | |
| 9 → 10 | 1400 | 5700 | pasiva «Ojo del Huracán»: PERFECTO +20 ms |

**Fuentes de XP:** enemigos (tabla §7), Hellfire 1500, misiones 100–300, PERFECTO +5, roce +2, fantasma +3.
Estimación primera vuelta: camino+misiones ≈ 420 (Lv 3), oleadas ≈ 810 + bonos ≈ 400 (Lv 5 antes del jefe),
jefe 1500 (Lv 7).

**Loot por rareza**

| Rareza | Color | Peso | Presupuesto de stats | Afijos |
|---|---|---|---|---|
| Común | gris `#9AA3AD` | 55 | × 1.0 | 0 |
| Poco común | verde `#4CD964` | 28 | × 1.3 | 1 |
| Raro | azul `#3FA9FF` | 12 | × 1.7 | 2 |
| Épico | morado `#B36BFF` | 4.2 | × 2.2 | 3 |
| Legendario | dorado `#FFC23D` | 0.8 | × 3.0 | 4 |

Cada rareza define color primario, glow, borde de la carta e incrustación del marco, y **haz de luz** en el suelo.
Cofre del jefe: mínimo Raro; cada clic de la etapa 2 tiene 55 % de subir un escalón (máx Legendario).

**Slots:** arma, cabeza, pecho, botas, 2 abalorios + consumibles (Poción de ron-coco: cura 40 %) + oro.
Armas ejemplo: Sable de cubierta (equilibrado), Daga de abordaje (+20 ms ventana, −15 % ATK),
Ancla de mano (−20 ms ventana, +35 % ATK, remate más ancho).

**Misiones:** «Habla con el capitán del puerto» (100 XP, 20 oro) · «Limpia el camino (3 enemigos)» (200 XP,
2 pociones) · «Sobrevive a La Caldera» (300 XP + cofre).

**Logros (10):** Primer reflejo · Perfeccionista (10 perfectos) · Tormenta x5 (cadena máxima) ·
Fantasma (20 imparables atravesados) · Rozando la muerte (50 roces) · Sin un rasguño (oleada sin daño) ·
Rompe-escudos · Domador del infierno (vencer a Hellfire) · Coleccionista (equipar un épico) ·
Marinero de agua dulce (hablar con el capitán).

## 10. Arquitectura (MMO-ready)

```
 ┌──────── hilo principal (cliente) ─────────┐        ┌──────── Web Worker (servidor local) ────────┐
 │ input → cmd {seq, mx, mz, ax, az, btn}    │ input  │ LocalServer: World autoritativa a 60 Hz      │
 │ predicción del jugador local (misma sim)  │ ─────► │  · cola de cmds por cliente (máx 2/tick)     │
 │ reconciliación (rebobina + re-aplica)     │        │  · bots = clientes con IA (mismo pipeline)   │
 │ interpolación del resto (buffer 100 ms)   │ ◄───── │  · snapshot cada 3 ticks (20 Hz) + ack       │
 │ render/ ui/ audio/  (nunca deciden golpes)│snapshot│  · eventos fiables (daño, muerte, loot…)     │
 └───────────────────────────────────────────┘        └──────────────────────────────────────────────┘
          ▲ misma interfaz: Transport { sendInput(tick, cmd), send(msg), onSnapshot(cb), onEvent(cb) }
          └─ WsTransport (stub) → servidor Node que importa los MISMOS módulos src/sim/
```

- **Paso fijo 60 Hz** (acumulador), `dt` de frame limitado a 0.05 s, render desacoplado con interpolación.
- `sim/` es **puro**: sin THREE, sin DOM, sin `Math.random` (RNG con semilla `mulberry32`), sin reloj de pared.
  Se ejecuta igual en el Worker, en Node (tests) y, en el futuro, en el servidor real.
- **ECS-lite** sobre typed arrays (`Float64Array` para que predicción y servidor den bits idénticos):
  componentes `pos, vel, facing, mover, dash, player, bot, npc, vehicle(reservado)`; sistemas puros.
- **Modelo de comandos (tipo Source):** el jugador solo avanza cuando se procesa uno de sus comandos, tanto en el
  cliente (predicción) como en el servidor. Con colisión estática determinista el error de predicción es 0;
  lo que el servidor añada (knockback, etc.) se corrige por reconciliación con suavizado visual (λ=15).
- **Tiempo de instancia:** el slow-mo y el hitstop son propiedades de la *instancia* (la arena es una instancia por
  grupo, como una mazmorra de MMO), decididas por el servidor y replicadas. En el mundo abierto compartido el hitstop
  es solo cosmético en el cliente (≤ 110 ms, la sim no se detiene).
- **Bots** viven en el servidor como entidades `player` con nombre; la UI no distingue bots de humanos.

### Protocolo (JSON hoy, binario después) — `src/net/protocol.js`

| Dir. | Tipo | Campos | Fiable |
|---|---|---|---|
| C→S | `hello` | `v, name, skin` | sí |
| C→S | `input` | `seq, mx, mz` (−1..1, cuantizado 1/127), `ax, az` (punto de mira), `btn` (bits mantenidos), `prs` (bits pulsados este tick) | orden |
| C→S | `cmd` | `{type: 'interact' \| 'chat' \| 'equip' \| …}` | sí |
| C→S | `ping` | `t` | no |
| S→C | `welcome` | `you, tick, seed, tuningHash` | sí |
| S→C | `snapshot` | `tick, ack, ents[{id,k,x,y,z,f,s,a,…}], ev[]` | no (20 Hz) |
| S→C | `spawn` / `despawn` | entidad completa (nombre, skin, nivel) / id | sí |
| S→C | `event` | `damage, death, loot, levelup, pattern, reflect, phase, wave, timescale` | sí |
| S→C | `pong` | `t, tick` | no |
| reservado | `ship_spawn, ship_input, ship_state, board, dock, trade_offer, trade_accept` | naval/comercio (§13) | — |

Binario futuro: cabecera `u8 tipo, u32 tick, u16 n`; entidad `u16 id, u8 kind, i16 x·64, i16 z·64, i16 y·64,
u8 facing·(256/2π), u8 estado`. ~11 bytes/entidad → 50 jugadores a 20 Hz ≈ 11 KB/s por cliente.

## 11. Render

Pipeline (calidad media/alta):

1. **Normales + profundidad opaca** (capa MUNDO, materiales normales pareados que repiten el mismo desplazamiento
   de vértices — viento de palmeras/algas, dithering de oclusión) → `rtNormal` + `DepthTexture`.
2. **Color opaco** (capas MUNDO + SIN_CONTORNO: terreno, fondo marino, cielo, personajes, props) → `rtMain`
   (en alta a 1.5× = supersampling). El mapa de sombras se actualiza una sola vez, aquí.
3. **Contornos**: silueta por profundidad (umbral suelto, modulado por N·V para evitar artefactos diagonales en
   superficies rasantes, 2 px), costuras por normales (1 px); color `#1A1033`; se desvanecen con la distancia → `rtPost`.
4. **Copia a media resolución** de `rtPost` → `rtRefract` (lo que el agua refracta, ya con contornos).
5. **Agua** (capa AGUA) dibujada sobre `rtPost` con test de profundidad manual contra `rtNormal` (ver «Agua»).
6. **Gradación + AA**: saturación, viñeta, peligro, flash ≤ 0.8, aberración en slow-mo; alta → downsample bilineal
   del 1.5×; media → FXAA.
7. **Capa FX** (partículas, ondas, proyectiles, afterimages) **después** de todo, con oclusión manual contra la
   profundidad de `rtNormal` (partículas suaves). Nunca reciben contorno.
8. **DOM**: HUD, nameplates, números flotantes.

**Agua (v2)** — `src/render/water.js`, mismo look en las dos variantes:

| Elemento | Media/alta (refracción) | Baja |
|---|---|---|
| Profundidad | reconstruye el fondo bajo cada píxel desde la profundidad opaca (rocas, postes, casco, piernas) | heightmap del terreno |
| Color | Beer–Lambert por canal a lo largo del rayo (`absorb = 0.46, 0.20, 0.15` por u): arena → turquesa → azul profundo | igual, con alfa |
| Refracción | desplaza la imagen opaca con la pendiente de las olas; nunca trae lo que está sobre el agua | — |
| Cáusticas | dos redes de celdas deformadas por las olas sobre el fondo, se apagan con la profundidad y en sombra | en el shader del terreno |
| Superficie | bandas `mnBand`, manchas de luz onduladas, fresnel al cielo, destellos de sol en celdas que titilan | igual |
| Espuma | contacto con todo lo que atraviesa la superficie + encaje con huecos en la orilla + líneas de ola | contacto con la costa |
| Interacción | ondas de espuma al vadear (cualquier personaje) y al hacer dash; salpicaduras toon | igual |
| LOD | normales y destellos se calman a > 45–220 u (sin moiré en el horizonte) | igual |

Todo el ruido sale de dos texturas enlosables generadas al arrancar (`noiseTex.js`: celdas F1/F2−F1, fbm e id de celda;
pendientes de ola): ~10 lecturas por píxel en lugar de ruido procedural. Las mismas texturas alimentan las sombras de
nubes y el detalle del terreno. Un plano de fondo marino oscuro a −7.56 u cierra el océano bajo las celdas profundas.

Baja: sin contornos, render directo + FX con test de profundidad normal.

- Personajes: una geometría fusionada por aspecto (`SkinnedMesh`): 1 draw call por pasada y por personaje; las
  afterimages reutilizan la geometría con un esqueleto congelado (se re-enlazan si cambia el tipo de cuerpo).
  Detalle en «Personajes v2» más abajo.
- Props estáticos fusionados por celdas de 72 u y vegetación instanciada por celdas de 48 u (culling por celda).
- Toon: `MeshToonMaterial` parcheado con **bandas suaves propias** (`mnBand`, 4 bandas con antialias por `fwidth`).
  El **terreno** es un `MeshToonMaterial` con splat por altura/pendiente/máscaras (arena, arena mojada, hierba,
  roca, basalto, sendero, grietas de lava emisivas) y el **agua** un `ShaderMaterial` que usa la **misma** función
  `mnBand` y las sombras del sol.
- Fondo marino: algas que se mecen y piedras claras en las orillas; carga flotante y un bote que se mecen junto al
  muelle (la espuma de contacto los rodea sola).
- Sombras de nubes: ruido animado inyectado en todos los materiales (multiplica solo la luz del sol).
- Sol direccional con sombras en frustum ortográfico ±30 u centrado 7 u por delante del jugador (la cámara inclinada
  ve más lejos), encajado a texel → sin parpadeo,
  hemisférica cálida, rim light fría desde atrás. Preset «hora dorada» en La Caldera (tween 2 s).

**Personajes v2 (adultos, low-poly facetado)** — `charkit.js` · `charlooks.js` · `characters.js`

Referencias: pícaro encapuchado, exploradora elfa y guerrero esqueleto en low-poly. Se pasó de chibi (2,3 cabezas) a
proporciones adultas: ~6,5 cabezas (cabeza y manos algo grandes para leerse desde la cámara isométrica), 1,8–1,9 u.

| | |
|---|---|
| Modelado | piezas «lofteadas» (anillos de 6–14 lados) en pose de bind: torso, extremidades, capas, capucha, botas con vuelta, cinturones con hebilla, bandolera que se ciñe al torso, bolsas, brazaletes, hombreras. Aberturas limpias (capucha, abrigo abierto) quitando quads enteros; capas con forro interior más oscuro |
| Color | por cara (facetas nítidas), con variación tonal ±5 % por faceta y degradado vertical (bajos de abrigo más oscuros) |
| Sombreado | color con normales de derivadas (`flatShading`) + banda suave (mitad `mnBand`, mitad rampa) → cada faceta su tono; las normales de la geometría siguen suaves, así que el contorno solo marca siluetas. Rim más fuerte que en props. Atributo `aGlow` para gemas, ojos y filos |
| Esqueleto | 15 huesos: cuerpo, cadera, muslos, espinillas, columna, pecho, cabeza, brazos, antebrazos y dos huesos de tela (delante/detrás). Pesos suaves en rodillas, codos, cintura y paneles de abrigo (los faldones delanteros siguen al muslo, el trasero se queda atrás con muelles) |
| Animación | respiración y cambio de peso en reposo; carrera con rodillas y codos, contrarrotación cadera/hombros, dos rebotes por zancada; dash con inclinación y piernas recogidas; squash muy leve; pose «dormida» para enemigos |
| Aspectos | jugador: Corsario, Exploradora (elfa), Bucanero, Tormenta, Brasa · NPC: Capitana Brea, Tía Perla · enemigo: Centinela (esqueleto con cristales de hielo y gran espada; dos duermen a la entrada de La Caldera, despiertan en M2 junto al arquero esqueleto) |
| Coste | 1,7–2,5 k triángulos por personaje, 1 draw call por pasada |
| UI | retratos con el modelo real (`PortraitStudio`, un render por aspecto y caché) en el HUD y en el selector de aspecto |

Depuración: `?debug` y `__mn.sheet({ yaw, run, pitch, dist, list })` alinea todos los aspectos en la playa (ficha de
personaje de frente/perfil/espalda, o con la cámara de juego con `pitch: 48`).

**Calidad**

| | Baja | Media | Alta |
|---|---|---|---|
| Pixel ratio | ≤ 1 | ≤ 1.5 | ≤ 2 |
| Supersampling | — | — | 1.5× (si DPR ≤ 1.25) |
| Contornos | no | sí + FXAA | sí |
| Sombras | 1024, PCF | 2048, PCF | 2048, PCF (bordes suavizados por `mnBand`) |
| Partículas | 50 % | 100 % | 100 % |
| Agua | sin olas en normal | completa | completa |

AUTO: mide FPS cada 3 s y baja un nivel si cae de 45. F3 = overlay (fps, ms, draw calls, triángulos, entidades,
proyectiles, error de predicción).

Presupuesto: < 200 draw calls, < 300 k triángulos, 1500 proyectiles, pools fijos, cero `new` en el loop.

## 12. Momentos Highlight (GSAP)

- **Level-up en combate** (1.6 s, no bloquea): slow-mo 0.5× 0.3 s → anillo dorado que sube → flash suave →
  «NIVEL n» letra a letra con rebote → «▲+HP ▲+ATK» → acorde.
- **Cofre del jefe** (5 etapas, ninguna se omite): Anticipación (idle + sacudidas, «Clic») → Subida de rango
  (cada clic: salto, giro, aplastón; rareza +1 escalón) → Carga ~1 s (temblor creciente, luz por costuras, riser)
  → Explosión (bloom radial, shake, dolly-in, 3 ondas, rayos, monedas, confeti UNA vez) → Revelación y liquidación
  (cartas en arco con overshoot, números rodando, «¡NUEVO!», monedas por Bézier al HUD con «pop»).
  Glow detrás del cofre; nada tapa al héroe; nada queda temblando.

## 13. Ganchos navales y de comercio (NO se construyen ahora)

Muelle con barco anclado e interacción «ZARPAR — próximamente» · `data/ship_modules.js` con el esquema
(casco; módulos cañón/bodega/mástil/camarotes con slots de tripulación) · componente `vehicle` reservado en el ECS ·
`camera.setMode('naval')` · tipos de mensaje reservados en el protocolo. Los cañones del v0 (pistola, ráfaga,
escopeta, pesado) inspiran los módulos de cañón.

## 14. Plan de archivos

```
index.html                 bootstrap: importmap con respaldo jsdelivr → unpkg, capas de UI
styles/                    vars.css · hud.css · panels.css · title.css (· reward.css en M5)
src/main.js                arranque, frame, safe()
src/core/                  loop · input · events · rng · math · settings
src/net/                   protocol · transport · localServer · worker · wsTransport (stub)
src/client/                gameClient (predicción, reconciliación, interpolación)
src/sim/                   world · ecs · worldgen · noise · collision · systems/{movement,bots}
src/render/                scene · pipeline · camera · lighting · toon · noiseTex · sky · terrain · water ·
                           vegetation · props · charkit · charlooks · characters · ambient · quality ·
                           vfx/{effects,particles,afterimage}
src/ui/                    title · hud · banners · prompts · pause · stats · touch · toasts
src/audio/                 engine · sfx · music · ambience
src/data/                  meta · tuning (· items · skills · enemies · boss · loot_tables · quests · ship_modules)
tests/                     tests de la sim y de la geometría de personajes en Node (`npm test`)
tools/shot.mjs             capturas automáticas con Playwright
legacy/                    intento v0 (servidor Socket.io 2D) + REVIEW.md
```

## 15. Dirección de arte v2: plan de cambios por referencias

Proceso: el autor manda referencias por área; para cada una se apunta qué tiene que no tengamos y qué cambia. Hecho:
**agua v2** (refracción, absorción, espuma, cáusticas) y **personajes v2** (adultos low-poly, arriba en §11).

**Ambiente (siguiente).** Dos referencias de ARPG isométrico oscuro: (A) campo de batalla de noche bajo la lluvia, luz
de luna fría y un fuego cálido; (B) mazmorra violeta con braseros, chispas y contornos de tinta. Lo que tienen y
nosotros no:

| Rasgo de la referencia | Hoy | Cambio previsto | Coste |
|---|---|---|---|
| Charcos de luz local cálida (braseros, fogata, faroles, lava) que tiñen suelo, props y personajes | solo sol + hemisférica; braseros sin luz | **luces locales**: hasta 8 luces puntuales cercanas (4 en baja) evaluadas en la misma función de bandas (`mnBand`), caída por bandas y parpadeo; sin sombras | ~1 bucle corto por píxel |
| Sombras frías azul-violeta, luces cálidas, mucho contraste | sombras teñidas suaves, día brillante | **grading**: tonos partidos (sombras → violeta, luces → ámbar), curva de contraste y viñeta por preset | 0 draw calls (pase final) |
| Noche / atardecer con luz de luna | «día» y «hora dorada» | presets **noche** (luna fría, niebla oscura) y **noche volcánica** para La Caldera (cielo tapado por humo, la lava y los braseros iluminan); opcional ciclo día/noche | — |
| Resplandor (bloom) en fuego, lava, gemas, hechizos | no | bloom a media resolución con umbral (emisivos y `aGlow`) | +3 pasadas a media res. |
| Chispas y brasas en el aire con estela, ceniza | brasas simples en La Caldera | partículas estiradas por velocidad, ceniza, humo con luz de los braseros | 1 draw instanciado |
| Lluvia, suelo mojado y charcos | no | opcional: lluvia instanciada + ondas en el agua, terreno más oscuro con brillo especular y charcos por textura de ruido | 1–2 draws |
| Contorno de tinta y tramado en sombras (B) | contorno uniforme | opcional «cómic»: tramado en pantalla dentro de las bandas oscuras y grosor de contorno variable | 1 lectura de textura |
| Muros en primer plano oscurecidos (corte) | se disuelven con tramado | oscurecer a silueta el primer plano, además del tramado | — |
| Decals de sangre y quemaduras | no | decals en pool (llegan con el combate de M2) | instanciado |

Orden propuesto: 1) luces locales + presets noche / noche volcánica + grading, 2) bloom + brasas/chispas, 3) lluvia
y suelo mojado, 4) modo tinta. La playa y la aldea pueden seguir de día con más contraste; la noche y La Caldera
llevan el ambiente completo de las referencias. Presupuesto igual que hoy: < 200 draw calls, < 300 k triángulos.

## 16. Milestones y checklist de cada entrega

| M | Contenido | Estado |
|---|---|---|
| M0 | Este documento | ✅ |
| M1 | Isla + agua + luz + cámara + personaje caminando y dasheando + arquitectura de red local | ✅ (ver README) |
| M2 | Proyectiles + parry/reflect/dash + 2 enemigos + feel + F4 → **test de diversión** | |
| M3 | Oleadas + enemigos restantes + jefe 3 fases | |
| M4 | Progresión + inventario + loot + HUD completo + misiones + guardado | |
| M5 | Highlights (level-up, cofre) + pulido VFX + música por capas | |
| M6 | Rendimiento, calidad auto, móvil, accesibilidad, bots + chat, ganchos navales, README final | |

Checklist de capturas por milestone: ¿el personaje queda tapado por glow/partículas/texto/vegetación? ¿algo se quema
a blanco? ¿se distinguen parreable/pesado/imparable al zoom por defecto? ¿artefactos de contorno? ¿texto pequeño
legible? ¿algo sigue temblando tras asentarse? ¿FPS en objetivo por calidad? ¿algún golpe injusto?
