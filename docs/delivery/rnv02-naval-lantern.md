# RNV02 — farol naval

2026-10-10, AREA07. [Contrato](../briefs/rnv02-naval-lantern.md) · [plan](../briefs/area07-naval-action-plan.md).

Integración alpha.27/protocolo 39 sobre GM02/refugio/Tala y L06b: editor B con doce piezas, farol apagado
al construir, coste una madera/un hierro y HP 10. V/toque cerca enciende/apaga la luz cálida; se desplaza
y gira con la nave. Dueño y visitantes usan el interruptor, con estado esperado y replay acotado.
Perfil del dueño por M5 existente; saneado/identidad de instancia, daño/reparación y retirada completos.

Render conserva geometría al accionar, emplea uniforms con 4/8/12 fuentes y prioridad para la nave ocupada.
Textos nuevos ES/EN. No añade SQL, flags, texturas ni dependencias, no consume combustible y conserva la
noche actual. Reutilización de farol procedural tras comprobar antorcha Unreal concreta: detalle en el contrato.

## Verificación

Navegador local: cuatro perfiles aprobados, escritorio bajo ES/alto EN y touch bajo EN/alto ES.
[Evidencia](rnv02-naval-lantern/evidence-2026-10-10T20-01-26-506Z.json): construcción/reparación pagadas,
encendido/apagado por V/toque, luz cálida en uniforms, seguimiento al girar/mover, interior con techo oculto
y destrucción de farol encendido. Treinta y dos capturas; revisión raíz PC on/off y móvil bajo/interior alto.
Sin errores de página/consola/red, descargas externas ni overflow horizontal. Etapa móvil existente rota 90°.
Materiales, reubicaciones ECS y estímulo de daño son fixtures; no acreditan pilotaje humano ni FPS físico.

[Historial de ajustes](rnv02-naval-lantern/validation-history.json): se corrigieron las posiciones de fixture,
selector táctil y comprobación de daño. La revisión detectó además carcasa opaca y colisión de atajos;
jaula abierta y cámara en Y los resuelven. Las capturas previas no sustituyen el lote final.

Tras combinar L06b y el corte no montado SQL018: **631/631 pruebas integradas y 107/107 de release**,
sin fallos ni omisiones, con solapamiento. [Comandos/resultados](rnv02-naval-lantern/verification.json),
[integradas](rnv02-naval-lantern/integrated.tap) y [release](rnv02-naval-lantern/release.tap).
Un [probe adicional](rnv02-naval-lantern/evidence-2026-10-10T20-05-48-998Z.json) comprueba F real → timón,
E → cubierta activa, caminar y V → ACK de encendido. Su captura cercana deja ver núcleo/jaula abiertos.
Las fixtures descargan el exceso de materiales antes de embarcar; el rechazo previo por porte era correcto.
El test de conservación usa GameHost y store de memoria durable como fixture; no es una prueba autenticada
de farol en Supabase público.

## Publicación

Código `9f3a19e`, integración alpha.27/protocolo 39 `3dcd116` y aceptación `e648d1b` enviados a continuidad,
conservando L06b y SQL018 no montado. VPS observado a las **20:12:06 UTC** en
`e648d1be69d9320d88ac1e980ae4d699a4675b79`, imagen
`sha256:d6d66c961e4dc60895bac5aa14a0df820334501206a72d57c4e82f77d228f1a2`.
Una autoridad sana; la misma imagen pasó 107/107 offline antes del relevo. Página/health 200, Supabase
durable/cuentas activas, economía y recursos listos, sin errores/guardados pendientes/bloqueo de tick;
timer activo. [Revisión, imagen y status](rnv02-naval-lantern/deployment.json).
`logging:true` ya estaba activo antes de este corte; no se aplicó SQL ni se cambió ningún flag.
[Navegador público](rnv02-naval-lantern/public-browser.json): Chrome nuevo entra como invitado por
`wss://marea.62.171.136.148.sslip.io/ws`; comprueba alpha.27/protocolo 39, doce piezas incluido farol,
mapa M y minimapa, sin errores de página/juego ni requests fallidas. Capturas
[partida](rnv02-naval-lantern/public-gameplay.png) y [mapa](rnv02-naval-lantern/public-map.png) inspeccionadas.
[Status posterior](rnv02-naval-lantern/post-smoke.json), **20:15:21 UTC**: misma revisión/imagen sana,
cero jugadores/sockets tras cerrar QA, tick avanzando, sin errores/guardados pendientes y timer activo.
No acredita construcción/guardado autenticado del farol en Supabase ni latencia/FPS de usuarios reales.

## Límites y siguiente corte

La luz no tiene oclusión/sombra por pared. Sin antorcha portátil, combustible, beneficio de descanso/clima ni
rendimiento en dispositivo físico. El servidor retira la nave al desconectar al dueño, como antes.
CAS ordinario conserva estado al reentrar tras guardado; ACK de interacción no acredita un commit durable
ni recuperación ante caída abrupta del último cambio. No crea un segundo diario/authority.

Sigue el checkpoint de noche casi negra sin fuente de luz, con bajo/móvil y UI legible; después agua
costera/reembarque, provisiones/hogar, viajes comerciales, rival naval y cooperación según el plan aprobado.
