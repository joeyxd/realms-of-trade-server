# D08a.1 — manejo arcade, corrientes y captura de vela

2026-10-06. Corte solicitado por el autor tras la lista corta de navegación: mejorar el movimiento,
probar tres mecánicas y añadir sonido, efectos, salpicaduras y timing satisfactorio. El principal
interpreta los tres puntos iniciales como **manejo arcade + corrientes + captura de ráfaga**, lo comunica
al empezar y conserva expulsión con recoil/remolino/ancla para los cortes siguientes.

## Alcance y contratos

Continuar la bahía aislada D08a, servida por loopback en 5180. No integrar pilotaje en partida, red,
cubierta móvil, progresión, mercancías ni guardado. M5 y aceptación móvil D06b conservan sus pendientes.
Los valores son de laboratorio: el autor aún debe valorar tacto, intensidad y controles en dispositivos.

- Más propulsión/timón y recuperación lateral corta; masa, distribución, altura y sobrecarga mantienen
  sus efectos comparativos. Sin giro instantáneo, pérdida involuntaria de carga o vuelco.
- Dos corredores curvos visibles de agua, derivados de las mismas descripciones que la simulación.
  Drag/freno operan sobre velocidad relativa barco menos agua; no sumar velocidad por frame/tick.
  Campo continuo, bordes suaves y velocidad del agua limitada a 3,2 u/s.
- Agenda determinista de ráfagas cada 18 s de tiempo simulado. Aviso 3 s antes, ventana de 1,5 s y
  captura con Espacio, botón táctil o A del mando. Una oportunidad por anuncio; un fallo no resta avance.
  Requiere abrir vela, soltar freno y orientación favorable. Captura da 5,5 s de fuerza de vela adicional;
  centro de ventana recompensa más. Coeficientes editables en datos, sin fórmula final de progresión.
- Un techo absoluto compartido de 13 u/s en este experimento. La expiración quita fuerza y deja
  decaer el impulso; no recorta bruscamente velocidad ni elimina masa/inercia. La comparación base
  de manejo, sin ambiente, conserva su techo de 10 u/s.
- Crucero asistido opcional para probar viajes con manos disponibles; freno lo anula y Escape pausa.
  Cancelación/blur/ocultación limpian acciones pendientes; ninguna captura sobrevive al reinicio.
- Feedback: vela existente deformada solo en la bahía, inclinación acotada del casco, espuma/estela,
  salpicaduras y flechas de corriente. Tras probar mar abierto, el autor pide sensación de velocidad
  y efectos dramáticos: referencias de espuma fijas por celda, líneas de cómic periféricas durante
  boost, FOV suave 35–41°, inclinación de cámara hasta 1,43° y casco hasta 11,5°. El centro permanece
  libre y se puede apagar «Efectos de cómic»; reduced motion omite líneas/inclinación/FOV/oleaje de vela.
  Cámara legible, sin vibración, ceguera ni controles invertidos.
- Audio Web Audio sintetizado, desbloqueado por gesto, volumen acotado, mute/pausa y fuentes limitadas.
  Indicadores escritos/de forma funcionan también sin sonido. No confundir grafo verificado con audición.

## Reutilización previa y presupuesto

Luna revalidó candidatos concretos antes de implementarlos. `NS_Spline_WaterSplash.uasset` (5.381.446 B),
su Blueprint (68.664 B), `NS_Spline_Wind.uasset` (1.611.320 B) y los dos paquetes de lluvia conservan
la evidencia y límites de [D08-REUSE](../research/unreal-assets/D08-REUSE.md): Niagara/Blueprint no ejecutan
en navegador, grafo/dependencias/simulación no verificados. No exportarlos para este corte.

Audio `SW_Water_Slash_01.uasset` (303.741 B), avión y pasos tampoco fueron decodificados/escuchados;
son candidatos sin encaje sonoro demostrado. Reutilizar `AudioEngine` y el patrón de filtros de ambiente.
No usar `sfx.wake()` como estela: es un drone/campanas, con otro propósito.

Reutilizar `RaftLayer`, geometría de vela, atlas 1024/512, agua/pipeline y `ParticlePool` del juego.
Fuentes `C:\Unreal` intactas. Ninguna nueva textura, bitmap, archivo de audio o dependencia de descarga.
Pool y emisión reducidos en móvil; verificar capacidad real, selección de atlas y pantalla horizontal/vertical.
Las referencias son un solo mesh procedural: hasta 338 flecks móvil / 722 escritorio; dos cintas de
estela de nueve muestras, pool de spray 144/288, líneas SVG 12/20 y una fuente ambiente compartida.
Bytes y emulación no demuestran FPS en teléfono físico.

## Equipo y aceptación

- Principal: diseño, datos/campo/física/agenda, integración, revisión visual y aceptación final.
- GPT-6 Luna: revisión acotada FAB, módulos aislados de audio/VFX, entrada/HUD y pruebas independientes.
- Un escritor por archivo, un navegador/GPU a la vez; conservar cambios concurrentes M5.

Comprobar respuesta vacío/cargado/acomodo, arrastre gradual, límites y determinismo 30/60/120 FPS,
captura temprana/válida/perfecta/única/expiración, foco/multitáctil/pausa y sonido sin autoplay.
Revisar capturas desktop, 844×390 y 390×844; medir variantes realmente seleccionadas y emisiones.
Registrar commit exacto, comandos, resultado y límites en entrega. Luego prueba humana antes de integración
naval autoritativa/predicción/cubierta; D09 sigue siendo puerta antes de carga real expuesta.
