# D03 — Kit elemental integrado (M4.8 P5)

Fecha: 2026-10-04. Base: `9a76925` (Tinta aceptada). Candidato: `0.4.8-rc.1`, protocolo 12.
Commit: el que incorpora este informe; consultar `git log -- docs/delivery/d03-pearlkit.md`.
Workers GPT-6 Luna: VFX, feedback/audio y pruebas/balance, con rutas exclusivas. Integración, revisión de código,
capturas y aceptación por el principal. No se integraron assets Unreal ni se alteró el manifiesto.

## Resultado

Aceptado como candidato local para mecánica y revisión visual de software. M4.8 conserva aceptación física y
publicación pendientes; no se presenta como versión final ni equilibrio competitivo confirmado.

- Las cuatro perlas comparten paleta congelada: naranja, hielo, amarillo y morado. Tromba/vórtice/gotas,
  Timón/carga/estela/captura, Abordaje, Hoja, Lluvia, pistolas, disparos/reflejos y feedback remoto reciben su tinte.
  Los seis materiales del Timón conservan los hooks toon mediante la fábrica original y no se tiñen entre piratas.
  Pools, geometría de ataque, número de instancias/pases y señales de peligro hostil se conservan.
- Se añade una firma sonora corta al inicio del ataque/habilidad: fuego, hielo, chispa y tono oscuro. Dos voces
  adicionales como máximo por inicio; no por partícula, pulso de daño o fotograma. Los sonidos originales siguen.
- Una bala fija `elem` al salir: daño/pasiva, rebotes, estela, shader e impacto diferido usan ese valor después de
  escupir/cambiar. `shot` / `shotEnd` transmiten propietario y elemento; el cliente adopta el valor autoritativo,
  incluido cero. El golpe neutro no adquiere una perla tragada después. Eventos de ataque neutrales declaran cero.
  La bonificación nocturna de Tinta conserva su regla: portador y hora actuales en el tick de impacto.
- Se corrigieron el pulso G de Nube y el tinte de impactos remotos; Descarga y sus partículas también reciben
  la paleta. Tarjetas de compañeros y avisos quedan debajo del reloj, sin tapar la maldición de Tinta.
  No se añaden afinidad, legendarias, persistencia o reglas navales.

## Balance revisado

`node tools/pearl-balance.mjs` produce JSON reproducible con semilla `99282957`. Muestra: un golpe de servidor
con ATK 13, sin crítico, contra muñecos inmóviles, observado durante 180 ticks. Grupo: dos objetivos separados
2 u. Los totales son resultados de esa muestra, no DPS sostenido ni equivalencia de valor entre poderes.

| Perla | Un objetivo | Total del grupo | Utilidad separada |
|---|---:|---:|---|
| Sin perla | 13 | 13 | Base |
| Brasa | 23 | 23 | 10 de quemadura dentro de la ventana; renovar no acumula |
| Escarcha | 13 | 13 | Ralentización 3 s; tres golpes congelan 0,6 s, sin congelar jefes |
| Tormenta | 13 | 20 | Un salto a un vecino, daño bruto ×0.5 |
| Tinta | 13 | 13 | Primer golpe marca; posteriores ×1.1 durante 4 s; nube oculta |

Se conservan los valores aprobados: **600 oro**, élites **2.5/3.75/5 %**, jefe/HELLFIRE **12/18/24 %**,
cofres **8/12/16 %** en Marea I/II/III. Maldiciones de agua, fuego/lava, atracción de balas y día/noche se
reportan aparte. Decisión: mantener la base actual hasta obtener sesiones de juego real; no ajustar control y
ocultación intentando igualar solo el daño de un golpe. Dos ejecuciones dieron JSON idéntico.

## Evidencia

- Suite completa: **276/276 sin red** a concurrencia 2 y **2/2 de red** aisladas: **278/278**. Logs ignorados:
  `shots/review/p5-tests.log`, `p5-net.log`. Se corrigió una fixture neutral sin tiempo de calma antes del rerun final.
- Cinco pruebas nuevas en `tests/pearlkit.test.mjs`: comandos de melee, Estocada, Hoja, pistola, Descarga, Tromba,
  Abordaje y Timón con cada perla; balas/reflejos y rebote tras escupir; paquete de otro pirata, adopción y feedback
  diferido; lanzamiento neutral seguido de Brasa; evento neutral seguido de cambio de portador. No son solo
  llamadas a la pasiva aislada. Sintaxis y `git diff --check` revisados.
- Galería `tools/pearl-review.mjs`, `MODE=gallery`: cinco paletas, escritorio **1280×720 high**, móvil emulado
  **844×390 low**. Capturas `80-*-kit.png` inspeccionadas en `shots/review/p5-desktop/` y `p5-mobile/`.
  Son fixtures del renderer con efectos congelados; no demuestran casts reales ni FPS. Se oculta el tracker en
  esa galería para inspeccionar los efectos. Formas/bordes siguen visibles; núcleos brillantes conservan el estilo.
- Audio de la capa aislada mediante `OfflineAudioContext` en Chrome: cero para neutral, cuatro señales finitas
  y picos inferiores a 0.08 a volumen 1. No acredita audición, mezcla del conjunto o altavoz físico.
- `MODE=online`: Chrome y Edge independientes contra autoridad WebSocket local con latencia artificial de
  25 ms por dirección. Brasa en Edge y Tinta en Chrome: paquete de pistola y su impacto diferido observados
  en el otro cliente; apuntado G y cancelación B con mando emulado sin gastar CD/nube; G de teclado aceptada
  y una sola nube canónica en ambos snapshots/renderers. Sin errores JS, shader o autoridad. La captura detiene
  una nube ya aceptada: no certifica temporización/FPS. El RTT observado de software puede superar la latencia
  artificial. Logs y capturas en `shots/review/p5-online*`. Una carrera en la fixture al alternar mando/teclado
  se resolvió esperando a consumir la liberación antes de pulsar el mismo hueco.
  Capturas `90–93` inspeccionadas en 1280×720 y 844×390: compañero debajo del reloj y aviso debajo de la tripulación.
- `tools/build-release.mjs` prepara publicación desde objetos de Git, usando el constructor de página del commit.
  Comprueba versión/protocolo, rutas/imports y manifiesto; publica página, módulos y assets. `release.json`
  registra SHA de origen, bytes reales y SHA256 del payload (no se auto-hashea). Canary previo desde `9a76925`:
  127 archivos, 1.442.627 bytes, cero discrepancias de hash. El candidato se construye después de su commit;
  la carpeta `dist/` y el staging temporal quedan ignorados. Prueba de Worker del artefacto: `MODE=artifact`,
  `MN_RELEASE=dist/<versión>-<SHA>` en la herramienta de revisión. No se publica el servidor.

## Límites y siguiente tarea

Falta aceptación con GPU real a la velocidad objetivo, teléfono y mando físicos y audición en juego. SwiftShader,
Web Audio offline y mando emulado no sustituyen esas pruebas. La galería no evalúa rendimiento ni control táctil;
los casts táctiles reales del navegador emulado quedaron documentados en D01/D02.

Después de esa aceptación, publicar cliente y servidor compatibles y verificar la URL/servidor reales. Este
checkpoint no hace push ni despliegue. D04 (balsa/cubierta) sigue en `PLAN-DELIVERY.md`; M5 debe definir y cerrar
almacenamiento/identidad/recuperación antes de arriesgar bienes persistentes. No decidir afinidad ni pérdidas
navales durante este cierre. La prueba A01 permanece aplazada y no bloquea el kit procedural.
