# Bases humanas v2 — superficies y atlas regional

Fecha: 2026-10-07. Corte local **P02b** del [plan del creador](../../PLAN-CHARACTER-CREATOR.md).
Las dos bases tienen ahora superficies construidas con anillos y parches de unión, pesos coherentes en
las costuras y un atlas corporal por regiones. La v2 reduce el coste geométrico y permite revisar el encaje
de futuras piezas. **P02 de producción sigue abierto**: el acabado de las láminas y la integración en
la partida requieren sus siguientes gates.

## Entrega comprobable

Abrir `node tools/character-lab/server.mjs` y visitar **http://127.0.0.1:5194/?v=2**.
El visor permite comparar v0/v1/v2, ambos cuerpos, paletas, vistas, poses y cuadrícula UV.
Las versiones anteriores conservan sus modelos, mapas, fuentes y recibos reproducibles.

| Archivo | Triángulos | Altura de reposo | Mapas embebidos | Tamaño exacto |
|---|---:|---:|---|---:|
| [Masculino escritorio](../art/source/characters-base-v2/male-base-v2.glb) | 7.080 | 1,8176 m | 4 × 1024 | 624.276 B |
| [Masculino móvil](../art/source/characters-base-v2/male-base-v2-mobile.glb) | 7.080 | 1,8176 m | 4 × 512 | 442.232 B |
| [Femenino escritorio](../art/source/characters-base-v2/female-base-v2.glb) | 7.080 | 1,7876 m | 4 × 1024 | 624.856 B |
| [Femenino móvil](../art/source/characters-base-v2/female-base-v2-mobile.glb) | 7.080 | 1,7876 m | 4 × 512 | 442.812 B |

La v1 tenía 23.844/23.182 triángulos: la reducción es del 70,3 %/69,5 %, respectivamente.
Cada GLB contiene cinco mallas con pesos y quince huesos. El móvil reduce mapas; mantiene la geometría.
La descarga contiene materiales PBR estándar y no incluye las poses ni el shader de contorno del visor.

## Construcción y alcance artístico

El cuerpo tiene anillos de torso, parches de hombro, un puente medial de cadera y superficies de brazos,
piernas, palmas y pies. La fuente construye caras entre anillos y exporta triángulos indexados.
Se ajustaron cintura/cadera femenina, mandíbula, ojos, orejas y volumen de las prendas de estudio.
Las palmas tienen un contorno simplificado; no hay dedos separados, pulgar articulado ni huesos de dedos.
Los pies siguen siendo volúmenes simplificados sin dedos. El cuello usa un encaje superpuesto con la cabeza.

El cuerpo usa nueve regiones UV: torso, dos brazos, dos piernas, dos manos y dos pies. Las duplicaciones
de vértices para las costuras conservan posición y pesos. Cabeza y prendas tienen sus propios mapas.
Los cuatro mapas procedurales son estudios de piel/tela; quedan pendientes el pintado artístico,
empaquetado final, separación UV y densidad uniforme. El inspector verifica rango UV y datos válidos;
no certifica ausencia de solapamientos ni de autointersecciones en toda posible pose.

El cuerpo, camiseta y pantalón tienen una componente cerrada cada uno al soldar posiciones coincidentes,
sin bordes abiertos, bordes no manifold ni triángulos degenerados. La cabeza tiene tres componentes
cerradas por cráneo y orejas. Las superficies de ojos/cejas y acentos faciales son overlays abiertos
intencionales. Las tapas interiores de ropa cierran este estudio; escotes, sisas, dobladillos y pliegues
siguen pendientes para el vestuario del explorador.

Las fuentes editables son código paramétrico en [tools/characters-base-v2](../../tools/characters-base-v2/).
Sus seis snapshots, ocho PNG y hashes están en el [recibo](../art/source/characters-base-v2/models-receipt.json).
No se entrega una escena de modelado `.blend` ni una retopología artística final.
Se revisó el candidato `SKM_Manny_Simple` del inventario Unreal: exportación y compatibilidad siguen sin
verificarse; estas bases usan geometría propia. Las fuentes Unreal permanecen intactas.

## Articulación y futuro importador

Unidades: metros, +Y arriba, +Z frente, +X izquierda del personaje. El reposo tiene brazos abajo;
la pose A es una presentación del visor. Las quince articulaciones mantienen nombres y jerarquía local.
Los pivotes `foreL/foreR` están 36 mm hacia fuera respecto a los calculados por el `charkit` actual con
estas proporciones. La integración debe conservar skeleton y bind del GLB o realizar un rebind explícito.
Los nombres compartidos no permiten sustituir directamente las matrices del personaje actual.

El [auditor CPU](../art/characters-base-v2/pose-evidence-v2.json) comprueba las cinco mallas de ambos cuerpos
en pose A, carrera y articulación, además de 16 muestras de un ciclo de carrera. No encontró posiciones
inválidas, pesos fuera de rango, mezclas de ramas opuestas fuera del puente medial ni triángulos colapsados
en las tres poses. El máximo estiramiento de arista del ciclo fue 1,85011 masculino / 1,63024 femenino;
el máximo hueco entre posiciones duplicadas fue 0,00000003 m. El límite de ensayo es 3× y 0,00001 m.
Estos límites detectan fallos técnicos; la calidad visual de toda la animación requiere revisión posterior.

## Evidencia local

- [Navegador](../art/characters-base-v2/browser-evidence-v2.json): escritorio 1440×900 y móvil emulado
  390×844, ambos cuerpos, cinco mallas/quince huesos, mapas reales 1024/512, shaders enlazados y GL=0.
  Paletas conservan la ropa; referencias, UV, comparación de versiones y cambios rápidos/descarga verificados.
- 28 capturas: [frente masculino](../art/characters-base-v2/desktop-male-front-v2.png),
  [articulación femenina](../art/characters-base-v2/desktop-female-joints-v2.png),
  [UV](../art/characters-base-v2/desktop-female-uv-v2.png) y
  [móvil femenino](../art/characters-base-v2/mobile-female-front-v2.png), entre otras.
- [Archivos del catálogo](../art/characters-base-v2/artifact-evidence-v2.json): descarga HTTP local y hashes
  contra archivos de origen. Filas nuevas `char-base-male-v2` / `char-base-female-v2` en estado `prepared`.
- Reconstrucción exacta de v0/v1/v2 y siete pruebas del catálogo correctas. El QA usa Chrome headless
  con WebGL de software; la vista Juego es un encuadre del visor. No mide FPS en teléfono físico ni
  ejecuta la partida ordinaria.

```powershell
node tools/characters-base-v2/generate.mjs --check
node tools/characters-base-v2/audit-poses.mjs
node tools/character-lab/qa-v2.mjs
node tools/characters-base-v2/register-catalog.mjs --check
node tools/characters-base-v2/verify-catalog.mjs --write-evidence
```

## Continuación

Cerrar P02 exige afinar cara, siluetas, extremidades y prendas, pintar/empacar el atlas y evaluar el
material con iluminación de juego. P03 añade cabello, barba y variantes de ojos/cejas; P04 construye
el equipo del explorador. El creador, identidad guardada, equipo autoritativo visible y aceptación
de rendimiento siguen el orden del plan. Esta entrega está implementada y probada localmente.
