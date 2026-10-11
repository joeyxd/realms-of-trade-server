# D01 — Tormenta (M4.8 P3)

Fecha: 2026-10-04. Responsable de integración y aceptación: agente principal.
Base mecánica: Escarcha `40949b2`; dirección naval `20d8ee6`. Base de integración: `590d5b4`
(plan de entregas incorporado en paralelo). Checkpoint: `0.4.8-alpha.3`, protocolo 10.
Commit de implementación y aceptación: `66e6e67`.

## Resultado y estado

Integrado y aceptado para mecánica y revisión visual en navegador de software. Publicación y aceptación de
rendimiento/controles en GPU, teléfono y mando reales siguen pendientes. M4.8 conserva P4 Tinta y P5 cierre.

- G carga hasta 1.2 s y libera una cadena de 2–5 NPC distintos; sostener 3 s dispara automáticamente.
  CD 15 s al soltar, movimiento al 55 %, cancelación por dash/stagger/muerte sin gasto.
- Primer objetivo en cono de 40° a 10 u; vecinos a 5 u, selección por distancia/ID, daño ATK ×1.8 y ×0.75
  por salto. Los golpes del kit saltan una vez a otro NPC a mitad de daño bruto, incluso tras un golpe mortal.
  No hay recursión, crítico adicional ni saltos PvP.
- La maldición curva patrones hostiles hacia una posición fijada al emitirse: radio 18 u, giro ≤0.22 rad/s,
  desvío ≤0.45 rad. Renderer, contactos y parry comparten la curva; balas propias/reflejadas conservan su camino.
- Escarcha se compone con curvas mediante integración determinista a 240 Hz. Obstáculos y vida fija se
  respetan. Snapshots retienen patrones, retiradas y balas omitidas por capacidad para recuperar eventos perdidos.
- Perfil/G, UI, botón RAYO, indicador y efectos están conectados. El eco de G no duplica sonido ni pulso;
  eventos de rayo tienen ID propio para distinguir impactos de pistola consecutivos.

## Evidencia

- `tests/tormenta.test.mjs`: 12 casos de perfil, carga/CD, cadenas, maldición, obstáculos/TTL, Escarcha,
  snapshots/retiradas/capacidad, predicción/rechazo y parry. Integración dirigida: 61/61.
- Regresión final: 257/257 sin red y 2/2 de red (~100 ms RTT), total 259/259; logs locales ignorados
  `shots/review/tormenta-tests.log`, `tormenta-focused.log`, `tormenta-net.log`.
- Capturas inspeccionadas: desktop 1280×720 y móvil emulado 844×390, en
  `shots/review/tormenta-desktop/` y `shots/review/tormenta-mobile/` (`61panel`, `62charge`, `63chain`).
  Se comprobaron panel, carga completa y cadena autoritativa de cinco objetivos. Móvil usó contactos táctiles,
  arrastre y liberación. Se reforzó el trazo del rayo tras comprobar su contraste sobre arena.
- Sin errores JS de juego. Fuentes Google bloqueadas y avisos conocidos de SwiftShader. El escenario pausa
  carga/efectos ya aceptados para capturarlos: estas imágenes no acreditan FPS ni temporización del efecto.

## Assets, límites y siguiente tarea

No se importaron assets de Unreal/FAB; Tormenta mantiene VFX procedurales. A01 es una preparación independiente
y no condiciona esta aceptación. Curvas con Escarcha usan aproximación determinista; queda balance integrado
en P5. Cliente y servidor deben actualizarse juntos por el protocolo 10. No hubo push, despliegue ni publicación.

Siguiente: D02 / M4.8 P4 **Tinta**, según `PLAN-M4.8.md`: fijar contrato de marca/nube/IA y maldición día-noche,
implementar y verificar autoridad/predicción antes del cierre P5. Principal reserva manifiesto, protocolo,
`src/main.js`, `src/render/scene.js`, `src/net/localServer.js` y documentación compartida; asignar rutas exclusivas
de sim, pruebas y UI/VFX antes de delegar. M5 y las decisiones navales conservan su planificación independiente.
