# RNV04 — combustible y fuego privado

Entrega AREA07 del 2026-10-10, alpha.31 / protocolo 42. [Contrato](../briefs/RNV04-fire-fuel.md).

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

Publicación, activación de `MN_FIRE_OPERATIONS=1`, revisión/imagen sana y entrada pública autenticada
se registrarán después de verificarlas. El actualizador mantiene una sola autoridad y espera mundo vacío.
No se cambian los flags de otras áreas. Sigue agua costera/reembarque, después provisiones/hogar.
