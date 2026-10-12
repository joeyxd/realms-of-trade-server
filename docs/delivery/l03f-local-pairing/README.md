# L03f — conectar a Brisa desde la PC

Implementación y validación local completas; publicación y aceptación pública se
registran por separado. [Contrato](../../briefs/l03f-local-pairing.md) y
[navegador local: 14/14](browser-acceptance.md).

El compañero preparado en SQL034 se conecta al mismo mundo por WSS con su propio
perfil M5 y una plaza normal. SQL027 controla la detención y SQL025 sus documentos
iniciales. La primera capacidad es solamente `chat`. No necesita otro SQL.

## Uso

Requiere Node 22 o posterior, las dependencias del repositorio (`npm ci`) y un
modelo OpenAI compatible disponible en loopback. Desde la carpeta del repositorio:

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

[Integración: 82/82](integration.txt), [red y controlador: 15/15](focused.tap), [regresión del actualizador](updater.txt) y
[navegador ES/EN](browser/browser.json) conservan sus alcances separados.
Las pruebas con proveedor simulado no acreditan el modelo real del dueño.

Tras integrar el cambio concurrente `9ea14a0` de suelo, el [recheck serial](merge-recheck.tap)
pasó 76/76, incluidos servidor, perfiles, pairing, mente y ruta de perlas. Los conteos se solapan.
La recuperación previa de disponibilidad está en [availability-recheck.json](availability-recheck.json);
se restableció el servicio, pero no quedó identificado el comando que provocó el fence anterior.
