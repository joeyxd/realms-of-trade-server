# D08 — prueba de manejo naval, carga y viento

Estado: **D08a bahía aislada implementada; aceptación visual e integración naval pendientes**.
Fecha: 2026-10-05. [Brief del corte](d08a-handling-lab.md) y [resultado](../delivery/d08a-handling-lab.md).
Este documento conserva la dirección de D08 completo; no confundir el laboratorio con navegación activa.
Continúa `docs/NAVAL-ROADMAP.md` y la prioridad del autor: una casa modular que también
sea un vehículo agradable de pilotar. No fija el formato definitivo del mar ni del abordaje.

## Base comprobada

- `src/data/raftparts.js` contiene 29 tipos de piezas. La balsa inicial tiene cuatro
  fundamentos, una vela y una caja. Las piezas ya tienen coste, peso y funciones declaradas.
- La base tiene un techo técnico de 144 fundamentos, con anchura y profundidad máximas
  de 12 casillas. Cada casilla mide 2 unidades del mundo. Hay tres niveles.
  Los pisos superiores usan soporte y voladizo: el límite de la base no limita por sí solo
  toda la envolvente superior. El editor deberá explicitar sus límites antes de permitir obras.
- `raftStats` calcula peso total, flotación y una velocidad abstracta. No representa todavía
  aceleración, giro, distribución de carga, navegación por habilidad ni viento propulsor.
- La balsa visible está amarrada. [P2](../delivery/d04p2-raft-walk.md) habilita cubierta transitable;
  [D05](d05-raft-editor.md) prepara edición
  validada por servidor; D06, bodega e interacciones. Las reservas del protocolo naval
  y la cámara naval no demuestran que ya se pueda navegar.

## Lugar en las entregas

[D04 P2, cubierta transitable](d04p2-walkable-raft.md), D05 y D06a ya están aceptados localmente.
La bahía D08a ya está implementada de forma aislada, con simulación y medidas comprobadas;
su preparación avanzó mientras la revisión automática de Chrome estaba bloqueada por límite de uso.
El siguiente corte de aceptación es cerrar móvil D06b y revisar visualmente la bahía para comparar manejo,
sin pérdidas persistentes. La persistencia D09 puede avanzar en paralelo con su dueño respectivo.
Es una prueba acotada de D08: no reemplaza las dependencias de D10 para un viaje real con
comercio, enemigos y carga persistente. No esperar a terminar PvP para evaluar el movimiento.

El prototipo usa barcos y carga de prueba. No escribir una posición de mar inválida en el
perfil ni devolver/crear mercancías de la economía real mediante reinicios del laboratorio.
Antes de exponer riesgo real, conservar la puerta de custodia y recuperación de D09/M5.

## Sensación buscada

La orden responde enseguida, pero el barco conserva masa. Una balsa ligera describe curvas
ágiles; una casa cargada necesita anticipar el giro y tarda más en frenar. Evitar deriva lateral
sin límite, detenciones instantáneas y giros sobre el sitio a velocidad máxima.

Usar un cuerpo agregado determinista: posición, rumbo, velocidad y velocidad de giro;
propulsión, arrastre y autoridad del timón. No una simulación física por tablón. La respuesta
del timón puede depender de la velocidad con ayuda limitada a baja velocidad para la balsa.

Separar tres restricciones, con explicación antes de construir o zarpar:

- **Estructura:** materiales/refuerzos determinan tamaño, altura y flotación admisibles.
- **Operación:** navegación mejora el manejo y habilita maniobras de forma acotada.
- **Rendimiento:** límites técnicos protegen cliente móvil y servidor; XP no los supera.

Un piloto experto no crea flotación ni vuelve ágil una fortaleza como una balsa vacía.
Cambiar de piloto no elimina piezas. No adoptar aún niveles, porcentajes, XP o velocidades
definitivas: se fijarán con comparaciones jugables.

## Carga y acomodo

El peso de piezas y bienes afecta aceleración, frenado, calado visual acotado y manejo.
La masa alejada del centro aumenta la resistencia al giro. El desequilibrio lateral y la
carga alta deben producir avisos y penalizaciones comprensibles, sin volcar por sorpresa.

Hoy la bodega global mezcla capacidad y peso. Para representar el acomodo real, separar
volumen de masa y asignar bienes a módulos de almacenamiento con ubicación; no fingir que
el contenido ya pertenece a cada caja. Versionar/sanear datos persistentes cuando se adopte.
El prototipo puede comparar distribuciones explícitas en fixtures antes de esa migración.

Mostrar vacío/cargado y antes/después de editar: peso/flotación, capacidad, aceleración y giro.
Probar expulsar carga de prueba para notar el cambio inmediato. En el juego definitivo debe
quitar bienes reales y producir botín o pérdida una sola vez, según la regla aprobada; sin
retorno automático a puerto ni duplicación al reconectar.

## Controles propuestos para probar

W/S/A/D, botones táctiles y mando estándar ya tienen adaptador en D08a; su aceptación por dispositivo
sigue pendiente. Los controles descritos aquí para entrar/salir del puesto y combatir son propuestas
para la integración futura, no acciones activadas en la partida.

- Interacción en el puesto de mando cambia de caminar a pilotar con estado explícito.
  Al salir se limpian entradas pendientes; el barco no se detiene por arte de magia.
- Teclado: W/S pide más o menos propulsión, A/D gobierna el timón. Evaluar esta propuesta
  contra una asistencia de rumbo antes de cerrar el esquema. S no hace retroceder una vela
  instantáneamente. Ratón/apuntado no debe arrastrar el rumbo por accidente.
- Móvil y mando: dirección/propulsión accesibles desde el control principal y botón claro
  para entrar/salir del puesto. Probar asistencia de rumbo para evitar giros bruscos del stick.
  Conservar las acciones de combate existentes fuera del contexto naval.
- Construcción: B o botón de construir; R rota únicamente dentro del editor, donde no lanza
  el arte R. Demolición explícita con devolución visible; evitar que cancelar una habilidad
  quite una pieza. Estos controles de construcción ya están activos en D05; pilotaje sigue propuesto.
- Ancla y soltar carga tendrán acciones deliberadas. Anclar no debe ser un freno instantáneo
  a cualquier velocidad. No decidir aún costes o límites definitivos de maniobras.

## Viento propuesto

Usar dirección y fuerza compartidas, derivadas de estado/semilla y ticks de simulación.
La vela obtiene empuje según su orientación respecto al viento; el viento de frente reduce
avance y permite bordear. Primera prueba con ajuste automático de vela y señal legible de
eficiencia. El ajuste manual puede evaluarse después, sin exigirlo para el primer viaje.

Cambios graduales y ráfagas anunciadas. Indicador de viento, vela y audio deben expresar
el mismo estado que usa la propulsión. Probar calma y viento contrario con ayuda limitada
de remo para la balsa; no dejar al principiante atrapado indefinidamente. El motor puede
tener empuje independiente del viento, con combustible y las mismas reglas de masa.

## Movimiento hermoso y rendimiento

Predecir localmente la orden del piloto, validar en servidor y reconciliar sin saltos
persistentes; interpolar barcos remotos. Mantener el mismo resultado a distintos FPS.
No ocultar respuesta tardía del control detrás de una cámara excesivamente amortiguada.

Cuando la cubierta se mueva, representar al caminante respecto al barco en autoridad y
predicción. Balanceo visual acotado y separado de la superficie de colisión, sin sacudir al
personaje ni hacer vibrar muebles. Cámara con mirada hacia el avance y transición suave
entre cubierta/navegación; conservar posición y velocidad al cambiar cámara.

Estela, espuma, inclinación al girar, tensión de vela y sonido dependen de velocidad, giro
y viento reales. Reducir detalle/VFX en móvil conservando información de rumbo y peligro.
Reutilizar atlas y geometría; medir coste con barcos construidos y no solo con la balsa inicial.
El tope de 600 registros del saneado no constituye un presupuesto aceptado de render.

## Aceptación y reparto

Comparar la misma balsa vacía/cargada, carga centrada/periférica y una casa más grande.
Registrar tiempo/distancia de aceleración, frenado y giro bajo condiciones repetibles.
Evaluar calma, viento favorable/contrario, expulsión de carga y piloto principiante/experto
cuando exista esa progresión. Las diferencias deben verse y entenderse en la interfaz.

Comprobar autoridad, predicción con latencia, reconexión, caminar a bordo y entradas al
cambiar de puesto. Revisar teclado, mando y móvil. Medir en teléfono/GPU reales antes de
afirmar FPS; capturas o emulación verifican lectura visual, no rendimiento físico.

El principal conserva arquitectura, diseño de controles, integración y aceptación. Agentes
GPT-6 Luna pueden implementar agregados/cálculos, adaptadores de entrada o VFX y comprobaciones
en archivos disjuntos tras briefs específicos. Un solo dueño de protocolo/entrypoints y una
sesión de navegador/GPU. No cerrar este corte por tener una animación bonita sin manejo,
carga y consistencia compartida comprobados.
