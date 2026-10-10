# PRG02b — primer hito de pilotaje

Fecha: 2026-10-10. **Alpha.23 / protocolo 36**, integrada sobre recursos M5 `922295b`, mercado privado y hotfix GM. Código en `3a23f2c2304c21a0704d62b368f4bda961ac2392`, checkout aislado `codex/area07-pilot`; el árbol compartido dirty permanece intacto. [Contrato](../briefs/prg02b-pilot-learning.md).

La lección concede `pilot_coastal` una sola vez después de un atraque normal aceptado mientras el intento está `returning`. El primer aprendizaje eleva únicamente ese perfil de progresión v1 a v2 y conserva Tala, hitos y conocimientos. **Pilotaje II mejora un 15 % la respuesta del timón desde el siguiente embarque**, también fuera de la lección. Escala el torque existente; masa, inercia, carga, velocidad y flotación mantienen sus reglas. Repetir no entrega más práctica, XP, moneda o materiales.

El guardado utiliza el CAS M5 de `ProfileSessions`, sin otra autoridad, migración SQL, dependencia ni operación económica nueva. La interfaz ES/EN distingue aprendizaje local, pendiente y confirmado. Solo el perfil confirmado de un store durable anuncia `saved`; una respuesta ambigua bloquea/cierra la sesión y la reentrada consulta la fila canónica. **Una caída antes del guardado confirmado puede exigir repetir la lección.** El intento sigue siendo de sesión y el scope del perfil sigue siendo el existente de cuenta; el aislamiento personaje/mundo pertenece a AREA15. Runtimes antiguos que solo entienden progresión v1 no admiten un perfil aprendido v2.

## Verificación

**174/174 pruebas de integración pasan** después del rebase, incluida la fixture corregida del HUD. Cubren progresión/perfiles, continuidad, lección, física/predicción, costa/cubierta, rutas, balsa, cuentas, servidor, economía y runtime. La prueba GameHost de continuidad comprueba atraque, CAS retenido y confirmado, repetición sin nueva recompensa/escritura, cierre/reentrada, timón `1.15`, respuesta perdida después del commit y rechazo de datos corruptos/futuros. Las pruebas de física comparan timón base/aprendido con balsa vacía/cargada y preservan las propiedades de carga.

**38/38 casos adicionales** de las siete suites de inventario/mercado privado y runner de agentes pasan sobre la integración. **22/22 casos** de contratos/estado/autoridad de recursos más continuidad naval pasan juntos; estos 22 incluyen los cuatro casos navales ya incluidos en los 174 y no se suman como cobertura única. [Resumen de corridas](prg02b-pilot-learning/verification.json).

**Navegador: 3/3 vistas aprobadas con protocolo 36**, escritorio 1280×720, táctil apaisado 844×390 y retrato 390×844. Inicio, cancelación/reintento, maniobra, retorno y atraque normal; etiqueta aprendida visible y sin crédito adicional a bienes/XP/blueprint. Cero errores de página/consola/red y sin desbordamiento del HUD revisado. Capturas finales de escritorio completado y retrato inicial inspeccionadas. [JSON y capturas finales](prg02b-pilot-learning/evidence-2026-10-10T17-06-11-466Z.json). La evidencia anterior de las 17:04 conserva el pase previo al rebase, protocolo 34; la de las 17:06 es la aceptación integrada.

La QA emplea GameHost efímero con almacenamiento en memoria y muestra “Learned in this game”: no acredita guardado durable público. Su fixture reposiciona candidatos de cuerpo del servidor para recorrer boyas de forma determinista; `NavalLesson`, plan/commit y el atraque normal siguen activos. No demuestra pilotaje humano sin asistencia ni rendimiento en teléfono físico. La captura de finalización comprueba el mensaje; su cámara posterior al atraque no acepta una composición del mundo. Se reutilizan boyas y HUD, sin arte nuevo; el candidato Unreal `NS_Spline_WaterSplash` no aporta un marcador de instrucción adecuado.

## Publicación y operación

El corte completo se envía a `claude/loving-lovelace-ptbif7` mediante fast-forward, conservando recursos M5 y trabajo concurrente. El actualizador existente sigue esa rama; no se modifica configuración de recursos, SQL ni el servicio del otro agente. El código de PRG02b no requiere ninguna activación adicional.

La [sonda VPS de las 17:10 UTC](prg02b-pilot-learning/deploy-observed.json) confirma una sola autoridad sana en `b84c2da`, Supabase durable/cuentas, cero errores/guardados pendientes y página/health públicos 200. Hay cero jugadores pero **una conexión abierta**, por lo que el actualizador difiere el relevo. Timer activo; **PRG02b todavía no está aceptado en la entrada pública**. Confirmar revisión activa y entrada real después del relevo; un push o las pruebas locales no sustituyen esa evidencia.

Siguiente entrega: techo/puerta funcionales del refugio naval y después farol utilizable; mantener la luz actual hasta disponer de fuentes reales conforme a la regla de noche casi negra de AREA07.