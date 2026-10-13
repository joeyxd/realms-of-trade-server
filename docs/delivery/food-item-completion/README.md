# Alimentos actuales: utilidad, valores y carga cómoda

2026-10-13. [Contrato](../../briefs/food-item-completion.md). El autor eligió cerrar los
alimentos actuales y continuar con las mochilas existentes. Este corte no cambia recetas,
costes, atributos persistentes, protocolo ni SQL.

## Cambios comprobados localmente

- Guía desplegable ES/EN en provisiones e inventario para doce mercancías existentes:
  pescado, fruta, harina, galleta, ron, agua, caña, especias, coco, resina, tronco y tabla.
  Descripción, utilidad, volumen, masa y valor base por unidad; cifras obtenidas de los
  catálogos actuales. Consultar la guía no consume objetos ni envía órdenes.
- Seis alimentos normales muestran su recuperación inmediata. Las tres comidas especiales
  explican ingredientes, recuperación, efecto, duración conectada, reemplazo y pérdida al
  reaparecer. Los medidores mantienen su límite de 100.
- Las dos barras de carga de la ficha usan el cálculo compartido con la simulación:
  la galleta reforzada suma 10 de carga cómoda, y el bonus desaparece al caducar o cambiar
  la comida. El techo de masa y el volumen no cambian.

| Comida | Ingredientes actuales | Recuperación | Efecto durante 15 minutos conectado |
| --- | --- | --- | --- |
| Pescado asado | 1 pescado, estación propia encendida cercana | 35 saciedad | +10 % vida máxima |
| Grog | 1 ron + 1 agua | 5 saciedad, 55 hidratación | +25 % recuperación de aguante |
| Galleta reforzada | 1 galleta + 1 harina, estación propia encendida cercana | 25 saciedad | +10 carga cómoda |

Se preparan y consumen en una sola acción; también restauran hasta 5 % de vida máxima.
Solo hay un efecto activo. El temporizador se pausa sin conexión.

## Evidencia

- **38/38**: `meal-carry-presentation`, `meals-core`, `meals-host`, `meals-panel`,
  `freshwater-panel`, `torch-resin-coconut` y `torch-resin-coconut-host`, con
  `node --test --test-concurrency=1`. Incluye consumo, autoridad, recibos, replay,
  reinicio del host de prueba y regresión de ambas barras de carga.
- **6/6 configuraciones Chromium locales**, 24 capturas ES/EN escritorio, móvil y móvil
  rotado: [evidencia](local-final/evidence-2026-10-13T06-09-23-902Z.json).
  Panel real con cliente de prueba, sin cuentas ni escritura pública. Comprobados doce
  registros, seis alimentos, tres resultados, proporciones fraccionarias de resina,
  receta completa de antorcha y guía abierta conservada al actualizar.
- **1/1** `tests/item-models.test.mjs`: conservada la integración existente de modelos.
  [Entrega de arte y límites](../item-models-v1/DELIVERY.md).
- **4/4 configuraciones locales de CharacterScreen**, 20 capturas ES/EN escritorio y
  móvil girado: [evidencia](character-verified/evidence-2026-10-13T06-28-04-182Z.json).
  Constructor, render y actualización de regiones reales con perfil de prueba; bonus
  40→50→40, guía conservada abierta y lectura con scroll. La revisión detectó y corrigió
  el solapamiento de la guía con los detalles del objeto en pantallas bajas. La figura
  3D no se carga en este fixture; no acredita interacción pública o teléfono físico.

Los modelos de antorcha, resina y coco tienen su conexión de gameplay existente.
Los otros nueve modelos de cocina/propuesta son decoración GM bajo demanda; una malla
colocada no crea comida recogible. Lima, hierbas y sal siguen como propuestas.

## Continuidad

Publicado y verificado en **`a21c47f0fe6acbc3c63682b1aaa3b87acbeb4ccf`**, alpha.67,
protocolo 60. [Prueba de runtime](public-runtime.json): una autoridad saludable,
los siete archivos de UI/CSS coinciden con Git en el contenedor y por HTTPS;
cocina y taller habilitados, cero errores o escrituras pendientes en esa lectura.
El actualizador pasó **197/197** antes del relevo. Entrada pública y controles reales
comprobados por el canario de [INV03](../inv03-existing-backpacks/README.md), **22/22**,
con cuentas temporales eliminadas y recibos conservados.
La integración con los cambios concurrentes pasó **36/36** en
`meal-carry-presentation`, `meals-host`, `ground-pearl-command-route` y
`ground-pearl-swallow` (subconjunto solapado con la cohorte anterior).

[INV03](../inv03-existing-backpacks/README.md) comprueba las dos mejoras de mochila ya
implementadas. [Fibra, techumbre y cuero](../../briefs/plant-fiber-thatch-leather.md) recoge
la nueva dirección solicitada, pendiente de recetas y balance. No introduce todavía
mercancías, botín, techos ni curtido.
