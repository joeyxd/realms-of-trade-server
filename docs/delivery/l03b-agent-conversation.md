# L03b — conversación con personalidad, software local

Implementado un turno explícito de conversación sobre mensajes C01 entregados al personaje, con personalidad
del archivo real, ruta fijada por el runner y salida textual estructurada. Mundo requiere política explícita;
Cerca y Susurro reutilizan audiencia, rate y recibos C01. Chat no autoriza acciones del cuerpo ni cambia objetivos.

La consulta comparte presupuesto, timeout y plaza única con L03a. El mensaje elegido permanece protegido ante
poda de historial. La inspección muestra el contexto seleccionado, conteos y fuentes. IDs consumidos, exclusión
de ecos, límites por interlocutor/total y cooldown cortan intercambios repetidos en el proceso. No hay respuesta
automática, detección fiable de humanos/agentes ni prevención durable entre procesos.

## Verificación

La aceptación se registra en [manifest](l03b-agent-conversation-verification.json),
[TAP de agentes](l03b-agent-conversation/agents-tests.tap) y
[TAP de regresión](l03b-agent-conversation/regression-tests.tap), con fingerprints antes/después del código
probado y comprobación final de fuentes. Incluye contratos/política, engine, WebSocket local y CLI real.
**266 pruebas de agentes aprobadas, una omitida por symlink Windows; 206/206 de regresión.**
Los tres archivos nuevos aportan 55 pruebas aprobadas: política 11, mente conversacional 40 y red/CLI 4.
La primera captura provisional conserva una carrera de la prueba CLI antes de corregir su espera de observación;
la primera regresión pasó 206 pero cambió `src/net/localServer.js` durante su captura. Se excluyen de aceptación;
los TAP finales y el manifest exigen fuentes estables. No se oculta ese diagnóstico inicial.

La prueba entre tres conexiones comprueba respuesta Cerca y Susurro, privacidad del tercero, destinatario
opaco correcto, política de Mundo, duplicados/ecos y descarte de respuesta tras stop con reconciliación de uso.
Los modelos son simulados/fixtures inyectadas. Recibos `routed` acreditan routing, lectura sigue desconocida.
No se deduce calidad lingüística de una frase scripted ni experiencia humana de pruebas automáticas.

Se conservan las 22 líneas de dirección/demostración y D-A3 completo mediante
[baseline](l03b-agent-conversation/baseline.json). Protocolo no modificado por el corte; estado actual en manifest.
No se configuraron credenciales de inferencia, llamaron proveedores ni aplicaron migraciones externas.
No hay commit, publicación ni despliegue del corte.

## Reutilización y límites

[Brief](../briefs/l03b-agent-conversation.md) registra revisión de `AgentChat`, snapshots y C01, y dos candidatos
Unreal de quests comprobados en lectura: `BP_TalkToQuest.uasset` (55.851 bytes) y `E_QuestDialogueType.uasset`
(4.494 bytes). No son componentes portables del chat web; las fuentes `C:\Unreal` permanecen intactas.

Proveedor/tokenizer/facturación real, operación D-A3, gasto durable, memoria persistente, panel y experiencia
conversacional humana siguen pendientes. La capa de permisos del servidor opt-in sigue L02c; provisioning,
UI y multi-host tienen sus pendientes propios. Percepción L06a no queda resuelta por este corte.

[Contrato/API y CLI](../agents/conversation-runner.md). Siguiente corte: **L03c**, metas con feedback dentro de
permisos y presupuesto, con el cuerpo funcionando mientras la mente espera.
