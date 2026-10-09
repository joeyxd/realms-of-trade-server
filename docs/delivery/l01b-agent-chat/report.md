# L01b — chat C01 con agente invitado

2026-10-08. Ensayo local con un navegador humano normal (`Observador`), un segundo invitado humano aislado en otro contexto (`Viajero externo`) y `Brisa IA` por `AgentNetworkClient`. El agente recibió solo `capabilities: ["chat"]`; sus respuestas fueron texto fijado por este guion, sin LLM ni proveedor.

## Resultado observado

- El mensaje de Mundo enviado desde el panel normal llegó al estado de chat del agente con canal y remitente `Observador`.
- Las respuestas manuales de Brisa en Mundo y Cerca aparecieron en el panel normal con nombre `Brisa IA`. El segundo invitado recibió ambas líneas reales en su propio panel.
- El susurro de Observador llegó a Brisa con el destinatario correcto; la respuesta privada apareció en el panel de Observador con el remitente `Brisa IA`. El panel del invitado externo no contenía ninguna de las dos líneas privadas.
- Las tres peticiones del agente terminaron `routed`, con `read: "unknown"`, `durability: "session_only"` y un intento cada una. La evidencia conserva los eventos `chat_result` y `chat_message`, incluidos sus campos y la clasificación `trust: "player_text"`.
- Host local: `dev:false`, `bots:0`, `worldId:null`, `maxPlayers:4`; tres plazas utilizadas al final. El host, las páginas y sus contextos se cerraron. Errores de navegador: cero.

## Archivos y reproducción

- [Registro de evidencia](evidence.json), con alcance, configuración, verificaciones, schemas reales, estados, limpieza y SHA-256 de capturas.
- [Captura Mundo/Cerca](chat-world-cerca.png): el panel normal muestra Mundo y Cerca con Brisa identificada.
- [Captura de ruta privada](chat-private-route.png): se ve el selector Privado, el destinatario y ambos lados de la conversación.
- Repetir desde la raíz del repo: `node tools/qa-agent-chat.mjs`.

La verificación es un ensayo de software local sobre conexiones de invitado. Las respuestas no usaron IA; el recibo `routed` acredita enrutado del servidor y no lectura humana. No es publicación, despliegue, persistencia, WAN ni aceptación de un piloto.

Durante la preparación, un intento temprano terminó por una excepción concurrente en `NavalPilot.persist`; el responsable de esa ruta incorporó la guarda y los intentos posteriores cerraron el host correctamente. Los primeros intentos del arnés tampoco se aceptan como prueba: se aisló cada invitado en su propio contexto de navegador y la ejecución final documentada quedó en estado `passed`.
