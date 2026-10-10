# Glosario ES/EN de MAREA NEGRA (alfa actual)

Guía editorial para textos visibles del juego. Recoge términos presentes en catálogos y datos del checkout; no redefine reglas ni convierte propuestas en funciones disponibles. Marcas, nombres propios e IDs conservan su forma establecida.

| Concepto | Español | English | Uso actual y fuente |
|---|---|---|---|
| Objeto de personaje | objeto / equipo | item / gear | “Objeto” para una pieza recogible o examinada; “equipo” para piezas que llevas. `Equipo / Gear` y `item_reward / Reward` (`src/i18n/adventure.js`); IDs en `src/data/items.js`. |
| Inventario personal | bolsa | bag | Etiqueta de inventario de aventura; se usa también para las perlas sin tragar. `Bolsa / Bag`, `En la bolsa / In your bag` (`src/i18n/adventure.js`). |
| Materiales portátiles | mochila | backpack | Usar mochila/backpack para los materiales que el personaje lleva a obras o a la balsa. Frase de misión: “haz sitio en la mochila / make room in your backpack” (`src/i18n/data.js`); aportes comunitarios `En tu mochila / In your backpack` (`src/i18n/systems.js`). |
| Carga | carga | cargo | Mercancía/peso transportado, distinta del espacio de almacenaje. `Carga / Cargo`, con desglose de bodega y mochilas (`src/i18n/systems.js`). |
| Almacenaje naval | bodega | hold | Compartimento de carga o pieza de almacenaje. `Abrir bodega de la balsa / Open raft hold`; `Bodega / Hold` (`src/i18n/systems.js`), `storage.name: Bodega` (`src/data/raftparts.js`). La etiqueta de la barra usa “Espacio de bodega usado / Hold space used”. |
| Vehículo inicial | balsa | raft | Usar para el vehículo inicial y construible. `runtime.raftHint` (`src/i18n/runtime.js`); partes en `src/data/raftparts.js`. |
| Barcos | barco / nave | ship / vessel | “Barco” para una embarcación concreta y “nave” como categoría general cuando el contexto lo pida. Tipos actuales: `Bote / Dinghy`, `Balandra / Sloop`, `Goleta / Schooner`, `Bergantín / Brigantine`, `Galeón / Galleon` (`src/i18n/data.js`, `src/data/ships.js`). |
| Aparejos y velamen | aparejos; vela; mástil | rigging; sail; mast | Vocabulario reservado para términos navales; el catálogo actual usa nombres concretos de piezas. No afirmar un sistema de aparejos como mecánica aparte. `Rayo de mástil / Mast lightning` y vela en `src/i18n/data.js`. La pareja `Vela cangreja / Lateen sail` corresponde al ID `mast_cangreja` (`src/data/ships.js`), pero los nombres pueden referirse a tipos distintos de vela: revisar intención náutica antes de renombrar cualquiera de los dos. |
| Habilidad | habilidad | skill | Acción de combate, categoría amplia. `Habilidad {slot} / Skill {slot}` (`src/i18n/systems.js`). |
| Arte de arma | arte (del arma) | weapon art | Habilidad ligada a un arma; el catálogo la llama “arte”. `Artes del {weapon} / {weapon} arts` y desbloqueo por `Maestría / Mastery` (`src/i18n/adventure.js`); clasificación en `src/data/tattoos.js`. |
| Tatuaje | tatuaje | tattoo | Nombre de la habilidad aprendida con Doña Sepia. El texto actual indica que gana tinta/experiencia llevándolo puesto; datos de rango y formas en `src/data/tattoos.js`, distribución de XP a tatuajes equipados en `src/sim/systems/inventory.js`. |
| Maestría de arma | maestría | mastery | Progreso ligado al arma y diferenciado del rango del tatuaje. UI `Maestría {level} / Mastery {level}` (`src/i18n/adventure.js`); datos/tuning en `src/data/weapons.js`. |
| Rango de tatuaje | rango | rank | Término para el rango del tatuaje; no intercambiar con maestría. `Tatuaje · rango {rank} / Tattoo · rank {rank}` (`src/i18n/adventure.js`). |
| Perla de poder | perla | pearl | Distinguir por contexto entre perla tragada y sin tragar; especificar el estado si puede confundirse con la mercancía. UI y reglas de texto en `src/i18n/adventure.js`; IDs/nombres en `src/data/pearls.js`. |
| Perlas de mercancía | perlas blancas | white pearls | Mercancía económica, distinta de las perlas de poder. `Perlas blancas / White pearls` (`src/i18n/data.js`), ID de bien en `src/data/goods.js`. |
| Afinidad | afinidad | affinity | Terminología reservada para uso futuro; los catálogos revisados no la muestran como término de UI. La traducción léxica es `afinidad / affinity`; esto no afirma que un sistema o efecto esté implementado. |
| Recursos y materiales | recurso / material | resource / material | “Recurso” para categoría/nodo recolectable; “material” para requisito de fabricación u obra. “Bien/mercancía” para inventario económico. Uso de materiales comunitarios en `src/i18n/systems.js`; bienes en `src/data/goods.js`. |
| Mapa | mapa | map | Panel y representación del mundo. Claves `hud.map` y `nav.map` en `src/i18n/runtime.js`. |
| Navegación | navegación | navigation | Control/desplazamiento naval. `Navegación de la balsa / Raft navigation` (`src/i18n/runtime.js`); usar “ruta / route” para un recorrido concreto. |
| Proyecto comunitario | obra / proyecto | project | “Obra” para la construcción/aporte concreto; “proyecto” para disponibilidad/estado general. El flujo usa ambos (`src/i18n/systems.js`); mantener la elección contextual de manera consistente dentro de cada frase. |
| Rechazo de operación | no se pudo… / el servidor rechazó… | could not… / the server rejected… | Mensaje directo basado en el motivo conocido; no exponer códigos ni inventar causas. Ejemplo genérico en `src/i18n/systems.js`. |
| Marca e ID | conservar | preserve | Conservar `Salty Shore`, `HELLFIRE`, `Doña Sepia`, `Tía Perla`; traducir sus descripciones, no sus nombres. IDs como `sable`, `tierra` y códigos de evento/rechazo no se traducen (`PLAN-I18N.md`, §§3–4). |

## Criterios para texto bilingüe nuevo

Categorías visibles de mercado: **Víveres / Provisions**, **Bebida / Drink**, **Materiales / Materials**,
**Armamento / Arms**, **Lujo / Luxury**. Se resuelven desde `GOOD_CATS` sin modificar IDs ni clasificación.
Los topónimos y nombres de personajes conservan su forma establecida; una adaptación explícita ya
existente, como Cala Calavera / Skull Cove, se mantiene sin renombrar los datos ni el sitio.

- Redactar frases naturales e independientes en español y en inglés, con el tono tropical pirata estilizado y el mismo significado e información.
- Usar una traducción estable por concepto y superficie; respetar distinciones actuales entre bolsa, mochila y bodega.
- Preservar nombres propios, marcas, controles, IDs, cantidades, lógica y bytes firmados. Traducir su explicación cuando corresponda, nunca el contrato.
- Usar frases completas con parámetros y pluralización propios de cada idioma; no concatenar fragmentos que alteren el orden natural.
- No introducir pistas, recompensas, requisitos o mecánicas en un idioma que falten en el otro. Si una causa de rechazo no se conoce, usar el mensaje genérico localizado.
- Los términos reservados para futuro no prueban disponibilidad de una mecánica ni deben usarse para insinuarla.

## Notas editoriales

- **Bodega:** `holdSpaceLabel` ahora dice “Espacio de bodega usado / Hold space used”; la barra reporta volumen ocupado (`capacity.holdVolume`) sobre capacidad (`src/ui/commerce.js`).
- **Mochila:** la frase de misión y el panel comunitario coinciden ahora en `mochila / backpack` (`src/i18n/data.js`, `src/i18n/systems.js`).
- **Doña Sepia:** mantener la ñ también en inglés por ser nombre propio; se corrigieron las seis frases de aventura que la habían omitido (`src/i18n/adventure.js`).
- **Vela cangreja / Lateen sail:** el nombre español y el término inglés podrían señalar aparejos distintos. El ID y datos de navegación usan `mast_cangreja`; validar la intención náutica con producto antes de cambiar el nombre visible. No se propone cambio mecánico.
- **Afinidad / affinity** y **aparejos / rigging:** equivalencias léxicas reservadas, sin afirmar que exista un sistema jugable expuesto.
- **Perla:** `perla tragada`, `perla sin tragar` y `perlas blancas` evitan confundir poder con mercancía.
