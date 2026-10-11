# Intentos de navegador GM04b

La aceptaci?n final local es **17/17** en [evidencia](local-browser-evidence.json), autenticaci?n simulada, alpha.41/protocolo 47. Se conservaron los intentos de desarrollo en el worktree.

El intento 3 descubri? un error real: las decoraciones a?adidas seleccionadas carec?an de la marca base:false y el guardado mixto fallaba con template_selection. El editor ahora entrega ambas clases de selecci?n con marca expl?cita; la prueba de integraci?n reproduce ese contrato. [Diagn?stico conservado](attempt3/local-browser-evidence.json).

Los dem?s intentos incompletos corrigieron el fixture: acceso al mapa antes de abrir el editor, proyecci?n de clic fuera de c?mara, fantasma oculto sin movimiento de puntero, inyecci?n de carga sobre la API antigua, y expectativa de nombre anterior a renombrar. Un intento perdi? la conexi?n local antes de empezar; se conserv? el di?logo y se repiti? sin ocultarlo. No se cuentan como aceptaci?n. La inyecci?n final usa el estado real del registro, una promesa diferida y Escape antes de resolver.

La primera regresi?n amplia termin? sin resumen a los 180 segundos y con fuentes cambiando. Se conserva como no aceptada en [integration-attempt1.json](integration-attempt1.json). Las regresiones aceptadas tienen hashes estables y ?mbito GM expl?cito.
