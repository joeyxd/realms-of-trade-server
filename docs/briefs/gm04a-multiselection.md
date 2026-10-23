# GM04a — editar un conjunto de decoraciones

Fecha: 2026-10-10, hora de México. Continúa GM03b2; implementación y aceptación se registran
por separado en la entrega.

El autor selecciona varias decoraciones con Shift+clic o con casillas en Escena. El inspector muestra
el número seleccionado y un pivote en el centro de sus posiciones. Mover, girar y escalar conserva
la disposición relativa; duplicar crea IDs independientes; eliminar oculta las bases y quita las
decoraciones añadidas. Cada operación completa tiene un solo deshacer/rehacer. Apoyar en terreno
proyecta cada origen de forma independiente. El foco encuadra el conjunto.

La selección es temporal, con máximo 120 elementos. Los giros y la escala del inspector son deltas
desde el conjunto actual; vuelven a cero/uno tras confirmar. No se persisten jerarquías ni grupos:
el documento v2 mantiene instancias y overrides ordinarios. Un lote inválido, fuera de límites o
sin capacidad se rechaza completo, sin deformar el conjunto por clamps individuales. Escape o
pérdida de foco restaura el arrastre entero. No cambiar selección, historial o modo durante el arrastre.
Los objetos ocultos se restauran individualmente; la colisión se configura individualmente.

El guardado local/remoto, CAS, preparación, hash, revisión activa y rollback conservan sus contratos.
No añade SQL, estado de perfil, permisos, nueva autoridad ni cambios a recursos/servicios/terreno.
La siguiente parte de GM04 podrá añadir plantillas expandidas en instancias; no hace falta una
migración de documento para aceptar este corte.

Reutilización: se revisaron el inventario [Unreal/FAB](../research/unreal-assets/PORTABILITY.md),
la [caja integrada](../delivery/a02-crate.md) (`prop:storage-crate`, 204 triángulos, 51.684 B) y
los [restos de playa](../delivery/beach-debris-v1.md) (436 triángulos, 18.740 B, sin texturas nuevas).
El corte reutiliza esos modelos y la decoración base para aceptación; no exporta originales ni
incorpora descargas 2K/4K. Las copias comparten geometría/materiales según el loader actual.

Aceptación: matemática YXZ con giro/inclinación/escala alrededor del pivote; inmutabilidad, límites,
IDs únicos y undo/redo atómico en lotes mixtos; ida/vuelta v2 y preparación de publicación. Navegador:
casillas/Shift, gizmo, inspector, cancelación, duplicar/eliminar, guardado/reapertura y colisiones de
prueba; capturas inspeccionadas ES/EN y viewport estrecho. Publicación: imagen/revisión/health reales,
entrada pública y sesión GM existente. Sin afirmar FPS físicos ni colaboración simultánea.
