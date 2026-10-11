# AREA03 INV02b — Carga durable en M5

Sigue al [contrato INV02a](inv02a-durable-carry.md). Este corte conecta adopción,
asignación y reasignación a la cola económica existente. No añade otra autoridad ni una
pantalla de atributos. Estado y pruebas: [entrega INV02b](../delivery/inv02b-durable-attributes.md).

## Reglas y adopción

| Concepto | Contrato |
|---|---|
| Puntos ganados | `lvl - 1`, máximo nueve con el nivel máximo actual 10 |
| Estado opcional | `attr: {v:1,carga:0..9,re:0..1}`; inversión no mayor que puntos ganados |
| Carga cómoda / techo | `40 + 4*carga` / `50 + 5*carga`, unidades de juego |
| Mochila | Conserva volumen 18/30/42; subirla no cambia puntos ni techo de masa |
| Adopción | Explícita; nivel 1 puede adoptar con cero puntos; no ocurre al cargar |
| Pack anterior al taller | Solo el pack canónico `{cap:10,goods}` sin `carry`: adopta mochila básica 18 y masa 50 |
| Pack del taller | Conserva su mochila y todos sus objetos; adopta masa 50 |
| Asignación | Puede introducir `attr` si ya tiene `carry` válido y puntos disponibles |
| Reasignación | Una gratuita; inversión positiva, `re=0` y carga real no mayor que 50 |
| Rechazo | No cambia perfil, puntos, objetos ni mochila; los rechazos de gameplay también tienen recibo |

Un perfil anterior pesado conserva sus objetos. Puede adoptar/asignar si cabe en el nuevo
techo; si no cabe, recibe un rechazo sin recorte de inventario. La lectura preserva el DTO
legado sin `attr`. Un campo presente inválido se rechaza, sin clamping ni adopción implícita.

## Comandos y confirmación

```js
{type:'attributes',op:'adopt',opId,expectedRev}
{type:'attributes',op:'assign',opId,expectedRev,stat:'carga',n}
{type:'attributes',op:'reset',opId,expectedRev}
```

`opId` sigue `[A-Za-z0-9_-]{1,64}`; `n` es entero 1–9. El cliente no envía puntos,
capacidades ni un perfil candidato. El host construye el candidato a partir de su perfil
confirmado, captura `before` y las versiones exactas de perfil/mundo y usa el UUID económico
existente. El mundo solo puede avanzar su checkpoint de recursos de forma monótona.

La misma cola serializa comercio, taller, Tala y Carga. La reserva bloquea operaciones
incompatibles hasta el drain. No cambia el perfil vivo ni se envía éxito antes de confirmar
el commit. Una respuesta perdida consulta el recibo y reintenta la misma identidad/solicitud;
un resultado incierto mantiene el bloqueo. Un replay histórico devuelve el ACK original sin
reinstalar un perfil viejo. Cambiar el payload conservando `opId` se rechaza.

ACK de éxito: los seis campos `type,op,opId,ok,why,rev`, más `points` y `limits`.
El rechazo conserva solo esos seis campos y la revisión confirmada actual. La revisión del
comando puede estar atrasada: su rechazo es un no-op durable, no un fallo de persistencia.

## Persistencia y compatibilidad

[SQL029](../../server/migrations/029_attribute_operations.sql) es aditivo después de SQL001–028.
No actualiza perfiles ni reescribe recibos. Valida el candidato contra filas bloqueadas y
comparte `mn_economic_operations`, CAS y namespace de UUID con M5. Los demás comandos
económicos y el autosave conservan `attr`; solo la operación de atributos puede introducirlo
o gastarlo. El taller mantiene la masa derivada al aumentar volumen. El crédito cooperativo
de Tala conserva Carga en beneficiarios desconectados y al reconectar.

`MN_ATTRIBUTE_OPERATIONS=1` es opt-in, requiere taller habilitado y readiness SQL
`mn_attribute_operations_ready() -> {version:1}` antes de abrir el mundo. Predeterminado:
apagado, con rechazo explícito `disabled`. El despliegue del código puede preceder a SQL;
la activación requiere SQL aplicado y canario propio. Protocolo 49, alpha.43: recargar peers.

## Lo que sigue

INV02c: ficha ES/EN para puntos, Carga cómoda/techo y estado pendiente/rechazado; adopción
visible y confirmación del perfil; mismo contrato para acciones de agentes autorizadas.
Después: lentitud y dash compartidos entre host/predicción, con descarga que recupera velocidad.
Hambre/sed, comidas, huecos/pilas, party y flotabilidad conservan sus cortes separados.

No se crean assets: se reutilizan mochila, taller y bodega existentes; revisado el inventario
[D06-REUSE](../research/unreal-assets/D06-REUSE.md). Los Blueprints son referencia visual,
la autoridad sigue en la simulación JS/M5.

Referencias: [M5 económico](m5-economic-authority.md), [taller](prg01d-starter-workshop.md),
[continuidad de aprendizaje](prg01b1-profile-continuity.md), [estado](../CONTINUITY-STATUS.md).
