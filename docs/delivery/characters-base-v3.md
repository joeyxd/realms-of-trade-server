# Bases humanas v3 — rostro y dedos estáticos

Fecha: 2026-10-08. Corte **P02c**, implementado en el visor local del
[plan del creador](../../PLAN-CHARACTER-CREATOR.md). La v3 sustituye las manos tipo manopla por cuatro
dedos y un pulgar conectados a cada palma; refina mandíbula, ojos, nariz y labios, y redondea el antepié.
El acabado ilustrado de producción, vestuario y creador conectado a la partida siguen abiertos.

## Modelos y visor

Abrir `node tools/character-lab/server.mjs` y **http://127.0.0.1:5194/?v=3**.
El visor conserva v0/v1/v2, abre v3 por defecto y añade acercamientos de mano/pie y la guía de cabezas.
La selección, paletas, referencia de cuerpo, UV, poses y descarga continúan funcionando.

| Archivo | Triángulos | Altura de reposo | Cuatro mapas | Tamaño exacto |
|---|---:|---:|---|---:|
| [Masculino escritorio](../art/source/characters-base-v3/male-base-v3.glb) | 10.216 | 1,8089 m | 1024 | 780.064 B |
| [Masculino móvil](../art/source/characters-base-v3/male-base-v3-mobile.glb) | 10.216 | 1,8089 m | 512 | 581.452 B |
| [Femenino escritorio](../art/source/characters-base-v3/female-base-v3.glb) | 10.216 | 1,7789 m | 1024 | 780.584 B |
| [Femenino móvil](../art/source/characters-base-v3/female-base-v3-mobile.glb) | 10.216 | 1,7789 m | 512 | 581.976 B |

La v2 tenía 7.080 triángulos; el aumento de 3.136 cubre dedos y mayor resolución facial.
Ambas variantes usan la misma geometría, cinco mallas y quince huesos. Cada GLB conserva materiales PBR
estándar y mapas embebidos. El visor usa ocho bandas de luz en v3 para suavizar las grandes manchas
del ensayo anterior; ese shader, contorno y poses no se incluyen como clips dentro del archivo.

## Cambios de forma

- Mandíbula masculina más ancha y mentón menos puntiagudo; mandíbula femenina más estrecha y labios con
  mayor volumen. La cabeza conserva una familia común y diferencias todavía discretas.
- Ojos más pequeños y menos blancos, arco de ceja más bajo, relieve orbital y puente nasal más estrecho.
  Piel con sombras procedurales suaves en órbitas/pómulos/nariz/labios; ojos y cejas siguen como geometría.
- Palmas con rejilla de superficie: cuatro aperturas distales y una lateral alimentan los dedos y pulgar.
  Hay espacios reales entre dedos, longitudes espejadas, ligera curva y puntas redondeadas.
  **Los dedos son estáticos**, movidos por antebrazos; no hay huesos de dedos ni animación de agarre.
- Pie más ancho y redondeado, con transición de talón/empeine. Sigue siendo un volumen de estudio:
  dedos del pie, arco y acabado anatómico requieren trabajo posterior.

La ropa base mantiene el estudio v2: escotes, sisas, dobladillos y pliegues aún requieren ajuste artístico.
La palma y el pulgar conservan una forma simplificada; esta entrega no acredita anatomía de producción.
El cuerpo y ambas prendas permanecen como una componente cerrada cada uno al soldar posiciones,
con cero bordes abiertos/no manifold y triángulos degenerados. Cabeza/orejas son tres componentes
cerradas; ojos y acentos faciales conservan overlays abiertos intencionales y el cuello es un encaje superpuesto.

## Guía alpha y procedencia

Se usó la skill `imagegen` y el **generador integrado `image_gen`** para crear una
[guía de cabezas](../art/source/characters-base-v3/head-style-guide-v1.png), usando las láminas v0 como referencia.
El [prompt completo](../art/source/characters-base-v3/guide-prompt.json) y
[recibo](../art/source/characters-base-v3/guide-receipt.json) conservan origen, dimensiones y SHA-256.
Es PNG RGBA 1536×1024, con 830.271 píxeles totalmente transparentes y alfa máximo 254.
Se copió al proyecto sin alterar el original generado. Es una referencia artística; no se pega como
rostro ni se presenta como textura UV o modelo 3D. Los mapas usados por el modelo siguen siendo procedurales.

Las seis fuentes editables en [tools/characters-base-v3](../../tools/characters-base-v3/) se reconstruyen
exactamente desde sus snapshots y el [recibo de modelos](../art/source/characters-base-v3/models-receipt.json).
El atlas mantiene nueve regiones corporales; los dedos comparten mapas de mano. Empaquetado sin solapamientos,
gutter y densidad uniforme siguen pendientes; el inspector comprueba rango/datos UV y topología,
no certifica autointersecciones ni el atlas artístico final. No se entrega escena `.blend`.

Se volvió a revisar el candidato concreto `SKM_Manny_Simple`: exportación, rig y compatibilidad siguen
sin verificarse en el inventario. Se conserva geometría propia; fuentes Unreal intactas.
El rig v3 mantiene los pivotes v2, con 36 mm de diferencia lateral en antebrazos respecto al cálculo actual
de `charkit`. La futura integración debe preservar el bind del GLB o hacer un rebind explícito.

## Comprobación local

- [Auditor CPU](../art/characters-base-v3/pose-evidence-v3.json): cinco mallas de ambos cuerpos,
  tres poses y 16 muestras de carrera; posiciones finitas, pesos normalizados y costuras coincidentes.
  No hay mezclas de ramas opuestas fuera del puente medial ni triángulos colapsados en las tres poses.
  Máximo de aristas en el ciclo: 1,85011 masculino / 1,63024 femenino; hueco máximo de costura 0,00000001 m.
  Límites técnicos del ensayo: 3× y 0,00001 m; no equivalen a aceptación artística de toda animación.
- [Navegador](../art/characters-base-v3/browser-evidence-v3.json): 1440×900 y móvil emulado 390×844,
  ambos cuerpos y mapas realmente cargados 1024/512, programas enlazados/GL=0, sin errores JS/red.
  Paletas conservan ropa, guía con alfa real, UV, comparación v0/v1/v2/v3 y descarga tras cambios rápidos.
  40 capturas, incluidas cuatro comparaciones de rostro v2 y acercamientos de mano/pie.
- Capturas inspeccionadas: [mano](../art/characters-base-v3/desktop-male-hand-v3.png),
  [pie](../art/characters-base-v3/desktop-male-foot-v3.png),
  [rostro móvil](../art/characters-base-v3/mobile-female-face-v3.png) y
  [articulación](../art/characters-base-v3/desktop-female-joints-v3.png).
- [Descargas HTTP del catálogo](../art/characters-base-v3/artifact-evidence-v3.json): hashes contra fuentes
  locales. Nuevas filas `char-base-male-v3` / `char-base-female-v3` preparadas; filas anteriores intactas.
  Reconstrucción exacta v0/v1/v2/v3 y siete pruebas pertinentes del catálogo correctas.

```powershell
node tools/characters-base-v3/generate.mjs --check
node tools/characters-base-v3/audit-poses.mjs
node tools/character-lab/qa-v3.mjs
node tools/characters-base-v3/register-catalog.mjs --check
node tools/characters-base-v3/verify-catalog.mjs --write-evidence
```

QA usa Chrome headless/WebGL de software; no mide FPS en teléfono físico ni ejecuta la partida ordinaria.
La continuación de P02 requiere pintura/atlas artístico, anatomía y ajuste de ropa base; P03 prepara
cabello, barba y variantes de ojos/cejas, y P04 el kit del explorador. El creador, identidad guardada
y equipo autoritativo visible conservan sus gates posteriores.
