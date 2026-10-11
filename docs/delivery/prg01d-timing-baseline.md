# PRG01d — baseline confirmado de Tala v3

El canario público de alpha.37 alcanzó la palma, pero un desafío inventado dejó M5 cerrado a
escrituras antes de recibir el ACK `timing`. El perfil confirmado sigue intacto y no hay recibos
económicos para esa identidad de prueba. El candidato sintético pasa los validadores; la
reproducción local identifica una diferencia entre la economía viva y el último snapshot guardado.

SQL024 compara todo el mundo salvo `resources` incluso al guardar una denegación sin efectos.
El host solo alineaba ese baseline para artesanía y fuego. Tras avanzar ticks normales, el
acumulador económico del gather difiere del guardado y SQL devuelve `conflict`; M5 conserva su fence.

Alpha.38 guarda primero el baseline de una palma v3 mediante el mismo `WorldState.save`, antes de
congelar la operación. `prepare` espera al escritor existente y toma sus versiones confirmadas.
No cambia SQL, límites, recompensas, prueba de timing, autoridad ni política del reloj.

La regresión usa `GameHost` con el store Supabase conectado a PostgreSQL local PGlite y SQL024/026:
dos casos fallan al retirar el checkpoint y pasan con la corrección. Comprueba economía alineada
al despachar, rechazo `timing` sin cambios de perfil/nodos/ledger/cooldowns, tres aciertos con seis
troncos/diez puntos y replay exacto. Pasan además 28 regresiones de recursos, taller, fuego y
control durable. [Antes de la corrección](prg01d-starter-workshop/activation/timing-before-fix.tap),
[SQL local](prg01d-starter-workshop/activation/timing-sql.tap) y
[regresión](prg01d-starter-workshop/activation/timing-regression.tap).

Recuperación y aceptación pública se registran al completar sus comprobaciones.
El corte de compañeros permanece documentado por separado en
[L03d-d](l03d-companion-control.md); esta corrección es un requisito de disponibilidad del alfa.
