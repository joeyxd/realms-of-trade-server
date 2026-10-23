# D08c.8 — masa, volumen y porte de la balsa

Fecha: 2026-10-07. Implementación local `0.6.0-alpha.8`, protocolo **23**.
Contrato: [brief](../briefs/d08c8-raft-capacity.md). Continúa recolección/crafting D08c.7.
Sin commit/push, actualización de demo pública ni aplicación de SQL en este corte.

## Comportamiento

Cada bien distingue masa uM de volumen uV, unidades abstractas de juego. El volumen conserva
exactamente el espacio anterior; guardados mantienen ids/conteos/capacidad. `w` permanece
como alias legacy, mientras economía y pilotaje calculan masa desde `mass`/`holdMass`.
Se corrige la divergencia previa entre peso económico y peso del rig.

| Bien | Masa uM por unidad | Volumen uV por unidad |
| --- | ---: | ---: |
| Piedra | 4 | 2 |
| Hierro | 6 | 3 |
| Lona | 1 | 2 |
| Balas | 5 | 3 |
| Tabaco | 0.5 | 1 |
| Seda | 0.25 | 1 |

Los otros bienes conservan masa igual al antiguo `w`. Son densidades iniciales para
calibración, no balance aceptado. El espacio sigue limitando transferencias y recetas;
este corte no añade rechazos por masa ni elimina mercancías anteriores.

La bodega muestra porte nominal y volumen libres, masa de nave equipada/bodega/mochila
y dimensiones de cada mercancía. La transferencia anticipa el espacio resultante y
conserva masa total. El editor compara estado confirmado con una colocación prevista:
consume materiales en copias, suma masa de la pieza y cambia volumen disponible según
módulos. Una caja aporta espacio y pesa; solo los cimientos actuales aportan flotación.
El HUD naval reutiliza la lectura de carga para mostrar porte restante/exceso.
Se desactiva el seguimiento del apuntado de combate mientras está abierto el editor:
la cámara sigue al personaje sin desplazar la rejilla hacia el cursor de construcción.

## Autoridad y alcance

La lectura es privada para cada dueño, con identidad de nave y revisiones de plano/comercio.
No incorpora identidades/conteos de mercancías en registros públicos de balsas. Cliente
acepta capacidad únicamente con un snapshot válido y descarta ticks antiguos o relojes
navales incoherentes. Bodega/editor esperan revisiones coincidentes antes de etiquetar
una lectura como confirmada. El servidor conserva validación final de construcción y carga.

Durante navegación la masa/flotación procede del rig operativo autoritativo, incluido daño
de sesión. En tierra durante un viaje se anticipa reembarcar con las piezas sobrevivientes
y mochila actual del dueño. Perder flotación reduce porte sin borrar la mercancía.

El porte de esta entrega es **nominal por flotación existente**:
`libre = max(0, flotación − masa equipada − masa de carga)`; el exceso se muestra aparte.
No completa la fórmula aprobada de estructura/desplazamiento seguro. Siguen límites por
material/refuerzo, reserva y umbrales, masa corporal de piloto/tripulantes, mochilas de invitados
y distribución de contenido entre módulos de bodega. Esas masas deben incorporarse también
al manejo antes de presentarlas como capacidad. La colocación prevista no garantiza soporte,
ocupantes ni aceptación final; el retiro no anticipa su reparto de materiales devueltos.

## Reutilización y coste

Auditoría Luna acotada sobre [D06 reuse](../research/unreal-assets/D06-REUSE.md) y
[D08 reuse](../research/unreal-assets/D08-REUSE.md): caja Dreamrise ya integrada,
51,684 B y 204 triángulos. Candidatos ActionRPG `T_Mat1Image`/Sword/HPBottle son uasset
sin export visual pertinente para esta lectura. Se reutilizan UI/CSS/modelos actuales:
cero texturas nuevas y fuentes `C:\Unreal` intactas.

## Verificación

**208/208 pruebas focales**, sin fallos/skips: economía/bodega/editor/guardado/producción,
recursos integrados, navegación/crew/touch/HUD y gates de perlas; incluye nueve pruebas nuevas
de capacidad. Demuestran igual volumen con distinta masa, conservación en transferencias,
cajas frente a flotación, guardados anteriores sobre capacidad, privacidad/revisiones,
montaje real con rig coincidente y mercancía excesiva que sigue guardada/navegable.
Daño letal de un cimiento se verifica en el cuerpo de navegación ordinaria: menor flotación
y carga conservada. No es una suite completa de todo el checkout ni aceptación de balance.

Logs locales: `.scratch/d08c8-baseline-tests.log` (75), `.scratch/d08c8-naval-tests.log` (52),
`.scratch/d08c8-boundary-tests.log` (73), `.scratch/d08c8-hud-tests.log` (8).
La prueba del HUD rechaza capacidad retenida cuando avanza plano/inventario o cambia modo;
solo publica lectura al coincidir identidad/revisiones. Syntax y diff-check focal pasan. Build de artefacto
local genera página de **155,619 B UTF-8** con **267 módulos/assets**, incluidos los dos módulos
de capacidad nuevos. El campo `bytes` del builder cuenta 155,599 caracteres; el tamaño de archivo
se mide aparte. El artefacto recoge el checkout compartido, no constituye un paquete de release
aislado ni una publicación.

**3/3 recorridos finales de navegador emulado pasan**, Chrome normal, calidad Baja,
sin forzar SwiftShader, modificar heartbeat ni relajar guardas de producción. Cero errores de página
o consola en cada vista. Se guardan 12 capturas; el principal inspeccionó las nueve de
bodega/editor/HUD correspondientes a las tres vistas.

| Vista | Interacción comprobada | Evidencia visual |
| --- | --- | --- |
| PC 1280×720 | H/B, pointerdown sobre celda, F en timón | [Bodega](d08c8-raft-capacity/capacity-desktop-1280x720-01-cargo-panel.png), [preview](d08c8-raft-capacity/capacity-desktop-1280x720-02-editor-capacity-preview.png), [HUD](d08c8-raft-capacity/capacity-desktop-1280x720-03-sailing-capacity-hud.png) |
| Móvil 844×390 | Celda con toque y Colocar; botón Pilotar | [Bodega](d08c8-raft-capacity/capacity-mobile-844x390-01-cargo-panel.png), [preview](d08c8-raft-capacity/capacity-mobile-844x390-02-editor-capacity-preview.png), [HUD](d08c8-raft-capacity/capacity-mobile-844x390-03-sailing-capacity-hud.png) |
| Vertical 390×844, stage rotado | Mismo recorrido táctil y reentrada | [Bodega](d08c8-raft-capacity/capacity-portrait-390x844-01-cargo-panel.png), [preview](d08c8-raft-capacity/capacity-portrait-390x844-02-editor-capacity-preview.png), [HUD](d08c8-raft-capacity/capacity-portrait-390x844-03-sailing-capacity-hud.png) |

[JSON consolidado](d08c8-raft-capacity/raft-capacity-evidence.json) y runner
`tools/qa-raft-capacity.mjs`. La transferencia de un hierro cambia mochila→bodega y conserva
masa total: hierro 6 uM/3 uV. Colocar una barandilla consume una madera de 3 uM y añade una
pieza de 1 uM; porte libre previsto **25→27 uM** coincide con lectura confirmada. Reentrada
con el save firmado conserva plano, mochila, bodega y oro. Montaje real confirma el mismo
rig/porte en HUD: PC muestra además 3/6 uV de bodega; touch reutiliza su etiqueta de objetivo
para indicar 27.0 uM libres. El cuerpo navega en las pruebas automáticas; este recorrido de
navegador confirma montaje/lectura, no un viaje largo ni sensaciones a 60 FPS.

Fixture declarada: un host memory de loopback y contexto limpio por vista, semilla `GAME.seed`,
sin `.env`, SQL, cuentas reales o almacenamiento externo. Se añaden hierro/lona/madera: una
unidad de cada uno a mochila, 8 uV/10 uM en total, conservando oro. Son insumos de QA;
este recorrido no los gana mediante harvesting ni acepta una nueva receta. Se reubica al
jugador en un helm real, se espera calma y se encuadra la cámara tras la reubicación. Objetivo
del editor proviene de hit-test real, sin inyectar target, comando o confirmación. El encuadre
de fixture no prueba el seguimiento natural de cámara durante una travesía.

`previousAttempts` distingue los intentos previos de la aceptación final: cámara de combate
que desplazaba el objetivo de construcción (corregida en producción), semilla diferente entre
host de QA y mapa cliente (fixture corregida; guarda de costa intacta) y lectura del HUD antes
de renderizar el snapshot confirmado. Otras esperas/parsers del runner se ajustaron a calma,
revisiones y controles reales; no se relajan reglas del servidor para obtener aceptación.

## Continuidad

La lectura común permite definir upgrades y límites operativos con consecuencias visibles
antes de gastar materiales. El siguiente corte debe aplicar estructura/refuerzos y reserva
con un conjunto pequeño de barcos comparables, conservando planos/bienes antiguos y
explicando la restricción antes de cargar/zarpar. Tiers/recetas regionales y crafting de barco
siguen después. Pérdidas/recuperación durables continúan detrás de D09; rutas/encuentros detrás
de D10. Dispositivo físico/FPS, balance del autor y publicación mantienen sus puertas.
