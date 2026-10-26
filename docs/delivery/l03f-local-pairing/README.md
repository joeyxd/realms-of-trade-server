# L03f — conectar a Brisa desde la PC

Contrato y recorrido en [el brief](../../briefs/l03f-local-pairing.md). La prueba
de navegador local pasó 14/14; véase [su informe](browser-acceptance.md). La
evidencia pública y la integración del último merge se registran por separado.

El compañero preparado en SQL034 se conecta al mismo mundo por WSS con su propio
perfil M5 y una plaza normal. SQL027 controla la detención y SQL025 sus documentos
iniciales. La primera capacidad es solamente `chat`. No necesita otro SQL.

## Uso

Requiere Node 22 o posterior y las dependencias del repositorio (`npm ci`). Para
conversar necesita un modelo OpenAI compatible disponible en loopback; conectar
el cuerpo y probar la detención no llama al modelo. Desde la carpeta del repositorio:

```powershell
node tools/agent/pair-companion.mjs --url wss://marea.62.171.136.148.sslip.io/ws --directory "C:\DEV\companions\Brisa" --base-url http://127.0.0.1:8080/v1 --model qwen3.8-flash-next-coder-iq1_m --max-calls 8 --max-tokens 262144
```

Entra con tu cuenta, abre **Mis compañeros**, crea o recupera a Brisa, pulsa
**Permitir conexión**, abre **Conectar en mi PC** y genera el código. Pégalo en
la entrada oculta de la terminal. Dura cinco minutos y solo sirve una vez.
El dueño debe permanecer conectado; la sesión dura como máximo una hora.
El endpoint y modelo quedan en tu PC. No reutiliza cookies ni credenciales
personales de otros programas.

Escribe a Brisa por el chat del juego. Responde a mensajes nuevos de la conexión
de su dueño, sin contestar de nuevo el historial. **Detener**, **Revocar conexión**,
salir del mundo, caducidad y reinicio cancelan la sesión y las respuestas pendientes.
Para volver, permite la conexión si está detenida, genera otro código y usa la
misma carpeta. No hay reconexión automática. **r + Enter** recarga contexto local
y cancela una respuesta en preparación; **Ctrl+C** detiene el controlador.

## Continuidad y límites

La carpeta contiene `personality.md`, `objectives.json`, `memory.jsonl`, manifiestos
y presupuesto. Los documentos iniciales proceden de la ficha/configuración durable.
La memoria del intercambio se escribe después de confirmar la entrega de la
respuesta. Cada conversación relee documentos y selecciona memoria acotada.
Recargar contexto o emparejar otra sesión conserva documentos y consumo.

El presupuesto se persiste: hasta ocho llamadas, techo de tokens explícito,
512 tokens de salida por llamada y dos horas desde la inicialización. Cambiar
de sesión no lo reinicia. La carpeta existente debe coincidir con identidad,
configuración, proveedor y límites; no se sobrescribe una discrepancia.
La administración y compactación de memoria existentes siguen siendo locales;
este corte no añade una UI pública para ellas.

Oficio y personalidad orientan sus documentos sin conceder movimiento, combate,
recolección, construcción o comercio. Máximo dos controladores emparejados;
cada uno consume una plaza del alfa. Los códigos y permisos viven en RAM, nunca
en argumentos, archivos, URLs o evidencia.

## Operación y evidencia

`MN_COMPANION_PAIRING=1` habilita el puente, apagado por defecto. Requiere cuentas,
creación habilitada y readiness durable SQL025/027/034. No se combina con el piloto
de transacciones de suelo. `/status.storage.companionPairing` informa disponibilidad,
sin acreditar por sí solo conversación o memoria.

**Canary público, alpha.60 / `6b713d2`.** El recorrido reanudado pasó sus seis
comprobaciones en [resume.json](public-recheck/resume.json): claim predeterminado
y `AgentNetworkRunner` reales por WSS pública, respuesta desde un stub HTTP local,
memoria local con ámbito de Brisa escrita tras confirmar la respuesta, y stop del
dueño con revocación y SQL027 detenido. `resume.json` conserva el estado histórico
de limpieza pendiente al capturarlo. **Limpieza completada el 2026-10-12:** el autor
ejecutó la consulta acotada; las lecturas RPC confirmaron ausencia de creación,
configuración y control, según [sql-cleanup-verification.json](public-recheck/sql-cleanup-verification.json).
Después el helper comprobó el marcador QA, sockets cerrados y perfiles estables,
retiró únicamente los dos perfiles y la cuenta temporal, y verificó perfiles nulos
y auth 404. El resultado final en [acceptance.json](public-recheck/acceptance.json)
es `pass: true`, `cleanupComplete: true`, `cleanupPending: false`. Su campo
`canaryRetained` y error de expiración conservan el intento inicial; no describen
retención actual ni un fallo nuevo. No queda un manifiesto de limpieza pendiente.

Los intentos previos quedan registrados: el primer WSS devolvió 403 y la limpieza
del canary sí terminó, según [acceptance.json](public/acceptance.json). El intento
siguiente chocó con el límite estricto de expiración del código en
[public-recheck/acceptance.json](public-recheck/acceptance.json). Se corrigieron
el margen acotado de reloj de 30 segundos y el `Origin` derivado de HTTPS; después
pasaron las seis comprobaciones de reanudación. La prueba no hizo llamadas a Qwen.
El autor confirmó Qwen apagado el 2026-10-12; no se volvió a sondear ni consumir.

Tras esos arreglos, [public-fixes.tap](public-fixes.tap) pasó 42/42 y
[cli-recheck.tap](cli-recheck.tap) pasó 8/8. El CLI valida opciones antes de pedir
el secreto y usa mensajes de error seguros en español: la terminal privada es
obligatoria, la cancelación no muestra detalles y los fallos inesperados solo
informan que el controlador terminó con un error seguro.

El merge upstream dejó el árbol en alpha.63/protocolo 59 y conservó los cambios GM
y Bucanero. La integración pasó [68/68](alpha63-merge.tap), y las comprobaciones
adicionales de mundo/GM pasaron [11/11](world-merge.tap), en ejecución serial.
Los conteos anteriores se solapan; no se repitió la suite general.
**Publicado en `c146b08`, alpha.63.** [publication.json](publication.json) verifica
el contenedor sano y su imagen `sha256:b0e1b7818ce1…`, 194/194 pruebas del
actualizador, 14 hashes de imagen y 8 archivos públicos coincidentes con Git,
incluido `src/client/companionPairing.js`. Readiness de emparejamiento activo;
mundo listo, cero errores y cero escrituras pendientes en esa captura.
La [portada pública](public-entry-alpha63.png) cargó en Chrome y la pestaña temporal
se cerró después. No se repitió el canario autenticado en esta revisión: sus seis
comprobaciones corresponden a alpha.60 con el controlador local ya corregido.
La prueba no demuestra inferencia con Qwen ni aceptación del MMO completo.

**Revisión posterior, alpha.64 / `7b34381`, 2026-10-12.** Lectura del VPS y salud
pública: contenedor sano, mundo listo, pairing/creation disponibles, cero errores
y escrituras pendientes en esa captura. La revisión concurrente no cambió servidor,
protocolo ni módulos de compañero; el helper se fijó a alpha.64 para terminar la
limpieza existente. No se repitió el canario ni la inferencia.

## Recorrido en cuenta real y refresco de lista

**Recorrido desde la cuenta real, 2026-10-12, alpha.64.** Chrome autenticado en
la partida existente: Mis compañeros → Crear compañero → revisar documentos →
confirmar creación. Brisa quedó preparada y detenida, como recolectora cálida,
curiosa, prudente y bondadosa, con aspecto Explorer. La ficha muestra personalidad
y objetivos guardados. El Centro de inferencia carga y avisa que esta cuenta aún
no tiene conexiones; no se indicó gasto, proveedor ni URL. Se abrió Conectar en
mi PC para consultar estado, sin generar código, permitir conexión ni iniciar
controlador. No hubo llamadas al modelo ni aceptación nueva de conversación o memoria.
Las capturas de la cuenta permanecen privadas en `.scratch`, fuera de esta entrega.

El recorrido detectó una lista vacía al terminar el wizard: la fila aparecía al
cargar después el estado de emparejamiento. El cliente ahora solicita esa lectura
tras recibir una creación guardada y refresca la lista al confirmarla. Si otra
lectura empezó antes de la creación, encola una sola lectura posterior; no solapa
operaciones ni reemplaza generación/revocación. Cuenta, sesión y timeout conservan
sus límites. Un fallo posterior permite reintentar al cargar de nuevo el panel,
sin bucle automático. La prueba de red confirma una sola fila, sin código, cuerpo
conectado ni cambio de revisión o detención durable.

La validación local y sus intentos quedan en [owner-ui-fix.tap](owner-ui-fix.tap)
y [owner-ui-fix-recheck.tap](owner-ui-fix-recheck.tap). El primer registro dio 32/33:
una comprobación existente observaba el socket remoto antes de recibir el cierre.
Ahora las dos comprobaciones de cierre esperan ese evento con límite; el helper
de red permite hasta 15 segundos ante inicialización concurrente del mundo.
La repetición final pasó **33/33**, con archivos seriales, sin repetir la suite general.
Esto no cambia tiempos del servidor ni acredita rendimiento. La aceptación pública
del refresco automático queda pendiente del relevo habitual del actualizador;
el recorrido público anterior verificó la creación y su estado detenido.

## Presencia: comportamiento actual y propuesta

La UI prepara la ficha y permite emparejar, pero todavía necesita el controlador
Node local para ingresar el cuerpo. No existe invocación solo desde la UI, seguir,
esperar ni despedir con reglas propias. **Detener** revoca y cierra el socket del
controlador; el host desconecta y retira el cuerpo. La entrada normal restaura vida
y checkpoint, por lo que no debe reutilizarse como sistema de retirada en combate.
El siguiente [contrato de presencia](../../briefs/l03g-companion-presence.md) es una
propuesta para separar cuerpo, mente y retiro seguro; no está aprobado ni implementado.
