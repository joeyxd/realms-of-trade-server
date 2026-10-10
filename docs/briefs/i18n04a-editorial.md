# I18N04a — glosario y mensajes del editor

2026-10-10. Siguiente corte de AREA12 después de la implementación local de I18N01–03.

## Resultado

Quien usa el editor ve los estados de guardado, importación y modelos en el idioma actual. Un cambio
Español/English actualiza el aviso visible, incluso si la respuesta llegó tarde; conserva el borrador,
la selección, el historial y la operación pendiente. Los errores desconocidos reciben una explicación
genérica, sin exponer mensajes crudos de IndexedDB, archivos o proveedores en la interfaz.

## Alcance

- Mapear códigos conocidos de borradores/documentos/modelos a mensajes ES/EN con acción siguiente útil.
- Conservar la fuente de los avisos para volver a presentarlos sin repetir operaciones.
- Revisar la terminología actual en un [glosario común](../i18n/glossary.md): bolsa, mochila, bodega,
  maestría, tatuajes, perlas, navegación y aportes. Corregir discrepancias editoriales comprobadas.
- Registrar en PLAN-I18N, PLAN-MASTER, PLAN-DELIVERY y HANDOFF el alcance implementado, sus pruebas,
  la integración pendiente y los próximos cortes de publicación y promoción.

No modifica el documento GM, sus IDs, validación, CAS, recuperación, autoridad, permisos o guardado remoto.
Los paneles locales de operadores/agentes y laboratorios de arte tienen alcance propio; no son pantallas
del cliente jugable cubiertas por I18N01–03. Si se ofrecen públicamente, necesitan una entrega bilingüe.

## Aceptación

Pruebas de códigos conocidos/desconocidos, cambios repetidos de idioma y ausencia de efectos secundarios.
Navegador con el editor real y IndexedDB local: fallo de importación, conflicto entre dos pestañas,
guardado/modelo pendiente, cambio de idioma, respuesta tardía, borrador intacto y ninguna operación
duplicada por traducir. Capturas ES/EN inspeccionadas y regresión pertinente de documentos/drafts/catálogos.

## Integración

El checkout compartido está en `e967fb1`; upstream consultado el 2026-10-10 está en `4c6743b`.
Upstream ya incluye editor GM, comunidad y recursos M5. El cliente local también depende de CharacterScreen,
kit y catálogo visual de crafting aún ausentes de esa revisión. Publicar exige una integración aislada
que preserve los cambios de recursos/perfiles/GM; copiar todo el árbol local enviaría trabajo ajeno.
La entrega de publicación conserva su revisión exacta y prueba entrada/reconexión pública ES/EN.

## Reutilización

Revisados el [inventario Unreal](../research/unreal-assets/SUMMARY.md) y la
[shortlist ActionRPG](../research/unreal-assets/actionrpg/FINDINGS.md). `BP_TradeWindow.uasset` y widgets
empaquetados no resuelven los mensajes de IndexedDB del editor web. Se reutilizan el editor y los paneles
DOM actuales; no se genera arte ni se modifican las fuentes Unreal.
