# L03d-e2b — Brisa: creación, conversación y memoria local

2026-10-10, hora del autor; ejecución UTC del 11 de octubre. [Brief](../briefs/l03d-local-companion-studio.md).

Brisa fue creada con el rol recolectora, personalidad cálida, rasgos curiosa/prudente/bondadosa y
aspecto Exploradora. Conversó por C01 contra un GameHost real local con
`qwen3.8-flash-next-coder-iq1_m`, loopback sin clave y razonamiento desactivado explícitamente.
La memoria y el contador sobrevivieron al cierre del proceso; una sesión nueva recuperó el nombre
ficticio del barco, **Faro de Jade**, desde un episodio histórico con fuente.

## Lo comprobado con el modelo real

[Evidencia sin credenciales](l03d-local-companion-studio/real-model.json).

| Paso | Resultado |
| --- | --- |
| Primer saludo | Texto rechazado por `invalid_reply_text`; uso conocido, ningún envío de Brisa. |
| Saludo después de acotar el prompt | Mensaje enviado y entregado por el servidor; mezcla ES/EN. |
| Guardar recuerdo | Episodio de chat entregado, sin llamada al modelo. Memoria inicialmente vacía. |
| Cerrar y abrir otro proceso | Misma identidad local, mismo hash del journal y contador de dos llamadas; empieza detenido. |
| Preguntar nombre del barco | Recupera la fuente persistida y menciona Faro de Jade, aunque repite el saludo anterior. |
| Resumir episodio | Propuesta rechazada por `invalid_decision`; no escribe un resumen. Original intacto. |
| Segunda pregunta sobre barco | Responde Faro de Jade y atribuye el recuerdo a la conversación anterior. |
| Pregunta sobre oro no observado | Reconoce que no puede verlo; no inventa una cifra. |

Seis llamadas confirmadas por el ledger local en este corte: 19.182 tokens nativos; cero reservas, uso desconocido o
sobregiro al terminar. Coste monetario desconocido, no cero. Las respuestas entregadas tardaron
4,9–13,5 s; esto es conversación, no aceptación de reflejos físicos. El modelo mezcla idiomas,
tiene errores gramaticales y no pasó el resumen. No se acepta todavía su calidad de personaje ni
se afirma que toda memoria sea correcta. No hubo reparación de JSON, fallback ni retry automático.

## Herramientas y alcance

- [Plantillas](../../src/net/companionTemplates.js): cinco oficios, cinco personalidades, rasgos y
  los cinco aspectos humanos vigentes. Personalidad, objetivos, journal vacío, manual y manifiesto
  nuevos, sin sobrescribir documentos. Los oficios no conceden acciones.
- [Creador](../../tools/agent/create-companion.mjs) y [panel](../../tools/agent/companion-studio-server.mjs):
  wizard de cuatro pasos, sorteo desde plantillas, conexión local, revisión y creación detenida.
  Inicio/stop/reentrada explícitos, conversación, captura, inspección y exportación de archivos.
  Aspectos elegibles por catálogo; las fichas son símbolos, todavía no preview 3D modular.
- [Runtime](../../tools/agent/local-companion.mjs): GameHost y dos sockets normales, dueño/personaje
  separados, permisos solo de chat, sin inferencia autónoma ni acciones corporales. Identidades de
  ensayo locales, mundo efímero y memoria en disco; no autenticación Supabase de esos personajes.
- [Ledger local](../../tools/agent/local-resource-budget.mjs): reservas durables antes del envío,
  endpoint/modelo/expiración fijados, contadores nativos y bloqueo ante resultado incierto.
  Máximo ocho llamadas, 200.000 unidades locales y dos horas para esta ficha. Reiniciar no repone
  límites. Es contabilidad local cooperativa, distinta del futuro ledger central multiusuario SQL028.
- AgentMind admite una espera de reflexión de hasta 30 s solo por opt-in. El snapshot actual y las
  decisiones corporales siguen limitados a 1,5 s; stop, archivos, sesiones y permisos siguen cercando
  cualquier envío/commit tardío.

La pantalla está [comprobada](l03d-local-companion-studio/browser.json) en 1280×1000 y 390×844,
sin errores de página ni desbordamiento horizontal. Capturas inspeccionadas:
[wizard](l03d-local-companion-studio/wizard-desktop.png),
[revisión](l03d-local-companion-studio/review-desktop.png),
[panel](l03d-local-companion-studio/workspace-desktop.png),
[móvil/memoria](l03d-local-companion-studio/workspace-mobile.png).

## Verificación de código

[67/67 focales](l03d-local-companion-studio/focused-tests.txt) tras integrar `ea982f8`: mente/contexto,
conversación, memoria, caducidad física/reflexión, ledger, plantillas, adaptador HTTP, API del panel
y runtime WebSocket con proveedor simulado. Stop en inferencia impide un chat tardío; no consume
modelo real en estas pruebas. El arranque/restauración no consulta al modelo.

La ejecución amplia anterior de `agent-*` no está verde: 594/610 pasaron, diez fallaron, una cancelada
y cinco omitidas. El registro incluye fallos de proyección de inventario (mochila 18 frente al
contrato 10) y pruebas de red de metas, reentrada, memoria, movimiento, PvE y comercio.
La repetición serial se observó en consola, sin conservar un log; no se usa como aceptación
auditable. No se anuncia regresión general aprobada.

## Reabrir la ficha

Desde el worktree `area17-market`:

```powershell
node tools/agent/companion-studio-server.mjs --directory "C:\DEV\real of trade\realms-of-trade-server\.scratch\companions\brisa-20261010" --base-url http://127.0.0.1:8080/v1 --model qwen3.8-flash-next-coder-iq1_m --port 8765
```

Abre el enlace local con clave efímera que imprime. Brisa empieza detenida; el journal existente
no se borra y el saldo no se restablece. No iniciar otra instancia con el mismo directorio. La
expiración del recurso exige una nueva autorización explícita para continuar consumiendo después;
los documentos permanecen disponibles. La sesión del panel actual conserva dos llamadas restantes.

Esta entrega no aplica SQL, activa proveedores públicos, crea cuentas de compañeros públicos ni
abre túneles al PC. E1 conserva el centro ingame publicado. Sigue vincular identidad duradera de
compañero y admisión/contabilidad central a ese centro, después integrar este wizard dentro del juego
y el preview real del creador humano. Las herramientas de operador permanecen fuera de la imagen VPS.
