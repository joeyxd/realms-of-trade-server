# Bases iniciales del creador de personajes

Fecha: 2026-10-07. Dirección aprobada por el autor: creador modular con bases masculina y femenina,
estilo ilustrado marítimo, cabello/barba/ojos seleccionables y equipo visible durante la partida.
Esta entrega prepara dos láminas, dos GLB articulados y un visor para probar la base.
Su alcance es P01 del [plan del creador](../../PLAN-CHARACTER-CREATOR.md).

## Referencias y modelos

| Base | Referencia pintada | GLB inicial | Medidas |
|---|---|---|---|
| Masculina | [Lámina v1](../art/source/characters-base-v0/male-concept-v1.png) | [Modelo v0](../art/source/characters-base-v0/male-base-v0.glb) | 9.676 triángulos, 1,865 m, 444.592 bytes |
| Femenina | [Lámina v1](../art/source/characters-base-v0/female-concept-v1.png) | [Modelo v0](../art/source/characters-base-v0/female-base-v0.glb) | 9.676 triángulos, 1,835 m, 444.608 bytes |

Ambas láminas muestran frente, perfil, espalda y cabeza, con pelo y equipo pendientes de personalización.
Las generó la herramienta integrada `image_gen.imagegen`; no devolvió un identificador exacto de modelo.
[Prompts completos](../art/source/characters-base-v0/prompts.json) y
[recibo raster](../art/source/characters-base-v0/concepts-receipt.json) conservan procedencia, dimensiones y hashes.

Los GLB proceden del [generador paramétrico](../../tools/characters-base-v0/generate.mjs).
Cada uno conserva cinco mallas —cuerpo, cabeza, ojos, top y shorts— y quince huesos con la jerarquía corporal
actual. Los pesos están normalizados; COLOR_0 es lineal. Sus ojos son superficies curvas sobre la cara,
y las piezas de ropa se articulan con el cuerpo. Las paletas base corresponden a top azul pizarra,
shorts gris oscuro y piel cálida. [Recibo de modelos](../art/source/characters-base-v0/models-receipt.json).

## Visor local

Ejecutar `node tools/character-lab/server.mjs` y abrir **http://127.0.0.1:5194**.
[Uso y verificación](../../tools/character-lab/README.md).

Permite seleccionar cuerpo, probar cinco tonos de piel, girar/acercar, ver frente/perfil/espalda/rostro,
comparar pose A/reposo/carrera de demostración y abrir la lámina correspondiente.
La descarga entrega el GLB original; recolores y poses del visor son temporales.
Three.js 0.160 se carga desde la dependencia local. El servicio escucha en localhost y es de solo lectura.

## Verificación técnica y visual

- `node tools/characters-base-v0/generate.mjs --check`: hashes de fuente/GLB, reconstrucción exacta en memoria,
  altura, jerarquía y pesos comprobados sin modificar las salidas.
- QA de navegador: ambos cuerpos en escritorio 1440×900 y móvil emulado 390×844; cuatro combinaciones.
  Carga real, cinco mallas con skin, quince huesos, deformación por pose, recolor de piel conservando ropa,
  láminas cargadas, programas GL enlazados y ausencia de desbordamiento horizontal comprobados.
- Capturas inspeccionadas de proporciones, rostro y carrera. La revisión corrigió tamaño/perfil de cabeza,
  unión de hombros, perneras, ojos que interpenetraban la cara y encuadre móvil.
- Catálogo: dos filas propias con fuentes, modelos y capturas; siete pruebas pertinentes del catálogo aprobadas.

[Evidencia de navegador](../art/characters-base-v0/browser-evidence-v0.json),
[frente masculino](../art/characters-base-v0/desktop-male-front-v0.png),
[frente femenino](../art/characters-base-v0/desktop-female-front-v0.png),
[rostro femenino](../art/characters-base-v0/desktop-female-face-v0.png) y
[móvil femenino](../art/characters-base-v0/mobile-female-front-v0.png).
Chrome headless usa WebGL de software; esta revisión verifica carga y comportamiento, no FPS físico.

## Estado y continuación

Las dos referencias fijan dirección artística. Los GLB v0 son maquetas humanas articuladas para ensayar
proporciones y modularidad: conservan uniones de superficies paramétricas, rostro simplificado y
ropa de prueba. La anatomía continua, los párpados, manos/pies, deformación fina de hombros/cadera,
UV y acabado pintado pertenecen a P02. Los archivos no incluyen clips, huesos faciales ni materiales pintados
de producción; el visor anima el rig directamente.

Las filas `char-base-male` y `char-base-female` se registran como **archivos preparados**, con alcance de
prototipo descrito en sus notas. El próximo corte es anatomía y UV de producción, después cabello/barba,
prendas y creador. Identidad persistente y equipo visible requieren sus cortes de servidor/render del plan.
La entrega queda en el laboratorio y acompaña las prioridades M5/D08/agentes; no aplica modelos al juego.
