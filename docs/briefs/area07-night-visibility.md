# AREA07 — La luz es necesaria de noche

Decisión explícita del autor, 2026-10-10. Dirección aprobada para el mundo; **todavía sin cambio de
iluminación ni fuentes equipables**. Se aplica a exploración terrestre y navegación.

De noche, fuera de una fuente real de luz, el entorno debe verse casi negro y la visibilidad ser mínima.
Preparar una antorcha o farol y reconocer un puerto iluminado deben importar al viajar. La UI, los menús
y los instrumentos conservan legibilidad; el escenario sin iluminar no recibe claridad gratuita del personaje.

La entrega de faroles del primer refugio naval debe incluir esta función, después de la primera lección
de pilotaje. Poner fuentes utilizables al alcance del jugador antes de reducir la iluminación del mundo.
Combustible, duración, coste y reglas de apagado se fijan al implementar ese corte.

## Base actual que deberá cambiar

- [lighting.js](../../src/render/lighting.js) mantiene luz ambiental, lunar y relleno de cámara que hacen
  visible la noche. [lights.js](../../src/render/lights.js) añade un radio automático al personaje.
- El selector de luz de [Pausa](../../src/ui/pause.js) permite forzar día. La hora autoritativa de la
  partida debe fijar la oscuridad jugable; un ajuste cosmético no debe revelar terreno u objetivos ocultos.
- [Calidad](../../src/render/quality.js) limita cuántas luces locales se dibujan. Baja/móvil deben conservar
  cobertura de luz útil equivalente: pueden reducir bloom, partículas y detalle, sin eliminar fuentes
  esenciales ni ampliar artificialmente el alcance visible.
- [DESIGN §15](../../DESIGN.md#15-dirección-de-arte-v2-plan-de-cambios-por-referencias) documenta los presets
  anteriores, que deberán adaptarse. Este brief registra la nueva dirección sin reescribir la evidencia histórica.

## Aceptación del corte de luz

Comparar desde la misma posición sin luz/con luz, a pie y en barco, dentro/fuera del alcance, de noche
y al amanecer, en escritorio y móvil con calidad baja/alta. Verificar varias fuentes cercanas, luz de
otros jugadores y módulos rotos/apagados; su estado debe coincidir con lo que se ve. Revisar entrada,
ajustes cosméticos, reconexión, UI y transiciones para que no eludan o rompan la oscuridad.

No se decide aquí combustible, daño por oscuridad, pérdidas, invasión offline o nuevas reglas de propiedad.
