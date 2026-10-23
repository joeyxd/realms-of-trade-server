# Intentos de navegador GM04b

La aceptación final local es **17/17** en [evidencia](local-browser-evidence.json), autenticación simulada, alpha.41/protocolo 47. Los intentos de desarrollo se conservaron en el worktree.

El intento 3 descubrió un error real: las decoraciones añadidas seleccionadas carecían de la marca `base:false` y el guardado mixto fallaba con `template_selection`. El editor ahora entrega ambas clases de selección con marca explícita; la prueba de integración reproduce ese contrato. [Diagnóstico conservado](attempt3/local-browser-evidence.json).

Los demás intentos incompletos corrigieron el fixture: acceso al mapa antes de abrir el editor, proyección de clic fuera de cámara, fantasma oculto sin movimiento de puntero, inyección de carga sobre la API antigua y expectativa de nombre anterior a renombrar. Un intento perdió la conexión local antes de empezar; se conservó el diálogo y se repitió sin ocultarlo. No se cuentan como aceptación. La inyección final usa el estado real del registro, una promesa diferida y Escape antes de resolver.

La primera regresión amplia terminó sin resumen a los 180 segundos y con fuentes cambiando. Se conserva como no aceptada en [integration-attempt1.json](integration-attempt1.json). Las regresiones aceptadas tienen hashes estables y ámbito GM explícito.
