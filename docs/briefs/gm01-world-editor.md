# GM00 + GM01: primer editor dentro del juego

Autorizado por el autor el 2026-10-10 tras aprobar [PLAN-GM-EDITOR](../../PLAN-GM-EDITOR.md).
La prioridad confirmada es construir volando dentro del juego con borradores y optimizar los modelos
conservando su apariencia. Este corte prepara dos pilotos y entrega edición de **decoración nueva**.

Entrar desde la pantalla inicial evita crear un personaje persistente mientras se edita. La cuenta online
se comprueba mediante el resolver Supabase existente y `GM_ACCOUNT_IDS` del servidor. El modo solo abre
una herramienta local sobre su propia isla. Los borradores se guardan en IndexedDB, separados por
servidor/cuenta/semilla; exportar conserva una copia transportable. La activación del mapa compartido
corresponde a GM03; los archivos locales no constituyen almacenamiento durable en el servidor.

## Entrega

- Cámara libre con botón derecho, WASD, Q/E, Shift y rueda; entrada/salida sin comandos de combate.
- Biblioteca de modelos actuales y pilotos preparados, búsqueda, estadísticas y carga bajo demanda.
- Fantasma sobre terreno, colocación, selección y transformaciones de posición/rotación/escala uniforme.
- Deshacer/rehacer, duplicar, eliminar, autoguardado, reapertura e importación/exportación con revisión CAS.
- UI nueva en español/inglés. El terreno y los props/recursos existentes conservan sus datos e identidades.

## Assets y presupuestos iniciales

Reutilizar la caja ya exportada de Unreal (`prop:storage-crate`, A02) y los modelos estáticos del
manifiesto. El inventario existente identifica `SM_Rock` y recursos Dreamrise como candidatos exportables;
su formato `.uasset` necesita preparación y no sustituye los dos GLB locales seleccionados por el autor.
`BP_Holdable_BuildHammer` sirve como referencia de interacción, sin ejecutar su lógica en el navegador.
No hace falta producir arte nuevo ni modificar fuentes Unreal para este corte.

Pilotos: `Tropical_Rock_Formation` (19.469 triángulos, texturas 2K) y coral (2.000.696 triángulos,
texturas 4K). Mantener originales y hashes, recetas fijadas, derivados 2K/1K y dos densidades de coral
para comparar. El catálogo público excluye los ensayos de coral que aún conservan dos millones de
triángulos. Los presupuestos de los pilotos son criterios de preparación; la apariencia se decide
comparando cámaras, escala e iluminación idénticas con el loader real. No acredita FPS en un teléfono.

## Verificación

Contratos de documento/IDs/límites, historial, CAS entre pestañas y autorización HTTP real. En navegador:
entrada sin cuerpo, vuelo, colocación y transformación por UI, deshacer/rehacer, guardar/cerrar/reabrir,
rechazo de importación incompatible sin sustituir el guardado, revocación y salida sin decoración residual.
Inspeccionar capturas ES/EN y A/B de los dos modelos. Comprobar que el arranque normal no solicita sus GLB.

Registrar implementación, pruebas y publicación por separado en [informe](../delivery/gm01-world-editor.md).
Siguientes cortes: edición de decoración existente y prueba caminando (GM02), publicación del mapa
compartido (GM03), grupos/materiales/funcionalidad y terreno después.
