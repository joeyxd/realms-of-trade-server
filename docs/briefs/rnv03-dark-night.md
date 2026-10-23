# RNV03 — noche oscura y farol portátil

Corte AREA07 posterior a RNV02. Implementación alpha.28/protocolo 40; aceptación y publicación
se registran en [la entrega](../delivery/rnv03-dark-night.md). La noche sin fuentes de luz debe ser
casi negra también en calidad baja; la interfaz conserva su contraste y sus controles.

## Comportamiento

- La partida usa la hora compartida del mundo. Se elimina el selector día/noche del menú; una
  preferencia antigua o `?tod=day` no cambia la iluminación de una sesión jugable. Presets de título
  y editor/captura quedan fuera de la partida. Amanecer y atardecer conservan transición gradual.
- Se retiran la luz automática del jugador, el relleno de cámara y el contorno luminoso nocturno.
  El agua tampoco revela el terreno por iluminación propia. Fogatas, faroles, ventanas y lava
  existentes siguen siendo referencias localizadas; La Caldera no repone relleno global de noche.
- Cada jugador humano conectado dispone de un **farol básico de cinturón**, parte del equipo inicial.
  **N o el botón Farol/Lantern** lo encienden/apagan. Empieza apagado en cada sesión, se apaga al
  morir y requiere encenderse otra vez tras revivir. Funciona a pie, en cubierta y al timón.
- El farol inicial es un servicio ligado al personaje, sin valor comercial, grant de materiales,
  ranura de inventario ni duplicación de objetos. Este corte no añade combustible/duración/coste.
  Esos límites y mejoras pertenecen al balance posterior; el farol naval sigue costando sus materiales.
- Otros personajes ven el farol y aprovechan su luz. El estado se confirma en el servidor; no se
  ilumina provisionalmente una acción rechazada. No modifica combate, detección o percepción NPC.

## Autoridad y continuidad

`personalLantern` es un comando explícito con booleano deseado y `opId`. La autoridad deriva el
personaje de la conexión; rechaza formas desconocidas, NPCs/bots y personajes muertos. Pasa por
los gates de sesión/pausa/tick/M5 existentes. Recibos de sesión acotados suprimen el reenvío exacto;
el mismo identificador con otro contenido se rechaza. ACK privado y bit público en tuple `ENT.LANTERN`.
Snapshots del mismo tick pueden corregir el interruptor; snapshots antiguos no restauran una luz.

El interruptor portátil es **estado de sesión**: no se escribe un campo de perfil ni se crea un
writer/SQL/ledger. Salida, muerte y reentrada apagan el servicio. RNV02 conserva su guardado CAS
por instancia de farol naval sin cambios; este corte no amplía su garantía de crash/guardado.
El transporte administrado de agentes sigue rechazando comandos genéricos: habilitar su interruptor
requiere un corte propio de capacidades/runner AREA17; este cambio no amplía sus permisos.

## Render y móvil

Farol procedural con jaula abierta y núcleo cálido. Fuente y modelo comparten anclaje girado del
cinturón y siguen la pose renderizada, incluida cubierta móvil. Uniforms existentes, presupuestos
4/8/12 luces; la luz propia tiene prioridad y alcance idéntico en cada calidad. Cero nuevas luces
Three.js, texturas o dependencias. El botón conserva un objetivo de 48 px y no sustituye habilidades
ni interacción contextual V/F. UI y mapa permanecen legibles cuando el entorno se oscurece.

Las luces locales actuales no proyectan sombras ni oclusión por paredes. La noche oscura es una
regla de presentación, no un sistema de visibilidad contra clientes modificados. FPS físico y
latencia WAN requieren aceptación independiente.

## Arte existente

Verificado de solo lectura `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes\SM_Torch.uasset`
(21 751 bytes); el inventario RNV02 incluye también `Blueprints/BP_Building_Torch.uasset` (35 153 bytes).
La referencia es una antorcha azul alta, sin GLB portable aprobado. Se reutiliza el lenguaje procedural
de madera/hierro del farol naval, reducido al cinturón. No se modifica/exporta la fuente Unreal.

## Aceptación

Pruebas de contrato/host/cliente, replay, muerte/reentrada sin mutación económica, reloj y prioridad
de iluminación. Navegador real PC y móvil emulado, bajo/alto: pie/costa apagado/encendido, puerto,
farol naval/interior/mar y controles. Fixtures de hora, materiales y reubicación deben declararse.
Inspeccionar capturas y verificar revisión/imagen/salud/entrada pública antes de marcar desplegado.
Después sigue agua costera y reembarque, con reglas de carga/agotamiento/rescate antes de implementarlas.
