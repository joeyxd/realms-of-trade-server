# D08c.6 — navegación en la partida y circuito costero

2026-10-07. El autor autoriza integrar la navegación de los ensayos en el juego normal y completar
el loop básico. Este corte conecta Worker, fallback y GameHost; no publica ni activa pérdidas durables.

## Recorrido y política v1

- Subir a la balsa propia en Aldea, tomar el timón y zarpar con los controles existentes.
- Corrientes del puerto, captura de ráfaga por timing, cámara trasera, vela/timón articulados,
  sonido, estela, espuma, velocidad y HP por pieza usan los módulos ya construidos.
- La bodega y la mochila reales aportan masa y distribución. No se crea mercancía de prueba ni se
  expulsa carga real mientras D09 no tenga custodia de bienes. Ese botón queda fuera del runtime.
- Parar cerca de una costa transitable permite desembarcar. La misma nave permanece estacionada;
  volver a embarcar exige proximidad al punto de desembarco y a la cubierta. No teletransportar desde lejos.
- Regresar despacio al muelle permite atracar y recuperar la balsa en su amarre. Un circuito de ida y
  vuelta tiene guía de costa/retorno y confirmación del servidor, sin inventar XP ni recompensas económicas.
- Posición y daño naval son de sesión. Desconexión, muerte, fallo de soporte o pérdida de flotación
  recuperan la nave en el amarre guardado y rescatan ocupantes. Plano y bodega se conservan; no hay
  duplicación de módulos, reparación que genere materiales ni coordenadas marítimas en el perfil.
- Durante todo el viaje, incluso con propietario en tierra, bloquear edición, transferencias de bodega
  y producción. M5 conserva sus reservas: no consumir órdenes navales mientras el tick está detenido.

## Reutilización y equipo

Reusar [D08-REUSE](../research/unreal-assets/D08-REUSE.md), atlas/material optimizado de balsa,
CharacterView, RaftDeck, dinámica/contacto/predicción, cámara/audio/VFX/HUD y TouchHelm existentes.
Los Blueprints y agua de Unreal no ofrecen autoridad Node o reconciliación portable. No hacen falta
modelos/texturas nuevos; `C:\Unreal` permanece intacto. Luna cubre adaptadores de cuerpo, lifecycle
costero y vista/controles en archivos separados; el principal integra entrypoints y acepta evidencia.

## Aceptación requerida

- Worker/fallback y servidor ordinario admiten solo timón propio; observador ve la misma pose y cubierta.
- Captura y corrientes se predicen con el mismo frame; ráfaga confirmada no repite feedback al reconciliar.
- Parada, desembarco, reembarque y atraque conservan ID, plano, bodega, oro y progreso.
- Pausa/blur, reservas M5, secuencias/epochs viejos, desconexión y dueño reciclado no dejan empuje vivo.
- Edición/producción/cargo quedan bloqueados hasta cerrar el viaje, también en tierra.
- Escritorio y móvil emulado: interacción normal, controles, HUD/cámara/material/VFX y vuelta a pie.
- Registrar pruebas y capturas inspeccionadas. Sensaciones, audio oído y FPS físicos quedan al autor.

M6 P5 se reduce aquí al circuito costero de la isla actual. Rutas entre regiones, oficio naval,
piratas NPC/PvP, remolinos/ancla y pérdida/reparación durable siguen cortes posteriores.

## Ampliación del autor: interfaz móvil de referencia

Solicitud del 2026-10-07: timón dibujado sobre el control izquierdo, velocímetro con fuego a la
derecha, tres acciones circulares alrededor y control de cámara compacto debajo. Mantener
una acción abre la selección y permite cambiarla; la selección debe conservarse al reembarcar.

Principal: composición, SVG del dial, adaptador de acciones reales y documentación. Luna controles:
`src/ui/touchHelm.js` y su prueba. Luna QA: `tools/qa-nav-reference.mjs`, punteros reales CDP y
evidencia; Luna revisión: reutilización puntual y ciclo de entrada, solo lectura. Un navegador/GPU
propio a la vez. El laboratorio conserva el layout anterior por defecto.

Reutilización: SVG y dial web existentes. El cruce D08c.5 no encontró un timón/UI portable en los
paquetes Unreal; no exportar ni añadir texturas para este corte. El selector solo ofrece acciones
del catálogo vivo: ráfaga, mochila, cubierta/timón, mapa, centrar y operaciones costeras admitidas.
Mochila abre el inventario actual; no simula consumo ni expulsión de mercancía.

Aceptar pulsación larga de 500 ms sin activar al soltar, cambio de botón y persistencia local,
dos sticks independientes, neutralización al cancelar/ocultar/pausar, lectura de casco/carga/rumbo
reales, controles de al menos 44 px y capturas inspeccionadas en horizontal y portrait rotado.
Comprobar escritorio sin controles táctiles. No interpretar el radar de referencia como permiso
para inventar enemigos, objetivos o combate no implementados.

Pulido posterior solicitado por el autor: compactar el grupo derecho, reducir timón izquierdo,
viento con icono/porcentaje transparente junto a la brújula y casco como barra fina integrada
al HUD del personaje. Reutilizar los SVG y lecturas existentes; sin nuevas texturas. El casco
reparentado debe retirarse en `dispose()` y ocultarse al volver a tierra. Verificar fuente real
de HP/viento, tamaño táctil mínimo, espacio entre botones, pulsación larga y capturas normal,
rotada y en container estrecho. Esta revisión solo cambia presentación.

Ajuste de composición siguiente: chat cerrado por encima del timón, timón 8 px más abajo,
tres acciones a intervalos iguales de 35° alrededor del centro del velocímetro. Conservar
el tamaño compacto y el área táctil; medir separación entre círculos y comprobar hit testing,
incluido portrait rotado. Abrir el chat no debe recortar el compositor en la pantalla corta.
Reutilización: los mismos SVG/CSS y el chat C01 existente; sin exports o arte nuevo.
