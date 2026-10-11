# RNV06 — purificador útil a bordo

Implementación AREA07 sobre `d962055`, alpha.39/protocolo 47. El
[contrato](../briefs/RNV06-purifier.md) conserva la autoridad y el guardado existentes.
La publicación en Git y la aceptación del runtime VPS son estados separados.

## Resultado

El editor B ofrece el purificador existente: **3 hierro + 2 tablas**, una casilla de cubierta/piso
libre con soporte vivo, peso 3 y HP 30. La colocación paga primero desde la bodega, después desde la
mochila; conserva revisiones, propiedad, soporte y deduplicación de sesión del editor normal.

Cada purificador produce **una unidad de agua dulce cada 96 segundos simulados**, sin combustible ni
ingredientes. El agua llega a la bodega, ocupa volumen/masa reales y admite transferencia y comercio
existentes. H/botón táctil → Bodega → Producción muestra receta, ritmo, progreso y pausa en ES/EN.
No se activa el helper económico antiguo ni su bonus de techo. No existe todavía consumo por sed,
hambre ni curación asociado al agua.

Funciona con el dueño conectado y la balsa amarrada. Durante un viaje activo queda pausado, también
cuando el dueño camina a bordo o baja al agua; no acumula tiempo offline ni durante esa pausa.
La proyección privada identifica el motivo `voyage`; el panel normal de carga sigue cerrado en viaje.
Una pieza destruida conserva su fracción y muestra `broken`; repararla reanuda el trabajo. Bodega llena,
porte insuficiente, límite de revisión o guardado demasiado grande impiden la mutación correspondiente.

El avance usa el reloj económico y el save de perfil montados en LocalServer/GameHost. Los lotes
enteros avanzan una vez las revisiones de nave y comercio; las fracciones se conservan por tupla de pieza.
Retirar una pieza elimina su fracción. Agua/progreso/eventos son privados; la proyección pública sigue
sin inventarios. No añade SQL, un escritor ni recibos durables nuevos de producción/construcción.
La conservación ordenada no acredita recuperación de todos estos pasos tras una caída abrupta.

## Verificación

Selección integrada **120/120 en 20 archivos**: recetas, reloj real LocalServer, costes/replay/rechazos,
bodega llena, porte/tamaño, daño/reparación, pausa/reanudación, privacidad, HMAC local, editor/panel,
carga/comercio, fuego, navegación/natación e i18n. [Log](rnv06-purifier/local-acceptance.tap).
Se corrigieron dos expectativas antiguas de tests de carga para la mochila inicial actual
(18 de volumen y masa máxima), sin cambiar su balance ni implementación.

La prueba HMAC serializa y reingresa en el mismo proceso; por sí sola no acredita CAS GameHost,
disco, Supabase ni reinicio. La revisión de navegador y la evidencia del VPS se registran abajo.

Navegador: **PC ES 1280×720 y móvil EN 390×844, ambos aceptados**, calidad baja, cero errores y
14 capturas. Se revisaron coste/colocación, modelo público, receta/progreso, producción de agua,
transferencia por UI y dos recargas con la misma cuenta. El GameHost usa almacenamiento en memoria
desechable; posición, casilla objetivo y segundos simulados son fixtures declarados. La transferencia
respeta la espera normal de calma. Se corrigió el pie del editor para mantener Colocar visible.
[Evidencia](rnv06-purifier/local/evidence-2026-10-11T02-03-14-540Z.json),
[harness](../../tools/qa-purifier.mjs). No acredita persistencia Supabase ni rendimiento físico móvil.

## Reutilización

Se conserva el modelo procedural de `src/render/rafts.js`, con atlas naval existente. Sin texturas,
luces ni modelos nuevos. La revisión concreta de botella/banco/agua/lluvia Unreal está en el
[brief](../briefs/RNV06-purifier.md#reutilización-de-arte); fuentes intactas, sin exportación ni apariencia
aceptada de esos candidatos. La prueba móvil es emulada, sin atribuir FPS de teléfono físico.

## Continuidad de despliegue

Comprobación de solo lectura del 2026-10-11 01:52 UTC: una autoridad `8ce31ce`, alpha.37,
imagen `sha256:c7b719fc0b38cef85a7c78021c5655c50374c4c3aac37e192bc2fe42da4d26f7`, unhealthy,
cero jugadores/conexiones, una operación pendiente y un guardado bloqueado. SQL026 responde versión 1.
El actualizador y el contenido gen4/base se conservan.

La recuperación histórica del taller ya se había completado y su cuenta QA fue eliminada. El intento
de preflight de solo lectura de este corte se detuvo al no encontrar ese marcador; no se ejecutó stop,
start, limpieza ni reescritura de filas. Ese script histórico no identifica la operación pendiente actual.
El frente de continuidad identificó después un conflicto distinto en la base económica de Tala y
publicó `d962055`: checkpoint confirmado antes de congelar recibos temporizados. RNV06 incorpora esa
corrección. La comprobación posterior de las **02:06:42 UTC** confirmó el VPS recuperado por ese
frente: `d962055`/alpha.38 sano, una autoridad, salud/página 200, cero pendientes/errores de guardado.
RNV06/alpha.39 aún espera su push y aceptación de la revisión activa.

RNV06 no debe declararse activo hasta confirmar revisión/imagen, salud pública y entrada real.
Sigue el primer viaje comercial Salty Shore–Puerto Sol, con llegada física, carga/descarga y regreso,
coordinado con AREA01/08. Huerto/hamaca y producción navegando conservan cortes separados.
