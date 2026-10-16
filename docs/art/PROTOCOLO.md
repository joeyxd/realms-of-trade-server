# Protocolo de assets

Obligatorio para el autor y para todos los agentes desde el 2026-10-14. El índice que se puede consultar
es `ARTE-Y-MODELOS.html` en la raíz. Lo genera `ARTE-Y-MODELOS.cmd` o `npm run assets:index`, no se
commitea y muestra cada pieza, cada archivo y cada problema.

## Tres zonas

| Zona | Carpeta | Qué contiene | Regla |
|---|---|---|---|
| Juego | `assets/` | Lo que carga el navegador | Nombres ASCII, versión en el nombre, registrado en un catálogo |
| Fuentes | `docs/art/<familia>/` | Originales, referencias, láminas, ZIP de Tripo | Enlazado desde su fila o desde su DELIVERY.md |
| Bandeja | `materials/` | Lo que el autor suelta, con cualquier nombre | No se commitea; se archiva en Fuentes |

Las capturas de QA no van en ninguna zona. Viven fuera de git; el DELIVERY.md guarda su JSON, su sha256
y, como mucho, una imagen principal.

## Una pieza, un ID, una fila

- Cada pieza (material, objeto, prefab, modelo, sistema) tiene un ID en kebab-case ASCII: `barril-ron`,
  `arena-seca`. El ID no cambia nunca.
- Su fila vive en `tools/art-catalog/catalog.json`. Se edita con `CATALOGO-DE-ARTE.cmd` o a mano.
  Los objetos de Tripo siguen en `docs/art/items-index.json`. No se crea un catálogo nuevo.
- La fila lista sus archivos en `files` con su rol (`albedo`, `normal`, `model`, `mobile`, `source`…).
  Las referencias van en `references` y la evidencia en `evidence`.
- Lo que el juego carga por manifiesto queda en `assets/manifest.json` (`src` y `mobileSrc` relativos a
  `assets/`). Una entrada del manifiesto sin fila aparece en el índice como «Registro del juego»; conviene
  darle ficha.

## Nombres y versiones

- Solo `A-Z a-z 0-9 . _ -`, sin espacios ni acentos: `wood-boards-v2-mobile.webp`.
- La versión va en el nombre: `-v1`, `-v2`. Nunca sobrescribas un archivo publicado. Crea `-v2` y mueve
  la fila o el manifiesto a la nueva ruta.
- Cuando hay dos calidades, va la pareja completa: `<nombre>-desktop.<ext>` y `<nombre>-mobile.<ext>`
  (o `-pc`/`-mobile`). En el manifiesto, `src` lleva escritorio y `mobileSrc` móvil.
- Los originales grandes quedan en `docs/art/` o fuera del repo. En `assets/` solo van derivados comprimidos
  con presupuesto móvil (ver AGENTS.md).

## Añadir una pieza

1. **Busca antes de crear:** `npm run assets:find -- <palabras>`, o el buscador del índice. Si ya existe,
   trabaja en esa fila y crea una versión nueva; no abras otra pieza.
2. **Elige el ID** y crea su fila en el catálogo de arte, con estado `pending` mientras no haya archivos.
3. **Archiva las fuentes** en `docs/art/<familia>/` con nombres ASCII. Si llegaron por la bandeja,
   muévelas desde `materials/` y añádelas a `references` o `files` de la fila.
4. **Genera los derivados del juego** en `assets/<tipo>/`, con la pareja `-mobile` cuando aplique.
   Añádelos a `files` de la fila y al manifiesto si el juego los carga por ahí.
5. **Integra y verifica** según el corte: capturas fuera de git, la ruta y la resolución realmente cargadas.
   Después cambia el estado a `applied`.
6. **Comprueba:** `npm run assets:check`. Tiene que decir «Protocolo de assets OK». Regenera el índice con
   `npm run assets:index` si quieres revisarlo. Commitea solo cuando el check pasa.

## Problemas que detecta

| Tipo | Qué significa | Arreglo |
|---|---|---|
| `nombre` | Espacios, acentos u otros signos en `assets/` o `docs/art/` | Renombrar a ASCII y actualizar quien lo cite |
| `sin-ficha` | Archivo en `assets/` que ningún catálogo ni el código reclama | Añadirlo a su fila o al manifiesto; si no se usa, borrarlo |
| `huerfano` | Archivo en `docs/art/` que nada enlaza | Añadirlo a su fila, enlazarlo desde su DELIVERY.md o sacarlo de git |
| `falta` | Una fila, objeto o catálogo del juego apunta a algo que no está en el repo | Corregir la ruta o recuperar el archivo |
| `movil` | `-desktop`/`-pc` sin su `-mobile` | Generar la variante móvil |
| `id` | ID de fila repetido o fuera de kebab-case | Renombrar la fila nueva |
| `bandeja` | Archivo commiteado en `materials/` | Archivarlo en `docs/art/<familia>/` y enlazarlo |

La evidencia (`evidence`) puede vivir fuera de git y no cuenta como `falta`. Las rutas armadas en código
(`${family}/albedo-${tier}.webp`, o una base como `wood-boards-v2` a la que se añade la variante) cuentan
como uso.

## Herencia: la baseline solo encoge

`tools/asset-index/baseline.json` guarda los problemas que existían el 2026-10-14. El check los tolera,
pero falla con cualquier problema nuevo. Al arreglar uno, ejecuta
`node tools/asset-index/build.mjs --write-baseline`, que solo quita entradas. Nunca añadas entradas a mano
ni borres el archivo para regenerarlo. Si un problema nuevo parece inevitable, se resuelve en la fila o en
el archivo, no en la baseline.

## Comandos

| Comando | Para qué |
|---|---|
| `ARTE-Y-MODELOS.cmd` | Generar y abrir el índice (autor) |
| `npm run assets:index` | Generar `ARTE-Y-MODELOS.html` |
| `npm run assets:check` | Fallar si hay problemas nuevos |
| `npm run assets:find -- <texto>` | Buscar piezas y archivos antes de crear |
| `node tools/asset-index/build.mjs --json` | El escaneo completo en JSON |
| `node --test tests/asset-protocol.test.mjs` | La misma guardia como prueba; su parte del juego corre también en el actualizador del VPS |

El actualizador del VPS ejecuta esta prueba dentro de la imagen. Ahí solo existen `assets/` y `src/`, así
que comprueba lo que el juego carga (rutas del manifiesto, editor y Niagara presentes y con nombres seguros)
y salta la parte de catálogos.
