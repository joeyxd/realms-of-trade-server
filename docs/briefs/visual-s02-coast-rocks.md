# S02 — rocas angulares de playa

Fecha: 2026-10-06. Continuación del autor tras arena S01 y huellas dinámicas.
Ensayo visual local; ajuste artístico pendiente de la revisión del autor.

Reutilizar `SM_Rock.uasset` de Dreamrise antes de crear otra malla. El archivo existe en
`C:/Unreal/survival project/SimpleMultiplayerSurvival/Content/Dreamrise_SMSK/Assets/Meshes/SM_Rock.uasset`.
No había un export portable. Conversión de geometría en una copia mínima bajo `asset-staging/s02-rock-export`;
fuentes Unreal intactas. El material de exportación sin render no se acepta como acabado visual.

Primer corte: tres siluetas derivadas de esa malla —compacta, alargada y baja— con gris cálido,
planos claros amplios, sombra fría y grietas escogidas. Toon/tinta, sombra solar y contacto del renderer actual.
Sin texturas nuevas; colores por vértice y shader compartido. Cada variante cabe dentro del radio actual
`0.55 × scale`, con margen de 0.03. Reemplazar solo las rocas existentes sobre arena; no añadir obstáculos.
Posiciones, colisiones, altura transitable, perfiles y protocolo conservados. Si no carga la malla,
se dibujan las rocas procedurales existentes.

La familia completa aún incluye conchas independientes y cantos. Este corte no aplica esas filas,
ni el material de acantilado/terreno, ni un arco. No convertir una deformación de la misma malla en
la afirmación de tres modelos originales diferentes.

Verificación requerida: malla/triángulos/bounds reales; contacto sobre arena; vista normal y cercana
PC/móvil emulado; carga fallida y `?noassets` con fallback; archivos/capturas registrados en la fila
`roca-playa`. Presupuesto y capturas no acreditan FPS en un dispositivo físico.
