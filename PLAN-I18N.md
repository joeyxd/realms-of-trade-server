# Español e inglés para el alfa y la campaña

Fecha: 2026-10-09. Actualizado 2026-10-10: I18N04b integra la localización del cliente y el editor GM;
se incorpora upstream `c9d3bbf` (fuego/fuel), código `b5d5565`, alpha32/protocol42. QA browser local y
release/editor/deployGM/firepanel suites pasan; recorrido público y aceptación de deployment pendientes.
Se conservan como
antecedentes locales [I18N01](docs/delivery/i18n01.md), [I18N04a](docs/delivery/i18n04a.md) y el
[glosario común](docs/i18n/glossary.md). Revisión pública y promoción pendientes.

Todo el alfa y la campaña de lanzamiento/promoción deben estar en **español e inglés**, con elección de idioma desde la
entrada al juego y cambio disponible en ajustes. Ambas versiones comparten mundo, personajes, progreso,
reglas y contenido. Aprender idiomas como habilidad y las barreras lingüísticas de puertos se posponen,
conforme al diseño general descrito en PLAN-PROGRESSION.

El primer resultado visible es **abrir el juego, elegir Español/English y entrar con menú, cuenta y conexión
en ese idioma**. Después se completa el recorrido de llegada a Salty Shore y su primera actividad, antes
de ampliar al resto del alfa. [PLAN-DELIVERY](PLAN-DELIVERY.md) conserva el orden operativo y M5 la
única autoridad de guardado; la localización acompaña las entregas jugables.

## 1 Cobertura y punto de partida

La preferencia debe estar disponible antes de crear personaje, iniciar sesión o aceptar una misión. Abarca
texto visible, ayuda, tooltips, etiquetas accesibles, mensajes de error, controles, diálogos y objetivos;
también texto integrado en imágenes o escenas cuando comunique información necesaria para jugar.

| Superficie | Punto de partida histórico (antes del corte I18N) | Cobertura requerida |
|---|---|---|
| Arranque | `index.html` declara `lang="es"`; errores y avisos escritos en español | Elección temprana, carga/fallo legibles, descripción y etiquetas accesibles coherentes |
| Entrada y cuenta | `title.js`, `pause.js`, `account.js` y `accountAuth.js` contienen frases directas | Menú, nombre/aspecto, invitado/cuenta, ajustes/controles, validación y reconexión |
| Primera sesión | HUD, tutorial, tracker, diálogo y avisos repartidos entre `src/main.js` y `src/ui/` | Instrucciones y recorrido inicial completos en ambos idiomas |
| Campaña jugable | `src/data/quests.js` mezcla textos de misión/NPC con objetivos y recompensas | Títulos, diálogos, objetivos, progreso y recompensas de todas las ramas disponibles |
| Sistemas del alfa | Paneles de combate, perlas, equipo, recursos, banco, construcción, navegación, mapa, comercio y comunidad | Nombres/descripciones, acciones, requisitos, precios, unidades, confirmaciones y rechazos |
| Convivencia | Chat y paneles de agentes/cuenta/wallet cuando estén expuestos al jugador | Controles y avisos traducidos; contenido escrito por personas conservado |
| Lanzamiento y promoción | Alcance confirmado por el autor; materiales concretos se preparan por entrega | Página de campaña, convocatoria, anuncios, descripciones públicas y FAQ en ambos idiomas |

La base común vive en [`src/core/locale.js`](src/core/locale.js) y
[`src/core/i18n.js`](src/core/i18n.js), con preferencia local `mn.locale`, independiente de
[`src/core/settings.js`](src/core/settings.js) y del guardado del personaje. Los catálogos de `src/data/`
conservan sus identificadores y reglas; los nombres de presentación se resuelven en el cliente.

**Aclaración del autor: «campaña» significa lanzamiento y promoción.** Página de campaña, anuncios,
descripción pública, FAQ y mensajes de convocatoria necesitan versiones equivalentes y revisión propia.
Los diálogos y misiones disponibles siguen incluidos como parte del alfa; no se amplía por esta decisión
la historia del juego. El primer alcance es texto y subtítulos del contenido publicado; doblaje por definir.

## 2 Elección del idioma

Comportamiento implementado y comprobado localmente en I18N01–03:

1. Ofrecer **Español / English**, con sus nombres propios, en la entrada y en ajustes; sin banderas ni
   requisito de cuenta. Seguir siendo localizable aunque el arranque del juego falle.
2. Recuperar una elección válida guardada en el navegador. Sin elección previa, usar el idioma preferido
   compatible del navegador (`es` o `en`); si ninguno coincide, español como respaldo inicial.
3. Recordar un cambio explícito de forma local. Si el almacenamiento está bloqueado, permitir jugar y
   cambiar idioma durante la sesión. Guardarlo entre dispositivos puede añadirse después sin bloquear el alfa.
4. Cambiar textos, formatos y `document.documentElement.lang` sin reiniciar mundo/partida ni reenviar acciones.
   Conservar nombre escrito, campos de formulario, foco, selección de personaje, sesión, panel abierto,
   objetivos, precios/cotizaciones y operaciones pendientes. Una respuesta tardía se muestra en el idioma actual.
5. Traducir pantallas ya abiertas y mensajes de sistema que sigan visibles a partir de su clave/datos.
   Nunca volver a emitir una recompensa, sonido o notificación de gameplay para refrescar su texto.

Las preferencias visuales pertenecen al cliente. Cambiar idioma no crea un campo de progreso, una migración
SQL o una segunda autoridad de guardado. Un personaje puede jugar hoy en español y mañana en inglés.
Dos jugadores pueden compartir servidor con idiomas diferentes y obtener los mismos resultados.

## 3 Textos y contratos de juego

La implementación usa un módulo común de traducción, catálogos locales `es`/`en` y claves estables por función
(`menu.play`, `quest.tierra.title`, `trade.denied.capacity`). Organizar por dominio cuando crezca el contenido;
no incorporar un servicio de traducción remota ni descargas por frase al recorrido del jugador.

- **Frases completas:** parámetros explícitos y pluralización para cantidades; evitar concatenar palabras
  que obliguen a conservar el orden del español. Formatear números/unidades para la presentación; precios,
  ticks y valores del servidor conservan su forma numérica original.
- **Datos separados de texto:** resolver nombre y descripción por ID de misión, mercancía, objeto, habilidad,
  recurso o lugar. Conservar condiciones, objetivos y recompensas comunes a ambos catálogos. Migrar todos
  los consumidores de cada superficie, incluidos tooltips, eventos y nombres cacheados.
- **Errores identificables:** convertir códigos conocidos de red/Auth a claves y parámetros. Un error
  inesperado obtiene un mensaje genérico traducido; no mostrar mensajes crudos del proveedor o servidor.
- **Contenido seguro:** parámetros de jugador como texto, con escape apropiado donde exista HTML. Mantener
  estructura/estilos fuera de la traducción y no interpretar texto del chat o traducciones como comandos.
- **Respaldo controlado:** una clave faltante puede recuperar español y emitir diagnóstico de desarrollo;
  una entrega aceptada no depende de ese respaldo para sus textos ingleses. Verificar paridad de claves,
  parámetros y formas plurales antes de publicar el corte.

Los IDs actuales pueden estar en español y siguen siendo estables: `madera`, `sable`, `tierra`, `aldea`,
tipos de comando/evento, claves de perfil y códigos de rechazo **no se traducen**. No comparar etiquetas
visibles para decidir gameplay ni cambiar el protocolo solo para mostrar otro idioma. Cualquier contrato
de eventos que necesite datos estructurados se revisa expresamente por entrega.

Nombres elegidos por jugadores y chat humano se muestran como fueron escritos. No se añade traducción
automática ni se obliga a separar comunidades por idioma. Los agentes conservan permisos y límites;
localizar su interfaz no modifica su autoridad. Retos y mensajes firmados de wallet conservan sus bytes:
se traduce la explicación que los acompaña, sin reescribir el contenido que se firma.

## 4 Terminología y contenido

Usar el [glosario común ES/EN](docs/i18n/glossary.md) antes de traducir cada dominio: perla, afinidad, maestría, bolsa/bodega,
balsa, aparejos, notoriedad y bounty. Distinguir términos con efectos diferentes; usar la misma traducción
en panel, tutorial, diálogo y aviso. Los nombres propios o de marca se conservan hasta decidir una
adaptación concreta; traducir su descripción no cambia el ID ni obliga a renombrar Salty Shore.

Cada texto nuevo se redacta y revisa en ambos idiomas dentro de su entrega. La traducción preserva intención,
tono y requisitos, sin añadir ventajas o pistas exclusivas. Las misiones comparten ramas y decisiones:
sus textos traducidos no duplican cadenas, guardados ni recompensas. No hornear instrucciones en una
textura cuando puedan mostrarse como texto; cualquier arte con texto necesario necesita alternativa legible.

La página de campaña ofrece Español/English desde la llegada y conserva la elección al navegar. Preparar
convocatorias y piezas de promoción en ambos idiomas con el mismo mensaje, promesas, fechas y condiciones;
vídeos con texto necesario disponen de subtítulos o versiones equivalentes. Compartir el glosario del juego,
sin obligar a que la web promocional use su runtime. No prometer features pendientes como ya disponibles.
Plataforma de campaña, canales y calendario se concretan al preparar los materiales.

El reparto emblemático, los arcos regionales y las actividades descritos en PLAN-LORE-REGIONS se escriben
con fichas/glosario y textos de jugador en ambos idiomas. Sus personajes pueden dar identidad
a la promoción; distinguir arte/historia previstos de poderes, regiones o modos que ya puedan jugarse.

La documentación de desarrollo y la comunicación con el autor pueden seguir en español; comentarios de
código en inglés. La regla bilingüe se aplica al producto y a lanzamiento/promoción. Las instrucciones antiguas
de «UI en español» quedan sustituidas para nuevo trabajo por [AGENTS](AGENTS.md).

## 5 Entregas con un resultado visible

| Corte | Resultado completo | Límites y dependencia |
|---|---|---|
| I18N01 Entrada bilingüe | Selector y preferencia; arranque/fallo, menú, ajustes/controles, cuenta/invitado y pérdida/reconexión en ambos idiomas | Base común pequeña; sin modificar personaje, SQL ni simulación. Revisar estado de los entrypoints compartidos antes de editar |
| I18N02 Primera sesión | Llegada, HUD/tutorial, primera misión/NPC, interacción y avisos de la actividad inicial completos | I18N01; extracción de textos de misión/datos conservando IDs. Acompaña Salty Shore y PRG01, sin esperar toda la expansión |
| I18N03 Sistemas disponibles | Combate/equipo/perlas, banco/construcción, mar/mapa, comercio/comunidad y demás paneles expuestos | Cortes por recorrido completo; cada uno incluye catálogo, ayudas, errores y touch. Nuevas features nacen bilingües |
| I18N04 Alfa y promoción completos | Todas las rutas publicadas revisadas en español/inglés; página de campaña, anuncios, FAQ y convocatorias equivalentes | Inventario de cobertura y revisión editorial/visual. Cada material sale en ambos idiomas desde su primera publicación; una entrada traducida por sí sola no acredita alfa bilingüe |

**Punto de continuación:** I18N01 y los textos actuales de I18N02/03 están implementados localmente.
I18N04a cierra la revisión de términos y avisos del editor. I18N04b integra cliente completo y editor GM
ES/EN; upstream `c9d3bbf` (fuego/fuel) se está incorporando al build alpha32/protocol42. La verificación
final sigue pendiente; después I18N04c prepara piezas de lanzamiento equivalentes. Las entregas pendientes de
permanencia continúan bajo M5. No rehacer la base de localización ni cambiar de área por este avance.
La campaña puede prepararse en paralelo con el glosario común; no esperar I18N04 para redactar su versión
inglesa. I18N04 es la comprobación de cobertura antes de anunciar el alfa bilingüe.

Rutas principales del primer corte: `index.html`, `src/core/settings.js`, `src/main.js`,
`src/ui/title.js`, `src/ui/pause.js`, `src/ui/account.js`, `src/client/accountAuth.js` y estilos pertinentes.
El árbol compartido tiene cambios concurrentes en entrypoints; el implementador inventaría el diff actual,
reserva un escritor por archivo y conserva el trabajo ajeno. La opción de wallet, si está activa dentro
de la cuenta, requiere su propio recorrido traducido antes de declararlo cubierto.

## 6 Verificación de cada corte

- Catálogos equivalentes, parámetros/plurales correctos y diagnóstico de claves faltantes. Preferencia
  ausente/corrupta, navegador de ambos idiomas y almacenamiento no disponible conservan una entrada usable.
- Recorrido real en ambos idiomas, cambio con panel/formulario abierto y respuesta pendiente, recarga y
  reconexión. Progreso, dinero, inventario y operaciones no cambian por traducir o repetir el cambio.
- Capturas inspeccionadas en escritorio y móvil, textos largos, foco/teclado, etiquetas accesibles y
  controles touch. Comprobar que no haya recortes, botones ocultos ni instrucciones en idioma incorrecto.
- Para misiones, todas las ramas/estados ofrecidos, objetivos, requisitos y recompensas equivalentes.
  Para economía, cotizaciones y cantidades idénticas con presentación localizada. Para promoción, página,
  enlaces, formularios y piezas equivalentes en ambos idiomas; mismas promesas y condiciones de acceso.
- Registrar qué superficies están traducidas, qué pruebas se hicieron y qué queda pendiente. Publicación
  requiere comprobar la revisión y el recorrido real del servidor; pruebas locales no acreditan despliegue.

## 7 Reutilización y estado

Reutilizar ajustes locales, paneles DOM, controles y estilos actuales. Se revisó el
[inventario Unreal](docs/research/unreal-assets/SUMMARY.md) y la
[shortlist de ActionRPG](docs/research/unreal-assets/actionrpg/FINDINGS.md): `BP_TradeWindow.uasset` y los
widgets de vendedor/crafting son referencias visuales empaquetadas, sin módulo de localización web
verificado. No aportan una dependencia necesaria para este corte; fuentes intactas y sin arte nuevo.

**Checkpoint local, 2026-10-10:** selector desde arranque/título, cuenta y parte superior de ajustes;
idioma del navegador como elección inicial, preferencia persistida y fallback sin almacenamiento.
I18N01 y textos existentes de I18N02/03 implementados en el checkout, incluyendo misiones/NPC, HUD/touch,
equipo/tatuajes/perlas, mapas, recursos/fabricación, comercio/comunidad, construcción y editor GM.
Cambio en caliente conserva formularios y operaciones. Nombres/chat de personas y mensaje exacto de firma
se preservan. [Cobertura, pruebas, capturas y límites](docs/delivery/i18n01.md).

I18N04b tiene QA browser local aprobado para cliente y editor, y suites locales de release, editor/deployGM
y firepanel/actions aprobadas. Sigue pendiente la aceptación pública y el deployment. Después se
comprobarán los recorridos de invitado y autenticados en el runtime desplegado, y se revisarán
editorialmente el alfa y las piezas de lanzamiento cuando existan. No se declara alfa público bilingüe
ni rendimiento físico móvil a partir de pruebas locales.

## 8 Registro del avance y próxima entrega

| Corte | Estado al 2026-10-10 | Evidencia y límites |
|---|---|---|
| I18N01 | Implementado y probado localmente | Selector en arranque/título/cuenta/ajustes, navegador/preferencia/fallback, campos/foco y auth pendiente; [informe](docs/delivery/i18n01.md). Sin login/firma real ni publicación |
| I18N02 | Textos actuales implementados y probados localmente | HUD/touch, tutorial, NPC, siete misiones y recompensas; IDs y perfil conservados |
| I18N03 | Textos de sistemas actuales implementados localmente | Personaje/equipo/tatuajes/perlas, recursos/crafting, comercio/carga/comunidad, balsa, mapas/naval/chat y editor. Fixtures de operaciones pendientes; no equivalen a aceptación de todos los recorridos online |
| I18N04a | Implementado y probado localmente | [Brief](docs/briefs/i18n04a-editorial.md), [informe y capturas](docs/delivery/i18n04a.md), glosario y avisos GM ES/EN, categorías de mercado y revisión de etiquetas. Conflicto real de IndexedDB local entre dos pestañas sin sobrescritura |
| I18N04b | Integración en verificación | Cliente completo y editor GM ES/EN; upstream `c9d3bbf` (fuego/fuel), código `b5d5565`, alpha32/protocol42; sin cambios SQL/flags, no push. Cliente local browser: PASS, 11 grupos, 20 PNG, errors[]; siete misiones/nueve ramas tattoo. Editor local browser: PASS, seis grupos, ocho PNG, errors[] (22:26:49Z), IndexedDB real en dos pestañas y remoto simulado. Release limpia 107/107 PASS, 14 archivos (70.7 s), tras primer run 106/107 por timeout `servermovement`; editor+deployGM 122/122 PASS (51.5 s), firepanel/actions 13/13 PASS y enfocado i18n/editor/chat/raft 49/49 PASS. Suites se solapan, no sumar. Sin diff server/src/sim/src/net respecto a c9d3bbf. Invitado público, capturas públicas, auth/permisos reales, reconexión y deployment pendientes; [informe y evidencias](docs/delivery/i18n04b.md) |
| I18N04c | Pendiente | Inventariar/redactar página, FAQ, convocatoria y anuncios concretos en ambos idiomas; revisar promesas contra features publicadas. Sin calendario ni canales fijados |

**I18N04b, integración en curso:** cliente completo y editor GM ES/EN; upstream `c9d3bbf` (fuego/fuel),
código `b5d5565`, alpha32/protocol42. Se preservan comunidad/editor, autoridad M5 y los contratos
GM02/GM03a/GM03b1, sin cambios SQL ni feature flags; todavía no hay push. QA browser local de cliente:
11 grupos/20 PNG, `errors: []`; QA local de editor: seis grupos/ocho PNG, `errors: []`, con IndexedDB real
para el conflicto de dos pestañas y cliente remoto simulado para respuestas CAS. La evidencia del cliente
no usa servidor desplegado, wallet ni auth real. Release limpia 107/107 (14 archivos, 70.7 s), tras el
primer 106/107 por timeout de `servermovement`; editor+deployGM 122/122 (51.5 s), firepanel/actions 13/13
y enfocado i18n/editor/chat/raft 49/49. Las suites se solapan, no se suman. No hay diff de `server/`,
`src/sim/` ni `src/net/` respecto a c9d3bbf. Faltan invitado público, capturas públicas, auth/permisos
reales, reconexión y deployment. No enviar arte/dependencias o cambios de servidor ajenos.

La publicación de este corte de textos no requiere migraciones ni activar M5/Web3; la aceptación sí
requiere confirmar la revisión realmente activa, salud y recorrido browser ES/EN. Registrar commit,
pruebas, runtime y recorrido en el informe de I18N04b una vez concluya la verificación.

**Cobertura aparte:** `tools/agent/owner-panel` y laboratorios de arte son herramientas locales de dueño/
desarrollo, con textos todavía en español. No se anuncian como parte del alfa bilingüe. Si se exponen al
público, reciben su propio recorrido ES/EN antes de anunciarlo. El texto de jugadores sigue literal.
