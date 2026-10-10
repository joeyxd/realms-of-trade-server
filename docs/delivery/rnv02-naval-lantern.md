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

Pruebas integradas y revisión desplegada se registrarán al finalizar la publicación. El test de conservación
usa GameHost y store de memoria durable como fixture; no es una prueba autenticada de farol en Supabase público.

## Límites y siguiente corte

La luz no tiene oclusión/sombra por pared. Sin antorcha portátil, combustible, beneficio de descanso/clima ni
rendimiento en dispositivo físico. El servidor retira la nave al desconectar al dueño, como antes.
CAS ordinario conserva estado al reentrar tras guardado; ACK de interacción no acredita un commit durable
ni recuperación ante caída abrupta del último cambio. No crea un segundo diario/authority.

Sigue el checkpoint de noche casi negra sin fuente de luz, con bajo/móvil y UI legible; después agua
costera/reembarque, provisiones/hogar, viajes comerciales, rival naval y cooperación según el plan aprobado.
