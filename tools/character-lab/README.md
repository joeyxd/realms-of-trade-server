# Visor de bases de personaje

Comparación de las bases masculina y femenina v0/v1/v2/v3. La v3 abre por defecto y refina rostro,
dedos estáticos y pies. El acabado de producción sigue la dirección de las láminas.
Usar `?v=0`, `?v=1`, `?v=2` o `?v=3` para abrir una versión concreta.
`?v=3&appearance=1` abre el [ensayo de apariencia P03a](../../docs/delivery/character-appearance-v1.md).

## Abrir

Desde la raíz del proyecto:

```powershell
node tools/character-lab/server.mjs
```

Visitar **http://127.0.0.1:5194**. El visor carga Three.js 0.160 del `node_modules` existente, sin CDN.
Otro puerto: `node tools/character-lab/server.mjs --port=5195`.
El servicio atiende solo GET/HEAD en localhost y sirve exclusivamente el visor, sus fuentes y Three.js.

Seleccionar versión, cuerpo y tono de piel; girar con ratón o toque; comparar pose A, reposo, carrera y
articulación de demostración. Las vistas Frente, Perfil, Espalda, Rostro y Juego fijan encuadres.
La cuadrícula UV muestra la distribución inicial del mapa. La referencia pintada se abre desde el visor.
Mano/Pie acercan las extremidades. Guía de cabezas abre la referencia alpha generada para el corte v3.
Descargar modelo GLB entrega el archivo original, con su paleta base y sin clips de animación.
Las modificaciones de vista y color son temporales, propias del ensayo.

«Montaje → Personalizar» en v3 ofrece cabello/barba, ojos/cejas y colores independientes, con reset.
«Descargar personaje GLB» conserva la combinación actual, colores, IDs, rig y mapas en un export de reposo
PBR; la descarga de base conserva el GLB original. Cuerpo/calidad/versiones conservan la selección y un cambio
durante la exportación descarta su resultado. En móvil la vista sigue visible al desplazar los controles.
La prueba mantiene abierto el acabado artístico P02/P03 y no guarda un perfil ni equipo de juego.

Fuentes/recibos: `tools/character-appearance-v1/` y `docs/art/source/character-appearance-v1/`.
QA: `node tools/character-lab/qa-appearance-v1.mjs`; capturas/downloads en `docs/art/character-appearance-v1/`.

## Fuentes y alcance

- [Plan del creador](../../PLAN-CHARACTER-CREATOR.md).
- [Entrega v0](../../docs/delivery/characters-base-v0.md) y [anatomía v1](../../docs/delivery/characters-base-v1.md).
- [Superficies v2](../../docs/delivery/characters-base-v2.md), sus límites y evidencia.
- [Rostro y manos v3](../../docs/delivery/characters-base-v3.md), guía alpha, prompt y recibos.
- Modelos, láminas, prompts y recibos originales: `docs/art/source/characters-base-v0/`.
- Modelos y mapas v1/v2: `docs/art/source/characters-base-v1/` y `docs/art/source/characters-base-v2/`.
- Fuentes editables: `tools/characters-base-v1/` y `tools/characters-base-v2/`; parámetros y funciones.
- Modelos/mapas/referencia v3: `docs/art/source/characters-base-v3/`; fuentes `tools/characters-base-v3/`.

El ensayo conserva cinco mallas y quince huesos por cuerpo. Las v1/v2/v3 descargan una variante por dispositivo:
mapas 512 en un viewport de hasta 600 px y 1024 por encima; los cuatro mapas están embebidos en ese archivo.
La descarga conserva materiales PBR estándar; el visor aplica bandas de luz y contorno a las mismas mallas.
No incluye ese shader ni clips dentro del GLB.

La animación de demostración usa el rig del GLB. El gate de integración verificará la animación de juego,
contornos, destellos, retratos y despiece. La v1 tiene topología implícita y UV cilíndrica; la v2 tiene
anillos/parches y nueve regiones UV corporales. La v2 usa pivotes propios de antebrazo: conservar el bind
o adaptar explícitamente al rig de juego. Refinamiento artístico, anatomía fina, atlas final y ajuste de ropa base
siguen en P02. La v3 añade dedos estáticos sin rig ni agarre propio y una guía alpha que se usa como
referencia artística; los mapas del modelo siguen procedurales. El vestuario del explorador corresponde a P04.

## Verificación

```powershell
node tools/characters-base-v0/generate.mjs --check
node tools/characters-base-v1/generate.mjs --check
node tools/characters-base-v2/generate.mjs --check
node tools/characters-base-v3/generate.mjs --check
node tools/characters-base-v3/audit-poses.mjs
node tools/character-lab/qa-v3.mjs
```

Las comprobaciones v1/v2/v3 verifican fuentes, hashes, reconstrucción, continuidad del cuerpo, normales,
índices, UV, matrices bind, pesos y mapas PNG sin escribir. La regeneración explícita usa `--force`.
El QA usa Chrome headless con WebGL de software y Playwright existente en
`.scratch/pilot-browser/node_modules/playwright/`; `MN_PLAYWRIGHT` puede indicar otra instalación.
Con otro puerto, indicar `MN_CHARACTER_LAB_URL`. Guarda capturas/evidencia en
`docs/art/characters-base-v3/`. Los QA v2/v1/v0 mantienen sus recorridos explícitos.
Estas comprobaciones no miden FPS en teléfono físico ni ejecutan la partida.
