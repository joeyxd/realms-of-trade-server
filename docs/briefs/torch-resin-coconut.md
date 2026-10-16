# Antorchas de campo, resina y cocos

Solicitud del autor, 2026-10-12. Receta elegida: **2 troncos + 1 resina**, desde
el inventario y sin banco. Este corte incluye las dos correcciones existentes:
idioma del panel de fuego en móvil y estadísticas ocultas por Fabricar a 1280×720.

## Contrato antes de implementar

- Conservar `fire/load` como operación única de crear/cargar la antorcha de mano.
  Cada carga consume exactamente 2 `tronco` y 1 `resina` de la mochila y dura
  20 minutos de simulación activa. Encender/apagar conserva el combustible pagado.
  Los fuegos de balsa conservan su receta de 1 tabla; no cambiar materiales globales.
- Añadir bienes `resina` (volumen 0,25, masa 0,2) y `coco` (volumen 1, masa 0,5).
  No son equipo ni campos nuevos de perfil: usan el inventario validado existente.
- Al completar una tala, el talador recibe, además de los troncos normales,
  una resina con probabilidad inicial del 35 % y un coco con probabilidad del 40 %.
  Solo las palmeras producen cocos. Los golpes previos no conceden extras.
  Conservar contribuciones, calidad y experiencia de tala existentes.
- Calcular cada extra desde ID estable, revisión final del nodo y bien mediante
  hash entero determinista compartido con SQL. Reintentos, recibos repetidos y
  reinicios no vuelven a sortearlo. No alterar el RNG de generación del mapa.
  Inventario, tala y extras se confirman juntos o se rechazan juntos si no caben.
- Consumir un coco por la operación de comida existente: +25 hidratación, máximo
  100, sin bonificación temporal ni efecto de saciedad. El servidor valida el
  descuento y la hidratación exactos; conserva recibos, CAS y permisos existentes.
- La inspección del mapa actual confirmó 234 palmeras y 342 arbustos, sin otro
  tipo de árbol; 96 palmeras pertenecen al roster base talable, además de las GM.
  Este corte cubre los árboles existentes sin crear un tipo para contenido ausente.
  Un futuro árbol no palmera deberá dar resina y excluir cocos al incorporarse
  con su propio modelo y admisión durable; no reclasificar arbustos como árboles.
- SQL037 nueva y reaplicable compone los contratos 001–036 y preserva recibos
  históricos. Publicación/activación requiere comprobar su readiness semántico;
  la migración se entrega al autor para aplicarla en Supabase.

Los porcentajes y +25 son valores iniciales ajustables, no balance aceptado.
No se necesita una nueva autoridad ni una versión de estado de recursos. El
protocolo 60 anuncia `resources.lootRules=1` y `fire.torchRules=2` al activar
`MN_TORCH_RESIN_COCONUT_OPERATIONS=1`. Los comandos nuevos llevan su regla;
los recibos históricos conservan su contrato. La activación requiere taller,
tala, fuego y supervivencia durables y readiness SQL037; el host rechaza un
cliente que intente usar el coste antiguo en un mundo con la regla nueva.

## Arte y reutilización

Revisados atlas `assets/ui/kit/{items,misc}.webp`, guía
`docs/art/tripo-items-v1.md` e inventario Unreal/FAB. Hay antorcha pintada y tronco,
pero no iconos específicos de coco/resina. `SM_Torch` de Dreamrise está listado
sin exportación/aceptación; no sustituye las referencias solicitadas por el autor.

Crear iconos de resina/coco con alfa real, pintura saturada, sombras por bandas
y contorno de tinta inspirado en Borderlands. Derivados WebP: 128 px escritorio,
64 px móvil. Conservar originales fuera del bundle, en
`docs/art/torch-resin-coconut-v1/`.

Entregar referencias independientes para Tripo3D: antorcha apagada, resina y coco
entero; un objeto por imagen, vista tres cuartos, sin texto/sombra/contorno de tinta.
La llama sigue como efecto separado. Objetivo: antorcha ~1.000 triángulos,
resina/coco 500–800; texturas 512/256. El autor crea los meshes; este corte no los
declara recibidos ni integrados.

## Aceptación

Pruebas focales de coste exacto, falta de materiales, límites de mochila,
extras solo al finalizar, replay/reinicio, falsificación SQL, consumo y clamp
de hidratación, y conservación de recetas/recibos anteriores. Capturas inspeccionadas
EN/ES, 1280×720 y móvil para panel de fuego, fabricación y consumo. Separar pruebas
locales, migración preparada y publicación pública comprobada en la entrega.
