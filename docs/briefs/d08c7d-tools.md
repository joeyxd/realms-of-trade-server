# D08c.7d — herramientas y minería

Fecha: 2026-10-08. **Implementado y verificado localmente: alpha.16/protocolo 32.**
El autor aprueba comenzar por herramientas fabricables y minería. Se entrega la base clásica
por pulsación F/touch; mantener y el bonus opcional de timing siguen como siguiente corte.
La hacha contextual de D08c.7c ahora requiere propiedad fabricada y guardada. Integra el terreno
S21 actual, sin modificarlo. [Entrega, evidencia y límites](../delivery/d08c7d-tools.md).

## Loop entregado

1. Recoger troncos sueltos y piedras pequeñas a mano; preparar madera en el banco actual.
2. Fabricar hacha de piedra (1 madera + 1 piedra) o pico de piedra (1 madera + 2 piedras).
   Son costes iniciales para verificar el loop, no balance aceptado. Ambos caben en mochila
   de volumen 10; ningún ingrediente exige la herramienta que se está fabricando.
3. Hacha para las 96 palmeras interactivas; pico para 24 rocas grandes y 6 vetas. Conservar la
   recogida manual de piedras pequeñas y troncos para no bloquear a un personaje sin herramientas.
4. Selección contextual de la herramienta que se posee al interactuar, conservando el arma
   de combate equipada. Dos ranuras fijas de cinturón (`axe`, `pickaxe`, tier 0/1), una de cada
   herramienta, guardadas con el personaje. No ocupan volumen de mochila ni son comerciables;
   costes materiales y límites representados antes de añadir herramientas transferibles/acumulables.
5. Materiales hacia balsa, talleres y obras. Herramientas mejores y metalurgia se conectan
   después al aprendizaje/desarrollo de pueblos; mineral abundante conserva la especialidad
   propuesta de Bahía Ceniza. Las vetas iniciales dan `mineral_hierro` bruto, distinto del `hierro`
   existente. Sin receta de fundición ni stock nuevo en los mercados.

## Siguiente interacción propuesta, aún no implementada

Un botón de trabajo con golpes normales y feedback de impacto, sin pantalla aparte. Una señal
breve en el recurso indica el momento de golpe potente. Acertar añade progreso al nodo, sin
multiplicar materiales ni cobrar otro golpe; fallar realiza un golpe normal. Opción de pulsar
una vez por golpe y de mantener para trabajo normal, tanto en PC como touch.

Primero entregar herramientas, selección, rocas y cadena guardada; luego el bonus opcional
como corte de interacción propio. El timing se valida con reloj y estado del servidor, no con
un `perfect: true` del cliente. Concretar tolerancia a RTT y accesibilidad antes de implementarlo.
No exigir precisión para obtener recursos básicos ni introducir una penalización de botín.
Durabilidad, reparación y calidad de herramienta quedan para una decisión posterior; no asumir
rotura como coste oculto en este primer loop.

## Autoridad y conservación implementadas

- Catálogo cerrado de herramientas/recetas, defaults y saneado de partidas antiguas. No añadir
  las herramientas a los slots de armas, cuyos kits/loadouts y estadísticas son de combate.
- Fabricar consume insumos y concede la herramienta en un solo commit de perfil, revisión de
  comercio, preflight de guardado y recibo. Replay exacto no consume de nuevo; otro request
  con ese ID se rechaza. Fabricar una herramienta ya poseída no destruye insumos.
- Harvesting comprueba herramienta desde el perfil del servidor, recurso actual, vida,
  calma, tierra, distancia, cooldown, revisión y espacio para el rendimiento final. Progreso
  compartido del nodo se actualiza únicamente después de validaciones/preflight.
- Roca/mineral requieren estado de golpes y agotamiento común; no duplicar botín por carreras
  o reentrada. Perfil y herramientas guardadas, sin anunciar aún persistencia durable del bosque.
- Revisar protocolo/snapshots al ampliar tipos/estado/eventos. Mantener autoridad de agentes L02c,
  construcción, banco por tandas y navegación; no tocar SQL ni publicar como parte de este brief.

## Reutilización auditada

Fuentes Unreal verificadas de solo lectura:

- Dreamrise_SMSK `Assets/Meshes/SM_StoneHatchet.uasset`, **199214 bytes**, en
  `C:/Unreal/survival project/SimpleMultiplayerSurvival/Content/Dreamrise_SMSK/`.
  Es el candidato semántico para hacha; exportación, dependencias/materiales y ajuste de estilo
  siguen sin verificar. No importarlo sin preview y presupuesto móvil.
- `SM_Rock.uasset`, **22059 bytes**, ya convertido en S02; runtime
  `assets/models/coast-rock-v1.glb`, **7964 bytes/64 triángulos**. Reutilizar geometría pintada
  y variantes para roca grande; vetas necesitan distinguirse visualmente sin confundir decorado.
- ActionRPG `SK_Axe.uasset`, **745285 bytes**, candidato esquelético con dependencias de
  skeleton/physics/equipamiento; no preferido para un utensilio compacto de recolección.
- No se encontró candidato inequívoco de pico/veta por nombre en el inventario revisado.
  El hacha de primitivas actual en `src/render/harvestPose.js` permite un fallback coherente;
  un pico simple puede extender ese lenguaje si la exportación Unreal no encaja.

Decisión de este corte: reutilizar S02 para roca/veta y el hacha nativa contextual; pico nativo
de piedra compatible. No importar el candidato Unreal sin exportación/preview. La minería añade
colores/grietas con geometría compartida y partículas existentes; no añade texturas.

Informes existentes: [S02](visual-s02-coast-rocks.md),
[fuente de roca](../art/source/coast-rock-v1/SM_Rock.unreal-report.json),
[survival](../research/unreal-assets/survival/FINDINGS.md). No fuentes modificadas, assets
generados, proveedor ejecutado ni texturas nuevas durante esta revisión.

## Verificación realizada

Bootstrap desde mochila vacía, fabricación/débito/guardado/reentrada, acceso sin herramienta,
herramienta incorrecta, carreras, replays, revisión vieja, mochila llena, preflight false/throw,
partidas antiguas y progreso compartido de roca/mineral. PC/touch/retrato y capturas inspeccionadas;
comandos y resultados exactos en la entrega.
Bonus de timing requiere además tolerancia de red y ruta normal accesible; no dar por medidos
FPS ni sensaciones del dispositivo físico con esos recorridos.
