# W00a-equipo — ambas modalidades con reglas claras

Fecha: 2026-10-07. Dirección del autor: **apariencias coleccionables y equipo funcional comerciable**,
ambos dentro de reglas claras. Esto resuelve la elección entre variantes; no aprueba automáticamente
reglas nuevas de pérdidas, custodia, precios ni escrituras. [Plan](../../PLAN-WEB3.md).

## Reglas de diseño para el piloto

| Tema | Apariencia coleccionable | Equipo funcional |
|---|---|---|
| Qué se transmite | Derecho de usar un diseño compatible con una base de equipo | La instancia concreta, con base/nivel/rareza/afijos definidos por el servidor |
| Efecto mecánico | Cero estadísticas; conserva hitbox, colisión, animación y legibilidad del equipo base | Usa `itemStats`, rarezas, presupuestos y pools de afijos existentes |
| Comprar/revender | No entrega el arma ni duplica licencias | Conserva base/nivel/rareza/afijos; no hace reroll ni concede niveles/maestría/XP |
| Compatibilidad | Aplicable al equipo compatible que el jugador ya pueda usar | Equipamiento y restricciones normales; no introduce excepciones por precio o wallet |
| Origen/catálogo | Diseño aprobado con ID/hash y compatibilidad visible | Instancia de origen servidor verificado; el esquema de contenido por sí solo no acredita ese origen |
| Propiedad | Una copia tiene un único titular/uso; tiradas requieren contabilizar todas sus copias | Una instancia tiene una única identidad/titularidad/ubicación, incluida pérdida o recogida |

Reglas comunes: el catálogo fija contenido y derechos antes de publicar; cliente/metadata no declaran
stats ni permisos. Tirada, cantidades, precio total, comisiones, restricciones y riesgos son visibles.
La reventa conserva identidad/contenido; cualquier cambio de balance usa reglas generales del juego,
no estadísticas especiales compradas. Mantener equivalentes funcionales obtenibles jugando es la
recomendación de diseño; vías/drop rates, precios, tiradas y límites concretos aún por cerrar.

## Riesgo y progresión actuales, sin cambiar gameplay

`spillOnDeath` derrama mochila en toda zona; en Cala/lawless también equipo vestido y pociones,
excepto arma inicial. `equipItem` comprueba personaje vivo, objeto en mochila y slot compatible:
**hoy no exige nivel mínimo de personaje**. El nivel de objeto afecta stats y generación.
Por tanto, no anunciar un requisito de nivel inexistente ni una exención de pérdidas por comprar.
Una regla nueva de nivel o protección tendría que acordarse para todo el equipo afectado.

Recomendación para funcional: conservar el riesgo normal y cerrar muerte/pickup/expiry durables M5
antes de habilitarlo. Un NFT no restaura una pieza perdida mientras otro jugador conserva esa pieza.
Recomendación para apariencia: tratarla como licencia separada del botín físico; conservarla al perder
el arma y permitir usarla de nuevo sobre otra base compatible. Esa permanencia requiere acuerdo explícito
y proyección de licencias; no se implementa ni se da por aceptada en este corte.

## Contrato de contenido implementado en aislamiento

`server/web3/equipmentContent.mjs`: formatos exactos, sin precios, cliente, perfil ni wallet:

- Apariencia: `{v:1,mode:'appearance',baseId,appearanceId,appearanceHash}`. Base conocida y diseño/hash
  acotados; campos de stats/afijos/efectos se rechazan. El arte y su compatibilidad visual requieren revisión.
  Se valida el formato de `appearanceHash`; este módulo no descarga ni verifica los bytes del diseño.
- Funcional: `{v:1,mode:'functional',item:{b,r,l,a}}`. No contiene UID local `u`, flag starter `s` ni stats
  libres. Base propia del catálogo, enteros de nivel/rareza y afijos válidos según `sanitizeItem`;
  rechazar cualquier payload que necesite coerción/clamp/redondeo en vez de aceptarlo corregido.
- `equipmentDefinition(raw)` devuelve contenido aislado y validado.
- `equipmentStats(raw)` devuelve cero stats para apariencia y el mismo `itemStats` para funcional.
- `equipmentContentHash(raw)` calcula SHA256 del JSON canónico validado.
- `equipmentRegistration(raw,definition)` construye un request register W01 con hash calculado.
  raw tiene exactamente `operationId,assetId,worldId,worldGeneration,sourceKey,contentId,rightsHash,to`.
- `equipmentContentFor(asset,definition)` exige clase equipment y hash correspondiente; no acredita
  dueño, autorización, procedencia ni permiso de uso. W01 sigue siendo la fuente de titularidad.

El contrato usa reglas de saneado existentes; no endurece en gameplay el mínimo de base ni la cantidad
mínima de afijos. Una definición no prueba que un drop se haya generado legítimamente y no debe
usarse como entrada pública para mint. Catalogación/adopción/custodia quedan para su corte.
Importaciones firmadas y snapshots de cliente no crean activos Web3 automáticamente.

## Reutilización y aceptación

Reutilizar `src/data/items.js`, `src/sim/items.js` y W01. Inventario Unreal/FAB revisado: no sustituye
contratos ni autoridad; no se generan skins/modelos ni se modifican fuentes Unreal.
Pruebas: cosmético con stats rechazado; funcional válido conserva exactamente stats; afijos falsos,
coerciones/extras/starter/UID local rechazados; hashes canónicos y alteración detectada; registro de
ambas modalidades transferible en W01 sin mutar contenido. Sin sim/host/UI/SQL nueva ni despliegue.
