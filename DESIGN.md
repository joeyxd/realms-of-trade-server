# MAREA NEGRA — Documento de diseño (Milestone 0)

> Nombre de código temporal. El título vive en **un solo lugar**: `src/data/meta.js`.
> Todos los números de este documento salen de `src/data/tuning.js`. Si cambias uno, cambia el otro
> (el panel de debug F4 de M2 edita `tuning.js` en vivo).

Rebanada vertical 1: **Isla tropical + Arena «La Caldera»**. Action-RPG isométrico para navegador
(Three.js 0.160), arquitectura MMO-ready, todo procedural (geometría, texturas, shaders, audio).

**El chiste del juego** (decisión del autor, M4.7): la estructura es la **economía**, la **construcción**, los
**barcos** y el **comercio entre pueblos**, y descansa sobre una base de acción que es divertida por sí misma
(combate bullet hell, tatuajes, perlas negras). Orden: primero terminar la base divertida, luego la estructura.
Construcción y barcos se unen en **«La Balsa»** (referencia del autor: *Raft*): tu barco es tu casa, empieza con
cuatro tablones y una vela y crece pieza a pieza hasta una fortaleza flotante con la que comercias de pueblo en
pueblo (`PLAN-M6.md`). Para seguir el proyecto: `docs/HANDOFF.md`.

**Prioridad del autor (2026-10-04):** construir y habitar en tierra firme o en un barco modular es la joya del
juego; barcos aéreos más adelante. Acuerdos de manejo por materiales/navegación/carga/distribución, piratería,
oficios regionales y ciudades en `docs/NAVAL-ROADMAP.md`. Topología naval/abordaje, fórmulas y detalles de
pérdidas/recuperación siguen abiertos. La discusión inicial vive en `docs/NAVAL-HOUSING-DISCUSSION.md`.

**Assets: híbrido** (decisión del autor). Todo lo que se pueda sigue siendo procedural (mundo, props, vegetación,
VFX, audio y los personajes base). Más adelante se importarán modelos `.glb` (GLTFLoader) para héroes, jefes y quizá
NPCs, pasados por `patchToon` para que compartan bandas de luz, contornos, luces locales y bloom; traen su propio
esqueleto y animaciones (no el rig de 15 huesos). A vigilar: licencias, peso de descarga y triángulos (presupuesto §11).

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

Dirección de contenido del autor (2026-10-04): regiones con tecnologías distintas, desde balsa/vela y motores
hasta vapor, estética victoriana/steampunk y enclaves de alta tecnología con robots. Materiales/oficios y
logística regionales sostienen esa convivencia. Barcos aéreos después; el contenido actual no entrega esas eras.

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
| La Caldera | `caldera` | < 27 u del centro de la arena | crepitar de lava, rumor | **noche volcánica** (transición 2 s) |
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
| Apuntar (el cuerpo mira al cursor, M3.5) | cursor · stick derecho del mando | auto-apuntado; arrastrar Q/E/R apunta | M1 / M3.5 |
| Ataque básico del arma (sable: combo + reflejo a tiempo; pistolas: disparo mantenido) | LMB · J · RT | ATK (mantener) | M2 / M3.5 |
| Guardia (mantener; perfecta = atrapar) | RMB · K · LT | GUARDIA (mantener) | M3.5 |
| Dash | ESPACIO · A | DASH | M1 |
| Habilidades del arma | Q / E · RB / LB | Q / E (tocar o arrastrar) | M3.5 (todo el kit desde Nv 1) |
| R (RIPOSTE lleno; depende del arma) | R · Y | R | M2 / M3.5 |
| Cambiar de arma | F junto a un armero | F | M3.5 |
| Interactuar / recoger | F | botón contextual | M1 (NPC) |
| Inventario · Mapa · Stats | I · M · TAB | menú | M4 |
| Zoom | rueda | pellizco | M1 |
| Pausa | ESC | botón ❚❚ | M1 |
| Stats de rendimiento · Debug | F3 · F4 | — | M1 · M2 |

- **Buffer de inputs: 130 ms**, dentro de la simulación (determinista: cliente y servidor lo ven igual).
- **Coyote: 60 ms.** El daño de un proyectil *parreable* se aplica con 60 ms de retraso; en esa ventana LMB (sable)
  lo convierte en un reflejo **POBRE** desde tu posición y RMB en un bloqueo de guardia.
- **Combate V2 (M3.5): el arma define las habilidades** (estilo Albion). Detalle completo en `PLAN-M3.5.md` §2.
  - **Sable de cubierta**: LMB combo de 3; cada bala que el golpe toca se juzga por su tiempo hasta el impacto:
    **EXCELENTE** ≤ 70 ms (recta al cursor, × 3, 2 rebotes, el único que devuelve orbes pesados), **BUENO** ≤ 150 ms
    (± 10°, × 2), **POBRE** ≤ 260 ms (± 35°, × 1), más lejos = destruida. Q **Estocada** (4.5 u, ATK × 1.8, CD 7 s),
    E **Hoja de viento** (media luna a 14 u/s, ATK × 1.4, destruye las balas que cruza, CD 5 s), R **Tormenta**.
  - **Pistolas de chispa**: LMB mantenido = disparo alterno cada 0.2 s (ATK × 0.7, el blindaje y el escudo cuentan,
    no reflejan), Q **Descarga** (7 perdigones, sopla balas, CD 6 s), E **Paso de humo** (blink 4.5 u con i-frames,
    CD 7 s), R **Lluvia de plomo** (zona en el cursor, 1.5 s).
  - **Guardia (RMB mantenido, todas las armas)**: arco frontal de 130°, deja pasar × 0.25 (pesado × 0.4) y gasta
    aguante (60, a 0 = GUARDIA ROTA 0.9 s); alzada ≤ 130 ms antes del golpe = **PERFECTA**: 0 daño, la bala queda
    **atrapada** (hasta 3, 6 s) y tu siguiente ataque básico las devuelve; aturde a los enemigos cercanos.
  - **Armeros** (playa y aldea): F cambia de arma; el arma viaja en HELLO, `describe` y la snapshot.

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

**Reflejo (M3.5: con el sable, por tiempo; con la guardia perfecta, atrapando):** el proyectil cambia de dueño,
color al acento del jugador (`#3BF0FF`; EXCELENTE blanco-dorado, POBRE tenue), daño `nivel × max(dañoBase,
0.8·ATK)` (× 3 / × 2 / × 1), homing por nivel, vida 2.5 s, trail. Los reflejos **ignoran blindaje** (cangrejo) y
el escudo del jugador; el orbe pesado reflejado **rompe el escudo** del jefe. Las balas de pistola son otra cosa
(`kind 'bullet'`): el blindaje frontal las frena × 0.2 y el escudo del jefe × 0.4.

**~~Parry RMB~~ (M2–M3):** sustituido en M3.5 por el reflejo a tiempo de la espada y la guardia (ver §4).

**Graze (ROCE):** proyectil hostil que pasa a < 0.35 u del borde de la hurtbox sin tocar → +2 XP, +4 % RIPOSTE,
toast «ROCE». Una vez por proyectil.

**Feel**

| Evento | Hitstop | Otros |
|---|---|---|
| Destruir (LMB) | 70 ms | chispas, «tic» metálico |
| Reflejo POBRE / BUENO | 50 / 80 ms | whoosh + trail; «POBRE» / «BUENO» |
| **EXCELENTE** | 110 ms | slow-mo 0.35× durante 0.25 s, flash, onda de choque 3 capas (ancha-tenue / media / fina-brillante), toast «¡EXCELENTE!», «clang» que sube un semitono por reflejo encadenado |
| **Guardia perfecta** | 90 ms | slow-mo 0.5×, «¡ATRAPADA!», las balas atrapadas giran sobre tu hombro |
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
| Centinela (M2) | 140 (def 2) | 2.3 | 4.5–8 | cerca: tajo AoE r=2.6 delante, 18 · medio: abanico de 3 púas imparables 10 u/s · cada ~9 s: orbe pesado 4.5 u/s | 0.8 / 0.6 / 0.8 s | 2.2–3 s | 60 |
| Grumete ahogado (M2.5) | 24 | 4.6 | persigue | mordisco AoE r=1.05 delante, 9; llegan en manadas, knockback × 1.6 | 420 ms | 1.1 s | 8 |
| Diablillo de fuego (M2.5) | 28 | 5.5 | orbita 5–7 | espiral de 10 orbes parreables (36° cada uno, círculo completo en 0.8 s), 7 u/s | 400 ms | 2.8 s | 20 |
| Chamán de coral (M2.5) | 60 | 2.4 | 8–10 | anillo de 14 orbes alternando parreable/imparable, 6 u/s | 600 ms | 3.5 s | 40 |
| Cangrejo mortero (M3) | 80 (def 3) | 2.0 | 7–11 | 3 morteros r=2.2 (uno en el jugador, dos a 2.6 u), vuelan 1.1 s y caen aunque muera; gira a 2.4 rad/s | 500 ms | 3.0 s | 50 |

Los centinelas duermen junto al portón de La Caldera y despiertan (1.3 s) cuando te acercas. El diablillo, el chamán
y el grumete llegan con la Prueba de Fuego (M2.5, `PLAN-M2.5.md`); el cangrejo, con sus oleadas 4 y 5 (M3, `PLAN-M3.md`).

**La Prueba de Fuego (M2.5):** pisar el círculo de runas del centro de La Caldera inicia 3 oleadas (5 grumetes +
2 arqueros · 4 diablillos + 4 grumetes + 2 arqueros, refuerzo de 5 grumetes · 3 chamanes + 3 diablillos + 6 grumetes,
refuerzo de 2 arqueros + 2 diablillos + 4 grumetes) y después HELLFIRE. Aparecen levantándose del suelo en un anillo
de r=14 (nunca delante del portón). Entre oleadas, 4 s de respiro y se limpian las balas hostiles. Si no queda ningún
participante vivo dentro durante 6 s, la prueba se reinicia; si ya habías llegado al jefe, el siguiente intento
empieza en el jefe. Tras ganar, 40 s de espera para repetir. Datos: `src/data/encounters.js`.
**Rebote:** un reflejo que impacta salta al enemigo más cercano (≤ 7 u, daño × 0.75): 1 vez (normal / RIPOSTE),
2 (PERFECTO). Varios reflejos sobre el mismo enemigo en 0.6 s hacen × (1 − 0.2·n), mínimo × 0.15.
**ESQUIVA:** atravesar con el dash una bala parreable o pesada que te habría dado: +1 XP, +3 RIPOSTE.

**Zona de práctica (M2):** en la playa, junto al punto de inicio: un muñeco de paja (combo de 3, se cura entre
rachas) y un cañón que dispara bolas lentas parreables a quien pisa su anillo de cuerda (r=4.2). Sin palmeras,
arbustos ni rocas delante de la cámara.

Cangrejo: **blindado por delante** (120°): daño × 0.2 de frente; × 1 por flanco/espalda; reflejos ignoran blindaje.

**Oleadas** (implementadas en M3; gong + banner «OLEADA n/5», 4 s de respiro, la música sube una capa cada dos):

| Oleada | Composición | Refuerzo |
|---|---|---|
| 1 | 5 grumetes + 2 arqueros | — |
| 2 | 4 diablillos + 4 grumetes + 2 arqueros | a los 8 s: 5 grumetes |
| 3 | 3 chamanes + 3 diablillos + 6 grumetes | a los 10 s: 2 arqueros + 2 diablillos + 4 grumetes |
| 4 | 2 cangrejos + 2 arqueros + 3 diablillos + 6 grumetes | a los 8 s: 1 cangrejo + 5 grumetes |
| 5 | 3 cangrejos + 2 chamanes + 6 grumetes | a los 10 s: 3 diablillos + 2 arqueros + 5 grumetes |

## 8. Jefe «HELLFIRE» (HP 3200 desde M3)

> **Versión M2.5 (implementada, 2 fases, HP 2600, DEF 8):** fase 1 (100–55 %) ciclo `fan5, spiral2 (3 brazos, 36),
> fan5, rings2 (2 × 16 alternos)` + orbe pesado cada 12 s; ENRAGE al 55 % (2 s invulnerable, se limpian las balas
> hostiles, invoca 3 grumetes); fase 2 ciclo `flower (6 brazos, 84 orbes), wall (9 púas imparables), rings3 (3 × 18),
> summon (máx 6 esbirros), fan7, spiral2` + orbe pesado cada 10 s, con **escudo** (daño × 0.2 salvo reflejos);
> reflejar el orbe pesado lo rompe 4 s (× 1.5) y lo aturde 1.5 s. Si te pegas a él: `slam` r=4.6 cada 3 s.
> Muerte: slow-mo 0.3× 1.2 s, 1500 XP.
>
> **Versión M3 (implementada, 3 fases, HP 3200, DEF 8; `PLAN-M3.md`, datos en `src/data/enemies.js`):**
> fase 1 (100–75 %) `fan5, spiral2, charge, fan5, rings2` (la **Embestida**: rectángulo de telegraph 0.7 s, 18 u/s,
> 20 daño); fase 2 (75–45 %) con escudo: `flower, laser2, rings3, summon, wall, fan7, laser2, spiral2` (**láser doble**
> ±50 °/s, 4 s, sentido alterno; invoca grumetes y diablillos); fase 3 (45–0 %): `meteors (8, r=1.8, 1 de 3 al
> jugador), curtain (4 filas de 30 con hueco), lanes (3 carriles de 3 u a 5 u/s), flower, meteors, spiral3 (4 brazos),
> lanes, rings3` + **lava** 19 → 11 u a 0.12 u/s (6 daño / 0.5 s) + **llamas** (lo que no sea reflejo × 0.5) + orbe
> pesado cada 14 s que, reflejado, lo aturde 2.5 s (× 1.4). Láseres y carriles se cruzan con dash (FANTASMA).
> La tabla de abajo es el diseño original; los valores reales son los de arriba.

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

Extensiones acordadas, aún sin implementación: navegación para operar barcos mayores y mejorar su manejo;
especialidades de comercio/oficio para mercancías, cantidades y recetas; afinidad por uso de poderes de perla.
Propuesta de afinidad por personaje/tipo de poder, separada del UID que cae/circula; techo/mejoras pendientes.
Ver `docs/NAVAL-ROADMAP.md` §§2 y 6; no modifica los números actuales de esta sección.

**Stats por nivel:** HP `100 + 12·(Lv−1)` · ATK `10 + 2·(Lv−1)` · DEF `2 + (Lv−1)` · SPD 6.5 (solo equipo) ·
CRIT 5 % (equipo) · ventana de parry 180 ms (± arma).

**Daño:** `max(1, round(ATK · mult · (crit ? 1.75 : 1) · (1 − DEF/(DEF+40))))`. Combo: 1.0 / 1.15 / 1.6 (360°).

**M3.5:** el kit lo da el **arma** (§4) y está entero desde Nv 1; los desbloqueos de Q / E / R por nivel de esta
tabla quedan **sustituidos** (M4 atará el kit a la maestría de cada arma, como Albion). Los niveles siguen dando
stats y la 2ª carga de dash.

| Lv → Lv+1 | XP | Acumulado | Desbloqueo al llegar |
|---|---|---|---|
| 1 → 2 | 100 | 100 | 2ª carga de dash |
| 2 → 3 | 180 | 280 | ~~Q «Tajo Giratorio»~~ (M3.5: Q del arma) |
| 3 → 4 | 280 | 560 | |
| 4 → 5 | 400 | 960 | ~~E «Guardia de Marea»~~ (M3.5: E del arma) |
| 5 → 6 | 550 | 1510 | |
| 6 → 7 | 720 | 2230 | ~~R «Riposte Tormenta»~~ (M3.5: R del arma, con el RIPOSTE lleno) |
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

### M4: lo construido (`PLAN-M4.md`)

- **Estadísticas** = base por nivel (arriba) + equipo + maestría → columnas del ECS. ATK final =
  `round((base + equipo) × (1 + 0.02·(maestría − 1)))`; la vida conserva su fracción al cambiar. Topes: CRÍT 50 %,
  velocidad −10 % … +25 %, enfriamiento 30 %, recarga de dash 30 %.
- **Maestría por arma** (1–10; sustituye los desbloqueos tachados de la tabla): toda la XP va también al arma
  equipada, aun en el nivel máximo. XP por nivel `[60, 140, 300, 900, 1800, 3200, 5600, 9000, 14000]` (acumulado
  M3 200, M5 1400, M10 35 000). LMB + Q en M1, E en M2, R en M3, +2 % de daño por nivel; Sable M5 «Filo templado»
  (+15 ms a EXCELENTE y BUENO), M10 «Ojo del huracán» (Tormenta 6 → 8 u); Pistolas M5 «Gatillo fácil» (cadencia ×
  0.85), M10 «Diluvio» (Lluvia 1.5 → 2.25 s, r + 0.8). Ritmo medido: el kit se abre en el camino, M5 en la primera
  Prueba y M10 hacia la quinta.
- **Objetos:** presupuesto `(2 + 0.8·nivel) × mul(rareza)` repartido por la base y los afijos (`STATS[k].per`
  puntos → valor). 20 bases, afijos por hueco sin repetir, el nombre lleva el sufijo del afijo mayor. Valor
  `round((3 + 2·nivel) × mul^1.4 × (1 + 0.15·afijos))`; Tía Perla paga el 100 %, desguazar el 25 %.
- **Loot** (`src/data/loot.js`): tablas por enemigo (oro, objeto, poción, coral), personal para cada pirata con
  derecho a la XP, 120 s en el suelo, recogida a 1.5 u. Cofre del jefe (sin la etapa de clics hasta M5): Raro +
  2 tiradas de subir al 35 %, 2 objetos más, 60–100 oro y una poción. Nivel del objeto = nivel del enemigo (o el
  tuyo en el cofre) + la Marea.
- **Mareas:** I (× 1) · II (vida × 1.8, daño × 1.5, +3 niveles, rareza +0.5, XP × 1.6, oro × 1.5) · III (× 3.2,
  × 2.4, +6, +1, × 2.4, × 2.2). Medido: la primera Marea II cuesta ~1–1.3 vidas y la primera III ~1.5 (sin
  regeneración ni pociones); con el equipo de III baja a ~0.3. Nivel 10 tras la segunda Prueba; desde ahí progresa
  el equipo.
- **Misiones** como se construyeron: la cadena Tierra firme (40 XP) → La capitana del puerto (100 XP + 20 oro) →
  Limpia el camino (3 arqueros, 200 XP + 2 pociones) → Los guardianes (2 centinelas, 150 XP + 40 oro) → Sobrevive a
  La Caldera (300 XP + 100 oro); Coral para la tía (6 corales, 2 pociones + 60 oro + abalorio) y Caza en La Caldera
  (40 enemigos, repetible, 120 oro + 1 poción). Los logros quedan para M5.

### M4.5: la Cala Calavera (`PLAN-M4.5.md`)

- **Sumideros de oro:** Cofre de la Marea II (450 oro, nivel + 3, rareza + 0.5) y III (1100, + 6, + 1, al menos Poco
  común) en el puesto de Tía Perla, con la Marea correspondiente abierta.
- **Zona sin ley** (`src/data/lawless.js`): un fuerte de radio 21 u junto a la costa este. Dentro, los golpes de un
  pirata hieren a los demás piratas de dentro × `pvpDmg` 0.6 (críticos del atacante, DEF del que recibe, compensación
  de lag con un historial de posiciones de los piratas). Dash: esquiva. Guardia: × `blockMult` y aguante. Guardia
  perfecta: 0 y aturde 0.5 s al atacante a ≤ 3.2 u. Golpe pesado: aturde 0.3 s. La ventana de gracia tras un golpe
  (0.35 s) frena las balas pero no el sable ni la estocada (un tajo golpea una vez por swing de todos modos).
- **Botín completo:** morir dentro deja en el suelo todo lo puesto (menos el arma inicial), la bolsa y las pociones,
  180 s, públicos (el primero que los pisa y puede cargarlos); el oro se queda; arma inicial del mismo kit. El botín
  de los mobs de dentro se tira una vez y es público (150 s).
- **Mobs:** 13 generadores a «Sin ley» (vida × 1.6, daño × 1.4, nivel + 3, rareza + 0.6, XP y oro × 1.5) que reaparecen
  aunque haya piratas (se levantan en 1.1 s). Las balas armadas y los círculos de un mob hieren a otros mobs de dentro,
  que lo eligen como objetivo 6 s (el golpe de un pirata lo devuelve al pirata). Desalmados (sable: 180 de vida;
  pistolas: 150): el pirata más cercano a su alcance (distancia × 0.7); sin ninguno, mobs de la Cala mientras haya un
  pirata a ≤ R + 18 u; nunca se hieren entre ellos; sueltan 2 objetos (rareza + 0.8, uno al menos Poco común). Un mob
  rematado por otro es la muerte del último pirata que lo hirió en 8 s (`assist`); sin él, sin XP ni misión (el botín
  cae igual, público).
- Medido (`tools/lawless.mjs`, bots de habilidad 0.8 con equipo de su nivel): un duelo de sable dura ~5 s, sable
  contra pistolas 8–15 s y pistolas contra pistolas ~16 s; con los mobs, el otro pirata quita 130–240 de vida por
  minuto y los mobs ~30 (a bots que reflejan casi todo; a una pirata de nivel 1 quieta la hunden en ~8 s).

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
          └─ WsTransport → server/ (Node, M3.6): estáticos + /ws + GameHost → el MISMO LocalServer
```

- **Paso fijo 60 Hz** (acumulador), `dt` de frame limitado a 0.05 s, render desacoplado con interpolación.
- `sim/` es **puro**: sin THREE, sin DOM, sin `Math.random` (RNG con semilla `mulberry32`), sin reloj de pared.
  Se ejecuta igual en el Worker, en Node (tests) y, en el futuro, en el servidor real.
- **ECS-lite** sobre typed arrays (`Float64Array` para que predicción y servidor den bits idénticos):
  componentes `pos, vel, facing, mover, dash, player, bot, npc, vehicle(reservado)`; sistemas puros.
- **Modelo de comandos (tipo Source):** el jugador solo avanza cuando se procesa uno de sus comandos, tanto en el
  cliente (predicción) como en el servidor. Con colisión estática determinista el error de predicción es 0;
  lo que el servidor añada (knockback, etc.) se corrige por reconciliación con suavizado visual (λ=15).
- **Combate V2 en red (M3.5):** el comando lleva `btn` con el bit `AIM` (apuntado explícito) y `w` (arma pedida + 1,
  solo junto a un armero). Todo lo que toca balas hostiles (golpes, guardia, estocada, media luna, descarga, lluvia)
  corre en el paso del comando al `pt` del cliente, así que la predicción lo repite exacto; el daño a enemigos es
  solo del servidor con historial rebobinado (`pt − interpTicks`). Los disparos del jugador (`Shots`) llevan `kind`,
  `tier`, `knock` y `lag`: el servidor los prueba contra los enemigos tal como los veía quien disparó
  (`lag = clamp(tick − pt, 0, rewind) + interpTicks`, `world.lagPos`), y el cliente adopta la copia del servidor por
  `key` (la del evento `shot`, con `owner`). Snapshot: `ENT.WPN` (17).
- **Tiempo de instancia:** el slow-mo y el hitstop son propiedades de la *instancia* (la arena es una instancia por
  grupo, como una mazmorra de MMO), decididas por el servidor y replicadas. En el mundo abierto compartido el hitstop
  es solo cosmético en el cliente (≤ 110 ms, la sim no se detiene).
- **Bots** viven en el servidor como entidades `player` con nombre; la UI no distingue bots de humanos.
- **Compensación de lag (M2):** cada comando lleva `pt`, el tick de proyectiles que el jugador estaba viendo. El
  servidor lo limita a `[tick − 24, tick + 2]` (20 hasta M3.5; a 300 ms de RTT se quedaba corto) y evalúa parries, destrucciones, golpes y roces en ese tick (los
  proyectiles son analíticos: no hace falta historial); el melee usa el historial de posiciones de los enemigos
  `interpTicks` antes de `pt`. El cliente avanza `pt` +1 por comando con recuperación (hasta +3 si va ≥ 2 ticks
  atrás, −1 si va ≥ 2 adelante, salto si el error pasa de 12). La estimación del reloj del servidor usa un filtro
  asimétrico (adopta al 60 % las muestras donde el servidor va adelantado y al 5 % las tardías; salta si cambia
  > 0.25 s), para que un cliente lento no se quede cerca del límite de rebobinado.
- **Tiempo de instancia (M2):** hitstop y slow-mo se aplican en el servidor (la sim de la instancia se detiene o se
  ralentiza) y en el cliente con el mismo evento `time {hitstop, scale, dur}`.
- **Servidor real (M3.6):** `npm start` = un proceso que sirve el cliente y corre el mundo. `GameHost`
  (`server/host.mjs`) envuelve el `LocalServer` del Worker: un id por socket, JSON + permessage-deflate, cubetas de
  tokens (120 mensajes/s, 48 KB/s), 5 mensajes basura por segundo cierran el socket, `cmds` ≤ 32 por mensaje,
  latido cada 15 s, `MAX_PLAYERS` (4) con `full` para el quinto (sigue mirando), `PROTOCOL_VERSION` 3 con `error`
  (4 desde M4).
  El cliente entra en línea si la página trae `<meta name="mn-server">` (la inyecta el servidor) o `?server=`.
- **Comandos de relleno (M3.6, solo en línea):** un cliente callado más de `combat.starveTicks` (12 = 200 ms) recibe
  comandos neutros (sin moverse, botones sueltos, `pt` avanzando dentro del rebobinado): el mundo le sigue
  golpeando y el encuentro no se atasca. Los comandos que lleguen después con `pt` ≤ el último relleno se
  descartan (no dan movimiento extra tras un pico de lag) y sus pulsaciones pasan al siguiente; tras una pestaña
  oculta el cliente sigue desde «ahora» y no se pierde nada. El `ack` no avanza con el relleno: el cliente
  reconcilia. En solo un dispositivo lento no se castiga (sin relleno).
- **Tiempo de instancia en cooperativo (M3.6):** el servidor marca cada `time` con `inst`. Un evento del mundo
  (`e: 0`, la muerte del jefe) detiene a todos. El hitstop / slow-mo de un jugador solo detiene la instancia si es
  el único humano; con compañía queda en su pantalla (hitstop ≤ `combat.coopHitstop` 60 ms, sin cámara lenta) y los
  demás lo ignoran. Los bots nunca detienen el mundo.
- **Cooperativo en la Prueba de Fuego (M3.6):** `n` = participantes humanos al empezar cada oleada / el jefe; vida
  × `1 + 0.6·(n − 1)` en las oleadas y × `1 + 0.75·(n − 1)` para HELLFIRE y sus esbirros. El evento `enc` y el
  estado del encuentro (índice 10) llevan `n`; el HUD dice «Tripulación n».
- **Perfiles y guardado (M4):** `world.profiles` (entidad → perfil) solo en el servidor; lo que cambia los números
  (equipo, nivel, maestría) se vuelca en columnas de `PLAYER_FIELDS` y el cliente guarda una copia del perfil en su
  mundo de predicción, así que una subida de nivel predicha da las mismas stats. Los eventos con `to` (loot,
  recogidas, misiones, diálogo, Marea, `note`) solo van a ese cliente. `MSG.PROFILE` (agrupado por tick) y
  `MSG.SAVE` (a los 3 s de un cambio, al momento en lo importante y un repaso cada 10 s; solo si cambió). En Node el
  blob es `base64url(json).firma` con HMAC-SHA256 (`SAVE_SECRET`); en el Worker es el JSON. Todo perfil cargado se
  sanea (bases y afijos conocidos, rangos, misiones y banderas). El loot sale de `world.lootRng` (otra semilla).
- **Almacenamiento M5 P1:** `server/store.mjs` proporciona memoria y Supabase con el mismo contrato de
  versiones optimistas y propiedad única. `GameHost` puede resolver una identidad verificada antes del
  HELLO, cargar su perfil, serializar guardados y esperar el último al cerrar. Ese perfil no produce un blob
  anónimo reutilizable. La reserva de cuenta es local al host; un conflicto cierra la sesión sin sobrescribir.
  P2 añade correo/contraseña en el título en línea, token verificado por un cliente Auth separado y configuración
  pública del servidor. Importación voluntaria con firma/identidad, perfil y recibo único en una transacción;
  el perfil existente prevalece y el legacy importado deja de restaurarse como invitado. Sin cuentas activas,
  sigue el flujo firmado anterior; Worker sin login. Proveedor real, Google/Discord y recuperación pendientes.
  P3 carga economía antes de escuchar y guarda snapshots CAS cada 60 s/cierre. D09a añade `commitPearl`:
  perfiles CAS, propietario de UID y recibo idempotente en una transacción, con comprobación diferida de
  propiedad. SQL 003 aplicada/verificada real. D09b coordina guardados/operación/rebase en las sesiones,
  comprueba UIDs registrados antes de WELCOME y cerca resultados ambiguos hasta leer recibo/perfiles/UID.
  Faltan staging/ack de simulación, leases, backfill de raras existentes, restauración del suelo y movimientos navales.
  [Contrato D09b](docs/delivery/d09b-pearl-sessions.md).
  D09c extiende almacenamiento con `commitPearlGround`: perfiles, ledger, ubicación y recibos atómicos,
  mint/relocación sin cuentas, tombstone al estar en perfil y listado por mundo/UID sin borrar expirados.
  SQL 004 aplicada/verificada real. D09d conecta la API a la cola común y verifica también ubicación actual
  al recuperar recibos. Faltan diario de intenciones tras restart y staging/restauración del juego. Los tiempos
  son datos del caller, sin política de envejecimiento offline.
  [Contrato D09c](docs/delivery/d09c-pearl-ground.md), [cola D09d](docs/delivery/d09d-pearl-ground-queue.md).
- **Ancho de banda (M3.6):** las entidades remotas viajan cuantizadas (posición y frente a 1/1000, velocidades a
  1/100); `you` va a precisión completa. Medido con 4 jugadores en la oleada 1: **8 KB/s por cliente** en el cable
  (41 KB/s de JSON antes de comprimir); el binario de abajo queda para > 8 jugadores por instancia.

### Protocolo (JSON hoy, binario después) — `src/net/protocol.js`

| Dir. | Tipo | Campos | Fiable |
|---|---|---|---|
| C→S | `hello` | `v` (12), `name` (≤ 16, saneado, único), `skin`, `weapon`, `save` (M4, ≤ 32 KB), `token?` (P2, ≤ 8 KB), `importSave?` | sí |
| C→S | `input` | `seq, mx, mz` (−1..1, cuantizado 1/127), `ax, az` (punto de mira), `btn` (bits mantenidos), `prs` (bits pulsados este tick) | orden |
| C→S | `cmd` | `{type: 'equip' \| 'unequip' \| 'salvage' \| 'open' \| 'talk' \| 'quest' \| 'buy' \| 'sell' \| 'tut' \| 'tier' \| 'pause' \| …}` | sí |
| C→S | `ping` | `t` | no |
| S→C | `welcome` | `you, tick, seed, tuningHash` | sí |
| S→C | `snapshot` | `tick, ack, ents[{id,k,x,y,z,f,s,a,…}], you, enc, frost, storm, ink, clock` | no (20 Hz) |
| S→C | `spawn` / `despawn` | entidad completa (nombre, skin, nivel) / id | sí |
| S→C | `event` | `damage, death` (`by`: quién hundió a un pirata), `hurt` (`kind: 'pvp'`, `by`), `loot` / `unloot` (personales con `to`; públicos con `pub`, `from`, `late`), `spill`, `levelup, pattern, reflect, phase, wave, timescale` | sí |
| S→C | `pong` | `t0, tick` | no |
| S→C | `profile` / `save` | perfil completo (privado) / `blob` para guardar (M4) | sí |
| S→C | `full` / `error` | `max` / `code: 'version'` (M3.6) | sí |
| reservado | `ship_spawn, ship_input, ship_state, board, dock, trade_offer, trade_accept` | naval/comercio (§13) | — |

M4.8 P5 / protocolo 12: los eventos `shot` y `shotEnd` llevan `owner` y `elem` fijado al salir. `Shots.elem`
alimenta daño/pasiva, rebotes, shader, estela e impacto diferido; el eco corrige predicción, incluido `elem: 0`.
Escupir/cambiar después no altera esa bala. La maldición nocturna de Tinta sigue comprobando al portador y la
hora en el tick de impacto. Los eventos de ataque de un jugador sin perla también declaran cero para no adquirir
el tinte de una perla tragada después. Paletas congeladas en `src/data/elements.js`, pools y señales hostiles
conservados; sonido elemental de dos voces máximo al inicio. Balance/evidencia: [D03](docs/delivery/d03-pearlkit.md).

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
6. **Capa FX** (partículas, chispas, ondas, proyectiles, afterimages) sobre `rtPost`, con oclusión manual contra la
   profundidad de `rtNormal` (partículas suaves). Nunca reciben contorno.
7. **Bloom** a partir de la máscara de brillo (alfa de `rtPost`): ½ → ¼ → ⅛ → 1/16 de pantalla y vuelta (§15).
8. **Bloom + gradación + AA**: contraste, tonos partidos, saturación, viñeta, peligro, flash ≤ 0.8, aberración en
   slow-mo, dither a 8 bits; alta → downsample bilineal del 1.5×; media → FXAA.
9. **DOM**: HUD, nameplates, números flotantes.

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

Baja: sin contornos, render directo + FX con test de profundidad normal (sin bloom ni gradación).

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
  hemisférica cálida, rim light fría desde atrás. De noche el mismo sol es la luna. Presets y luces locales: §15.

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
| Luces locales | 4 | 8 | 12 |
| Bloom y gradación | no | sí | sí |
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

Dirección naval ampliada (2026-10-04): material/navegación/carga/distribución cambian manejo, soltar carga para
escapar, rendición y notoriedad/patrullas, reservas locales en puerto, rutas protegidas con PvE y atajos disputados.
Crafting/harvesting regionales y remesas financian obras visibles de ciudad. M5–M8 tienen sus ampliaciones en
plan; el núcleo económico existente aún no es navegación/abordaje jugable. Formato recomendado, aún abierto:
mar regional compartido con dos zooms y abordaje sobre cubiertas reales enganchadas. `docs/NAVAL-ROADMAP.md`
separa acuerdos, alternativas, contratos técnicos y aceptación por fases.

## 14. Plan de archivos

```
index.html                 bootstrap: importmap con respaldo jsdelivr → unpkg, capas de UI
styles/                    vars.css · hud.css · panels.css · title.css (· reward.css en M5)
src/main.js                arranque, frame, safe()
src/core/                  loop · input · events · rng · math · settings
src/net/                   protocol · transport · localServer · worker · wsTransport (stub)
src/client/                gameClient (predicción, reconciliación, interpolación)
src/sim/                   world · ecs · worldgen · noise · collision · systems/{movement,bots}
src/render/                scene · pipeline · camera · lighting · lights · toon · noiseTex · sky · terrain · water ·
                           vegetation · props · charkit · charlooks · characters · ambient · quality · practice ·
                           crab (M3) · vfx/{effects,particles,streaks,afterimage,decals,projectiles,hazardfx (M3)}
src/ui/                    title · hud · banners · prompts · pause · stats · touch · toasts
src/audio/                 engine · sfx · music · ambience
src/data/                  meta · tuning · enemies · encounters (M2.5) (· items · skills · loot_tables · quests) · ship_modules
src/sim/systems/           movement · bots · combat · enemies · boss (M2.5) · encounter (M2.5)
src/sim/projectiles.js     proyectiles analíticos, patrones, disparos reflejados
tests/                     tests de la sim, de la geometría de personajes, de las luces locales y de los presets y
                           partículas en Node (`npm test`)
tools/shot.mjs             capturas automáticas con Playwright
tools/playtest.mjs         bot sin cabeza que juega La Prueba de Fuego entera (balance, M3)
legacy/                    intento v0 (servidor Socket.io 2D) + REVIEW.md
```

## 15. Dirección de arte v2: plan de cambios por referencias

Proceso: el autor manda referencias por área; para cada una se apunta qué tiene que no tengamos y qué cambia. Hecho:
**agua v2** (refracción, absorción, espuma, cáusticas), **personajes v2** (adultos low-poly, arriba en §11) y los
**pasos 1 y 2 del ambiente** (abajo).

**Ambiente.** Dos referencias de ARPG isométrico oscuro: (A) campo de batalla de noche bajo la lluvia, luz
de luna fría y un fuego cálido; (B) mazmorra violeta con braseros, chispas y contornos de tinta. Lo que tienen y
nosotros no:

| Rasgo de la referencia | Hoy | Cambio previsto | Coste |
|---|---|---|---|
| Charcos de luz local cálida (braseros, fogata, faroles, lava) que tiñen suelo, props y personajes | solo sol + hemisférica; braseros sin luz | **luces locales**: hasta 8 luces puntuales cercanas (4 en baja) evaluadas en la misma función de bandas (`mnBand`), caída por bandas y parpadeo; sin sombras | ~1 bucle corto por píxel |
| Sombras frías azul-violeta, luces cálidas, mucho contraste | sombras teñidas suaves, día brillante | **grading**: tonos partidos (sombras → violeta, luces → ámbar), curva de contraste y viñeta por preset | 0 draw calls (pase final) |
| Noche / atardecer con luz de luna | «día» y «hora dorada» | presets **noche** (luna fría, niebla oscura) y **noche volcánica** para La Caldera (cielo tapado por humo, la lava y los braseros iluminan); opcional ciclo día/noche | — |
| Resplandor (bloom) en fuego, lava, gemas, hechizos | ✅ paso 2 | bloom por máscara de brillo (emisivos, `aGlow`, partículas) | +7 pasadas pequeñas |
| Chispas y brasas en el aire con estela, ceniza | ✅ paso 2 | chispas estiradas por velocidad, ceniza, humo con luz de los braseros | 1 draw instanciado |
| Lluvia, suelo mojado y charcos | no | opcional: lluvia instanciada + ondas en el agua, terreno más oscuro con brillo especular y charcos por textura de ruido | 1–2 draws |
| Contorno de tinta y tramado en sombras (B) | contorno uniforme | opcional «cómic»: tramado en pantalla dentro de las bandas oscuras y grosor de contorno variable | 1 lectura de textura |
| Muros en primer plano oscurecidos (corte) | se disuelven con tramado | oscurecer a silueta el primer plano, además del tramado | — |
| Decals de sangre y quemaduras | no | decals en pool (llegan con el combate de M2) | instanciado |

Orden propuesto: 1) luces locales + presets noche / noche volcánica + grading, 2) bloom + brasas/chispas, 3) lluvia
y suelo mojado, 4) modo tinta. La playa y la aldea pueden seguir de día con más contraste; la noche y La Caldera
llevan el ambiente completo de las referencias. Presupuesto igual que hoy: < 200 draw calls, < 300 k triángulos.

**Paso 1 hecho: luces locales, presets y grading** — `lights.js` · `lighting.js` · `toon.js` · `pipeline.js`

| Parte | Cómo |
|---|---|
| Luces locales | Sin luces de three.js (cambiar su número recompila todo): dos arrays de uniforms (`mnLightPos` xyz + radio, `mnLightCol` rgb·intensidad + *wrap*) y un contador. Toda superficie toon (terreno, props, vegetación, personajes) suma `mnLocalLight()` tras la luz del sol: caída en 3 bandas suaves mezcladas con una rampa (charcos pintados, no anillos) × cara hacia la luz con un mínimo por *wrap*. El agua refleja cada luz (destello en las olas + brillo suave) y la espuma se tiñe. Sin sombras. |
| Fuentes | faroles (6 del camino + 2 nuevos sobre postes del muelle), braseros y fuegos del portón, fogata, lava (puntos a ≥ 9 u sobre el río y el cráter), luz baja del suelo agrietado de la arena, ventanas de las chozas (solo al atardecer y de noche: paneles cálidos + luz), ojos de los centinelas, **luz del jugador** (radio tipo Diablo, solo de noche) y **destellos** cortos (el dash con el color del aspecto; en M2 golpes y parries). |
| Selección | Hasta 12 en alta, 8 en media, 4 en baja. Las fijas tienen sus huecos y la del jugador y los destellos usan 1–2 reservados, así nunca echan a una fija de golpe. Se ordenan por distancia al foco menos medio radio; cada elegida se apaga a medida que la primera excluida se le acerca (6 u de margen), así que el cambio de conjunto ocurre con peso 0: **sin saltos** (test). Parpadeo: 3 senos por luz, los fuegos también tiemblan en altura. |
| Presets | `day`, `golden` (atardecer), `night` (luna fría azulada, hemisférica oscura, estrellas, niebla azul marino) y `volcanic` (sol rojo apagado tras el humo, sin disco, niebla rojiza cercana, grietas más vivas). Cada preset lleva también los mandos de las luces locales (fuego, lava, ventanas, jugador), la luz del agua (dispersión, espuma, destellos), un *fill* desde la cámara para que los personajes se lean en la oscuridad y el grading. |
| Capas | **base** = luz fija (Día / Atardecer / Noche) o **ciclo** de 16 min; desde M4.8 P4 el ciclo sigue la hora de la economía autoritativa (inicio 08:00). **zona** = noche volcánica encima al entrar en La Caldera (2 s). El cambio mezcla desde la luz actual (2,5 s). Ajuste «Luz del escenario» en Pausa: sus presets son cosméticos; Tinta usa la noche del servidor, 20:00–06:00, indicada en el HUD. |
| Grading | En el pase final (media/alta): curva S de contraste y tonos partidos en espacio perceptual (sombras → violeta/índigo, luces → ámbar, tintes de luma neutra), saturación y viñeta por preset. En baja no hay pase final: solo cambian luces y colores. |
| Agua de noche | La dispersión turquesa y la espuma se escalan con la luz del preset; el brillo sólido del sol se apaga más rápido que los destellos, así que la luna deja un camino de brillos y no manchas. |
| Coste | 0 draw calls nuevos salvo 1 malla de ventanas (solo de noche); un bucle de ≤ 12 iteraciones por píxel en los shaders toon y en el agua. |
| Depuración | `?tod=day|dusk|night|cycle` y `__mn.tod('night')` prueban luz. La fase manual de `cycle` queda sustituida por el reloj compartido al actualizar el juego; F4 → «Hora del mundo: día/noche» cambia el reloj en solo para verificar la maldición. |

**Paso 2 hecho: bloom, chispas, ceniza y humo con luz** — `pipeline.js` · `toon.js` · `vfx/streaks.js` · `vfx/particles.js` · `vfx/effects.js`

| Parte | Cómo |
|---|---|
| Máscara de brillo | Sin umbral sobre la imagen (la arena al sol no debe brillar): el alfa de `rtMain`/`rtPost` guarda 1 − brillo. Lo opaco escribe 1; bajan el alfa los emisivos toon fuertes (lava, vetas calientes de las grietas, gemas `aGlow`, ojos de centinela), el cristal de los faroles (según el mando de fuego), las brasas de los braseros, las ventanas encendidas, la luna y las estrellas, los destellos de las luces locales y de la luna en el agua, las partículas aditivas, las chispas y las afterimages del dash. El humo y el polvo (mezcla normal) lo vuelven a subir: el humo delante de un fuego le tapa el resplandor. Los contornos nunca brillan; la niebla lo apaga. El terreno usa su propia máscara: brillo suave sobre el río de lava (es grande), pleno en las vetas calientes. |
| Cadena | Extracción a ½ de pantalla (4 lecturas bilineales: sin parpadeo), bajada ¼ → ⅛ → 1/16 y subida sumando cada nivel al siguiente (filtro dual de Kawase, pesos 1,5 / 1,25 / 1: halo ancho y núcleo apretado). Half float cuando la GPU lo permite. Se suma en el pase final antes de la gradación, × la fuerza del preset (día 0,35, atardecer 0,55, noche 0,9, noche volcánica 1). |
| FX en luz lineal | La capa FX se dibuja ahora en `rtPost` (antes que el bloom y la gradación), así que mezcla en luz lineal: los fuegos llevan más intensidad (más de noche que de día, para no quemarse a blanco sobre la arena al sol). |
| Chispas y brasas | `StreakPool`: un draw instanciado de cápsulas orientadas a cámara y estiradas por la velocidad (estela que se curva al deambular), cabeza caliente y cola que se enfría de amarillo a rojo. Chispas que saltan de fogata, braseros y fuegos del portón; brasas que suben del suelo de La Caldera con vaivén; **burbujas de lava** que revientan cada 0,5–1,9 s en el río (chispas + destello + voluta caliente). `effects.sparks()` queda para golpes y parries de M2. |
| Ceniza | Copos que caen alrededor del jugador cerca de La Caldera, girando y volteándose (el ancho «respira»), claros y oscuros; iluminados como el humo. |
| Humo con luz | Las partículas alfa se iluminan: luz ambiente del preset (`fxLight`: blanca de día, azul oscura de noche, rojiza en La Caldera) + las luces locales alrededor (sin cara: el humo sobre un brasero queda cálido por debajo) + su propio calor, que se apaga al subir (`heat`). El humo de los fuegos pasa de bolas grises a volutas suaves comidas por ruido; la columna del volcán brilla abajo de noche. El polvo y las ondas de espuma de noche ya no salen claros. |
| Coste | +7 pasadas a ½–1/16 de pantalla y 1 draw de chispas (≤ 700 instancias); el pase final lee una textura más. En la aldea de noche en alta: ~124 draw calls. Baja: sin bloom; las chispas siguen. |
| Depuración | con `?debug`, `__mn.view('bloom')` (solo el bloom), `__mn.view('glow')` (la máscara) y `__mn.view()`. |
| Precompilado | El precalentado de shaders compila cada pasada como se dibuja (destino lineal, capa FX sin las luces de la escena): el primer dash ya no compila nada. |

**Tinta (M4.6).** Referencia: Hades / Borderlands. Lo que tienen: contorno grueso de tinta en las figuras y
más fino en el decorado, sombras duras y saturadas (violeta, azul) en vez de grises, trama de pluma en lo oscuro
y superficies con detalle pintado a mano. Hecho: el peso de línea va en el alfa de la pasada de normales (mundo
0.5, personajes 1) y la composición dibuja la línea gruesa de los personajes por fuera de la figura; `mnBand` a
tres tonos con la sombra teñida por `splitShadow` del preset (sombra real, no nubes); trama en espacio de mundo
(`MN_COMIC`, `opts.comic`, `opts.hatchMask`) y línea en el borde de la sombra proyectada; detalle procedural en
terreno, props y vegetación (`src/render/inkGlsl.js`). Regla: solo lecturas de `mnNoiseTex` y ALU, nada de
texturas nuevas ni pasadas; `low` sigue sin contornos de post-proceso.

## 16. Milestones y checklist de cada entrega

| M | Contenido | Estado |
|---|---|---|
| M0 | Este documento | ✅ |
| M1 | Isla + agua + luz + cámara + personaje caminando y dasheando + arquitectura de red local | ✅ (ver README) |
| M2 | Proyectiles + parry/reflect/dash + 2 enemigos + feel + F4 → **test de diversión** | ✅ |
| M2.5 | «La Prueba de Fuego»: 3 oleadas bullet hell en La Caldera + HELLFIRE en 2 fases + esbirros melee + rebote de reflejos (`PLAN-M2.5.md`) | ✅ |
| M3 | Oleadas + enemigos restantes + jefe 3 fases: 5 oleadas, Cangrejo mortero, HELLFIRE con embestida, láser doble, meteoros, carriles, cortina y lava (`PLAN-M3.md`) | ✅ |
| M3.5 | Combate V2: apuntar con ratón / stick, reflejo a tiempo en 3 niveles, guardia con atrapar y devolver, armas que definen las habilidades (sable / pistolas), armeros, disparos con lag compensation (`PLAN-M3.5.md`) | ✅ |
| M3.6 | Servidor Node real (WebSocket) con 2–4 jugadores: el mismo `LocalServer`, relleno de comandos, tiempo de instancia y arena cooperativos, medición con latencia (`PLAN-M3.6.md`) | ✅ |
| M4 | «El botín»: objetos y rarezas, maestría por arma que abre el kit, loot personal, pociones, misiones y diálogo, vendedora, Mareas, partidas firmadas, HUD y paneles (`PLAN-M4.md`) | ✅ |
| M4.5 | «Sin ley»: detalles de M4 (aviso del cofre, oclusión del cofre, cofres de Marea) + la Cala Calavera: fuego amigo, botín completo y público, mobs que se pelean, Desalmados (`PLAN-M4.5.md`) | ✅ |
| M4.6 | «Tinta»: móvil siempre en horizontal (escenario girado), botones táctiles v2, contornos con peso, sombras de cómic con trama, superficies pintadas, etalonaje (`PLAN-M4.6.md`) | ✅ |
| M4.7 | «Tatuajes»: habilidades equipables en Q / E (Tromba, Abordaje, Timón) con rangos y formas, y el cómic Ultra para GPU potentes (`PLAN-M4.7.md`) | ✅ |
| M4.8 | «Perlas negras»: kit/circulación pulidos, candidato `0.4.8-rc.1`; aceptación física y publicación pendientes (`PLAN-M4.8.md`) | rc.1 |
| M5 | Almacenamiento/cuentas/importación y economía persistente; Auth/perfil/mundo/003/004 reales; perla/suelo atómicos y cola. Diario de intenciones/staging/juego/adopción/leases abiertos (`PLAN-M5.md`) | P1–P3 local + base D09a–d |
| M6 | «La Balsa»: tu barco es tu casa, construido pieza a pieza en cuadrícula (velas, bodegas, huertos, redes, cañones), viajes entre pueblos, peleas sobre cubierta (`PLAN-M6.md`) | núcleo hecho |
| M7 | Comercio entre pueblos: 18 mercancías, 6 pueblos con su equilibrio (lo que uno fabrica es barato allí y caro donde se come), leyes y contrabando, mercaderes (`PLAN-M7.md`) | motor hecho |
| M8 | Construcción en pueblos: solares, talleres con recetas, almacenes, astillero, taberna, fortín (`PLAN-M8.md`) | núcleo hecho |
| — | Pulido continuo: highlights (level-up, cofre), música por capas, accesibilidad, bots + chat | |

Checklist de capturas por milestone: ¿el personaje queda tapado por glow/partículas/texto/vegetación? ¿algo se quema
a blanco? ¿se distinguen parreable/pesado/imparable al zoom por defecto? ¿artefactos de contorno? ¿texto pequeño
legible? ¿algo sigue temblando tras asentarse? ¿FPS en objetivo por calidad? ¿algún golpe injusto?
