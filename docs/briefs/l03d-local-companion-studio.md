# L03d-e2b — Brisa, compañero local con documentos y memoria

El autor autoriza crear a Brisa, aprendiz recolectora y habitante de Salty Shore,
con voz amable y rasgos curiosa, prudente y cordial. Se conecta el modelo local
sin clave ya probado, con llamadas explícitas y un techo finito. No se abre un
túnel del VPS a loopback ni se interpreta SQL instalado como una identidad provisionada.

La entrega debe unir AgentMind, cuerpo/red C01, documentos y memoria existentes:
crear archivos nuevos, conversar por WebSocket normal, capturar un episodio,
cerrar la sesión, recuperar el mismo journal y consultar de nuevo al modelo.
La prueba usa un mundo local aislado con identidades de ensayo explícitas;
no sustituye el mundo público ni afirma autenticación externa de esas identidades.
La memoria se guarda en disco; el mundo de ensayo es efímero.

Un asistente local recoge nombre, rol, apariencia del catálogo humano vigente,
personalidad, hasta tres rasgos y conexión. Permite sortear esos valores desde
plantillas y revisar antes de crear. Roles: marinero, infante de marina,
constructor, recolector y habitante de Salty Shore. Un rol no concede herramientas:
construir, recolectar o navegar barcos siguen sin ser acciones de la mente actual.
Los documentos lo explican y nunca precargan recuerdos de acciones inexistentes.

Se reutiliza la apariencia 0–4 ya integrada; no se generan assets. El inventario
Unreal/FAB no ofrece una necesidad adicional para este formulario/transporte.
El editor modular de cuerpos/ropa conserva su entrega independiente.

Las reservas locales son unidades de cómputo, sin moneda ni tarifa inventada.
El ledger tiene esquema propio, endpoint/modelo fijados, captura antes de enviar,
límites de llamadas/tokens, recuperación de reservas y bloqueo ante uso incierto.
No es el ledger central multiusuario de SQL028. El conteo previo conservador por
bytes se etiqueta estimado; los usos confirmados proceden del transporte nativo.

La conversación/reflexión puede esperar hasta 30 s por configuración explícita;
las decisiones físicas conservan su caducidad máxima de 1,5 s. Stop, archivos,
sesión, prioridad del dueño y permisos deben seguir invalidando cualquier resultado.
No hay consultas autónomas, reparación de JSON, retries ni gasto al crear la ficha.

Aceptar con pruebas de contratos, ledger recuperado, transporte falso, WebSocket
real, conversación con el modelo real, recuerdo entre sesiones, documentos exportables,
stop durante espera y capturas del asistente inspeccionadas. Registrar idioma,
latencia, referencias recuperadas y errores sin confundir calidad con JSON válido.
El aprovisionamiento público y su wizard ingame requieren vínculo autoritativo
persistente; este corte no introduce una ruta que lo simule mediante metadata.
