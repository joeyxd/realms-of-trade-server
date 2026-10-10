# GM03b1 — preparar una revisión para publicación

Fecha: 2026-10-10. Continúa GM03a por petición del autor. Este contrato se fija antes del código.

La siguiente entrega visible es **Validar para publicar** en Online: trabaja sobre una revisión remota
explícita, muestra problemas con los IDs afectados y permite descargar un paquete reproducible cuando
no hay errores. Cambiar el diseño exige guardarlo online y volver a preparar. La preparación no publica,
no solicita reinicio ni cambia el mapa activo. GM03b2 añadirá registro durable de revisiones, puntero de
contenido y activación/rollback con admisión exacta y exclusión compartida con el actualizador.

## Contrato

- `POST /api/gm/prepare` recibe solo `expectedRevision`. Usa autenticación y allowlist GM por petición;
  deriva dueño y mundo igual que GM03a. Lee el borrador confirmado del servidor y exige esa revisión.
  No acepta un documento arbitrario del navegador. Si cambia durante la preparación devuelve conflicto.
- Comparte una proyección pura de círculos con la prueba caminando. No cambia props, RNG, recursos,
  economía, perfiles ni funciones del terreno. Los recursos se consultan en la base intacta.
- El preflight v1 limita a 1.000 ediciones, escala 20 y radio efectivo 20. Comprueba dominio, altura
  respecto al suelo, círculos sobre accesos protegidos (spawn, servicios, muelle, recursos, arena,
  volcán y camino principal). Son límites conservadores de publicación, distintos de un borrador libre.
  Las intersecciones entre decoraciones se permiten. Modelos sin colisión y rotaciones inclinadas se
  identifican como advertencias. Este análisis geométrico no certifica todas las rutas ni FPS físicos.
- Resuelve únicamente modelos de los índices distribuidos, lee sus bytes reales y fija SHA-256,
  definición de loader y tamaño. GLB autocontenido; rutas externas, escapes y dependencias ausentes
  bloquean la preparación. No confía en hashes declarados. Los candidatos de arte mantienen esa etiqueta.
- El paquete incluye documento exacto, mundo, revisión origen, huella del código/base y dependencias,
  resumen de colisiones y validación. Su ID es SHA-256 del contenido canónico; repetir la misma petición
  sobre los mismos bytes produce el mismo ID. No contiene bearer, correo, rutas de disco ni secretos.
  La descarga guarda metadatos y hashes, no duplica los GLB. La futura activación deberá verificar todos
  los bytes y conservar dependencias; un enlace actual no demuestra retención de una versión histórica.
  También fija los bytes de todos los assets del manifiesto base, incluidas variantes móviles: una
  revisión vacía sigue dependiendo de rocas costeras, materiales y otras piezas del mapa generado.
- UI ES/EN: validando, errores, revisión preparada y descarga. La preparación queda invalidada al
  cambiar la revisión remota o el diseño mostrado; las respuestas antiguas se descartan al salir o
  revocar identidad. Error/conflicto conservan diseño local y borrador online.

## Decisión de integración

La auditoría encuentra `World({map})` como seam de futuro montaje y HELLO/WELCOME como seam de admisión.
No existen aún registro de revisiones ni exclusión de activación de contenido. Por eso se entrega primero
la revisión verificable; no se presenta un guardado de contenido como una activación M5. Sin SQL nuevo,
cambio de protocolo ni flags opcionales. Se conserva una sola autoridad y el flujo del actualizador.

## Reutilización y aceptación

Reutiliza GM00/GM02/GM03a y `prop:storage-crate`, candidato Unreal/FAB ya integrado
([reutilización D06](../research/unreal-assets/D06-REUSE.md)). No requiere arte nuevo ni cambia fuentes
2K/4K. Los modelos candidatos siguen sujetos a su revisión visual y de presupuesto antes de activarlos.

Pruebas: proyección pura y equivalencia con caminar, protecciones, límites, dependencias/hashes/rutas;
HTTP con dueño derivado, conflicto durante preparación y ausencia de escrituras; cliente con identidad,
cierre y errores. Navegador real de prueba: errores reparables, descarga verificable, ES/EN y continuidad
GM03a. Publicación de código por rama existente y comprobación de revisión/imagen/salud/entrada real;
la entrega distinguirá código publicado de mapas activados.
