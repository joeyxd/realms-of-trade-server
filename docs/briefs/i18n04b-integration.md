# I18N04b — integración bilingüe del cliente y editor GM

Fecha: 2026-10-10. Estado: **en verificación**. Se integra upstream `c9d3bbf` (fuego/fuel); código
`b5d5565`, alpha32/protocol42. Aún no se hizo push. La publicación y aceptación pública siguen pendientes.

## Alcance

I18N04b integra ES/EN en el cliente actual completo y el editor GM. En el cliente, QA local terminó
`PASS` con `errors: []`: 11 grupos de comprobación, incluido el juego solo con Worker, siete misiones y
nueve ramas de tatuajes, con 20 capturas en [evidencia del cliente](../delivery/i18n04b/client/evidence.json).
Está inspeccionado visualmente el carácter EN, habilidades ES, equipo móvil EN y mercado EN. Véanse
[character EN](../delivery/i18n04b/client/03-character-en.png),
[skills ES](../delivery/i18n04b/client/14-skills-es.png),
[mobile gear EN](../delivery/i18n04b/client/07-mobile-gear-en.png) y
[market EN](../delivery/i18n04b/client/17-market-en.png).

La evidencia local del editor, generada a las 22:26:49Z, registra seis grupos, ocho PNG y `errors: []`
en [su JSON](../delivery/i18n04b/editor/evidence.json). El código del editor quedó idéntico tras el
merge de fuego/fuel. Incluye una colisión IndexedDB reproducida en dos pestañas reales y respuestas locales simuladas para
guardar/importar/modelo y para conflicto remoto. El cliente remoto es un mock: no acredita CAS remoto,
credenciales ni permisos de servidor. La captura compacta ES fue revisada por ajuste del estado y ejes:
[conflicto compacto](../delivery/i18n04b/editor/09-compact-conflict-es.png).

Se mantienen GM02 (mapa generado, vista caminable y `BaseDecorationLayer`), GM03a (borradores remotos,
CAS, exportación y conflictos) y GM03b1 (revisiones de preparación, errores de foco, identidad hash y
permisos). No cambian SQL, feature flags ni autoridad de gameplay.

## Checks y pendientes

La repetición limpia de release, 14 archivos, terminó **107/107 PASS en 70.7 s** después de una primera
ejecución **106/107** que agotó tiempo en `servermovement` bajo carga WebGL. Editor + deployGM terminó
**122/122 PASS en 51.5 s** y firepanel/actions **13/13 PASS**. También se reportó un conjunto enfocado
de i18n/editor/chat/raft **49/49 PASS**. Estos grupos se solapan; no se suman como un total. Se verificó
que `server/`, `src/sim/` y `src/net/` no difieren de `c9d3bbf`.

El recorrido del cliente es local, con Worker solo y sin servidor desplegado, wallet ni autenticación
real. La prueba local de invitado no sustituye aceptación del sitio público; el recorrido público de
invitado y sus capturas siguen pendientes. Login/autenticación real, permisos autenticados y
reconexión pública también están pendientes. No hay aún aceptación de deployment.
