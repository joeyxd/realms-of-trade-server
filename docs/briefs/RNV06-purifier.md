# RNV06 — purificador útil a bordo

Corte AREA07 posterior a [RNV05](RNV05-coastal-swimming.md). Objetivo: construir un módulo que
produzca agua dulce real y preparar carga para el viaje. Implementación prevista alpha.39/protocolo 47;
la aceptación local y la publicación se registran por separado en la [entrega](../delivery/rnv06-purifier.md).

## Contrato jugable

- El editor B permite colocar el purificador existente sobre una cubierta/piso libre con soporte vivo.
  Cuesta **3 hierro y 2 tablas**, tomadas primero de la bodega y después de la mochila. Conserva peso 3,
  HP 30, ocupación de una casilla y los controles de propiedad, revisión, geometría y ocupantes actuales.
- Filtro pasivo: **una unidad de agua dulce cada 96 segundos simulados** (10 por día de juego).
  Usa el reloj económico y lotes enteros de la producción montada; no lleva combustible ni ingredientes.
  El techo no modifica esta tasa. `roofBonus` del helper económico antiguo no se activa en este corte.
- El agua va a la bodega propia, ocupa volumen/masa reales y usa las transferencias y mercados existentes.
  H/toque → Bodega → Producción muestra receta, ritmo, fracción y motivo de pausa en ES/EN.
  No se añade una necesidad de sed/hambre, un efecto sobre natación ni un consumible de curación.
- Producción conectada y amarrada. El viaje activo —también al caminar a bordo o bajar al agua— pausa
  el trabajo hasta volver a atracar; no se acumula tiempo durante esa pausa ni offline.
  La proyección privada identifica `voyage`; el panel de carga normal sigue cerrado durante el viaje.
- Bodega llena conserva la fracción y espera espacio, sin perder ni crear un lote parcial. Una pieza
  destruida conserva su fracción, deja de trabajar y muestra `broken`; reparar permite
  continuar. Retirar la pieza elimina su fracción y usa el salvamento habitual según su condición.

## Autoridad y conservación

`stepRaftProduction` es el único cálculo de lotes; `stepRaftWork` lo monta en el avance económico
actual y comprueba porte y tamaño del guardado antes de mutar. `raftWorkStatus` comparte esa lectura con
el panel privado de carga. No se monta `stepRaft` legacy ni un temporizador adicional.

Las fracciones siguen la tupla completa de la pieza en `grid.work`. Los lotes avanzan una vez las
revisiones de nave y comercio por paso; la producción solicita el guardado de perfil existente. Colocar,
reparar y retirar usan la autoridad normal del editor y su guardado de perfil. No son nuevas operaciones
SQL atómicas de construcción/producción ni recibos de taller: SQL024/026 continúa acotado a bodega/caja.
Reintentos del editor se deduplican durante la sesión con el contrato actual. Recarga/reentrada ordenada
debe conservar piezas, agua y fracciones; crash durability de todos estos pasos queda fuera de esta aceptación.

La proyección pública contiene solo piezas/condición. Agua, progreso y eventos de producción son privados
del dueño. No cambia permisos de visitantes ni permite editar durante un viaje.

## Reutilización de arte

Revisión acotada Unreal/FAB, fuentes intactas: se conserva el purificador procedural ya implementado en
`src/render/rafts.js` y el atlas naval existente; no se añaden texturas, luces ni modelos exportados.
El inventario no identifica un purificador portable aceptado. Candidatos adyacentes verificados en disco:

- Dreamrise `Assets/Meshes/SM_WaterBottle.uasset` (22.030 bytes), botella de referencia por nombre,
  sin exportación ni apariencia aceptadas; no sustituye el módulo.
- Dreamrise `Assets/Meshes/SM_RepairBench.uasset` (101.896 bytes), banco ajeno a esta necesidad.
- MyProject `Content/BigNiagaraBundle/NiagaraWeather/Effects/NS_Rain.uasset` (425.052 bytes) y
  `Content/SlashTrailElemental/Resource/Texture/T_water.uasset` (152.854 bytes), efectos/materiales
  Unreal sin puente Niagara ni lógica portable de producción.

Referencias: [inventario](../research/unreal-assets/SUMMARY.md),
[reutilización económica](../research/unreal-assets/D06-REUSE.md) y
[cadena de producción](../research/unreal-assets/D06B-REUSE.md).

## Aceptación y continuidad

Comprobar colocación pagada/repetida/rechazada, fracciones, ritmo, bodega llena, porte/tamaño, daño/reparación,
pausa de viaje, privacidad y conservación ordenada mediante la autoridad real. Revisar por navegador
PC ES y móvil EN emulado: editor, módulo visible, producción y transferencia de agua. Dispositivos físicos,
balance y producción navegando requieren aceptación propia.

SQL026 está instalado y la recuperación histórica del taller terminó. Al cerrar este corte, el VPS
tenía otro bloqueo de Tala; `d962055` corrigió su base económica y su frente recuperó el VPS.
La entrega registra la observación sana y después verificará la revisión pública del purificador.

Sigue el viaje comercial Salty Shore–Puerto Sol del [plan AREA07](area07-naval-action-plan.md), coordinando
anclas transitables y mercados con AREA01/08. Huerto/hamaca se mantienen como módulos posteriores separados.
