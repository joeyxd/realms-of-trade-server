# PRG01d — baseline confirmado de Tala v3

El canario público de alpha.37 alcanzó la palma, pero un desafío inventado dejó M5 cerrado a
escrituras antes de recibir el ACK `timing`. La captura del incidente confirmó perfil intacto y cero recibos
económicos para esa identidad de prueba; el fixture ya quedó eliminado tras recuperar. El candidato sintético pasa los validadores; la
reproducción local identifica una diferencia entre la economía viva y el último snapshot guardado.

SQL024 compara todo el mundo salvo `resources` incluso al guardar una denegación sin efectos.
El host solo alineaba ese baseline para artesanía y fuego. Tras avanzar ticks normales, el
acumulador económico del gather difiere del guardado y SQL devuelve `conflict`; M5 conserva su fence.

Un [control SQL de solo lectura](prg01d-starter-workshop/activation/logging-baseline-diagnostic.json)
contra la base real confirma que el rechazo conserva su forma válida: la transición pasa con
el mundo guardado, falla al avanzar únicamente el acumulador y pasa al alinear el baseline.
No se envió una operación de commit ni se cambió ninguna fila.

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

La [recuperación exacta](prg01d-starter-workshop/activation/timing-recovery.ndjson) conservó los hashes
de perfil/mundo y tick. Alpha.38 quedó activa con revisión/imagen y hashes Git
[verificados de forma independiente](prg01d-starter-workshop/activation/timing-deployment-independent.json):
salud pública 200, una autoridad y cero errores, pendientes o datos sin guardar.
El [canario público de Tala](prg01d-starter-workshop/activation/public-d783c754-992a-4304-9e2a-25d3f4df4d9d.json)
pasó 6/6, con rechazo sin mutación, tres golpes reales, tres troncos/diez puntos, replay y tabla 2:1.
Perfil/Auth QA eliminados y cuatro recibos conservados. Esta aceptación es de Tala aislada;
la repetición combinada de taller y navegador actualizado permanecen pendientes.
La revisión independiente de este frente integró `d962055` y pasó
[20/20 de taller, SQL y baseline](prg01d-starter-workshop/activation/timing-final.tap).
El corte de compañeros permanece documentado por separado en
[L03d-d](l03d-companion-control.md); esta corrección es un requisito de disponibilidad del alfa.
