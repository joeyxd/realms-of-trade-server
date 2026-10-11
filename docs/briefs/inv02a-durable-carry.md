# AREA03 INV02a — puntos de Carga y frontera durable

Checkpoint 2026-10-10. Sigue al [taller PRG01d aceptado](../delivery/prg01d-starter-workshop.md).
El primer subcorte implementa un cálculo puro sin montarlo en gameplay. La siguiente entrega debe
conectar ese cálculo a M5 antes de mostrar una asignación como confirmada.

La dirección aprobada está en `PLAN-PROGRESSION.md`, §15.7, del checkout IDE compartido. El borrador
`../inv02-survival` conserva trabajo de Carga, hambre/sed y comidas; no se copia ni publica entero.
Su protocolo 47 ya lo utiliza el purificador publicado. Su SQL028 candidato tampoco constituye una
operación durable de asignación: no aplicarlo para activar este contrato.

## Reglas adoptadas

| Concepto | Regla |
|---|---|
| Puntos | Un punto por nivel después del primero; con el nivel máximo actual 10, hasta nueve |
| Carga cómoda | 40 + 4 por punto invertido |
| Techo de masa | 125 % de la cómoda: 50 + 5 por punto |
| Volumen | Conserva las mochilas 18/30/42 del taller; Carga no añade volumen |
| Personajes anteriores | Puntos de su nivel disponibles, sin inversión automática |
| Reasignación | Una gratuita; requiere puntos invertidos y que la masa quepa bajo el nuevo techo de 50 |
| Objetos | Se conservan todos, también ante rechazo o un perfil legado sobrecargado |

Estas son unidades de juego, no kilogramos físicos. La lentitud al 70 %/40 % y el bloqueo de dash
aprobados para INV02 se integrarán con movimiento/predicción después de la operación durable.
Hambre, sed, comidas, huecos/pilas y flotabilidad quedan fuera de este subcorte.

## Contrato puro implementado

[`attributes.js`](../../src/data/attributes.js) lee exactamente `attr: {v:1,carga,re}` y calcula
puntos. [`attributePlan.js`](../../src/sim/systems/attributePlan.js) expone
`planAttributeChange(profile, command)`; no tiene imports desde el host, UI o guardado.

```js
{type:'attributes',op:'assign',opId,expectedRev,stat:'carga',n}
{type:'attributes',op:'reset',opId,expectedRev}
```

`opId` sigue el identificador económico `[A-Za-z0-9_-]{1,64}`; `expectedRev` debe coincidir con
`eco.tradeRev`. El comando no acepta campos adicionales ni autoridad/capacidad suministrada por el
cliente. El perfil debe tener un `carry` válido del taller y un pack canónico. Un `attr` ausente
conserva su DTO legado; un `attr` presente inválido, futuro o con más puntos que los ganados se rechaza.

Antes de asignar se comprueba la capacidad guardada: fórmula vigente de `carryLimits` si aún falta
`attr`, o `50 + 5*carga` si ya existe. No se recalcula el pack al leerlo. En éxito se clona el perfil
y solo se cambian `attr`, `eco.pack.maxMass` y `eco.tradeRev`. Se devuelve el perfil candidato,
los puntos y los límites calculados. En rechazo se devuelve la referencia original, sin mutarla.

Un resultado `ok:true` de este módulo **solo describe un candidato válido**. No es un ACK durable,
un recibo ni una garantía de replay. Repetir contra el estado ya aplicado produce conflicto de
revisión; recuperar el mismo recibo corresponde al futuro montaje M5.

## Orden de implementación restante

1. **Operación M5:** integrar `attributes` en el namespace económico existente, serializada con
   comercio/taller/Tala, usando perfil anterior y versiones exactas de perfil/mundo. No mutar el
   perfil vivo ni enviar éxito antes del commit confirmado. Ante timeout conservar la misma identidad
   y candidato para consultar/reintentar el recibo; UUID o payload distintos no equivalen al mismo intento.
2. **Compatibilidad y SQL:** validar la transición exacta contra filas bloqueadas y conservar recibos
   históricos. Separar la adopción de Carga del saneado al cargar. Hace falta una vía explícita para
   el nivel 1 sin puntos, los packs previos al taller y el baseline nuevo de 50; no adoptarlos como
   efecto lateral de un comando rechazado. Una vez adoptado `attr`, los demás comandos deben conservarlo
   y derivar el mismo límite. Revisar comercio, taller, muerte, reconexión y crédito de Tala offline.
3. **Protocolo y UI ES/EN:** acordar el siguiente número libre, ficha con puntos disponibles, peso
   cómodo/techo y confirmación pendiente/rechazada. Una sola reasignación; no anunciar éxito optimista
   como guardado. Los agentes usan la misma operación y reglas.
4. **Movimiento:** compartir cálculo de sobrepeso en autoridad y predicción; caminar nunca se bloquea,
   descargar recupera velocidad, nadar y navegar respetan sus contratos actuales.
5. **Aceptación:** asignar/reintentar/reconectar/reiniciar sin duplicar puntos; conflicto y pérdida de
   respuesta, reset vacío/usado/pesado, transición legado sin pérdidas, Tala cooperativa con beneficiario
   offline y compras/crafting/transferencias. Después canario autenticado y navegador ES/EN con una
   sola autoridad. Mantener separado el despliegue de la activación.

El borrador anterior confirma el gasto en memoria y programa un guardado posterior; además cambia
el pack durante saneado, lo que puede romper la comparación exacta de un beneficiario offline de Tala.
Esos dos caminos no se reutilizan. Este corte no necesita ejecutar otra migración SQL.

Referencias: [autoridad económica M5](m5-economic-authority.md),
[contrato del taller](prg01d-starter-workshop.md),
[continuidad del aprendizaje](prg01b1-profile-continuity.md),
[estado de servidor](../CONTINUITY-STATUS.md),
[entrega INV02a](../delivery/inv02a-carry-contract.md).
