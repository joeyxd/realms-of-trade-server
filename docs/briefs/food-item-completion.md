# AREA03 — fichas de alimentos y continuidad INV03

Solicitud del autor, 2026-10-13: comprobar los objetos importados, explicar su utilidad
y estadísticas, cerrar los alimentos actuales y continuar con las mochilas existentes.
Base revisada: `a19f5e1`, alpha.67; estado público consultado sin errores ni escrituras
pendientes, cocina/coco/resina habilitados. La revisión local de modelos pasó 1/1.

## Corte de alimentos

Reutilizar los doce GLB entregados, atlas e interfaz de provisiones/inventario. El
inventario Unreal ya contrastado en SRV02 y la entrega de modelos no requiere otra
exportación: aquí hacen falta información y validación de comportamiento.

- Fichas ES/EN de los víveres e ingredientes actuales: descripción, uso, volumen y masa
  por unidad, recuperación inmediata y recetas relacionadas, con cifras desde los
  catálogos reales. Consulta desplegable accesible por toque/teclado en inventario.
- Tres comidas especiales: descripción, recuperación de saciedad/hidratación,
  curación normal, bonificación, duración conectada, reemplazo, pausa offline y pérdida
  al reaparecer. Preparación y consumo inmediato siguen siendo una sola operación.
- Corregir la carga cómoda mostrada en la ficha usando el cálculo que ya incluye la
  comida activa. Expirar/reemplazar el efecto debe restaurar la presentación base.
- Lima, hierbas y sal conservan su condición de propuestas; los props colocados por
  GM siguen siendo decoración. Una malla no introduce recogida ni un consumible nuevo.

Verificar consumo/ingredientes/bonificaciones, autoridad y replay con las pruebas
existentes; añadir una regresión para la discrepancia de carga cómoda. Revisar la UI
real en ES/EN y escritorio/móvil, incluida consulta sin consumir. Confirmar publicación
por revisión y comportamiento servido; separar pruebas locales de canarios durables.

## Siguiente corte autorizado

Continuar [INV03](inv03-existing-backpacks.md): las mejoras ya pagables 18→30→42,
costes 2 tablas + 3 lonas / 4 tablas + 5 lonas, Carga y otros bienes conservados,
denegación, replay y reentrada. Revisar evidencia previa antes de repetir el canario;
cerrar las lagunas de aceptación, sin crear otro sistema de inventario o nuevos tiers.
