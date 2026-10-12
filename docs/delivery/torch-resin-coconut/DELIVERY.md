# Antorcha de campo, resina y coco — entrega local

2026-10-12. Implementación sobre `codex/gm-editor-first`, protocolo 60.
[Contrato y balance inicial](../../briefs/torch-resin-coconut.md).

## Continuación de publicación — alpha.65

El autor indicó que ejecutó SQL037 y pidió continuar. La primera comprobación
desde el contenedor real, usando `service_role`, obtuvo `PGRST202` para
`mn_torch_resin_coconut_ready()`; fuego y supervivencia existentes devolvieron
versión 1. El servidor permanecía sano en alpha.64, sin jugadores ni errores.
La activación espera confirmar que la migración completa está visible en ese
proyecto. [Sonda de solo lectura](supabase-before-release.json).

Integrados los cambios concurrentes de cocina y compañeros hasta `9349d7c`;
se conservan los iconos individuales de coco/resina y el atlas de cocina.
[Regresión combinada 100/100](release-integration/tests.json) y
[navegador combinado 4/4](release-integration/browser/evidence.json).
Capturas de fabricación y consumo inspeccionadas; son comprobaciones locales.

## Resultado jugable

- Fabricación a mano de antorcha: **2 troncos + 1 resina**, sin banco; 20 minutos
  de simulación activa por carga. Los fuegos de balsa siguen usando una tabla.
- Al completar la tala de una palmera: 35 % de una resina y 40 % de un coco,
  con tiradas separadas y reproducibles por identidad/revisión. El golpe final
  concede troncos y extras juntos; se rechaza todo si no cabe en la mochila.
- Coco consumible desde Inventario → Agua y provisiones: +25 hidratación, máximo
  100, sin saciedad. El resultado se guarda junto con el descuento del objeto.
- Panel de fuego sigue la preferencia ES/EN, incluso si cambia mientras está
  abierto. Fabricación muestra estadísticas completas y botón accesible a 720p
  y en móvil horizontal; los detalles ya no invaden la columna de inventario.
- Resina y coco tienen iconos pintados con alfa, 128 px en escritorio y 64 px
  en móvil. Los originales no forman parte de la carga normal del juego.
- Ambos bienes pueden depositarse y retirarse de la bodega; asignar atributos
  conserva sus cantidades y valida el peso y volumen reales. No están dados de
  alta en los mercados ni en los presupuestos de comercio de agentes.

Los árboles actuales son palmeras; no hay otro tipo de árbol talable en el mapa.
Se incluyen palmeras base y las admitidas por GM. No se han añadido meshes nuevos:
el autor los creará en Tripo3D con las referencias entregadas.

## Arte para Tripo3D

[Paquete ZIP](../../art/torch-resin-coconut-v1/tripo-and-icons.zip), con tres
referencias independientes y dos iconos originales transparentes.

- [Antorcha apagada](../../art/torch-resin-coconut-v1/torch-tripo-reference.png)
- [Resina](../../art/torch-resin-coconut-v1/resin-tripo-reference.png)
- [Coco entero](../../art/torch-resin-coconut-v1/coconut-tripo-reference.png)
- [Prompts exactos, dimensiones y presupuesto](../../art/torch-resin-coconut-v1/README.md)

La llama se mantiene como efecto separado. La integración de GLB espera los
modelos del autor; los iconos ya están conectados al inventario y fabricación.

## Activación pendiente en Supabase y servidor

La ejecución de SQL037 está reportada por el autor; su readiness público sigue
pendiente. No se ha cambiado la configuración pública ni publicado este corte.
La instalación vigente mantiene sus reglas hasta activar
la nueva capacidad; los recibos históricos conservan su coste original.

1. Aplicar [037_torch_resin_coconut.sql](../../../server/migrations/037_torch_resin_coconut.sql)
   en el SQL Editor del proyecto, después de las migraciones 001–036. Es
   transaccional y reaplicable; revalida también los recibos ya guardados.
2. Comprobar desde SQL Editor:

   ```sql
   select public.mn_torch_resin_coconut_ready();
   ```

   Debe devolver exactamente `{"version":1}`. El servidor repite la comprobación
   como `service_role` y rechaza el arranque de la capacidad si no está lista.
3. Publicar el cliente y servidor compatibles con protocolo 60, manteniendo las
   autoridades existentes, y activar `MN_TORCH_RESIN_COCONUT_OPERATIONS=1`.
   Requiere `MN_STARTER_WORKSHOP=1`, `MN_FIRE_OPERATIONS=1` y
   `MN_CANTEEN_OPERATIONS=1`, con sus dependencias habituales. No activar la
   autoridad opcional de transacciones de suelo para este corte.
4. Confirmar revisión e imagen activas, salud pública, `foraging.enabled/ready`,
   conexión real, tala, receta y consumo con persistencia antes de declarar
   aceptación pública. El actualizador no aplica SQL ni activa este flag.

## Evidencia

- [Navegador local 4/4](local/accepted/evidence.json): Chrome a 1280×720 en ES/EN,
  844×390 en EN y 390×844 en ES (el juego rota su escenario horizontal en retrato).
  Cuenta local desechable mediante GameHost; coste y consumo confirmados, cambio
  de idioma con panel abierto, cero errores de página y respuestas HTTP 200 para
  ambos iconos. En móvil se cargaron exclusivamente sus variantes de 64 px.
- Capturas inspeccionadas de antorcha/hacha, panel vacío/encendido y coco en
  inventario. [Hacha 720p](local/accepted/desktop-es-craft-hacha_piedra.png),
  [hacha móvil](local/accepted/phone-en-craft-hacha_piedra.png),
  [fuego EN móvil](local/accepted/phone-en-fire-empty.png),
  [coco móvil](local/accepted/phone-en-inventory-coconut.png).
- [Regresión focal final: 149/149](regression-final.tap),
  [catálogo e idioma: 14/14](catalog.tap) y [pruebas de cierre: 30/30](final-focused.tap).
  Cubren servidor, recibos, reintentos, reinicio, capacidad, tala, combustible,
  inventario, supervivencia y contratos históricos. Los conteos se solapan.
- [SQL037 final: 9/9](sql-final.log), con las migraciones 001–037 en PGlite:
  reaplicación, permisos, readiness, tala atómica, recibos históricos, consumo,
  coste exacto, depósitos/retiradas de ambos bienes, denegaciones de mercado y
  resina comunitaria, atributos y bodega con recipientes. La
  [regresión SQL anterior: 23/23](sql.tap) incluye fuego y supervivencia heredados;
  la suite final vuelve a cubrir SQL037 después de los adaptadores de compatibilidad.
- La comprobación adicional `i18n04b-character.test.mjs` tiene un fixture antiguo
  sin `attributes.html`. Se reprodujo el mismo fallo en una exportación limpia
  de `30a1ba3e2d5fff1dbe753d61c35945a94e58ab93`:
  [evidencia de base](baseline-character.tap). No se declara la suite general verde.

Pruebas locales y emulación móvil; balance y FPS en dispositivo físico siguen
sin aceptación. Ninguna captura local demuestra publicación ni estado de Supabase.
