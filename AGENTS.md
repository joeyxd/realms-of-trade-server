# MAREA NEGRA — instrucciones del proyecto

## Continuidad

- Leer `docs/HANDOFF.md`, `DESIGN.md` y el plan del milestone activo antes de trabajar.
- La rama de continuidad es `claude/loving-lovelace-ptbif7`; usar el PR existente #1.
- Conservar trabajo ajeno y distinguir implementación, propuesta, pruebas y despliegue.
- Interfaz y comunicación con el autor en español; comentarios de código en inglés.

## Delegación — decisión explícita del autor, 2026-10-04

- Usar agentes **GPT-6 Luna** (`model: gpt-6-luna`) para cualquier tarea que no necesite autoría directa del
  agente principal y cuya delegación ahorre tiempo o tokens sin comprometer el resultado final.
- Ejemplos: inventarios, búsqueda y recopilación, clasificación de archivos/assets, lectura acotada del repo,
  extracción de datos, comprobaciones independientes y tareas de implementación bien delimitadas.
- El agente principal conserva la autoría de las decisiones de diseño/arquitectura, la integración, la revisión
  de evidencia y la aceptación del resultado. Nunca aceptar conclusiones solo porque las afirma un subagente.
- Dar briefs precisos: objetivo, rutas y contexto mínimos, entregable, criterios de aceptación, límites de
  lectura/escritura y verificación. Agrupar tareas relacionadas; evitar delegación repetida sin utilidad.
- Separar archivos de trabajo cuando haya ediciones paralelas. Inventarios e investigaciones son de solo lectura
  salvo autorización expresa para exportar o modificar.
- Si GPT-6 Luna no está disponible, comunicarlo antes de sustituirlo por otro modelo.

## Prioridades y límites actuales

- La joya del juego es construir y habitar en tierra firme o en un barco modular; barcos aéreos más adelante.
  Comercio entre ciudades, transporte con riesgo y combate/piratería deben reforzar esa identidad.
- Dirección naval aprobada y fases en `docs/NAVAL-ROADMAP.md`: materiales/navegación/distribución/carga afectan
  tamaño y manejo; expulsar carga, rendición, patrullas/notoriedad, rutas PvE/PvP, oficios regionales, afinidad
  y desarrollo de ciudades. La discusión inicial está en `docs/NAVAL-HOUSING-DISCUSSION.md`.
- Distinguir dirección acordada de recomendaciones abiertas: formato naval/abordaje, fórmulas, patrimonio
  protegido, costes/pérdidas y bounty no están cerrados ni implementados. No decidirlos silenciosamente.
- El autor autorizó iniciar la investigación Unreal en paralelo mientras redacta sus decisiones navales
  (2026-10-04). Ruta fuente confirmada: `C:\Unreal`, con tres proyectos. Informes e inventario en
  `docs/research/unreal-assets/`; los proyectos fuente permanecen de solo lectura.
- Esa investigación debe usar GPT-6 Luna para listar/clasificar assets, scripts, modelos, efectos, audio y arte,
  priorizando portabilidad al juego actual y mejora concreta. Examinar contenido añadido/adquirido y dependencias;
  excluir módulos base de Unreal. No modificar los proyectos fuente. El autor se encarga de las licencias;
  no iniciar una auditoría de licencias como parte de ese inventario.

## Reglas técnicas

- Simulación determinista y autoritativa en `src/sim/**`: sin reloj ni `Math.random`; usar RNG del mundo.
- Todo campo nuevo de perfil requiere valores por defecto y saneado. Cambios de snapshots/`you` requieren revisar
  `PROTOCOL_VERSION`. No confiar en validación del cliente para inventarios, precios o propiedad.
- Verificar cambios visuales con capturas inspeccionadas. Ejecutar pruebas pertinentes; un push no es despliegue.
