# AREA07 — Barco hogar, navegación y vida en el mar

Plan operativo de AREA07, aprobado por el autor el 2026-10-10. La auditoría inicial se conserva como
base histórica; los checkpoints siguientes distinguen implementación, pruebas, publicación y activación.

Guía maestra local: `PLAN-MASTER.md`, sección AREA07 (compartida con las demás áreas).
[M6](../../PLAN-M6.md) · [Dirección naval](../NAVAL-ROADMAP.md) ·
[Progresión](../../PLAN-PROGRESSION.md#5-navegación-natación-y-poderes) ·
[Mundo del alfa](../../PLAN-ALFA-MUNDO.md) · [Continuidad M5](../../PLAN-M5.md).

## Checkpoint de continuidad — 2026-10-10

- **PRG02a completado:** lección voluntaria, dos boyas, maniobra y atraque real.
- **PRG02b completado y enviado:** alpha.23/protocolo 36, código `3a23f2c` e integración `4c6743b`.
  Pilotaje II se aprende una sola vez; +15 % al timón desde el siguiente embarque, conservando carga/inercia.
  Perfil común v2, CAS M5 existente y HUD local/pendiente/confirmado.
  [Entrega/evidencia](../delivery/prg02b-pilot-learning.md): 174 casos integrados, 38 de agentes, tres vistas UI;
  22 recursos/naval con solapamiento. Una caída antes de confirmar el save puede requerir repetir la lección.
- **Activación observada:** a las 19:24:26 UTC el VPS estaba sano en `29a9e46`, que contiene PRG02a/b y
  RNV01: una autoridad, imagen comprobada, página/health 200, recursos listos y cero errores/pendientes.
  Entrada real de invitado, mapa/minimapa y protocolo 37 comprobados en navegador nuevo.
- **RNV01 implementado y activo, alpha.24/protocolo 37: refugio construible.** Techo soportado y puerta real, coste/materiales/daño del catálogo,
  sin cambiar origen/amarre. Puerta sin cerradura usable por personajes cercanos desde ambos lados.
  Apertura por instancia en el perfil del dueño, colisión/predicción compartidas y techo con vista interior.
  [Contrato](rnv01-naval-refuge.md) y [entrega](../delivery/rnv01-naval-refuge.md): 516 casos tras integrar Tala,
  107 del actualizador con solapamiento y tres vistas UI. V/toque, soporte destruido, retiro/reconstrucción,
  colisión, reintentos y CAS del dueño comprobados localmente.
- **RNV02 implementado y activo:** farol utilizable, coste/soporte vivo/HP, V/toque y guardado
  del dueño. [Contrato](rnv02-naval-lantern.md) y [entrega](../delivery/rnv02-naval-lantern.md).
- **RNV03 implementado y activo:** [noche y farol portátil](../delivery/rnv03-dark-night.md), alpha.28/protocolo 40.
  650/650 en serie, 107/107 release (solapamiento), cuatro vistas de pie/puerto, cuatro navales y dos probes
  N/toque al timón/cubierta. VPS `9f23be3` sano, 107/107 imagen y entrada WSS comprobados; sigue agua costera/reembarque → provisiones/hogar.

## 1 Visión y criterio de éxito

El barco es una casa que se construye, un taller que produce y un vehículo que transporta bienes reales.
Su forma, material, distribución, carga y tripulación deben cambiar cómo navega y qué trabajo puede hacer.
La referencia Raft aporta crecimiento y vida cotidiana; la referencia del autor a Cosmoteer/Space Engineers
aporta piezas funcionales y consecuencias localizadas cuando una parte se rompe.

Una sesión completa del alfa debe permitir preparar la nave en Salty Shore, cargar provisiones/mercancía,
zarpar, resolver una situación del mar, desembarcar para trabajar o comerciar, regresar, descargar y reparar.
Al reentrar, se reconoce la misma nave con su construcción, carga y condición conservadas según el contrato
de guardado del corte. Las garantías ante caída abrupta se verifican aparte del reinicio ordenado.

La expansión conserva roles: una balsa ligera responde antes; un mercante transporta más; una casa flotante
ofrece servicios y paga su tamaño con masa, espacio y maniobra. Esta clasificación es una recomendación de
diseño, no clases obligatorias ni bonos ya aprobados. Mejor pilotaje no crea flotación ni elimina la sobrecarga.

## 2 Base exacta usada en la auditoría

- El plan maestro y las decisiones recientes se leyeron en el checkout compartido. Contiene trabajo ajeno
  sin commit y su HEAD está detrás del upstream; no se hizo pull/reset ni se publicó ese árbol.
- El código de referencia se inspeccionó en `vps-live-release`, revisión
  `ec5d054dd63a1889d5d9e34e93387b582e220785`, coincidente con el upstream consultado.
- El 2026-10-10 a las **15:53:32 UTC**, SSH y HTTP confirmaron una única autoridad VPS con esa revisión,
  contenedor saludable, página y `/health` 200, Supabase durable/cuentas activas y autoridad económica M5
  habilitada. Cero errores, pendientes o bloqueo de tick en la muestra. Fue inspección operacional;
  no se hizo un nuevo recorrido naval con navegador ni se reinició el servidor para esta auditoría.
- Pasaron **88/88 pruebas focales** sobre esa revisión: construcción, porte, reparación, conservación,
  producción, navegación integrada, cubierta y ensayo de ruta. No sustituyen balance, FPS físico ni una
  prueba naval pública prolongada.

Hay un cambio local ajeno de mochila `PACK_CAP` 10 → 20 en el checkout compartido. No pertenece a esta
revisión publicada ni a esta propuesta. Al integrarlo hay que volver a contrastar la masa llevada a bordo.

## 3 Qué funciona y dónde termina su alcance

| Frente | Implementación actual | Lo que todavía falta |
|---|---|---|
| Primera nave | Se concede una balsa inicial 2×2 con vela y caja una sola vez al migrar/crear el perfil; un estado explícitamente vacío no recibe otra | Fabricar una nave completa desde recursos, comprar otras familias y operar una flota. Los modelos clásicos del catálogo no equivalen a vehículos físicos integrados |
| Construcción | Cimientos conectados, pisos, pilares, paredes, barandillas, escaleras, caja, red y parrilla; colocación/retirada con soporte, coste, revisión y protección de ocupantes. Refuerzo de cimiento por operación propia | El catálogo define **30** tipos, pero `EDITOR_PARTS` permite **nueve**; techo, puertas/ventanas, vela adicional y muchos módulos no están habilitados como construcción ordinaria |
| Tamaño | Límite técnico de 144 cimientos, tres niveles y saneado acotado a 600 piezas; se puede cambiar la forma dentro de las reglas de soporte y amarre | Tiers de materiales y límites de diseño por competencia; presupuesto móvil medido. El límite técnico no acredita que cualquier fortaleza funcione bien en teléfono |
| Manejo | Pilotaje físico autoritativo, inercia, frenado, deriva, viento, corrientes y captura de ráfaga; carga y distribución alimentan el rig | Competencia de navegación, más propulsiones útiles, clima cambiante y maniobras nuevas por cortes. El viento base es fijo y las ráfagas están programadas por ticks |
| Tripulación | Dueño más hasta tres invitados; pasajeros caminan en cubierta relativa mientras el dueño pilota. El dueño alterna timón/cubierta | Delegar timón, permisos durables y tareas cooperativas. Pasar a cubierta no mantiene a ese dueño emitiendo controles de timón |
| Carga | Masa y volumen separados; bodega, mochila y personas cuentan; porte limitado por estructura y desplazamiento seguro; rechazo de carga/zarpe y refuerzo | Distribución individual de mercancía, reservas bancarias por puerto y expulsión real de cargamento. La transferencia mochila/bodega sí usa M5 económico |
| Daño | HP e identidad por pieza; choque costero localizado; piezas rotas dejan de aportar soporte operativo, flotación o producción. Se conserva el plano para recuperar | Tipos/arcos de daño y combate naval completo. El modelo actual no es una simulación de inundación, compartimentos ni fractura estructural compleja |
| Reparación | Materiales reales, coste por daño, reconstrucción de la misma instancia y recuperación desde el amarre | Reparación de emergencia navegando y contratos durables específicos para todo daño/reparación/pérdida ante fallos |
| Conservación | Perfil con plano, bodega, condición e identidad; última pose compatible con seed/mapa. Reentrada estacionada, reembarque costero o recuperación en puerto; la entidad sale del mundo cuando se desconecta su dueño | Presencia física de barcos aparcados sin dueño conectado, política de exposición/producción offline, custodia entre regiones/hosts, pérdidas definitivas y recuperación ante caída abrupta de todo el recorrido |
| Vida a bordo | Bodega y producción efectiva de red → pescado y parrilla → galletas, con lotes/fracciones y parada por falta de espacio/materiales | Agua, huertos, alambique, combustible, faroles, cama/hamaca funcional y servicios de hogar. Sus datos o el helper económico antiguo no equivalen a sistemas montados |
| Objetivos en el mar | Ensayo opcional: tres boyas en orden, salvas anunciadas y regreso con atraque real | Rutas útiles entre pueblos, rival móvil/vencible, armamento del jugador y recompensas/progreso durables. La amenaza actual es una batería fija |
| Natación | Salida y reembarque por costa en el circuito existente | Natación general, resistencia/rescate y después buceo. La maldición de Brasa en agua ya existe y debe revisarse explícitamente al introducir natación |
| Presentación | HUD naval, instrumentos, mapa/minimapa, cámara, audio, espuma y controles PC/touch integrados | Localizar el recorrido completo ES/EN, revisar módulos nuevos y medir dispositivos. Más luz/reflejos en calidad alta es un pase visual propio |

Fuentes de implementación:
[piezas](../../src/data/raftparts.js), [piezas habilitadas](../../src/data/raftEditor.js),
[construcción y costes](../../src/sim/systems/raftEditor.js), [rig](../../src/sim/naval/handling.js),
[pilotaje/tripulación](../../src/sim/naval/pilot.js), [capacidad](../../src/sim/economy/raftCapacity.js),
[condición](../../src/sim/naval/condition.js), [recuperación](../../src/sim/naval/recovery.js),
[producción montada](../../src/sim/systems/raftProduction.js),
[recetas de producción](../../src/sim/economy/raftProduction.js),
[ruta de prueba](../../src/sim/naval/route.js), [acciones reales del HUD](../../src/client/liveNavigationView.js).

### Dos distinciones para no rehacer ni sobreprometer

**Los botones de la referencia no acreditan habilidades reales.** La partida ofrece ráfaga, mochila,
timón/cubierta, mapa, cámara y transiciones contextuales. Expulsar carga de prueba existe en el laboratorio;
no hay una operación jugable de jettison con bienes reales y recuperación/saqueo montada en el mundo.
Ancla-drift y Hold Tight de la referencia tampoco deben darse por implementados a partir de un icono.

**M5 económico ya está integrado, con cobertura concreta.** Mercado cotizado, compra de materiales,
transferencia mochila/bodega y aportes usan perfil/mundo/recibo conjuntos. Edición, reparación, producción,
pose y daño naval tienen otras rutas de mutación/guardado. No crear otra autoridad ni asumir que SQL014
convierte automáticamente todas esas acciones en transacciones durables.
[Alcance aceptado](../delivery/m5-economic-authority.md) · [Contrato](m5-economic-authority.md).

**Guardar una nave no equivale a dejarla habitando el mundo.** `detachRafts` sincroniza el perfil,
retira la entidad y rescata a visitantes cuando sale el dueño. Para la visión de mundo continuo hasta
wipe necesitamos amarres/presencia persistentes y reglas offline explícitas. No habilitar daño/robo offline
como consecuencia accidental de conservar la nave visible.
[Ciclo de vida actual](../../src/sim/systems/rafts.js).

## 4 Secuencia aprobada

**Aprobada por el autor, 2026-10-10.** Se comienza por PRG02. Nueva regla del mundo:
[noche casi negra fuera de fuentes de luz](../NAVAL-ROADMAP.md#noche-y-fuentes-de-luz). El farol del
primer refugio debe ser funcional para explorar/navegar de noche, también en calidad baja/móvil.
La UI permanece legible; luz automática y presets cosméticos actuales deberán adaptarse en ese corte.

La orientación PRG02 del plan maestro se conserva. La secuencia está aprobada; los números de balance,
el contrato y los archivos de cada implementación se cierran antes de comenzar. PRG02a/b están completados;
RNV01 entrega techo/puerta y RNV02 completa el refugio con luz, antes de oscurecer las noches.

| Orden | Entrega | Resultado observable y dependencia |
|---|---|---|
| 1 | **PRG02: primera lección de pilotaje** | Una ida/vuelta costera con objetivo en el mundo, maniobra/atraque y una mejora perceptible de pilotaje. Reutiliza navegación existente; AREA03 comparte el contrato de aprendizaje y M5 conserva el avance. No añadir XP por mantener una tecla o navegar en círculos ni regalar una recompensa económica por el ensayo antiguo |
| 2 | **Primer refugio naval construible** | Techo y puerta interactuable, después farol; poder armar una habitación, caminar por ella y navegar sin bloquear salida ni cambiar el origen del barco. Habilitar catálogo exige colisión/interacción, coste, daño, soporte y guardado completos, además de render |
| 3 | **Agua costera y reembarque** | Entrar al agua, desplazarse y salir claramente por playa o embarcación. Corte separado de PRG02; definir agotamiento/rescate y relación con carga/Brasa, verificar predicción y servidores. Buceo va después |
| 4 | **Provisiones y servicios de hogar** | Un módulo nuevo útil, preferentemente agua por purificador, conectado a consumo/producción/carga. Luego huerto y hamaca por cortes propios; respawn requiere reglas de muerte y punto inválido. Evitar activar simultáneamente todos los datos del helper antiguo |
| 5 | **Primer viaje comercial entre puertos** | Salty Shore–Puerto Sol con llegada física, descarga y retorno; comparar camino y costa. AREA01 entrega geografía/anclas transitables y AREA08 reutiliza mercados M5. Con AREA15, definir amarres/custodia y presencia sin dueño antes de exponer bienes públicos. Después Bahía Ceniza, con necesidad marítima real |
| 6 | **Primer rival naval vencible — D10/A6** | Un barco NPC móvil con intención legible, un arma utilizable, esquiva/huida, daño a piezas y regreso a reparar. Los bienes que exponga requieren el contrato de continuidad correspondiente; no basta ampliar la batería fija |
| 7 | **Cooperación y riesgo público** | Delegación de timón/tareas, expulsión real de carga, rendición y saqueo con capacidad. PvP, patrullas y abordaje avanzan después de definir consecuencias y comprobar liquidación única |

La prioridad posterior a PRG02 puede cambiar por el resultado del prototipo. El primer refugio es la mayor
carencia visible de la promesa «barco hogar»; natación es la mayor carencia de interacción con el mar.
Ninguna requiere terminar todos los pueblos, un MMO regional o una simulación naval compleja.

### Alcance original PRG02 — completado; se conserva como contrato

Una lección costera parte del amarre actual, llega a un destino cercano identificable y vuelve a atracar.
El servidor decide qué maniobra/tramo cuenta y registra una finalización; se propone un hito inicial
acotado antes de una curva completa de XP. El beneficio de pilotaje se elige con AREA03 y se contrasta
vacío/cargado: debe notarse sin borrar diferencias de masa, inercia, flotación o diseño.

Reutilizar el modelo común de aprendizaje que se esté preparando en AREA03; no conectar la actividad
directamente a la XP de combate ni crear una segunda ficha de skills. Si ese contrato aún no está listo,
preparar objetivo/feedback del recorrido sin declarar un nivel naval permanente.

Aceptación: PC/touch, rechazo de finalización falsa o repetida, cancelación/desconexión, reentrada,
beneficio comparable, carga/daño conservados y textos ES/EN. El crédito y la conservación publicados
necesitan pruebas de su operación M5 concreta; el prototipo de recorrido no acredita esa permanencia.

### RNV02 — farol utilizable (implementado y activo)

[Contrato](rnv02-naval-lantern.md) · [entrega](../delivery/rnv02-naval-lantern.md). Integración alpha.27/protocolo 39,
sobre GM02/refugio/Tala y comercio L06b. Editor B incorpora el farol: una madera + un hierro, HP 10, masa 1 y cubierta viva.
Empieza apagado; V/toque elige el contexto cercano puerta/farol y conserva F/E/G. Y centra la cámara sin colisionar
con V ni C (ficha del personaje). Dueño/visitantes usan intención explícita con revisión/estado esperado y replay acotado;
conserva estado por ID en el perfil M5 del dueño, sin SQL ni nuevo writer. Roto deja de alumbrar; reparación pagada
requiere encender otra vez. No consume combustible. El núcleo visible en jaula abierta y fuente cálida siguen
pose/giro/nivel, con presupuesto 4/8/12 y prioridad para la nave ocupada; no reconstruye geometría al accionar.
Arte procedural existente reutilizado tras verificar antorcha Unreal concreta, distinta y aún no portable.
631/631 pruebas integradas, 107/107 release con solapamiento, cuatro vistas y probe real F/E/V aceptados;
VPS `e648d1b` sano hasta las 20:15:21 UTC, imagen 107/107 y timer activo. Entrada pública WSS,
mapa/minimapa y catálogo comprobados; evidencia/límites en entrega.

### RNV03 — noche oscura y farol portátil (implementado y activo)

[Contrato](rnv03-dark-night.md) · [entrega](../delivery/rnv03-dark-night.md), alpha.28/protocolo 40.
Noche casi negra sin fuentes, también en bajo/móvil; hora compartida obligatoria durante la partida,
sin selector cosmético ni luz automática del jugador. Farol inicial de cinturón N/toque, público y
apagado al morir/reentrar. Servicio de sesión sin objeto económico, combustible o perfil/SQL nuevo.
Usa el presupuesto existente y mantiene la luz propia; modelo/fuente siguen pose, cubierta y giro.
Costa/puerto, pie, farol naval e interior se verifican por navegador; publicación y revisión activa
se documentan en la entrega. No hay sombras/oclusión por paredes ni prueba de FPS físico.

**Sigue agua costera/reembarque:** definir primero alcance, carga, agotamiento, rescate y pérdidas;
usar la cubierta y autoridad actuales. Después provisiones/hogar.

## 5 Más allá del alfa

- **Especialización mediante construcción:** carguero, pescador/taller, explorador y escolta con ventajas
  explicables por piezas, carga y habilidades; mejoras y recetas regionales ligadas a pueblos que crecen.
- **Mar con decisiones:** corrientes conocidas, oportunidades variables, clima anunciado y rutas que
  compensen tiempo/capacidad/riesgo. Más maniobras se añaden cuando aporten una decisión y un coste reales.
- **Nave funcional por módulos:** aparejos, propulsión, armamento y servicios con daño que cambie su uso;
  reparación localizada y salvamento. Inundación/redes internas/combustible complejo son propuestas futuras,
  no requisitos de la primera balsa ni sistemas ya existentes.
- **Piratería y tripulación:** persecución, huida, negociación/rendición, patrullas y notoriedad;
  después abordaje de dos cubiertas con estado compartido. Humanos y agentes deben usar los mismos permisos.
- **Mundo continuo:** regiones compartidas con una sola autoridad por barco y transferencia segura de
  ocupantes/carga/condición. Cargar un sector conserva identidad y progreso; no crea una copia del puerto.
  El VPS actual tiene cupo de cuatro; ocho personajes/ocho balsas es una meta de aceptación posterior.
- **Tecnología:** materiales y velas mejores, motores, barcos mayores y regiones con otras tecnologías;
  aire después de demostrar construcción, logística y recuperación marítimas.

## 6 Decisiones que deben seguir abiertas

Hundimiento y pérdida de plano/piezas, protección de pertenencias domésticas, coste de rescate, captura
de barcos, legalidad de ataques, formato de abordaje, fórmulas definitivas y curva de aprendizaje.
La dirección «barco que se rompe por piezas» está acordada; sus pérdidas permanentes no se deciden
silenciosamente. Reservas seguras por puerto son dirección del producto, no un banco naval ya implementado.

## 7 Reutilización y forma de implementar

Conservar rig/contacto/condición, editor, cubierta relativa, mapas, HUD y M5 existentes. La revisión del
[inventario Unreal/FAB](../research/unreal-assets/SUMMARY.md) encuentra referencias concretas de interacción
en `Dreamrise_SMSK/Blueprints/BP_Holdable_BuildHammer` y de contenedores/crafting en
`ActionRPGStarterSystem/InventorySystem`; no identifica un kit naval/doméstico modular completo verificado.
Para esta planificación se reutiliza el runtime actual y no se exporta ni modifica ninguna fuente Unreal.
Antes de un módulo visual nuevo, revisar el candidato específico y su portabilidad, estilo y coste móvil.

Un dueño para sim/protocolo/perfil; coordinar aprendizaje con AREA03, rutas con AREA01/08 y permanencia
con AREA15. Integrar selectivamente sobre la revisión upstream vigente. El deploy continuo conserva sus
checks y espera sin jugadores; documentar cada recorrido aceptado y comprobar la revisión realmente activa.

## 8 Verificación de esta auditoría

Comando ejecutado en `vps-live-release`, resultado 88 aprobadas, cero fallos/omisiones:

```powershell
node --test tests/rafts.test.mjs tests/raft-editor.test.mjs tests/raft-capacity.test.mjs tests/raft-load-limits.test.mjs tests/raft-repair.test.mjs tests/raft-persistence.test.mjs tests/raft-production.test.mjs tests/naval-live-integration.test.mjs tests/naval-route.test.mjs tests/naval-navigation.test.mjs tests/naval-deck-walk.test.mjs
```

Se comprobó la existencia de las referencias locales de este informe y el formato del cambio documental.
No se implementó ni publicó gameplay nuevo en este análisis.
