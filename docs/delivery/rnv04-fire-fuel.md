# RNV04 — combustible y fuego privado

Entrega AREA07 del 2026-10-10, implementación inicial alpha.31 / protocolo 42. [Contrato](../briefs/RNV04-fire-fuel.md).
Publicado y activo; aceptación pública repetida en alpha.34 / protocolo 43, conservando traducciones, compañeros y contenido GM concurrentes.

## Comportamiento

Las luces municipales conservan suministro infinito. N/toque crea una antorcha de mano por una madera
de la mochila: dura **20 minutos encendida**. Al agotarse hay que crear otra; apagar conserva el saldo.
Los faroles y las nuevas antorchas de suelo/pared de la balsa duran **60 minutos por madera**;
fogata y parrilla, **30 minutos** provisionales. Cada fuego privado tiene un slot, sin recarga automática.
V/toque cerca abre el panel con combustible, tiempo y controles. La bodega abastece primero al fuego de
su propia balsa, después la mochila. Solo el dueño puede cargarlo/operarlo; los demás aprovechan la luz.

El editor añade antorcha de suelo, montaje sobre pared y fogata, con costes/HP/soporte reales.
La parrilla pausa su receta existente sin combustible y conserva trabajo parcial. No duplica el
descuento de madera al producir. El carbón y la vivienda colocable en tierra siguen pendientes.

## Autoridad

SQL022 amplía el recibo económico M5 común; no hay otro writer. Baseline exacto, revisiones,
perfil/mundo/recibo atómicos y replay sin repetir cobro. La UI confirma el estado del servidor.
El reloj deriva de segundos completos de simulación, compatible JS/Postgres; no consume mientras
el mundo está detenido. Un fuego de balsa encendido continúa consumiendo si la simulación avanza,
aunque su dueño esté desconectado. La antorcha se apaga al morir/reentrar conservando combustible.
Ese apagado de ciclo de sesión usa el guardado de perfil existente; no constituye otro recibo de fuego.

El límite actual es 601 slots históricos por perfil; retirada/reconstrucción no transfiere combustible
a otra pieza. No hay recolección de slots antiguos todavía. Luz local sin sombras/oclusión nueva;
no se acredita FPS de teléfono físico ni una travesía humana prolongada.

## Pruebas locales

- Integración tras unir `cf5857f`: **91/91**, [salida](rnv04-fire-fuel/integrated.tap).
- Selección del actualizador: **107/107**, [salida](rnv04-fire-fuel/release.tap). Se solapa con integración.
- Regresión de entrada/perlas tras corregir la proyección desactivada: **33/33**, [salida](rnv04-fire-fuel/legacy-boundary.tap).
- Composición fuego/SQL022 y GameHost/SQL018/019, artesano y recuperación: **33/33**, [salida](rnv04-fire-fuel/common-journal.tap). Incluye SIGKILL reales; montaje común opcional sigue apagado.
- Memoria y SQL prueban consumo exacto, apagar/encender, agotamiento, replay, rev/tipo inválido,
  capacidad, conservación ante comercio y cálculo del reloj fraccionario.
- Navegador local PC ES y móvil emulado EN en calidad baja/alta: **4/4**, sin errores de página/consola/red;
  capturas inspeccionadas. Carga/toggle por UI real y M5; selección de estaciones/reubicación/reloj son
  fixtures explícitas. No se presenta esa selección programática como recorrido V humano.

Una ejecución amplia en paralelo dio 3992 aprobadas, 12 fallos, una cancelada y cinco omitidas de
4010 casos. Detectó y permitió corregir nuestra consulta de reloj al tener fuego desactivado y la
expectativa de capa `mount`. Los demás fallos incluyen timeouts de agentes/procesos, RTT bajo carga,
limpieza Windows y hash raw con CRLF. No se declara verde la suite global ni se relajaron esos límites.

## SQL y publicación

SQL022 aplicada en el proyecto existente mediante su editor SQL autenticado; resultado exitoso.
Canario real **8/8**: readiness, denegación anónima, identidad aislada, mano/cobro/replay, apagado,
antorcha de suelo/bodega primero, conservación ante comercio y rechazo de enum nulo.
[Resultado](rnv04-fire-fuel/sql-live.json). Perfiles y mundos QA eliminados; los recibos son inmutables
y quedan como evidencia QA, sin escribir cuentas reales. Un primer intento verificó mano/apagado,
pero falló en una fixture sin grid: se corrigió la fixture y se repitió; sus dos recibos también se conservan.

**VPS aceptado a las 22:50:17 UTC:** `fe50ab19831a4e885474663aa1c4857a696210ff`, imagen
`sha256:34d18b7681c7da151a3dc5717edab465dc2f8c9486ea4733e01e133c1ac51271`.
Una autoridad saludable, página y `/health` 200, Supabase durable/cuentas y fuego listos, cero errores
ni escrituras/perfiles pendientes al cerrar; cuatro operaciones económicas completadas durante QA.
[Estado observado](rnv04-fire-fuel/vps-activation.json).
Se activó únicamente `MN_FIRE_OPERATIONS=1`; artesano y montaje común conservan su estado apagado.
El actualizador mantiene el reemplazo cuando el mundo está vacío y pasó **107/107** en la imagen.
La selección adicional de fuego en esa misma imagen pasó **30/30** sin red ni credenciales:
[salida](rnv04-fire-fuel/image-fire.tap). Tras integrar traducciones, panel/acciones y paneles nuevos
pasaron **17/17** localmente. Todas estas selecciones se solapan; no se suman como casos únicos.

**Navegador público: 9/9**, con una cuenta QA real y WSS, sin interceptar red ni mover el personaje,
alterar el reloj o sembrar el mundo. Solo su perfil desechable empezó con dos maderas. N y el botón real
crearon la antorcha por una madera; apagar conservó el saldo, reencender no cobró otra, y recargar restauró
la sesión, la madera y el combustible con la antorcha apagada. Reencender después del reload tampoco
repitió el cobro. Mapa y minimapa renderizados; cero errores de página/consola/peticiones fallidas.
Los 403 de `/api/gm/session` son la denegación esperada de capacidades GM para esta cuenta ordinaria
y quedan registrados por separado. [Resultado completo](rnv04-fire-fuel/public-accepted-alpha32/public-207f60df-d32c-4802-8916-6967151b5bcc.json).
Cuenta/perfil QA eliminados tras drenar escrituras; cuatro recibos inmutables retenidos.

Se inspeccionaron [panel vacío](rnv04-fire-fuel/public-accepted-alpha32/02-public-fire-panel.png),
[carga confirmada](rnv04-fire-fuel/public-accepted-alpha32/03-public-hand-torch-lit.png),
[reentrada](rnv04-fire-fuel/public-accepted-alpha32/05-public-hand-torch-reconnected.png) y
[mapa](rnv04-fire-fuel/public-accepted-alpha32/06-public-map.png). La hora pública era de día; no se
presentan estas capturas como prueba nocturna. La noche y los fuegos navales tienen la aceptación
visual local anterior; el canario SQL también cubre una estación naval, no un recorrido público a bordo.

Los [cinco intentos anteriores](rnv04-fire-fuel/public-attempts.json) se conservan como fallidos:
una desconexión transitoria WSS, un timeout de carga y dos carreras de la automatización al entrar y
restaurar sesión. El último pasó los ocho checks funcionales, pero detectó un favicon ausente; se añadió
el icono real y se repitió el recorrido completo en la imagen final. Todas las cuentas/perfiles de esos
intentos se limpiaron; los recibos permanecen. No se declara verde la suite global ni estabilidad 24/7.

**Integración concurrente posterior:** se conservó alpha.33 de compañeros y la biblioteca opcional de
adopción de mundo de AREA15, sin activar otra ruta de guardado. Fuego, paneles, compañeros y la
composición fuego/diario común pasaron **57/57** en once archivos sobre el merge final:
[salida](rnv04-fire-fuel/final-integration.tap). La evidencia pública anterior identifica su revisión
alpha.32 exacta; las pruebas locales no se presentan como un recorrido público de alpha.33.
La integración siguiente conserva GM03b2 alpha.34/protocolo 43: los once archivos anteriores más
cliente/HTTP/servicio de contenido GM pasaron **82/82** en catorce archivos:
[salida](rnv04-fire-fuel/gm-integration.tap). No activa revisiones GM ni cambia flags de gameplay.

**Revalidación pública final, 23:04 UTC:** alpha.34/protocolo 43 en `ee886903066016dee9752d8571aea382d717e073`,
imagen `sha256:208bc57038efbb8341811df48804a9266c59a417702b25b756bbce8b904856a5`.
El recorrido completo volvió a pasar **9/9**: entrada normal/WSS, una madera por antorcha, apagado,
reencendido, sesión/saldo/madera tras reload, nuevo encendido sin cobro y mapa/minimapa renderizados.
Cero errores de página/consola/peticiones fallidas; cinco denegaciones GM 403 esperadas por separado.
[Resultado](rnv04-fire-fuel/public-accepted-alpha34/public-c69c2585-2deb-4c9d-baf4-5cd83c16f459.json).
Cuenta/perfil desechables eliminados tras drenar escrituras y cuatro recibos retenidos. Se inspeccionaron
[panel](rnv04-fire-fuel/public-accepted-alpha34/02-public-fire-panel.png),
[carga](rnv04-fire-fuel/public-accepted-alpha34/03-public-hand-torch-lit.png),
[reentrada](rnv04-fire-fuel/public-accepted-alpha34/05-public-hand-torch-reconnected.png) y
[mapa](rnv04-fire-fuel/public-accepted-alpha34/06-public-map.png). La hora fue 05:08–05:31, cerca del
amanecer; esta repetición comprueba la mano y persistencia, no oscuridad profunda ni navegación naval.
La guarda de identidad GM de cliente/agente también pasó **35/35** en dos archivos:
[salida](rnv04-fire-fuel/final-client.txt), solapada con las selecciones anteriores.

La [instantánea del VPS](rnv04-fire-fuel/vps-integration-alpha34.json) registra una autoridad saludable,
fuego y Supabase listos y cero escrituras pendientes. Registra también un jugador concurrente y el timer
pausado durante el mantenimiento GM; no se atribuye ese jugador a la cuenta QA ya eliminada ni se presenta
esa instantánea como prueba de actualizaciones automáticas activas.
El [intento previo de esta integración](rnv04-fire-fuel/public-gm-interruption.json) queda fallido:
una activación GM concurrente cerró WSS con `1012/content_revision` durante el reload. No se debilitó
la comprobación; se repitió el recorrido completo con la revisión estable y pasó como se documenta arriba.

Sigue agua costera/reembarque, después provisiones/hogar; carga, agotamiento, rescate y relación con Brasa
deben cerrar su contrato antes de activar natación. Carbón y construcción privada en tierra siguen pendientes.
