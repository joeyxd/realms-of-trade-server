# D08a — bahía aislada de manejo

2026-10-05. Implementación experimental; aceptación visual pendiente. Continúa
[D08](d08-navigation-feel.md). La prueba móvil D06b conserva su puerta de aceptación;
esta preparación puede avanzar sin activar navegación en la partida ni cerrar ese pendiente.

## Corte autorizado

Una bahía local independiente, sin perfil, inventario, guardado, Worker, WebSocket ni servidor de juego.
Comparar la misma balsa vacía, con lastre centrado, en extremos o alto a un lado, y una casa 4×4.
El lastre tiene masa y posición explícitas; no representa distribución de la bodega persistida.
Reiniciar/soltar lastre solo afecta al laboratorio. No concede bienes, piezas ni progreso.

El principal define cuerpo agregado, coordenadas, controles y límites; Luna revisa candidatos,
implementa entrada/servidor aislado y comprueba invariantes en archivos disjuntos.
[Revisión Unreal/FAB](../research/unreal-assets/D08-REUSE.md) previa a implementar: reutilizar
RaftLayer, caja aceptada, atlas y agua existentes; sin exportación, audio o textura nuevos.

## Contratos

- Simulación pura a 60 Hz: centro de masa x/z, rumbo, velocidad lineal y angular. Render interpola;
  ningún FPS determina fuerzas. Tras bloqueo de pestaña se descarta tiempo superior a 250 ms.
- Pesos de piezas existentes y lastre explícito alimentan masa, flotación, centro, momento de inercia
  y equilibrio/altura. La carga periférica resiste el giro. No hay vuelco sorpresivo.
- Coeficientes separados en `src/data/navalHandling.js`, provisionales y sin alterar `raftStats`
  del juego. No son niveles/materiales/habilidad definitivos ni modelo físico por tablón.
- W/arriba solicita propulsión, S/abajo frena sin marcha atrás, A/D gobierna. Botones con dos punteros;
  mando estándar: stick X, RT/LT. Pausa/blur/pestaña oculta limpian controles y detienen la prueba.
- Viento constante por escenario, en coordenadas mundiales: a favor/lateral/en contra/calma.
  La vela se ajusta de forma abstracta; ayuda de remo en calma. No hay rachas ni progreso de navegación.
- Soltar lastre transforma la referencia del centro de masa conservando pose y velocidad de los puntos
  del casco; no añade impulso. El calado visual puede cambiar de forma acotada.
- Medir 6 s de aceleración; freno y giro de 90° desde la misma velocidad 2 u/s, límite 60 s y resultado
  explícito si no se alcanza. Conservar viento fijo durante el giro, sin fingir viento a favor constante.
- Laboratorio servido solo por loopback; módulos/assets/Three locales. No arrancar el host activo.
  El entrypoint y protocolo del juego conservan su versión. No publicar este prototipo como viaje real.

## Puertas de aceptación

Pruebas de determinismo, respuesta comparativa, freno, coordenadas, continuidad al soltar carga,
entradas/cancelación, presupuesto de ticks y aislamiento HTTP. Después revisar capturas de teclado,
táctil horizontal/vertical, atlas realmente cargado, estabilidad de cámara/materiales/agua.
No afirmar aceptación visual sin inspeccionar capturas ni FPS físicos sin medir en dispositivo.

La revisión automática bloqueó el arranque de Chrome por límite de uso al cerrar D06b; este corte
no intenta evitarla. Hasta resolverlo, D08a se entrega como código y mediciones comprobados, con UI
preparada para aceptación. Después: cerrar móvil D06b, revisar la bahía y sensación humana, ajustar
valores, y solo entonces diseñar integración de autoridad/predicción/cubierta móvil por cortes.
D09 sigue siendo puerta antes de arriesgar mercancías persistentes.
