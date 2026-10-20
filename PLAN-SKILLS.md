# PLAN-SKILLS: hoja de habilidades y progresión por estilo de juego

Estado: propuesta inicial, 2026-10-19, tickets T-1019-04 y T-1019-05 (exploración). Sin aprobar. Untracked en el
escritorio compartido, como PLAN-PROGRESSION.md; se versiona cuando Joi decida el área que la ejecuta.
Referencia visual: captura "Marea Negra / Skills" (lista de árboles a la izquierda, rejilla 5 tiers x 3 a
en el centro, panel de detalle con hero, números y "Level up" a la derecha, barra inferior con 4 habilidades
equipadas y bonos pasivos). Rutas citadas sobre el worktree `visual-revamp` (punta integrada + commits visuales).

## 0 Resumen

1. Hoy no hay árbol de habilidades. Hay cuatro capas sueltas: artes de arma (Q/E por maestría), tres
   tatuajes con rango 1-5, la perla (G) y dos pasivas por arma a maestría 5 y 10.
2. Hay una sola corriente de XP (combate y misiones) que alimenta nivel, maestría del arma y rango de
   tatuajes. Ninguna actividad pacífica da XP; solo la tala lleva una cuenta de práctica.
3. Los únicos puntos gastables son los de Carga (uno por nivel, reset gratis). Esa es la tubería de gasto
   que ya funciona de punta a punta (sim + operación M5 + SQL029).
4. Propuesta: cinco árboles con contenido en v1 (Combate, Supervivencia, Navegación, Oficios, Comercio) y un
   sexto hueco reservado (Exploración). La práctica de cada árbol sube el rango de ese árbol, el rango abre
   tiers y concede puntos **que solo se gastan en ese árbol**. Jugar de una forma profundiza esa forma.
5. Equipo: un objeto puede *prestar* una habilidad mientras está equipado (generaliza lo que ya hacen el arma
   con sus artes y la perla con G). Nunca da práctica ni puntos. Regla completa en 2.5.
6. UI: la ficha ya tiene un grid fijo 1672x941 de tres columnas (425/625/572). La hoja de habilidades es una
   nueva `kind` de la misma pantalla, con los tokens del kit (azul marino + naranja), no pergamino.
7. Entrega en seis fases; las dos primeras (catálogo de datos y hoja de solo lectura sobre el contenido de
   Combate ya existente) se pueden ver en el juego sin tocar SQL ni protocolo.

## 1 Lo que existe hoy

### 1.1 Habilidades

| Capa | Qué es | Dónde | Cómo se abre |
|---|---|---|---|
| Artes de arma | lunge, wave (sable); blast, blink (pistolas). Activas, slots Q/E, sin rangos | src/data/tattoos.js:14-19, src/data/weapons.js:5-8 | maestría del arma 1 y 2 |
| Tatuajes | tromba, leap (Abordaje), wheel (Timón). Activas, rango 1-5, formas base/A/B a rango 2 y 4 | src/data/tattoos.js:23-54 | Doña Sepia, 150 oro, el primero gratis |
| Perla | comet, iceanchor, mastbolt, inkcloud en la tecla G | src/data/pearls.js:2-23 | botín (élite 2.5 %, jefe 12 %) |
| R del arma | storm (sable), rain (pistolas) | weapons.js:5-8,93 | maestría 3 |
| Pasivas | temple y eye (sable), trigger y deluge (pistolas) | weapons.js:95-104 | maestría 5 y 10 |
| Hitos pacíficos | logging_steady (tala 60: swing 54 -> 45 ticks), pilot_coastal (timón x1.15), lección raft_storage | src/data/progression.js:7-22 | práctica de tala; pilotaje; artesano |

Solo Q y E son reasignables (`LOADOUT_SLOTS`, tattoos.js:61); G viene siempre de la perla. La tabla
numérica (cd, mult, windup) está en weapons.js:16-67; el rango de tatuaje multiplica el daño +6 % por rango
en src/sim/systems/skills.js:83-86 y un arte sin entrada cuenta como rango 1 (stats.js:51).

### 1.2 Progresión y moneda

- XP de nivel: curva [100..1400], nivel máximo 10 (src/data/tuning.js:76-77). Fuentes: bajas
  (src/sim/world.js:789-795), parry y guardia (combat.js:289,345), misiones (quests.js:81). Nada más llama a
  `gainXp`. HP/ATK/DEF suben solos por nivel (stats.js:16-20); no hay atributos manuales.
- La misma XP se reparte a la maestría del arma en mano y a los tatuajes equipados
  (`world.onXp`, src/sim/systems/inventory.js:204). Consecuencia: enganchar una actividad pacífica a `gainXp`
  entrenaría combate de rebote (área03, 77-81).
- Puntos: solo Carga, L-1 puntos, un reset gratis (src/data/attributes.js:6-10, attributePlan.js:28-30,
  server/attributeOperation.mjs, SQL 029, flag `MN_ATTRIBUTE_OPERATIONS`).
- Práctica pacífica: `progression.practice.logging`, 10 por palmera, hito a 60; `readProgression` rechaza
  cualquier otra clave (src/sim/systems/progression.js:34-38). Nada cuenta pesca, navegación, oficio ni comercio.
- Persistencia: perfil v1 con `lvl, xp, mast, sk{has,lo,free}, attr, progression, pearls, stats`
  (inventory.js:34-60, `sanitizeSk` 168-190); guardado M5 con CAS; no existe ninguna tabla SQL de habilidades.
- El Skill Studio autora solo presentación (escala, duración, colores); daño, coste y cooldown siguen en la
  simulación (src/editor/skillDocument.js:7-17; docs/briefs/skill-studio-vision.md:121-122).

### 1.3 Equipo

- Seis slots: weapon, head, chest, boots, ring1, ring2 (src/data/items.js:27-29). 21 bases, 5 rarezas con
  multiplicador 1.0 a 3.0 y 0-4 afijos; 17 stats numéricos (items.js:33-53, 57-96).
- Equipar solo recalcula stats (`gearTotals` y `refreshStats`, stats.js:65-104) y, si cambia el arma, el
  kit (`setWeapon`, inventory.js:629-659). Ningún ítem tiene campo de habilidad; la perla es la única fuente
  de acción ligada a un objeto (stats.js:100-103).
- Reglas W00 (docs/briefs/w00-equipment-rules.md:12-19): el equipo funcional usa `itemStats` y presupuestos;
  no concede niveles, maestría ni XP; el cliente y la metadata no declaran stats ni permisos; lo mecánico
  pasa por IDs que el servidor reconoce. W05 (modular) añade piezas que reparten presupuesto, sin poder
  gratis por ornamento.

### 1.4 La ficha

- `CharacterScreen` (src/ui/characterScreen.js) sobre `CharPanel`; pestañas stats C, gear I, tattoo T
  (rotulada Habilidades/Skills), quests L, pearl P; teclas en src/main.js:417-435. La pestaña T hoy muestra
  el loadout Q/E del arma, sus artes y los tatuajes (charpanel.js:290-331).
- Grid fijo: `--u = min(100cqw/1672, 100cqh/941)`, tres columnas 425/625/572 (styles/character.css:5-14).
  `kind()` elige "sheet" (tres columnas con figura 3D en el centro) o "wide" (una placa). Render por
  `part()` que compara cadenas por región `data-part`; clics delegados por `data-*`.
- Kit: tokens `--kit-navy`, `--kit-plate`, `--kit-orange`, fuentes Barlow Condensed / Semi Condensed, placa
  `.kit-plate` con `frame.webp` (styles/kit.css:6-30, vars.css). Atlases WebP en assets/ui/kit (items,
  gear, misc, foods) cortados por tools/crafting-ui/icons.py; los iconos de habilidad son SVG en línea
  (src/ui/hud.js:15,49). No hay atlas ni carpeta de iconos de habilidad.
- Barra rápida: LMB, RMB, dash, Q, E, R, G, poción (hud.js:107-115); botones táctiles t-q/t-e/t-r/t-g.
- i18n: tabla `TEXT={es,en}` en la pantalla más catálogos `adventure.*`, `systems.*` y `data.js`.

### 1.5 Decisiones previas que esta propuesta respeta

- Bucle común: practicar con resultado válido -> competencia -> hito -> técnica (PLAN-PROGRESSION.md:159-169).
  Una familia no merece una segunda barra por cada bono.
- Familias: Combate, Recolección, Fabricación, Navegación, Agua y salvamento, Comercio (198-206). Exploración
  no necesita disciplina obligatoria en v1; la ley es consecuencia, no XP (208-210).
- Ficha con pocas entradas, disciplinas conocidas primero (350-354). Puntos de nivel van a Carga; qué más se
  compra con ellos sigue abierto (538-542).
- Sin clases permanentes ni puntos manuales en fuerza/destreza (área03:95-103); guardar práctica y
  conocimiento, derivar rangos del catálogo, perfil `v:1` con bloque interno versionado (150-160); práctica
  solo por resultados válidos del servidor (PLAN:184-187); no subir el nivel máximo para llenar una barra.

## 2 Diseño propuesto

### 2.1 Los árboles

| Árbol | Familias del plan que agrupa | Fuente de práctica hoy | v1 |
|---|---|---|---|
| Combate | armas, tatuajes, perla | la XP de combate (ya se reparte en onXp) | completo, 15 nodos sobre contenido existente |
| Supervivencia | recolección, agua y salvamento, comida | tala (existe); agua dulce, comida, nado (por crear) | tiers I-II |
| Navegación | pilotaje, aparejos, mantenimiento | hito pilot_coastal (sin cuenta de práctica) | tiers I-II |
| Oficios | fabricación, domesticación | operación de artesano PRG01c (sin cuenta) | tiers I-II |
| Comercio | comercio, contactos | mercado de agentes SQL017 (sin cuenta) | tiers I-II |
| Exploración | descubrimiento, encargos | ninguna | hueco reservado, oculto tras flag |

Cinco árboles con contenido y el sexto reservado: el plan dice que Exploración y Reputación no son
disciplinas en v1, así que no se pintan barras vacías. El panel izquierdo guarda sitio para seis entradas,
la pintura y la tarjeta de puntos, como en la referencia.

### 2.2 Regla de progresión: la práctica de un árbol paga ese árbol

1. **Práctica.** Cada árbol tiene una cuenta `practice.<tree>` (entero, solo sube). Se acredita únicamente
   desde operaciones del servidor con resultado válido, nunca desde el cliente.
2. **Rango del árbol.** Derivado de la práctica con una curva por árbol (10 rangos). Los cinco tiers de la
   hoja (I Novato, II Marinero, III Veterano, IV Maestro, V Leyenda) se abren a rango 1, 3, 5, 7 y 9.
3. **Puntos del árbol.** Cada rango concede 2 puntos del árbol: 18 por árbol a rango 10, frente a 45
   rangos de nodo posibles (15 nodos x 3). Llenar un árbol es imposible: hay que elegir dentro del estilo.
4. **Gasto.** Un punto sube un nodo un rango (0/3 -> 3/3). Solo gasta puntos de su propio árbol. Sin
   prerrequisitos entre nodos en v1: el tier abierto y, en Combate, el arma en mano o el conocimiento
   (Doña Sepia, artesano) son las únicas puertas.
5. **Reset.** Un reset gratis por árbol y después coste en oro, calcado del patrón Carga (attributes.js:9).
6. **Contador visible.** La tarjeta "Puntos de habilidad" muestra la suma; cada entrada de árbol lleva su
   insignia con los puntos propios sin gastar.

Créditos de práctica por actividad (resultado válido del servidor):

| Árbol | Acción | Hook | Estado |
|---|---|---|---|
| Combate | baja, parry, guardia, misión de combate | `world.onXp` (inventory.js:204): añadir `treePractice('combat', n)` al fan-out | existe la señal |
| Supervivencia | palmera talada; agua dulce bebida; comida cocinada; rescate/reembarque | loggingOperation.mjs, freshwaterOperation.mjs, fireOperation.mjs | la tala ya cuenta |
| Navegación | minutos al timón con avance real; atraque; reparación de balsa | pilotaje (donde se concede pilot_coastal), raftEditor | por crear |
| Oficios | receta completada; enseñanza del artesano; reparación | artisanOperation.mjs | por crear |
| Comercio | venta o compra cerrada con agente; contrato cumplido | agentTrade.mjs, economicOperation.mjs | por crear |

Curvas iniciales, a medir en PRG-C01 antes de fijar: Combate reutiliza la curva de maestría
(weapons.js:92: 60..14000). Para el resto, objetivo de calibración: tier II en la primera sesión de esa
actividad, rango 10 en unas 30 horas de esa actividad. No añadir topes diarios hasta medir.

Por qué no un fondo global por nivel: el nivel solo sube con combate y misiones, así que un pescador nunca
tendría puntos; además 9 puntos no alimentan cinco árboles y subir el nivel máximo está desaconsejado.
Por qué no práctica sin puntos: sin elección no hay estilo; el jugador necesita renunciar a algo.

### 2.3 Los nodos

- Tres clases: **activa** (ocupa un slot equipado), **técnica** (cambia cómo funciona una acción:
  swing de tala, respuesta del timón, cupo de compra) y **pasiva** (bono numérico permanente que agrega
  `passive()` en stats.js:56-62, hoy limitado a la maestría del arma).
- Rango 0/3. El rango escala el nodo: activas +6 % de daño por rango (el `TATTOO.dmg` actual) o -0.5 s de
  cooldown, técnicas y pasivas con su propia tabla. Cada nodo declara `ranks: [r1, r2, r3]` con los
  deltas, y la hoja los muestra como "actual -> siguiente".
- Tatuajes: su rango 1-5 por XP se retira y pasa a ser práctica de Combate; el nodo tiene rango 0/3 con
  base, forma A y forma B en los rangos 1, 2 y 3. Doña Sepia sigue siendo la puerta de conocimiento (150
  oro, el primero gratis). Migración de perfiles: rango 1 -> 1, 2-3 -> 2, 4-5 -> 3, sin reembolso.
  Alternativa si no se quiere tocar a los jugadores actuales: mantener el rango por XP y que el nodo solo
  añada las pasivas (menos limpio: dos barras para una misma habilidad, justo lo que el plan prohíbe).
- Artes de arma: hoy rango fijo 1 (stats.js:51). Pasan a leer el rango del nodo; sin puntos siguen
  funcionando a rango 1 mientras la maestría las abra, así nadie pierde nada.
- Maestría del arma se conserva tal cual (por arma, abre Q1/E2/R3 y +2 % ATK): es la subespecialidad
  dentro de Combate, y las pasivas de maestría 5 y 10 se convierten en nodos de tier III y V.

### 2.4 Slots equipados

La barra inferior muestra cuatro: Q, E, R, G. Solo Q y E se asignan desde la hoja (como hoy); R es el arte
mayor del arma en mano y G la perla tragada. Añadir dos slots más toca columnas ECS, bits del protocolo,
`castSlot` y la capa táctil (tattoos.js:61-67, ecs.js, protocol.js, skills.js:78,133): se deja para una
fase posterior y solo si el contenido lo pide. Las técnicas y pasivas no ocupan slot.

### 2.5 Habilidades por equipo: la regla del préstamo

Generaliza lo que ya hacen el arma (su base elige el kit y las artes) y la perla (da G):

| Regla | Detalle |
|---|---|
| Qué otorga | un objeto puede llevar `grants: [{ skill, rank }]` en su base (src/data/items.js BASES), con IDs del catálogo de nodos; es dato del servidor, no metadata de cliente (W00) |
| Mientras | solo equipado; al desequipar sale del loadout como hoy sale el kit al cambiar de arma |
| Rango | fijo por el objeto (1 en común, 2 en raro, 3 en legendario, dentro del presupuesto de afijos); si el jugador ya tiene el nodo, vale el rango mayor, nunca se suman |
| Práctica y puntos | nunca; un objeto no da XP, maestría ni puntos (W00:13) |
| En la hoja | el nodo aparece con un icono de cadena y el nombre del objeto; se puede equipar en Q/E si es activa |
| Al morir | se va con el objeto (reglas de derrame en Cala) |
| Quién lo decide | el catálogo del servidor: cliente y metadata no declaran permisos (W00:18-19) |
| v2 | afijo `+1 rango a <nodo>` en abalorios, y piezas modulares W05 que prestan técnicas |

Objetos piloto: un abalorio que presta un arte del otro arma (por ejemplo blast con sable en mano) y uno que
presta una técnica de Supervivencia (nado largo). Dos ítems bastan para probar loadout, hoja y derrame.

### 2.6 Árbol de Combate v1 (contenido existente, nada nuevo que balancear)

| Tier | Nodo 1 | Nodo 2 | Nodo 3 |
|---|---|---|---|
| I | Estocada (lunge, sable) | Ráfaga (blast, pistolas) | Temple (pasiva: ventanas de parry +15 ms, hoy maestría 5) |
| II | Ola (wave, sable) | Parpadeo (blink, pistolas) | Gatillo (pasiva: cadencia x0.85, hoy maestría 5) |
| III | Tromba (tatuaje) | Abordaje (leap) | Timón (wheel) |
| IV | Tormenta (storm, R sable) | Lluvia (rain, R pistolas) | Ojo de tormenta (pasiva, hoy maestría 10) |
| V | Afinidad de perla (pasiva de la perla tragada) | Diluvio (deluge, hoy maestría 10) | Maldición domada (reduce la curse de la perla) |

Las artes muestran "requiere sable/pistolas en mano"; los tatuajes "aprender con Doña Sepia"; la fila V exige
una perla tragada. Todo existe en weapons.js, tattoos.js y pearls.js; la fase de datos solo lo cataloga.

### 2.7 Esbozo de los otros árboles (tiers I y II, a validar con cada área)

- Supervivencia: Tala firme (logging_steady como nodo de técnica), Nadador (alcance de agua dulce, RNV07),
  Estómago de hierro (efectos de comida y grog SRV02); II: Hachero (menos swings), Buceador (reembarque),
  Cocinero (raciones mejores). Carga no entra: sigue en sus puntos.
- Navegación: Timonel (pilot_coastal, timón x1.15), Aparejos, Lectura del mar; II: Maniobra, Reparación en
  travesía, Bodega (la lección raft_storage como conocimiento).
- Oficios: Carpintería, Cordelería (fibra, paja, cuero), Reparación; II: Aprendiz del artesano, Componentes,
  Acabados.
- Comercio: Regateo, Contactos, Cupo de compra; II: Contratos, Información de precios, Surtido.

## 3 La hoja

### 3.1 Layout

Nueva `kind` "tree" en characterScreen.js junto a "sheet" y "wide": tres columnas del mismo grid (425 lista
de árboles + pintura + tarjeta de puntos; 625 cabecera del árbol + rejilla 5x3 con la columna de tiers I-V;
572 hero, nombre, rango, tabla actual -> siguiente, preview, "Siguiente rango" y "Requiere", botón Subir).
Filas inferiores: la barra `.ch-quick` ya existente para Q/E/R/G y una placa de bonos pasivos. `drawFigure`
y `shouldAnimateFigure` solo corren con kind sheet (characterScreen.js:171,195), así que "tree" no dibuja
figura. La pestaña conserva la tecla T; el id `tattoo` se renombra a `skills` dejando alias para
`open('tattoo',{learn:true})` (main.js:259) y `denyTattoo` (main.js:875).

### 3.2 Estilo

Los tokens del kit ya son azul marino + naranja, la misma pareja de la referencia; el marco de cuerda es una
variante de `frame.webp` (nuevo `--kit-frame-rope`), no un cambio de tema. Nada de pergamino: las otras
pestañas no lo tienen y la hoja debe sentirse de la misma pantalla. Hero por árbol como los
`assets/ui/crafting/hero-*.webp`. Iconos: un atlas `skills` nuevo (6 iconos de árbol + 15 de Combate en
v1, silueta negra sobre placa y resalte naranja; bloqueados en gris con candado) cortado con
tools/crafting-ui/icons.py y registrado en `ICON_ATLASES` (kit.js:16-26). El preview del detalle reutiliza
src/render/skillPreview.js (ya renderiza el VFX de una habilidad) y, donde no haya VFX, el hero.

### 3.3 Interacción

Clic en nodo -> detalle; "Subir" gasta un punto (cmd al servidor, render optimista como Carga); arrastrar o
botón "Poner en Q/E" para activas (ya existe en tattooDetail, charpanel.js:360). La tecla E de la referencia
no sirve: E es un slot de habilidad; usar Enter o clic. Táctil: mismos `data-*` delegados; comprobar
`(pointer: coarse)` en la rejilla (celdas de al menos 64u). Textos nuevos en `TEXT={es,en}` de la pantalla
y nombres de nodo en el catálogo como pares [es,en] (`dataText`).

## 4 Datos y persistencia

- `src/data/skillTree.js` (nuevo): `TREES`, `NODES` (id, tree, tier, kind, ranks[], gate, text[es,en],
  icon), curvas, y funciones puras `treeRank(practice)`, `tierOpen`, `pointsEarned`, `pointsSpent`,
  `nodeRank(profile, id)`; tests en tests/.
- Perfil (v:1 se mantiene, bloque interno versionado como pide área03:150-160): `progression.practice`
  abre a `{logging, combat, survival, sailing, crafting, trade}` (logging se conserva y suma a survival);
  nuevo `progression.skills: {nodeId: rank}` y `progression.skr: {tree: resetsUsados}`. `readProgression` y
  `sanitizeProfile` validan rangos 0-3 y gasto <= ganado.
- Operación `server/skillOperation.mjs` (assign, reset, adopt) calcada de attributeOperation.mjs con su
  plan puro `src/sim/systems/skillPlan.js`, comando en protocol.js, flag `MN_SKILL_OPERATIONS`, migración
  SQL con RPC de readiness y gate `check*` (ops/migration-check.md). El número de SQL y de protocolo se toma
  tras el fetch, nunca antes.
- Créditos de práctica: una función pura `creditPractice(profile, tree, n)` llamada solo desde operaciones
  del servidor (tabla 2.2). Hasta que exista la operación de cada árbol, ese árbol se muestra a rango 0 con
  el texto "se entrena con <actividad>": honesto y visible.

## 5 Fases y tickets

| Fase | Entrega | Toca | Clase / riesgo | Gate |
|---|---|---|---|---|
| SK00 | esta propuesta aprobada, decisiones de la sección 6 | PLAN-SKILLS.md | DESIGN | Joi |
| SK01 | catálogo skillTree.js con Combate completo y tiers I-II del resto, helpers puros, tests | src/data, tests | BUILD medium | node --test |
| SK02 | hoja "tree" de solo lectura con estado real (maestría, tatuajes, perla), iconos v1, hero, textos ES/EN | src/ui, styles, assets/ui | BUILD medium + IMAGE | gate 28 + captura QA |
| SK03 | perfil: práctica por árbol, skills, sanitize, migración de tatuajes, fan-out de combate | src/sim, inventory.js | BUILD high | gate + inv02-baseline |
| SK04 | gasto y reset: skillPlan, skillOperation, protocolo, SQL + readiness, flag; botón Subir en vivo | server, src/net, migrations | BUILD high | gate + migration-check |
| SK05 | préstamo por equipo: campo grants, loadout, hoja, dos ítems piloto | items.js, inventory.js, stats.js | BUILD medium | gate |
| SK06 | créditos de práctica de Supervivencia, Navegación, Oficios y Comercio, un ticket por árbol, con el área dueña | server ops | BUILD medium cada uno | gate |
| SK07 | contenido tiers III-V de los árboles pacíficos y sus efectos | sim, resources, rafts | DESIGN + BUILD | medir primero |

SK01 y SK02 se pueden ver en el juego sin SQL ni protocolo. Un worktree propio (`skills-sheet`, rama
`claude/skills-sheet`) para SK01-SK05; SK06 vive en cada área. Un bump de alpha por push; el bump de
protocolo llega en SK04.

## 6 Decisiones que necesita Joi

1. Cinco árboles con Exploración reservada, o seis desde el principio con Exploración vacía.
2. Tatuajes: migrar su rango por XP al rango 0/3 por puntos (recomendado) o conservar las dos barras.
3. Puntos por rango (2) y tiers a rango 1/3/5/7/9: aceptar como números iniciales a medir.
4. Reset: gratis el primero por árbol y oro después, o solo gratis.
5. Préstamo por equipo en v1 (SK05) o después de SK06.
6. Si la hoja sustituye la pestaña T actual (recomendado) o convive con ella un tiempo.
7. Qué área lo ejecuta: nuevo worktree `skills-sheet` o dentro de AREA03 progresión.

## 7 Riesgos

- Dos monedas (Carga por nivel, puntos por árbol): hay que explicarlas en la misma ficha sin confundir.
- Farmeo de práctica pacífica: acreditar solo resultados válidos (PLAN:184-187) y medir antes de topes.
- El grid fijo escala como una unidad: una rejilla 5x3 con iconos de 64u cabe en 625u de ancho, pero el
  detalle de 572u con hero + tabla + preview + botón va justo en 714u de alto; validar en 1280x720.
- Iconos: 21 piezas pintadas en v1 por la lane de imagen; sin ellas la hoja no se parece a la referencia.
- `readProgression` cerrado: abrirlo mal rompe perfiles existentes; SK03 exige comparar con inv02-baseline.
