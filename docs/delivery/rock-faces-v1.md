# S12 — roca natural ilustrada aplicada localmente

Fecha: 2026-10-07. **Implementado y verificado en preview local.**

Las rocas existentes de playa e interior comparten tonos cálidos, caras claras, laterales fríos,
manchas sutiles, fracturas más finas y oscurecimiento junto al agua. Se reutilizan las mallas actuales,
incluidas las tres variantes SM_Rock de S02. No hay imágenes ni mapas normal nuevos: normales geométricas,
ruido compartido y shader toon producen el acabado. La luz mantiene el sombreado anterior; la pintura
describe caras geométricas sin forzar un facetado triangular fuerte en toda la iluminación.

## Alcance comprobado

En el seed del juego hay **68 rocas**. La familia nueva se aplica a **33**: ocho de playa S02 y 25 de
geometría procedural. **35** volcánicas/de arena de combate/lava mantienen su shader previo. Con `noassets`
las 33 naturales usan la pintura sobre el fallback procedural; ninguna roca desaparece.

Antes/después: mismos 68 props y radios; matrices, colores por vértice/instancia, índices y demás atributos
geométricos coinciden por bytes/SHA-256. Los programas de roca volcánica coinciden y su bloque GLSL anterior
permanece idéntico. Mallas y materiales se reutilizan en cambios de calidad. Terreno, RNG, gameplay,
protocolo, recursos interactivos y archivos de persistencia no se modificaron por S12.

| Coste del conjunto de rocas registradas | Antes | Después |
|---|---:|---:|
| Instancias | 68 | 68 |
| Triángulos de rocas, antes de culling | 5.312 | 5.312 |
| Geometrías compartidas | 5 | 5 |
| Materiales de color | 2 | 2 |
| Batches espaciales instanciados | 34 | 38 |
| Texturas nuevas | 0 | 0 |

Separar roca natural y volcánica añade cuatro batches en este seed; las vistas no dibujan necesariamente
todos. El contorno y las sombras usan sus contratos anteriores. La nueva pintura lee una vez el ruido
existente cuando hay detalle: reemplaza la lectura antigua de grietas en rocas interiores y las dos de
grietas/pincel en costa. Low omite esa muestra fina y mantiene paleta/humedad. Estos conteos no prueban
mejora ni FPS en GPU/teléfono físico.

## Reutilización y límites

[Brief S12](../briefs/visual-s12-rock-faces.md) registra cuatro candidatos exactos de `C:\Unreal` con bytes.
SM_Rock ya tiene un export portable revisado de 12.184 B y GLB runtime de 7.964 B/64 triángulos; se reutiliza.
Los paquetes Rock_shopk 2K se verificaron como archivos, sin inspección de píxeles/canales/dependencias ni
export; no se importaron. Los proyectos fuente quedan intactos.

Un muestreo local del terreno, x/z entre −160 y 160 cada 2 unidades, altura −0,8 a 9, volcánico menor de
0,2 y camino menor de 0,1, dio máximo `1-normalY ≈ 0,197` con e=0,64. No es un máximo global demostrado.
No se justificaba anunciar nuevas caras de acantilado sobre esas laderas. El trabajo de remates, taludes
modulares, aperturas/arcos y siluetas grandes sigue pendiente en sus filas. S12 acepta pintura en objetos,
no la geometría de un puerto completo.

## Verificación y archivos

**92/92 tests pertinentes**, sin skips, en 16 archivos: las cuatro pruebas nuevas cubren paleta/eligibilidad,
uniforms independientes y routing real de vegetación con fuente y transformaciones preservadas y RNG
prohibido. La suite incluye S01–S11, assets y catálogo.

Browser QA: before PC/high, móvil/medium y low; after PC/high, móvil/medium, low, assets desactivados,
noche y vertical rotado. Tres encuadres de rocas **existentes** por caso: playa, interior y contacto con mar;
27 capturas, sin geometría de galería añadida. Los seis casos finales y **24 cambios de calidad** pasan,
sin errores JS/juego/assets ni WebGL y con programas enlazados. Único error auxiliar permitido: el favicon
404 del preview local, conservado con URL. La vertical utiliza el escenario horizontal rotado existente.

- [Interior PC](../art/rock-faces/desktop-interior-after-v1.png), [antes](../art/rock-faces/desktop-interior-before-v1.png).
- [Playa PC](../art/rock-faces/desktop-beach-after-v1.png), [pie junto al mar](../art/rock-faces/desktop-wet-after-v1.png).
- [Low](../art/rock-faces/low-beach-after-v1.png), [noche](../art/rock-faces/night-interior-after-v1.png).
- [Matriz de runtime y equivalencia](../art/rock-faces/runtime-evidence-v1.json).
- [Recibo final de nueve fuentes exactas](../art/source/rock-faces-v1/final/source-snapshot.json).

Before usa el archivo de vegetación archivado antes de S12 mediante route local del navegador: el resto
del juego es el checkout actual para aislar la pintura. Las instancias y hashes completos se guardan una
vez por caso; las otras vistas/transiciones referencian ese registro. El verificador recalcula equivalencia
desde matrices/colores/hashes y compara el GLSL legado entre snapshots, además de comprobar errores y tiers.
Los snapshots se congelan una vez; `--check` valida sus bytes sin refrescar desde futuras fuentes.
La primera congelación de fuentes conserva el validador previo a corregir su manejo del campo opcional
de consola de transiciones; queda como diagnóstico y el catálogo utiliza exclusivamente el recibo final.

Reproducir: `node tools/prepare-rock-faces-sources.mjs --check`,
`node tools/register-rock-faces-catalog.mjs` y `node tools/verify-rock-faces-catalog.mjs`.
El harness `tools/qa-rock-faces.playwright.js` permite sustituir literales device/phase y se ejecuta en
Playwright serial; before recupera la fuente congelada del catálogo ya registrado.

Catálogo: [Roca de cara cálida / Roca natural](http://127.0.0.1:5190), con tres previews, fuentes y comparaciones.
Revisión 20, 85 filas/34 aplicadas; 43 enlaces únicos con SHA-256 HTTP exacto, filas locales/live coincidentes
y repetición sin cambio de revisión. UI inspeccionada: 28 imágenes decodificadas (27 capturas y referencia),
74 enlaces, diez de fuente incluyendo recibo; [captura de ficha](../art/rock-faces/catalog-rock-faces-v1.png).
[Juego local](http://127.0.0.1:5192/?solo&debug&q=high&tod=day&art=rocks): pulsar Jugar para el encuadre de
rocas de playa del preview. Ajuste artístico final, rendimiento físico y publicación pendientes.
