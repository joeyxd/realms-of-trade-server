# D02 — Tinta (M4.8 P4)

Fecha: 2026-10-04. Responsable de integración y aceptación: agente principal.
Base mecánica: `f9ddb17`, con Tormenta aceptada en `66e6e67`. Base final de integración: `85d8a70`,
que registra la prueba de assets paralela. Checkpoint: `0.4.8-alpha.4`, protocolo 11.
Commit de implementación y aceptación: el que incorpora este informe; consultar su historia con `git log`.
Workers GPT-6 Luna: simulación/datos, UI/VFX y pruebas, con rutas exclusivas y revisión consolidada del principal.

## Resultado y estado

Integrado y aceptado para mecánica y revisión visual en navegador de software. M4.8 conserva P5: pulido,
balance, aceptación con GPU/dispositivos reales y publicación. M5 y las decisiones navales siguen en su plan.

- Golpes válidos de Tinta marcan NPC vivos durante 4 s. El primer golpe aplica la marca; los posteriores de
  cualquier atacante hacen daño bruto ×1.1. No se acumula; Tinta renueva. Sin marcas PvP, sobre daño rechazado
  o heredadas al reutilizar entidades. El daño nocturno se compone una vez con esa bonificación.
- G / cruceta abajo / NUBE: mantener o arrastrar apunta, soltar coloca; alcance 10 u, radio 3 u, duración 5 s,
  CD 18 s. Cancelar apuntado no gasta. Preparación 0.22 s, recuperación 0.18 s y movimiento al 45 % al preparar.
- Todos los piratas vivos cubiertos quedan ocultos para NPC. Un enemigo no adquiere un pirata oculto nuevo;
  un objetivo ya visto conserva su última posición para movimiento y fuego a ciegas. Otro visible puede reemplazarlo.
  Arqueros, cañones, morteros y ataques dirigidos de HELLFIRE usan esa posición. La nube no borra proyectiles,
  cancela áreas comprometidas ni da invulnerabilidad. Sigue hasta vencer aunque cambie el portador o su perla.
- Hora autoritativa de economía, incluida su fracción entre actualizaciones: día de 16 min, inicio 08:00,
  noche 20:00–06:00. Pociones ×0.7 de día; daño saliente ×1.1 de noche. El cliente extrapola el ancla de snapshot.
  El ciclo de luz sigue ese reloj; presets de pausa son cosméticos. HUD indica hora/período/maldición activa.
- `ink` replica nubes y marcas; `clock` replica hora/tick/duración del día. G tiene cinco columnas predichas.
  El eco adopta la nube sin duplicar feedback; reconciliación retira casts rechazados y snapshots recuperan
  eventos perdidos/entrada tardía. Comandos para cambiar hora están restringidos al servidor de desarrollo.
- VFX procedurales limitados a 12 nubes y 32 marcas: humo de suelo con borde morado y centro suave, anillo
  bajo NPC marcados, icono G, botón NUBE, golpes tintados y sonido sintetizado. Sin texturas/manifest nuevos.
  Se corrigió el solapamiento del tutorial sobre el reloj en pantallas bajas.

## Evidencia

- `tests/tinta.test.mjs`: **12/12**. Perfil/saneado/guardado, hueco G, AimCast, alcance/CD, marcas/expiración,
  inmunidad/muerte/reutilización, selección y fuego real a última posición, daño dentro de nube, reloj y límites,
  autoridad `dev:false`, predicción aceptada/rechazada, dedupe y reparación por snapshots/entrada tardía.
- Regresión final: **269/269 sin red + 2/2 de red** (~100 ms RTT), total **271/271**. Regresión dirigida previa
  de Escarcha/Tormenta/apuntado/perlas: 49/49. Sintaxis de 29 archivos comprobada y `git diff --check` limpio.
  Logs locales ignorados: `shots/review/tinta-tests.log`, `tinta-net.log`, `tinta-focused.log`,
  `tinta-regression-focused.log`.
- Capturas inspeccionadas: escritorio 1280×720 y móvil emulado 844×390, calidad high, en
  `shots/review/tinta-desktop/` y `shots/review/tinta-mobile/`. Escenario `SCEN=tinta`: panel (`71`, `71b`),
  apuntado (`72`), nube aceptada (`73`), hora/maldición nocturna (`74`) y marca tras ataque real (`75`).
  Desktop comprueba cancelación sin nube/CD; móvil usa contactos táctiles CDP y arrastre/liberación.
- Sin errores JS del juego en los recorridos. Fuentes Google bloqueadas y avisos conocidos de SwiftShader.
  El escenario pausa nube y marca ya aceptadas por el servidor para capturarlas; no prueba FPS, temporización
  a velocidad real ni mando/teléfono físicos. Esas aceptaciones permanecen en P5.

## Próxima tarea y límites

**D03 / M4.8 P5:** revisar paleta/sonido de todo el kit con las cuatro perlas, legibilidad y balance integrado;
cerrar controles en GPU, teléfono y mando reales y dos navegadores en línea cuando estén disponibles.
Mantener los números de afinidad/navales como decisiones futuras; no introducir persistencia o legendarias aquí.
Una prueba de asset A01/A03 puede aceptarse aparte si mejora, con fallback; Tinta conserva el arte procedural.

Principal reserva protocolo, manifiesto, entrypoints, documentación y aceptación. Antes de delegar P5, asignar
rutas exclusivas y comprobar trabajo concurrente. Continuar PR #1 con commits selectivos. Construir el artefacto
desde el commit compatible de cliente/servidor; este checkpoint no hace push, despliegue ni publicación.

Para probar: solo → F4 → «+ Perla de Tinta» → P → Tragar → cerrar → esperar 4 s → mantener/soltar G.
En móvil, Bolsa → Perlas → NUBE y arrastre. F4 → «Hora del mundo: día/noche» comprueba la maldición real.
