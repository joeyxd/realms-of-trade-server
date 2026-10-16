# L06b-2a — inventario vigente y mercado privado

Fecha: 2026-10-10. Corte autorizado después de la auditoría AREA17. Implementación en
`codex/area17-market`, worktree aislado desde `b95f49a`, actualizado a `b84c2da` para la primera regresión
y a `70205bd` para integrar la lección naval.
Introducido en alpha **0.6.0-alpha.20**, protocolo **35**. Publicado dentro de la release integrada
**0.6.0-alpha.23 / protocolo 36**, revisión `4c6743b`; evidencia del despliegue debajo.

## Resultado

El runner puede consultar inventario propio, lista del pueblo donde está y cotización buy/sell de
un artículo. CLI y mente comparten el snapshot: las vistas actuales entran con fuente, tick y
caducidad. Los ledgers de lectura permanecen en inspección, fuera del prompt. El modelo consume
esas vistas; las solicitudes se invocan explícitamente desde runner/CLI, sin ciclo autónomo nuevo.

`market_read` es una capacidad independiente. La entrada privada no acepta selectores de cuenta,
personaje, entidad ni pueblo. El servidor deriva actor y pueblo del socket, verifica autorización,
vida, sesión/epoch, propiedad del perfil y puerta M5, también antes de un replay. La proyección
expone solamente filas del pueblo actual o artículo/cantidad/lado/total/promedio/ley.

`readCommerce` comparte presencia física y cotización con el comercio humano. La lectura privada
no toca perfiles, stock, eventos, recibos, RNG ni escrituras del store. La entrada económica genérica
del agente conserva su bloqueo. Compra/venta y presupuesto de bienes permanecen en L06b-2b.

Una consulta pendiente por canal, 64 IDs por sesión/epoch y cantidad 1–500. Un ID repetido conserva
la foto original; cambiar su petición se rechaza. Replay no renueva la edad. Movimiento XZ retira
mercado hasta otra lectura, incluso al volver al punto inicial. Denegación, caducidad, stop,
revocación, muerte o reentrada retiran las vistas actuales; respuestas tardías no las recuperan.
Los IDs archivados se retiran y no se reutilizan en otra sesión. Timeout queda como incertidumbre,
sin reenvío automático. Las herramientas se anuncian dentro del grant efectivo, que puede ser
subconjunto del concedido por el servidor. El presupuesto del contexto falla cerrado si no cabe.

## Integración

Se incorporaron prerrequisitos locales ya existentes: reserva durable de unidades simuladas L05a,
panel/runner loopback L05b, percepción y piloto opt-in L06a e inventario privado L06b-1.
La regresión de este corte cubre su código integrado. No se rehízo la memoria ni se conectó un
proveedor. El panel sigue siendo una herramienta local histórica; este corte añade uso CLI/contexto,
no una pantalla económica nueva. Las fuentes Unreal permanecen intactas: el candidato
InventorySystem sirve como referencia conceptual; se reutilizan catálogo/control/runner y reglas humanas.

El entrypoint `npm start` deja `agentControl:null` y `agentPilot:null`. El montaje confiable tiene
cuentas separadas, vínculos explícitos y hasta dos agentes/cuatro plazas. El bundle y la imagen de
producción no incluyen los operadores de `tools/agent`. Este corte no activa SQL015, progresión de
Tala, un proveedor, gasto de inferencia ni gasto de bienes. M5/GameHost conserva la autoridad de guardado.
Capacidad personal tomada de `PACK_CAP` de upstream; el cambio local concurrente de 10 a 20 no se publica aquí.

Host y peers deben recargarse juntos: la release pública integrada usa protocolo 36. La rama aislada
conserva GM, perfil de aprendizaje y lección naval; se actualizó a upstream `4c6743b` antes del relevo,
incluyendo los frentes de recursos y aprendizaje naval. No empaqueta el árbol dirty principal.

## Pruebas

Regresión final del 2026-10-10, 16:52:27–16:56:30 UTC: **725 casos, 720 aprobados, 0 fallos,
5 omitidos por symlinks no disponibles en Windows**. Son 84 archivos: 56 de agentes y 28 de
comercio humano, M5, perfiles/progresión y navegación. Node v24.14.0, ejecución serial y acotada;
huellas SHA256 de fuente/pruebas iguales antes y después. La fuente de esa regresión usa alpha.20/protocolo 35
y conserva upstream `70205bd`/su checkpoint documental `934fd38`.

[TAP final](l06b-agent-market/integrated-tests.tap) ·
[Comando y huellas](l06b-agent-market/integrated-tests.json) ·
[Historial de validación](l06b-agent-market/validation-history.json).

Dos ejecuciones anteriores detectaron fixtures antiguas: el helper descartaba una duración de tarea
y la prueba del piloto esperaba recursos en cada snapshot humano aunque son parciales. Se corrigieron
las fixtures, conservando las aserciones. Otra ejecución tuvo cinco fallos de red/chat/PvE sensibles
a tiempo/estado; no se reprodujeron en 32/32 casos focalizados ni en la regresión final. No se ha
demostrado una causa común. El historial conserva resultados de los intentos, sin presentarlos como aceptación.

Los ensayos nuevos cubren reglas humanas compartidas sin efectos, wire estricto/adversario, dos
cuentas aisladas, localidad y replay, rechazo al cambiar una petición, límite 64 (incluye rechazos),
guardas M5/navales, muerte/revocación, comandos de compra bloqueados, contexto detached sin campos
privados, catálogo máximo y fallo cerrado por presupuesto. El runner y CLI reales se prueban con
host WebSocket loopback y archivos temporales, inventario/lista/cotización, caducidad, stop y reentrada.
El CLI verifica `inferenceCalls:0` y `gameSpendingEnabled:false` en el contexto real emitido.

GPT-6 Luna implementó pruebas/contratos acotados y revisó las fronteras. El principal integró,
revisó código y evidencia, corrigió invalidez por movimiento/denegación y subconjunto de permisos.

Sobre `4c6743b`/alpha.23/protocolo 36 se repitieron los nueve archivos de inventario, mercado,
runner/CLI, contexto y reglas compartidas: **46/46 aprobadas, sin fallos ni omisiones**. Esto verifica
la integración posterior; no convierte la regresión anterior de 725 casos en una ejecución sobre
esta nueva revisión. [TAP de integración](l06b-agent-market/integrated-public-release.tap).
El actualizador validó la imagen exacta en un contenedor sin red, 1 CPU y 1 GiB: **107/107**,
sin fallos ni omisiones. [Resumen VPS](l06b-agent-market/vps-release-tests.txt).

## Publicación y siguiente corte

Fuente revisada enviada en `fc3c38a60a283a82faadae4956fb442662c412c7` a la rama de continuidad.
El primer intento se aplazó por una conexión abierta; se conserva como
[evidencia histórica](l06b-agent-market/deployment-pending.json). Tras el cierre confirmado por el
autor, el actualizador publicó `4c6743b87b71ba765e316cd1652d1e4f23991501`, que contiene `fc3c38a`.
Comprobación del **2026-10-10, 18:44–18:45 UTC / 12:44–12:45 America/Mexico_City**:

- Alpha.23/protocolo 36, imagen `marea-negra:alpha-4c6743b87b71`; revisión y release activa exactas,
  Docker healthy, sin OOM. El ID de imagen coincide con el marcador de las 107 pruebas del VPS.
- **8/8 comprobaciones públicas**: health 200, M5 durable sano, protocolo servido, operadores 404,
  entrada WSS real de invitado con WELCOME/snapshot/perfil, mercado privado denegado al invitado,
  admisión de agente no configurado denegada y protocolo antiguo rechazado.
- Sin errores ni escrituras/operaciones económicas pendientes en la consulta posterior. Los sockets
  de prueba se cierran; el número de conexiones públicas puede cambiar por otras sesiones.
- Recursos M5 reportan `enabled:true, ready:true` en esta release concurrente. AREA17 lo observa;
  no cambió SQL, secretos ni el flag de ese frente, ni acredita aquí su aceptación de gameplay.

[Revisión, imagen, salud y límites](l06b-agent-market/deployment-evidence.json) ·
[Humo público](l06b-agent-market/public-smoke.json). La entrada comprobada es de invitado;
no se repitieron transacciones económicas autenticadas. La configuración pública conserva el
piloto apagado. Aceptación de agentes reales, proveedor,
coste nativo, calidad del recuerdo y experiencia humana siguen pendientes.

Sigue **L06b-2b**: una compra y venta con permisos y presupuesto durable de bienes sobre
`EconomicAuthority`/SQL014, reconciliación de la misma operación tras respuesta perdida, revocación
y reinicio. No crear otro inventario/mercado/autosave. En paralelo de diseño, concretar proveedor
y canario L03d de conversación/PvE para medir utilidad y coste reales.

[Brief](../briefs/l06b-agent-market.md) · [Uso y contrato](../agents/market-read.md) ·
[Plan de agentes](../../PLAN-EXTRA-LLM.md).
