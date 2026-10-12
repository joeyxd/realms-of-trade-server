# L03f — conectar el compañero preparado a un controlador local

2026-10-11. Corte autorizado al continuar L03e. Primero se cierra el puente de
identidad y revocación; después se acepta conversación real con memoria local.

## Recorrido

Mis compañeros → Conectar en mi PC. La cuenta admitida consulta su creación SQL034,
habilita la conexión con el control SQL027 y genera un código aleatorio de un uso
válido cinco minutos. Se pega en el controlador Node local mediante entrada privada;
no se coloca en argumentos, enlaces, logs ni archivos. El controlador abre WSS
saliente al mismo mundo, canjea el código y recibe configuración y un permiso de
admisión de un uso. El servidor emite el grant real al entrar. No se reutilizan
cookies ni tokens personales de otros programas.

El piloto concede solamente chat: ocupa una plaza normal y usa el perfil M5 del
personaje creado. Nombre/aspecto proceden de la ficha guardada. El dueño debe seguir
conectado. Detener, revocar, salir de la cuenta, caducidad o reinicio invalidan los
códigos y las sesiones; volver exige otro emparejamiento. Permitir conexión nunca
resucita un grant viejo. Un código no sustituye la propiedad SQL034 ni el control
durable. Códigos y permisos efímeros se guardan solo en RAM, máximo 64 dueños.

El endpoint y modelo se configuran únicamente en la PC (loopback OpenAI compatible,
sin clave). Se reutilizan documentos, journal, presupuesto persistido, mente y
transporte existentes. Una llamada a la vez, límites explícitos, sin reinicio del
presupuesto al cambiar sesión y respuesta tardía descartada al detener. No se
levanta otro GameHost local para conectar al alfa. La primera prueba usa Brisa y
qwen3.8-flash-next-coder-iq1_m en 127.0.0.1:8080/v1, si sigue disponible.

## Integración y aceptación

Sin SQL nuevo: SQL025/027/034 son la autoridad durable, flag de emparejamiento
apagado por defecto. Alta dinámica restringida a creaciones propias verificadas;
convive con la allowlist estática sin reemplazarla. La creación sigue funcionando
cuando la conexión está apagada. Protocolos nuevos requieren recarga de peers.

Pruebas: propiedad/huésped, códigos caducados/usados/rotados, doble canje/admisión,
detención durante I/O/modelo, desconexión del dueño, reinicio, perfiles/plazas y
separación de memoria. Navegador ES/EN escritorio/móvil con capturas inspeccionadas.
Modelo real y despliegue se registran como evidencias independientes; no afirmar
inferencia pública por un transporte simulado o una prueba local de modelo.

Reutilización: C01, AgentNetworkRunner, AgentControl, CompanionControl, templates,
LocalResourceBudget, AgentMind y owner-files. Inventario Unreal/FAB no contiene
un emparejamiento de identidad Node/WSS ni transporte LLM portable; no se requiere
arte nuevo y las fuentes Unreal permanecen intactas.
