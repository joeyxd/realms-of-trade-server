# L03d-c — Ficha privada durable del compañero

2026-10-10. Continúa [Mis compañeros](l03d-owner-center.md) y la dirección aprobada del
[Inference Center](l03d-inference-center.md). Un corte completo de metadatos antes de conexiones y uso real.

## Resultado

El dueño de un compañero ya vinculado puede guardar su personalidad y objetivos, salir y volver a
cargar la misma ficha. Dos pestañas no pisan cambios: el guardado compara la revisión mostrada.
Ante conflicto o guardado incierto se conserva el borrador, se bloquea otro guardado y se ofrece cargar
explícitamente la versión del servidor. No se reenvía una mutación por timeout.

La ficha todavía no alimenta la mente local ni alojada. No crea personajes, bindings, credenciales,
conexiones vacías, grants, memorias o cuotas. No modifica stop/resume, inventario, mundo ni perfil.
Los bindings y el stop de L03d-b siguen siendo configuración/control del proceso; no se presentan como durables.

## Contrato y autoridad

- Mensajes opcionales `agent_companion_config` / `agent_companion_config_result`, fuera del tick.
  `load` lleva requestId y characterKey. `save` añade expectedRevision y config; no acepta dueño/mundo.
- La sesión autenticada admitida determina el dueño, el host determina mundo y vínculo. Invitado,
  controlador agente, personaje ajeno y mensajes con selectores extra se rechazan antes del store.
- Config v1 exacta: personalidad UTF-8 hasta 8192 bytes, hasta 16 objetivos únicos con id, estado,
  texto hasta 2000 bytes y hasta ocho condiciones de 500 bytes. Total JSON compacto hasta 32768 bytes.
  Sin secretos aparentes ni controles inválidos. Validadores JS/SQL conservan los mismos límites.
- SQL025 usa la misma instancia M5, en tabla privada independiente `mn_companion_configs` y RPCs
  de servicio. No toca recibos económicos ni gameplay. CAS por cuenta/mundo/personaje, revisión 0 inicial;
  una repetición exacta inmediata devuelve el mismo head, sin incrementar. No es recibo histórico de operación.
- Readiness verifica estructura/RLS/ACLs/funciones. Sin readiness no hay guardado; un fallo de esta
  superficie no detiene el mundo. Store en memoria solo se admite por opción explícita de ensayo.
- Una operación en curso mantiene su plaza hasta terminar aunque agote el timeout de respuesta.
  Logout/desconexión retiran datos y respuestas tardías. Una desconexión no revierte un commit ya iniciado.

## Reutilización y aceptación

Se adaptan personalidad/metas de `tools/agent/owner-files.mjs`, CAS del store y el panel DOM existente.
El candidato concreto [VibeUE](../research/unreal-assets/myproject/FINDINGS.md) es un plugin de Editor
Win64; no aporta UI/persistencia portable. Sin arte nuevo ni cambios en fuentes Unreal/Nitro.

Aceptar aislamiento de dos cuentas, CAS/replay/conflicto, límites UTF-8, permisos/readiness dañados,
reapertura de base en disco, WSS real con auth de fixture, timeout/respuesta tardía y ausencia de cambios
de gameplay. Revisar el recorrido integrado ES/EN, teclado, móvil y reentrada con capturas inspeccionadas.
SQL local, publicación de código y aplicación/canario VPS se registran por separado.

Sigue conexión admitida/modelo/límites conjuntos; luego proveedor y memoria con eventos/fuentes,
recuperación, borrado de derivados y canario de una segunda sesión. Una ficha no demuestra memoria inteligente.
