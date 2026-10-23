# Plan del creador de personajes modulares

Fecha: 2026-10-07. Dirección y arranque autorizados por el autor: personaje modular en el estilo de las
láminas del explorador y su tripulación, con bases masculina y femenina, pelo, barba, ojos y equipo intercambiables.
La primera entrega prepara referencias, dos modelos 3D articulados iniciales y un visor local.
El acabado de producción y el creador conectado a la partida avanzan en las etapas siguientes.

Estado inicial: P01 cuenta con referencias, dos maquetas GLB y visor; la verificación técnica y visual
se registra en la entrega. P02 inicia el modelado continuo, UV y acabado de producción.

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
