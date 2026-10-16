# GM02 — decoración existente y prueba caminando

Decisión del autor: continuar el siguiente corte del editor GM. Base de trabajo: `883d35e`,
alpha.23/protocolo 36; recursos M5 activos en el VPS son trabajo de AREA15 y se conservan.

## Resultado y límites

Desde el Editor GM se podrán seleccionar rocas naturales/costeras, flores y guijarros ya renderizados,
mover/girar/escalar, ocultar y restaurar su estado base. El borrador guarda overrides por identidad
de la base, sin modificar los arrays generados. Se excluyen rocas volcánicas, palmas, arbustos,
recursos, NPC, edificios funcionales, muelle y barcos. Las instancias siguen en sus batches;
se conservan sus matrices originales y se restauran al cerrar/revocar el editor.

La biblioteca sigue creando decoración nueva. Un inspector permite elegir sin colisión o un proxy
circular XZ, con huella visible. Las rocas base conservan su círculo proporcional a la escala;
no se convierten en superficies transitables. La prueba caminando combina los círculos base
inalterados con los overrides y los proxies nuevos en un mapa temporal, reutiliza `stepMover`
y crea un único personaje local descartable. No entra al servidor ni modifica M5. Escape/botón
regresa al editor, restaura cámara exacta y conserva el documento; cierre/logout limpia todo.

## Contratos

- Documento v2 añade `baseOverrides: [{id, transform, hidden}]`; v1 migra sin perder objetos ni
  cambiar el scope/revisión CAS. Export/import/recuperación conservan estos datos. Objetivos
  ausentes o con fingerprint diferente rechazan el borrador antes de alterar la escena.
- La identidad usa índice original, kind y fingerprint de la definición, vinculados al seed/revisión
  del documento. No se reordenan props ni se regenera el catálogo de recursos sobre la decoración editada.
- Cada círculo base debe tener un dueño inequívoco; los colliders independientes de prácticas/racks
  se conservan. La geometría y el círculo se transforman juntos solo dentro del preview.
- UI ES/EN. Sin migración SQL, protocolo nuevo, publicación compartida ni terreno en este corte.

## Reutilización

Se revisaron `docs/research/unreal-assets/SUMMARY.md` y el candidato `SM_StoragePart_03` ya utilizado
como `prop:storage-crate`. Este corte reutiliza geometría/materiales y personaje existentes; no
necesita nuevos assets ni exportaciones Unreal. Las cajas/edificios quedan fuera de la allowlist
para evitar separar arte y funciones de gameplay. Las fuentes y derivados GM00 se conservan.

## Aceptación

Pruebas de migración/IDs/historial/CAS; matrices/restauración/colores de instancias; reconciliación
de colliders sin mutación; movimiento real bloqueado por un proxy y paso libre al retirarlo.
Navegador en calidad alta: selección por escena y puntero, transformar/ocultar/restaurar/undo,
guardar/reabrir/importar, caminar/volver con cámara y documento idénticos, blur/logout durante
preview y regreso al juego sin overrides. Capturas inspeccionadas y errores del loop vacíos.
Antes de declarar publicado: revisión/imagen/salud pública y entrada real verificadas.
