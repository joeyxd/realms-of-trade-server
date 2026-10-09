# Anatomía de las bases masculina y femenina v1

Fecha: 2026-10-07. La iteración P02a del [creador modular](../../PLAN-CHARACTER-CREATOR.md) añade
cuerpo continuo, rostro con relieve, UV y mapas de material a las dos bases. El visor conserva
la v0 para comparar. P02 sigue abierto para retopología, manos/pies, atlas definitivo y acabado artístico.

## Modelos y fuentes editables

Los modelos conservan cinco piezas y quince huesos con los nombres y jerarquía del rig corporal local.
Los pivotes se ajustan a las proporciones de cada cuerpo. La piel, top y shorts son mallas conectadas;
las orejas y superficies faciales son piezas de la cabeza. El cuello se ensambla mediante una unión
solapada dentro de la cabeza.

| Base | Mapas 1024 | Mapas 512 |
|---|---|---|
| Masculina | [GLB escritorio](../art/source/characters-base-v1/male-base-v1.glb) | [GLB móvil](../art/source/characters-base-v1/male-base-v1-mobile.glb) |
| Femenina | [GLB escritorio](../art/source/characters-base-v1/female-base-v1.glb) | [GLB móvil](../art/source/characters-base-v1/female-base-v1-mobile.glb) |

La base masculina tiene 23.844 triángulos y mide 1,8582 m; la femenina, 23.182 triángulos y 1,831 m.
Los archivos de escritorio pesan 1.387.164 y 1.362.008 bytes; los móviles, 1.115.952 y 1.090.800 bytes.

El [recibo](../art/source/characters-base-v1/models-receipt.json) registra bytes, triángulos, altura,
topología por pieza, dimensiones de mapas y hashes de modelos/fuentes. Las variantes de dispositivo
comparten geometría y rig; cambia la resolución de sus cuatro mapas embebidos.

Las fuentes son código paramétrico editable:
[cuerpo y prendas](../../tools/characters-base-v1/body.mjs),
[cabeza y ojos](../../tools/characters-base-v1/head.mjs),
[pintura](../../tools/characters-base-v1/textures.mjs),
[exportador](../../tools/characters-base-v1/generate.mjs) e
[inspector](../../tools/characters-base-v1/inspect.mjs).
Los snapshots servidos por el catálogo conservan los mismos bytes que estas fuentes al aceptar el corte.

## Anatomía y materiales

La piel combina un campo de formas humanas en una sola superficie, eliminando las uniones de volúmenes
superpuestos del cuerpo v0. La nariz, mejillas, cuencas, labios y mentón forman parte de la superficie
facial; ojos, cejas neutras y pequeños acentos se articulan con la cabeza. Aún no son opciones del creador.
La ropa opaca es una prueba de encaje, anterior a las prendas del explorador.

Los mapas RGB multiplican los colores lineales de vértice con pinceladas amplias, rubor discreto y trama
de tela. Son un estudio procedural de material; el acabado ilustrado de las
[referencias originales](characters-base-v0.md) sigue siendo el objetivo artístico. El GLB exporta materiales
PBR estándar. El visor añade bandas de luz y contorno mediante sus propios materiales.

La UV cilíndrica mantiene valores entre 0 y 1, duplica la costura trasera y permite revisar el modelo
con cuadrícula. Su densidad no es uniforme entre rostro, torso y extremidades; debe reemplazarse por
un atlas diseñado para la personalización antes de producción.

## Visor y comprobación

Ejecutar `node tools/character-lab/server.mjs` y abrir **http://127.0.0.1:5194**.
El visor ofrece comparación v0/v1, cuerpo, piel, pose A, reposo, carrera y articulación; frente, perfil,
espalda, rostro y encuadre de juego; material, cuadrícula UV y referencia pintada.
Descargar entrega el archivo original; la paleta y pose del ensayo son temporales.

```powershell
node tools/characters-base-v1/generate.mjs --check
node tools/character-lab/qa-v1.mjs
node tools/characters-base-v1/register-catalog.mjs --check
node tools/characters-base-v1/verify-catalog.mjs
```

El inspector comprueba índices y atributos finitos, UV, normales, pesos normalizados, huesos válidos,
matrices bind y mapas PNG. El cuerpo debe ser una componente cerrada sin aristas no manifold.
La reconstrucción reproduce los cuatro GLB exactamente y comprueba los hashes de las cinco fuentes.
`--check` no escribe; `--force` regenera explícitamente esta versión.

El QA carga ambos cuerpos en escritorio 1440×900 y móvil emulado 390×844; comprueba la resolución
real de los mapas, URLs GLB solicitadas, recolor conservando ropa, programas WebGL, cuadrícula UV,
comparación y cambios rápidos de selección. Las poses se evalúan sobre vértices deformados, con un límite
del laboratorio para estiramiento de aristas. Las capturas incluyen vistas de rostro, articulación y juego.
[Evidencia de navegador](../art/characters-base-v1/browser-evidence-v1.json).

La ejecución final pasó las cuatro combinaciones de cuerpo y viewport, sin errores WebGL, de consola
ni de carga. La reproducción exacta de los cuatro GLB, cinco snapshots de fuente y ocho mapas externos
también pasó. Las siete pruebas existentes del catálogo local pasaron.

El máximo de estiramiento de aristas fue 3,932 en la base masculina y 3,948 en la femenina, por debajo
del umbral técnico de 5 del laboratorio. Este umbral detecta deformaciones excesivas del ensayo;
el acabado de hombros, codos, manos, pies y bordes de ropa sigue pendiente de revisión artística.
Las capturas conservan la superficie facetada y las limitaciones visibles de esta iteración:
[frente masculino](../art/characters-base-v1/desktop-male-front-v1.png),
[rostro femenino](../art/characters-base-v1/desktop-female-face-v1.png),
[articulación femenina](../art/characters-base-v1/desktop-female-joints-v1.png) y
[vista móvil](../art/characters-base-v1/mobile-female-front-v1.png).

Chrome headless utiliza WebGL de software. La revisión acredita carga y comportamiento del laboratorio;
el encuadre Juego es una cámara del visor, anterior a la integración y animación de `CharacterView`.

## Reutilización y siguiente corte

Se volvió a revisar el candidato concreto `SKM_Manny_Simple` del inventario Unreal y los héroes
Paragon Kwang/Wukong. Su exportación, geometría y encaje artístico siguen sin verificar; esta iteración
continúa con fuentes propias y la jerarquía local. Las fuentes Unreal permanecen intactas.
Referencias: [candidatos](../research/unreal-assets/myproject/FINDINGS.md) e
[inventario resumido](../research/unreal-assets/SUMMARY.md).

P02b debe sustituir la topología implícita por una malla preparada para deformación y edición artística,
mejorar dedos/pies, ajustar cobertura y pliegues de ropa en poses extremas, preparar atlas definitivo
y acercar el acabado a las láminas. El presupuesto propuesto de 12–20 mil triángulos vestido sigue siendo
un objetivo de optimización; esta iteración prioriza continuidad y estudio visual.
Después siguen cabello/barba/ojos seleccionables, vestuario, creador, identidad guardada y equipo visible.
Las filas v1 se registran como archivos preparados y conservan v0, fuentes, referencias y evidencia.
La [comprobación HTTP](../art/characters-base-v1/artifact-evidence-v1.json) verifica que cada enlace
de estas filas devuelve los mismos bytes y hash SHA-256 que su archivo local.
