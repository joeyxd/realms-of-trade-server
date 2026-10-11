# L04c — memoria automática y controles de continuidad locales

2026-10-10, hora del autor; ejecución UTC del 11 de octubre.
[Brief/contrato](../briefs/l04c-companion-continuity.md).

El Studio guarda un episodio al completar una conversación confirmada y prepara la siguiente petición
desde los archivos. Refrescar contexto cancela una consulta anterior sin cerrar la sesión ni reiniciar
el presupuesto; resumir conserva los episodios originales. Todo permanece en el ensayo local de chat.

## Implementado y probado

| Comportamiento | Evidencia |
| --- | --- |
| Captura automática sin inferencia adicional | Chat entregado por ambos sockets C01; append acotado/deduplicado y resultado de captura separado del envío ya confirmado. |
| Continuidad entre procesos | Episodio/resumen vigentes cargados desde el journal; continuación marcada histórica, con fuentes y sin reanudar órdenes. |
| Refresco manual | Cancela respuestas pendientes; conserva sesión, contador y stop. Relee archivos sin inferencia ni reentrada. |
| Resumen manual | Selección de uno a ocho episodios; mismo presupuesto, fuentes exactas y originales conservados. Un rechazo no genera retry. |
| Resumen automático opt-in | Presión del payload completo al 80 % o poda de opcionales, pausa de 3 s y de dos a ocho fuentes que caben. Un intento automático por cuota durable; los intentos manuales cuentan de forma conservadora. Apagado al reabrir. |
| Límites y cancelación | Stop, cambio de archivos y revisión de contexto invalidan efectos tardíos; obligatorio demasiado grande impide emitir la consulta. Uso desconocido conserva su reserva. |

La captura usa la ventana histórica de reflexión solo cuando está concedida explícitamente.
El presente y las decisiones corporales siguen exigiendo observación fresca de 1,5 s.
Los resúmenes no borran historia: el límite del journal permanece en 1 MiB. No se implementó
archivo automático ni búsqueda semántica; sigue recuperación léxica y el contrato de administración.

## Verificación

[Pruebas focales](l04c-companion-continuity/focused-tests.txt): **98 casos, 97 aprobados, cero fallos,
uno omitido** porque Windows denegó crear el symlink (`EPERM`). Incluyen runtime con GameHost/C01,
guards de memoria/contexto, adaptador, API y cuotas durables. Proveedores simulados; sin consumo real.

```powershell
node --test --test-concurrency=1 tests/companion-continuity.test.mjs tests/local-companion-runtime.test.mjs tests/companion-studio-server.test.mjs tests/companion-studio-ui.test.mjs tests/companion-templates.test.mjs tests/local-openai-mind.test.mjs tests/agent-mind-context.test.mjs tests/agent-reflection-freshness.test.mjs tests/agent-memory-mind.test.mjs tests/agent-memory-journal.test.mjs tests/agent-memory-store.test.mjs tests/agent-memory-retrieval.test.mjs
node tools/qa-companion-continuity.mjs
```

[Navegador local](l04c-companion-continuity/browser.json): **9/9**, sin errores de página; proveedor
simulado y sockets reales locales. Confirma captura, resumen con originales, refresco/stop y controles
durante inferencia. La automatización por presión se verifica en runtime, no se fuerza en este recorrido.
Capturas inspeccionadas: [contexto medido](l04c-companion-continuity/context-measured-desktop.png),
[desktop](l04c-companion-continuity/continuity-desktop.png),
[portrait](l04c-companion-continuity/continuity-portrait.png) y
[landscape](l04c-companion-continuity/continuity-landscape.png).
La estimación del adaptador no se presenta como tokenizer real.

## Integración con el host concurrente

Se incorporó `c33ed9c` (cantimplora/supervivencia) conservando ambos checkpoints; la fixture local
mantiene esas capacidades desactivadas. La primera [selección integrada](l04c-companion-continuity/integration-tests.txt)
dio 96 aprobadas, un fallo y un omitido; la [repetición del runtime](l04c-companion-continuity/integration-runtime-repeat.txt)
dio 2/5. Los rechazos de frescura quedaron conservados; se observaron 104 procesos Node concurrentes.
No se añadieron retries ni se amplió el límite de 1,5 s para el presente.

La revisión detectó una frontera mejorable: se reutilizaba la observación anterior después de esperar
I/O durable del presupuesto. AgentMind ahora relee después de admisión y antes de emitir efectos;
la observación original conserva su límite por modo y stop/archivos/permisos se vuelven a comprobar.
[Runtime final](l04c-companion-continuity/integration-runtime-final.txt): **5/5**.
[Navegador integrado](l04c-companion-continuity/integration-browser/browser.json): **9/9**, cero errores;
[desktop](l04c-companion-continuity/integration-browser/context-measured-desktop.png) y
[portrait](l04c-companion-continuity/integration-browser/continuity-portrait.png) inspeccionados.
Estas pruebas no convierten una observación realmente caducada en válida.

[Regresión final integrada](l04c-companion-continuity/final-regression-tests.txt): **251 casos,
250 aprobados, cero fallos y un omitido** por el mismo permiso de symlink Windows, en 29,7 s.
Incluye los doce archivos focales y siete archivos de AgentMind, presupuesto durable/nativo,
conversación, metas y las nuevas fronteras async. Los siete casos con reloj controlado prueban
observación renovada tras I/O, caducidad corporal original y bloqueo por stop/cambio de archivos;
una sola llamada al proveedor cuando corresponde. Los conteos anteriores se solapan con esta selección.

La revisión final detectó además un aviso preexistente: cancelar mientras se comprueba admisión tras
asentar el uso puede devolver `budgetReconciliation: pending` aunque el ledger ya esté confirmado.
El uso permanece contabilizado; se conserva como pendiente de corrección del aviso, sin ampliar este corte.

```powershell
node --test --test-concurrency=1 tests/companion-continuity.test.mjs tests/local-companion-runtime.test.mjs tests/companion-studio-server.test.mjs tests/companion-studio-ui.test.mjs tests/companion-templates.test.mjs tests/local-openai-mind.test.mjs tests/agent-mind-context.test.mjs tests/agent-reflection-freshness.test.mjs tests/agent-memory-mind.test.mjs tests/agent-memory-journal.test.mjs tests/agent-memory-store.test.mjs tests/agent-memory-retrieval.test.mjs tests/agent-async-budget-freshness.test.mjs tests/agent-mind.test.mjs tests/agent-durable-mind.test.mjs tests/agent-conversation-mind.test.mjs tests/agent-goals-mind.test.mjs tests/agent-inference-metering.test.mjs tests/agent-native-budget.test.mjs
```

## Brisa y alcance público

La ficha existente sigue en `.scratch/companions/brisa-20261010` del checkout compartido.
El Studio se reabre con el comando de [L03d-e2b](l03d-local-companion-studio.md#reabrir-la-ficha);
la clave efímera se obtiene de la consola. No ejecutar dos escritores sobre esa carpeta.
Este corte no renueva su autorización ni consume inferencia real. El resumen fallido del ensayo
anterior cuenta contra el automatismo; no se oculta ni se restablece al reiniciar.

[Reapertura real de sus archivos](l04c-companion-continuity/brisa-reopen.json): detenida, mismos hashes
de memoria/persona y misma revisión 18 del ledger; seis llamadas y 19.182 tokens confirmados,
cero pendientes. Refresco manual sin sesión ni presupuesto nuevos, captura automática disponible,
resumen automático apagado y cero intentos automáticos restantes por el compactado histórico.

La calidad real anterior sigue pendiente: mezcla ES/EN, 4,9–13,5 s y resumen rechazado. Las pruebas
simuladas de este corte no corrigen ni aceptan esa calidad. Tampoco acreditan compañía corporal/PvE.
Los archivos son locales, las identidades son fixtures y el mundo es efímero; no son persistencia
multiusuario pública. Sin nuevo SQL, cambio de protocolo, JEV ni activación de proveedor/compañero VPS.
Las herramientas permanecen fuera de la imagen del juego. Publicar la fuente no despliega este Studio.

Sigue conectar identidad durable y contabilidad central al centro ingame, integrar el wizard/preview
humano y realizar un canario consentido de conversación/memoria con el modelo real. La aceptación
social/PvE y la capa opcional de interpretación conservan su alcance y evidencia propios.
