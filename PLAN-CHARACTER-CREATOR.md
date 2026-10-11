# Plan del creador de personajes modulares

Fecha: 2026-10-07. Dirección y arranque autorizados por el autor: personaje modular en el estilo de las
láminas del explorador y su tripulación, con bases masculina y femenina, pelo, barba, ojos y equipo intercambiables.
La primera entrega prepara referencias, dos modelos 3D articulados iniciales y un visor local.
El acabado de producción y el creador conectado a la partida avanzan en las etapas siguientes.

Estado: P01 conserva referencias, dos maquetas GLB y visor. P02a conserva las bases v1 con cuerpo continuo,
relieve facial, UV cilíndrica y estudio de materiales. [P02b / bases v2](docs/delivery/characters-base-v2.md)
añade superficies de anillos/parches, extremidades simplificadas, atlas corporal regional y menor coste.
[P02c / bases v3](docs/delivery/characters-base-v3.md) añade relieve facial, dedos estáticos conectados
y pies redondeados, con guía de cabezas alpha generada. P02 sigue abierto para refinamiento artístico,
anatomía de extremidades, atlas definitivo y acabado antes de P03.

**Rechazo visual del autor, 2026-10-08:** las bases procedurales y mallas de apariencia de los cortes
anteriores fueron rechazadas como feas y muy alejadas de la referencia más reciente de Horizon Tides.
P01/P02/P03 no tienen aprobación visual ni pasan a integración por estos ensayos. Se conservan sus
resultados técnicos; P02 y P03 siguen abiertos, y la lógica modular de P03a puede informar la implementación.
[P03a / apariencia v1](docs/delivery/character-appearance-v1.md) tuvo 13/13 pruebas CPU históricas,
pero la QA de navegador falló, la evidencia HTTP está pendiente y no se registraron filas de apariencia
en la revisión 31 del catálogo.

**Kit alpha ilustrado v1:** QA técnica local aprobada: 13/13 aserciones de navegador, ocho capturas,
26 PNG móviles cargados y HTTP local de 62 recursos verificado. Hay 29 intentos guardados y 27 elegidos
(26 alpha y un fondo opaco de puerto). La revisión local ajustó recortes/offsets de runtime sin retocar
los PNG. El autor aceptó el look como dirección visual del piloto 3D el 2026-10-08; no se afirma coincidencia pixel por pixel,
cierre de P02/P03 ni integración al juego. Las etapas de producción 3D, vestuario, creador, identidad y
equipo conservan sus gates. [Informe](docs/delivery/character-alpha-v1.md).

**Piloto Meshy MCP, 2026-10-08:** [brief](docs/delivery/character-3d-pilot-v1.md). Servidor oficial 0.6.1
instalado fuera del checkout y configurado en Codex; handshake directo y 24 herramientas verificados.
Falta API key; la primera solicitud desde el master masculino está preparada y validada, pero no enviada.
No hay malla generada ni aceptación de rig/modularidad. Tripo tiene MCP alpha con complemento de Blender;
se investigó, sin instalarlo. Su cuenta Studio no acredita créditos API.

## Resultado jugable

El jugador crea su propia persona y conserva su identidad al conseguir ropa, armas y accesorios.
El explorador de chaqueta azul, pañuelo rojo y gafas es el primer preset completo del sistema.
La misma construcción visual sirve para humanos, personajes de agentes y futuros NPC humanos.

El creador ofrece un modelo giratorio, acercamiento al rostro, selección por miniaturas y colores controlados.
Cambiar cabello o barba actualiza la vista y el retrato; equipar un objeto confirmado por el servidor actualiza
su representación en el mundo. Un cuerpo inicial masculino y otro femenino abren la misma selección de estilos,
sujeta a compatibilidad de geometría. Las prendas requieren ajuste por cuerpo.

## Lenguaje visual

- Anatomía adulta estilizada, aproximadamente 6,5 cabezas de altura, con manos y ojos legibles.
- Siluetas expresivas, mechones grandes, superficies pintadas, tinta selectiva y sombras amplias.
- Ropa marítima remendada, cuero gastado, herrajes de latón y acentos azul petróleo, rojo y marfil.
- El primer control artístico usa frente, perfil, espalda, retrato y cámara normal de juego.
- La iluminación del material se calibra en el runtime; las sombras pintadas no deben competir con el sol.

Referencias iniciales: [base masculina](docs/art/source/characters-base-v0/male-concept-v1.png) y
[base femenina](docs/art/source/characters-base-v0/female-concept-v1.png).
Las láminas orientan anatomía y acabado; no son texturas, topología ni vistas ortográficas exactas.
Las cejas neutras dibujadas son una guía facial y deberán convertirse en una selección del creador.

## Base técnica verificada

| Sistema actual | Consecuencia para el creador |
|---|---|
| Cinco aspectos completos de jugador en `src/render/charlooks.js` | Mantener un mapper de los índices 0–4 a presets con IDs estables |
| `CharacterView` con un SkinnedMesh y 15 huesos | Conservar inicialmente nombres, jerarquía y animación corporal |
| Importación `char` hornea mallas/materiales y cambia los pesos al rig interno | Añadir una ruta modular que preserve selección, zonas y puntos de conexión |
| Nombre/aspecto son preferencias locales; un perfil de progreso por cuenta | Apariencia persistente necesita defaults, saneado y propiedad del servidor |
| Equipo en arma, cabeza, pecho, botas y dos abalorios | Conectar representación a los slots existentes antes de proponer slots adicionales |
| Retratos, destellos, tinta, afterimages y despiece dependen de geometría y caches | Revisarlos en cada cambio de composición; forman parte del gate de integración |

Fuentes: `src/render/characters.js`, `src/render/charkit.js`, `src/render/assets/rebind.js`,
`src/core/settings.js`, `src/sim/systems/inventory.js`, `src/data/items.js`, `src/net/protocol.js` y
`docs/HANDOFF.md`. El nuevo visor funciona aparte y permite revisar las bases sin cambiar estos consumidores.

## Reutilización de recursos existentes

La revisión acotada del inventario identificó `SKM_Manny_Simple` en
`ActionRPGStarterSystem/Assets/Mannequin/Character/Mesh/UE5Char/` como candidato a referencia de rig/exportación.
Los héroes Paragon Kwang/Wukong son candidatos secundarios de estudio; no hay un kit modular de cabezas,
cabellos y prendas identificado como compatible en el inventario actual.

Para este primer corte se usan los nombres y la jerarquía del rig local y geometría paramétrica propia.
El maniquí no fija la anatomía ilustrada solicitada, y su exportación/encaje no están verificados.
Antes del modelado de producción de cada nueva familia se revisará el candidato concreto que pueda
ahorrar trabajo, registrando reutilización o descarte. Las fuentes Unreal permanecen intactas.
Consulta: `docs/research/unreal-assets/myproject/FINDINGS.md` y `docs/research/unreal-assets/SUMMARY.md`.

## Contrato de los módulos

Un personaje usa una jerarquía corporal y un conjunto de piezas compatibles con su pose de reposo.
Compartir nombres de huesos no garantiza encaje: también deben coincidir los ejes, unidades, bind matrices
y puntos de conexión. Las proporciones femenina y masculina pueden tener posiciones articulares distintas.

| Familia | Representación inicial | Compatibilidad |
|---|---|---|
| Cuerpo | Malla con pesos y zonas de ocultación | Un descriptor por base; rango de proporciones limitado |
| Cabeza | Cabeza calva neutra, nariz, boca y orejas | Unión de cuello fija para cada familia de cuerpo |
| Ojos y cejas | Geometría/material facial y variantes seleccionables | Alineación con párpados; iris y color separados |
| Cabello y barba | Mallas sujetas a cabeza; barba preparada para cada forma facial | ID de cabeza, puntos de ajuste y máscara bajo sombreros |
| Chaqueta y botas | Mallas con pesos del mismo rig | Variante ajustada por base; ocultación de cuerpo cubierto |
| Sombrero, gafas, bolsas y armas | Piezas rígidas sujetas a puntos nombrados | Offset del punto y reglas de solapamiento |

Convenciones: metros, Y arriba, frente +Z, izquierda del personaje +X. El rig actual tiene 15 huesos:
`body`, `hips`, `thighL`, `shinL`, `thighR`, `shinR`, `spine`, `chest`, `head`, `armL`, `foreL`,
`armR`, `foreR`, `clothF`, `clothB`. Su reposo interno tiene brazos abajo; la pose A del visor es una pose
de presentación. Una futura fuente artística en pose A debe adaptarse de manera explícita a este contrato.

Los huesos actuales animan cuerpo y paneles de ropa. Un rig de dedos, mirada, mandíbula o cabello dinámico
requiere una ampliación concreta; no se considera resuelto por exportar un GLB humanoide.
Los pivotes de antebrazo v2/v3 están 36 mm hacia fuera respecto al cálculo actual de `charkit` con estas
proporciones. La futura integración debe conservar el bind del GLB o hacer un rebind explícito;
las pruebas del visor no acreditan sustitución directa del skeleton de `CharacterView`.

## Orden de entrega y gates

| Corte | Entregable | Se acepta cuando |
|---|---|---|
| P01 Bases | Dos referencias, dos GLB articulados v0, recibos y visor | Cargan ambos; huesos/pesos válidos; vistas y poses revisadas en escritorio y móvil emulado |
| P02 Anatomía de producción | Dos fuentes editables, UV y cabeza neutra con ojos preparados | Cuello, hombros, codos, cadera y rodillas se deforman bien; estilo legible con cámara de juego |
| P03 Apariencia | Cuatro cabellos, tres barbas contando afeitado, ojos/cejas y colores | Opciones encajan en ambas bases o declaran sus variantes; retrato y giro coinciden |
| P04 Vestuario | Kit del explorador y un segundo conjunto | Cambios de chaqueta, botas y sombrero conservan cara/animación; cuerpo y pelo cubiertos se ocultan |
| P05 Creador | Selecciones, miniaturas, giro, rostro, presets y reset | Usable con ratón y táctil; sin selecciones inválidas ni pérdidas al cambiar de pestaña |
| P06 Identidad guardada | Descriptor normalizado, presets legacy y sincronización | Reentrada y otro cliente recuperan la misma apariencia; IDs desconocidos tienen fallback seguro |
| P07 Equipo visible | Visuales vinculados a inventario confirmado | Equipar/quitar/morir/reconectar reflejan el estado autoritativo y conservan identidad |
| P08 Rendimiento y entrega | Calidad por dispositivo, caches, release y evidencia | Comparación visual y carga real verificadas; límites físicos medidos antes de aceptar FPS |

P01 habilita una prueba de proporciones y articulación. Sus GLB paramétricos no cierran P02 ni sustituyen
el acabado pintado de las referencias. P02 comienza con la base masculina y adapta la femenina antes de
expandir el catálogo, para comprobar una misma familia de prendas en ambos cuerpos.

## Identidad y equipo

La apariencia se describe con IDs de catálogo y colores permitidos. El siguiente esquema expresa el contrato
de diseño; sus campos se incorporan solo en P06 con versión, defaults y migración:

```json
{
  "v": 1,
  "bodyId": "human-male-v1",
  "headId": "neutral-male-v1",
  "hairId": "scout-short-v1",
  "beardId": "none",
  "eyesId": "neutral-v1",
  "browsId": "neutral-v1",
  "skinPaletteId": "warm-03",
  "hairPaletteId": "brown-02",
  "irisPaletteId": "amber-01"
}
```

El servidor valida catálogo/compatibilidad y conserva la identidad. El estado real de equipo sigue en `eq`;
los stats y permisos proceden de objetos poseídos y operaciones ya autoritativas. Mochilas decorativas o
gafas del creador no conceden capacidad de carga ni se convierten automáticamente en nuevos slots de gameplay.
El mapeo de objetos a modelo visible se mantiene en datos, con fallback para objetos sin representación.

La migración conserva nivel, oro, objetos, perlas, afinidad y resto del progreso. El índice legacy `skin`
no se reutiliza como ID nuevo ni se mezclan índices de jugadores y enemigos. Revisar `PROTOCOL_VERSION`
cuando cambien HELLO, SPAWN, snapshots o `you`; los clientes anteriores necesitan tratamiento explícito.

## Animación, caches y ensamblaje

El ensamblador selecciona piezas, aplica variantes por cuerpo y omite zonas cubiertas antes de preparar
la geometría. El primer experimento compara varias mallas que comparten skeleton con una composición
fusionada al cambiar de apariencia. Elegir según funcionamiento de materiales/contorno y coste medido;
no reconstruir geometría por frame ni prometer una sola llamada de dibujo si hay varios materiales.

Las claves de retrato, afterimage y despiece incluyen cuerpo, módulos, paletas y versión del ensamblaje.
Cambiar composición invalida sus caches y libera solo los recursos poseídos por esa instancia.
Mantener `position`, `normal`, `color`, `skinIndex`, `skinWeight` y `aGlow` donde lo requieren los efectos.
La ruta de producción debe tratar UV/materiales y conservar los morph targets si P02 introduce ajustes faciales;
el bake actual no preserva ese contrato por sí solo.

## Presupuesto inicial

Objetivos propuestos para medir y ajustar, no evidencia de FPS:

- Personaje vestido cercano: 12–20 mil triángulos; cabello por masas y sin mechones de transparencia costosa.
- Una familia de materiales compartida, atlas de cuerpo/rostro/ropa y paletas para recolores.
- Derivados de texturas 1024 en escritorio y 512 en móvil como punto de partida; originales fuera del bundle.
- Un rig por instancia y recursos de geometría/textura compartidos donde sea seguro.
- Distancia y calidad reducen accesorios y detalle facial antes de perder la silueta.
- Medir un jugador y grupos de 8/24 personajes; una prueba individual no representa un puerto concurrido.

## Primera entrega y continuación

Los archivos y la evidencia de P01 están en [bases iniciales](docs/delivery/characters-base-v0.md).
Abrir el visor con `node tools/character-lab/server.mjs` y visitar `http://127.0.0.1:5194`.
Regenerar/comprobar modelos con `node tools/characters-base-v0/generate.mjs --check`.
Las fuentes raster conservan [prompts exactos](docs/art/source/characters-base-v0/prompts.json) y procedencia.

El siguiente trabajo es P02: anatomía/topología/UV para producción y calibración artística conjunta con el
material de personajes. La línea visual acompaña las entregas M5, D08 y agentes; sus gates de gameplay
conservan su estado y dependencias. El primer cambio dentro de la partida se hará con dueño único de
`CharacterView`, importador y protocolo, después del ensayo aislado.

P02a conserva v0 y añade comparación en el visor, mapas embebidos 1024/512 según dispositivo y cuadrícula
UV. Las fuentes v1 son editables como código paramétrico; la continuidad de la malla implícita no equivale
a una retopología artística. P02b conserva v0/v1 y añade v2 por superficies explícitas, uniones con pesos
coherentes, manos/pies simplificados, nueve regiones UV corporales y 7.080 triángulos por personaje.
Las pruebas locales incluyen tres poses, 16 muestras de carrera y navegador escritorio/móvil emulado.
P02c añade v3, con 10.216 triángulos, mandíbula/órbita/nariz/labios refinados y cuatro dedos más pulgar
por mano en una superficie corporal cerrada. Los dedos tienen forma estática y puntas redondeadas,
sin rig ni agarre propios. La guía alpha se conserva con prompt/origen; los mapas siguen procedurales.
El visor incorpora acercamientos de mano/pie y comparación v0/v1/v2/v3.
El siguiente cierre de P02 exige afinar siluetas/cara/extremidades y prendas, pintar/empacar el atlas final
y evaluar el material de juego. Los pies siguen sin dedos separados; la palma/pulgar son simplificados,
y el estudio de ropa no sustituye las chaquetas/botas del explorador. Las métricas técnicas no cierran el gate artístico.

P03a conserva un ensayo técnico de piezas y GLB por cuerpo: alternar base/montaje, preservar selecciones y
exportar la composición con metadatos. El autor rechazó esas mallas visualmente el 2026-10-08; su QA de
navegador falló y HTTP quedó pendiente. No cuenta como arte aprobado ni como cierre de P02/P03. El kit
alpha ilustrado v1 tiene QA local aprobada, mientras la aceptación visual final del autor sigue pendiente.
P02/P03 y el trabajo 3D de producción quedan abiertos antes de preparar P04:
chaqueta, botas, gafas y arma del explorador, con ocultación y puntos de conexión explícitos.
