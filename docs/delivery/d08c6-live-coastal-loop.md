# D08c.6 — navegación en la partida y circuito costero

2026-10-07. Implementación local sobre el checkout compartido, base `126a543`,
**0.6.0-alpha.6 / protocolo 21**. [Contrato](../briefs/d08c6-live-coastal-loop.md).
Esta entrega conecta la navegación aceptada de los ensayos con la partida ordinaria;
no publica la demo ni aplica migraciones de Supabase.

## Recorrido disponible

La balsa propia de Aldea tiene un puesto fijo de mando sobre un cimiento libre. Se llega por
la pasarela y se toma el timón. La partida usa el cuerpo naval autoritativo con aceleración,
freno, giro, viento, corrientes y captura de ráfaga por timing. Mochila y bodega aportan peso
real y distribución; no se añaden mercancías ni lastre de prueba.

Puedes soltar el timón para caminar por la cubierta y retomarlo cerca de la palanca. Al frenar
junto a una costa seca y transitable, desembarcar estaciona la misma nave. El personaje vuelve
a la locomoción/combatir en tierra, mientras la balsa queda en su posición. Reembarcar exige estar
cerca del lugar de desembarco y del casco; renueva los epochs de control y actualiza el peso de
la mochila desde el servidor. Volver despacio al amarre permite atracar y cerrar la travesía.
La guía del HUD señala costa, puerto o punto de reembarque según la fase.

No se exige una velocidad mínima ni visitar un punto para volver a puerto. La marca de circuito
recorrido sirve de guía y confirmación de sesión; no concede oro, XP ni recompensas ficticias.

## Presentación y controles

Se reutilizan material de balsa, timón articulado, vela/vergas/cabos, CharacterView, cámara
de persecución, audio naval, espuma/estela/spray y líneas de velocidad. Los módulos pasan a
`src/render/naval`, `src/audio/naval` y `src/ui`; los ensayos conservan adaptadores a esas mismas
fuentes. La partida no importa módulos runtime desde `tools`.

El piloto usa ambas manos para agarrar la palanca y guarda el arma mientras la controla;
al caminar recupera su arma y animación normal. Los agarres usan la misma pose interpolada
que casco y personaje. La cámara cercana conserva casco/vela/timón visibles: la transparencia
de obstáculos de la isla se desactiva durante la vista naval y vuelve al desembarcar.

HUD de travesía con velocidad medida, integridad del casco, viento/ventana de ráfaga, carga,
corriente, rumbo y distancia. Los avisos de navegación sustituyen el prompt duplicado de los pies;
el tutorial terrestre queda oculto a bordo. La vida del personaje se separa del HUD naval.
La distancia al reembarque se calcula desde el personaje en tierra.

| Acción | Escritorio | Móvil |
|---|---|---|
| Tomar timón / reembarcar | F cerca del puesto o desembarco | Botón del aviso |
| Acelerar / frenar / girar | W / S / A-D; también flechas | Stick izquierdo |
| Capturar la ráfaga | Q en la ventana del viento | Ráfaga |
| Timón ↔ caminar | E; volver exige proximidad al puesto | Caminar / Timón |
| Desembarcar / atracar | G cuando sea seguro | Acción contextual |
| Recuperar nave estacionada desde puerto | G cerca del muelle | Botón del aviso |
| Cámara | Ratón / controles existentes, Centrar | Stick derecho, Centrar |

Los controles táctiles reutilizan círculos translúcidos e iconos vectoriales; los contactos se
neutralizan al soltar/cancelar/ocultar/salir. Pausa, chat y entrada deshabilitada envían controles
neutros. El perfil móvil carga albedo WebP de 512 px, sin normal de balsa; escritorio usa 1024 px
y normal existente. No hay nuevos modelos o texturas descargables de esta entrega.

## Autoridad, bienes y recuperación

Worker, fallback en proceso y host ordinario usan el mismo LocalServer. Dueño, soporte de cubierta,
proximidad, secuencias y epochs se validan en el servidor; observadores reciben pose, tripulación
y daño modular públicos. Las reservas M5 bloquean tick y comandos navales; los heartbeats leen
solo el último estado aplicado. Cambiar de modo descarta comandos terrestres/navales pendientes.

El contacto rápido con costa/muelle/borde aplica rebote/deslizamiento y HP localizado por pieza,
separado del plano guardado. Daño y pose marítima son **de sesión**. Muerte, desconexión, pérdida
de soporte o flotación recuperan nave en su amarre y rescatan ocupantes, conservando plano/bodega.
No se guardan coordenadas en mar, no se conceden piezas de reparación ni se duplica carga.
El presupuesto actual admite hasta cuatro cuerpos navales activos y tres pasajeros consentidos
por nave; no es aceptación de escalabilidad MMO ni de combate entre barcos.

Construir, producir o transferir bodega se bloquea mientras la travesía está abierta, incluso con
el propietario en tierra. Recoger cosas en la mochila durante la exploración es compatible con
el peso refrescado al reembarcar. La bodega sigue sellada. Jettison real, pérdidas/reparación
permanentes y custodia naval quedan detrás de D09; el botón de lastre del laboratorio no aparece
en la partida.

## Reutilización

Se revisó [D08-REUSE](../research/unreal-assets/D08-REUSE.md) y el cruce de recursos
[D08c.5](../briefs/d08c5-helm-touch.md). Los Blueprints de navegación/agua de Unreal no sustituyen
la simulación Node ni la reconciliación web. Atlas/rig/geometry/caja existentes resuelven este
corte; `C:\Unreal` permanece intacto. Luna cubrió cuerpo/carga, lifecycle costero y controles/vista;
el principal integró entrypoints, revisó presentación y reunió la aceptación.

## Interfaz móvil de referencia

El ajuste solicitado por el autor está integrado en la partida ordinaria. A la izquierda hay
un timón de ocho radios sobre el stick de movimiento; a la derecha, un dial con aro de fuego
y tres acciones circulares alrededor. Debajo queda el stick compacto de cámara. Casco, carga,
velocidad, ventana de ráfaga y dirección al destino leen el estado actual de la nave. La rosa
de brújula gira con el rumbo; no muestra enemigos inventados ni un encuentro de persecución.
La velocidad conserva `u/s`, la unidad de la simulación actual.

Mantener un botón **500 ms** abre «Elegir habilidad». Soltar no ejecuta la acción previa ni
selecciona por accidente una opción bajo el dedo; arrastrar más de 10 px cancela la pulsación.
La selección se guarda localmente en `mn:naval-touch-loadout:v1`. Las preferencias se separan
de los botones temporales: un catálogo vacío o una estancia en tierra no borra la configuración.
Cambiar una disponibilidad o un texto conserva el selector abierto; cambiar las acciones
estructuralmente, pausar, ocultar o salir neutraliza punteros y controles.

El catálogo ofrece ráfaga, mochila, cubierta/timón, centrar, mapa y la operación costera realmente
admitida (p. ej. amarrar). Mochila y mapa abren sus paneles existentes. Una acción en enfriamiento
puede reasignarse pero no lanzarse. El laboratorio conserva por defecto sus controles anteriores.
Dial, timón e iconos son SVG/CSS reutilizados: **cero texturas o requests de arte nuevos**. No se
exportaron paquetes Unreal para este UI. Los adornos navales solo aparecen a bordo para conservar
la interfaz normal de tierra al salir.

Aceptación de esta ampliación: **43/43 pruebas pertinentes**, incluyendo la separación de sticks,
pulsación larga, click de compatibilidad, catálogo cambiante, bloqueo de un fallback distinto
bajo el dedo, persistencia y circuito costero
autoritativo. [Salida focal](d08c6-live-coastal-loop/reference-regression.txt).
La matriz de navegador aprobó **3/3**: 844×390 horizontal, 390×844 rotado y 1280×800 escritorio.
Se verificaron rebind por touch, movimiento y cámara simultáneos, cancelación/pausa/visibilidad,
controles de al menos 44 px, ajustes 44×44, ausencia de desbordamiento y errores de consola.
[Evidencia](d08c6-live-coastal-loop/reference-ui-evidence.json),
[UI horizontal](d08c6-live-coastal-loop/reference-landscape-844x390-reference.png),
[selector](d08c6-live-coastal-loop/reference-landscape-844x390-picker.png),
[portrait](d08c6-live-coastal-loop/reference-portrait-390x844-touch-accepted.png).
El principal inspeccionó las capturas; SwiftShader y móvil emulado no acreditan FPS en teléfono.

Una comprobación adicional horizontal verificó el ciclo de interfaz: antes de embarcar se ocultan
los adornos navales y la bolsa normal sigue disponible; después, el comando autoritativo `Amarrar`
cierra la travesía y devuelve el HUD de tierra. [Evidencia del ciclo](d08c6-live-coastal-loop/reference-ui-lifecycle-evidence.json).
Este recorrido acotado no sustituye la matriz completa de cinco recorridos costeros indicada abajo.

### Pulido compacto del HUD móvil

La revisión posterior reduce el timón de 144 a 108 px (100 px en container estrecho) y el grupo
derecho de 236×222 a 188×182 px (178×174 en estrecho). Las tres acciones miden 50 px y el stick
de cámara 52 px; los hit targets conservan al menos 44 px y no se solapan. El selector de
pulsación larga y las preferencias locales mantienen su comportamiento.

El viento deja el panel superior: ráfagas vectoriales, porcentaje grande y dirección relativa
al rumbo aparecen junto a la brújula, sobre fondo transparente. Conserva la ventana de captura
y el aviso temporal con los datos vivos de la navegación. El casco se integra debajo de las
barras del personaje: línea de HP, valor actual/máximo y rojo en peligro. La fila se oculta en
tierra y se retira al desmontar la vista. El antiguo encabezado de casco/viento se oculta solo
en móvil. Reutilización: SVG/CSS existentes, cero texturas o exportaciones Unreal nuevas.

Regresión de interacción actual: **13/13**, [salida](d08c6-live-coastal-loop/compact-regression.txt).
Sintaxis y generación del artefacto local verificadas. Matriz compacta de navegador **3/3**:
844×390 horizontal, 390×844 rotado y 640×360. Se comprobaron porcentaje/HP vivos, viento
transparente, ventana temporal, controles sin solapes y de al menos 44 px, rebind, ambos sticks,
cancelación/visibilidad/pausa y ocultación del casco antes de embarcar y después de amarrar.
El espacio entre casco y objetivo es 13 px en horizontal/rotado y 5 px en 640×360.
[Evidencia compacta](d08c6-live-coastal-loop/compact-ui-evidence.json),
[horizontal](d08c6-live-coastal-loop/compact-landscape-844x390-reference.png),
[rotado](d08c6-live-coastal-loop/compact-portrait-390x844-reference.png),
[640×360](d08c6-live-coastal-loop/compact-container-640x360-reference.png).
El principal inspeccionó las capturas, incluida la vuelta al HUD terrestre al amarrar.
Ejecutar con `MN_NAV_COMPACT_UI_ONLY=1 node tools/qa-nav-reference.mjs` (en PowerShell,
asignar primero `$env:MN_NAV_COMPACT_UI_ONLY='1'`). Esta evidencia se conserva separada de la
matriz histórica de referencia. Los recorridos costeros completos y el playtest en dispositivo
siguen con el estado indicado abajo; la emulación no acredita FPS físicos.

### Arco de acciones y acceso al chat

El ajuste siguiente baja el timón 8 px hasta el margen seguro inferior. El acceso cerrado a
chat sube por encima del timón, con área táctil de 44 px de alto; abrirlo conserva la posición
del panel adaptada a pantallas cortas. Las tres habilidades siguen un arco de radio común
alrededor del velocímetro, con intervalos de 35° y la misma separación entre círculos. El radio
se reduce de 96 a 90 px en container estrecho; conserva los botones de 50 px y el stick de 52 px.
SVG/CSS existentes, sin arte adicional ni cambios de simulación o protocolo.

Aceptación posterior al último ajuste: **3/3** vistas emuladas (844×390, 390×844 rotado y
640×360). Órbita medida 96/96/90 px, con menos de 0,03 px de diferencia entre radios de las
tres acciones. Launcher de chat sin solape con timón, rótulo o flechas; conserva al menos
6 px hasta el adorno más cercano en la vista horizontal/rotada. Panel y compositor visibles
con opacidad 1 dentro del viewport; cerrar devuelve los controles. Pulsación larga, rebind,
ambos sticks, pausa/cancelación/visibilidad y ciclo de amarre también pasaron, sin errores.
[Evidencia del arco/chat](d08c6-live-coastal-loop/arc-ui-evidence.json),
[horizontal](d08c6-live-coastal-loop/arc-landscape-844x390-reference.png),
[640×360](d08c6-live-coastal-loop/arc-container-640x360-reference.png),
[chat abierto](d08c6-live-coastal-loop/arc-landscape-844x390-chat-open.png).
Capturas finales inspeccionadas por el principal; artefacto local generado. Repetir con
`$env:MN_NAV_ARC_UI_ONLY='1'; node tools/qa-nav-reference.mjs` en PowerShell.
El runner espera que termine la animación del chat antes de comprobar su visibilidad y mide
los controles circulares como círculos. Las pruebas y capturas compactas anteriores se conservan.

La pregunta del autor sobre porte/materiales se registra en
[NAVAL-ROADMAP §2.1](../NAVAL-ROADMAP.md#21-porte-y-mejoras-del-barco--revisión-2026-10-07).
Es propuesta para la entrega de carga: separar masa de volumen, descontar peso de la casa/nave
equipada y tripulación, y exigir mejoras físicas para aumentar porte. La capacidad abstracta
de bodega y las penalizaciones por peso ya existen; límites estructurales/tiers y bloqueo por
peso no están implementados por este ajuste visual.

## Verificación

Regresión completa del checkout compartido antes de la ampliación del UI móvil: **1714/1714**, cero fallos, salida 0, ejecutada con
`node --test --test-concurrency=2 tests/*.test.mjs`, sin force-exit.
[Salida](d08c6-live-coastal-loop/regression.txt). Se incluyen los cambios paralelos de chat/arte/M5;
el conteo no acredita publicación ni una migración aplicada en Supabase.

Las pruebas propias cubren clientes/host ordinarios, observador, privacidad/custodia, pausas y
reservas M5, soporte/epochs, caminar/retomar, desembarco/reembarque, recuperación y conservación.
La aceptación del mapa real lleva la balsa desde el amarre hacia la costa, frena a unos 21 m
del puerto, encuentra suelo seco real, desembarca, espera 60 ticks estacionada y reembarca.
No sustituye `groundAt`/`onDock` ni teletransporta la nave. La fuente de plano/bodega queda intacta.

Revisión de navegador: pendiente de cierre de los cinco recorridos y sus capturas actuales.
El harness [qa-live-navigation.mjs](../../tools/qa-live-navigation.mjs) levanta solo un host de memoria
en puerto efímero, sin `.env`, sin Supabase ni tráfico a la demo. Dispositivos/FPS físicos,
audio oído, sensaciones y balance quedan para el playtest del autor.

## Continuación

Siguiente rebanada del loop: nodos de madera/piedra con los recursos visuales ya disponibles,
recolección autoritativa → materiales/crafting → ampliación de la balsa en puerto. Después,
D10 delimita encuentro NPC/rutas; D09 habilita custodia/pérdidas/reparación persistentes.
P4 agua/hamaca/luces y P5/P6 completos permanecen abiertos. El artefacto local se genera con
`node tools/build-artifact.mjs .scratch/d08c6-artifact.html`; cliente y servidor deben actualizarse
juntos por protocolo 21 al publicar la entrega.
