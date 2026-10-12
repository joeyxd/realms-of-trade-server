# L03g — presencia del compañero independiente del modelo

2026-10-12. **Propuesta para alinear con el autor; sin aprobación de implementación.**
Responde a probar desde el alfa real con Qwen apagado y a separar reunirse,
esperar, pausar la mente y retirarse sin ventajas de combate o transporte.

## Punto de partida verificado

L03f prepara una identidad durable SQL034, documentos SQL025 y control SQL027.
El controlador Node emparejado ingresa por WSS con capacidad solo `chat`; la UI
no ingresa el cuerpo por sí sola. Qwen no se consulta hasta recibir un mensaje
del dueño. Permitir conexión no inicia el controlador ni una llamada de modelo.

Detener revoca la sesión en `server/companionControl.mjs`; pairing cierra sus
sockets y el host desconecta, guarda y retira la entidad mediante LocalServer.
`attachProfile` en `src/sim/systems/inventory.js` restaura vida máxima y checkpoint;
`syncProfile` conserva el checkpoint, no vida actual ni posición exacta. Son
reglas de entrada existentes, no una política aceptada de invocación/retirada.
Reutilizarlas para combatir permitiría una vía de curación/reubicación a evaluar
y cerrar antes de conceder esas capacidades. No se hizo un canario de ese abuso.

## Dirección recomendada

La presencia pertenece al host autoritativo. El proveedor genera decisiones y
lenguaje; apagarlo, cambiarlo o perder su conexión no teletransporta ni protege
el cuerpo. Emparejar autoriza una mente; no es la única fuente de existencia
del personaje. La UI muestra por separado presencia, orden actual, conexión del
controlador y disponibilidad de inferencia.

| Control | Comportamiento propuesto |
| --- | --- |
| Salir conmigo | Reunir al compañero en su ancla segura, estando el dueño allí y con plaza disponible. No acepta coordenadas del cliente ni transporta carga entre puertos. |
| Sígueme | Movimiento físico validado por el servidor, con colisión y distancia acotada. Si no encuentra ruta, informa/espera; no se teletransporta para alcanzar al dueño. |
| Espera aquí | Cancela la tarea y permanece en el lugar permitido, con marcador y opción de regresar caminando. No concede inmunidad ni almacenamiento remoto. |
| Pausar IA | Cancela nuevas decisiones y respuestas pendientes. Mantiene el cuerpo y la orden determinista segura permitida; no inicia ataques, gastos o tareas nuevas. |
| Descansar en el puerto | Retira el cuerpo solo tras llegar a su ancla segura y superar las comprobaciones de peligro y escrituras pendientes. Lejos del ancla, regresar exige desplazamiento normal. |
| Detener control | Revoca inmediatamente permisos y entradas pendientes. En el sistema futuro, esta revocación no equivale a desaparecer del combate. |

No cobrar una moneda ni añadir un temporizador arbitrario como única protección:
el servidor comprueba situación, pertenencia, ancla, revisión y consecuencias
pendientes. Anclas iniciales: un punto seguro definido en Salty Shore. Casas y
barcos requieren sus propias reglas de custodia/seguridad antes de habilitarlos.

## Primera entrega propuesta

1. Ingreso/retiro desde **Mis compañeros** en el ancla de Salty Shore, sin terminal
   ni proveedor, con cuerpo controlado por el host y una plaza normal. Mostrar
   claramente «IA pausada / proveedor desconectado». Conservar wizard y documentos.
2. Seguir/esperar con órdenes directas dentro de una zona segura delimitada y
   rutas comprobadas. La reconexión del modelo no crea otro cuerpo ni reinicia
   perfil, memoria o presupuesto. No habilitar combate/recolección en este corte.
3. Antes de salir a zonas de riesgo: cerrar persistencia de vida/posición segura,
   muerte, desconexión y custodia. No activar autoridades M5 aún apagadas ni
   resolver pérdidas/costes navales mediante un valor por defecto silencioso.

El cierre del navegador o la caída del modelo deben probarse como eventos distintos.
En la zona segura del primer corte, salir puede estacionar al personaje en su ancla
si no hay tareas/escrituras pendientes. Esperar sin dueño indefinidamente y simulación
offline quedan fuera. En una futura zona de riesgo, la salida no elimina daño ya
comprometido: el host conserva el cuerpo bajo control limitado hasta resolver peligro
o derrota según reglas de combate aprobadas, sin consumo LLM offline.

## Criterios de aceptación antes de publicar

- Solo el dueño autenticado controla su creación; como máximo un cuerpo por identidad.
  Creación, presencia, permiso de mente y slot se comprueban también en reentrada.
- El ingreso usa un ancla validada y la ubicación permitida del dueño. No hay
  teletransporte remoto de personaje, mercancía ni bypass de rutas por reemparejar.
- Seguir respeta colisiones, límites y obstáculos; esperar conserva el cuerpo.
  Una orden fallida informa su causa y no deja una entidad o slot duplicados.
- Pausar/cerrar Qwen cancela inferencia y descarta resultados tardíos; las órdenes
  directas de cuerpo siguen funcionando sin modelo y conservan sus consecuencias.
- Retiro denegado durante peligro, muerte o escritura pendiente; las caídas de
  socket y la revocación reciben las mismas restricciones físicas que la UI.
- Ingreso/retiro/reconexión no curan daño ni reinician cooldowns, carga, progreso,
  documentos o consumo. La política de muerte se aprueba antes de exposición al riesgo.
- Reinicio recupera solo estados durables validados mediante la autoridad existente;
  nunca otra copia de perfil ni una segunda vía de guardado. CAS/reintentos no duplican.
- Aceptación real en alfa ES/EN/escritorio/móvil: crear, reunir, seguir, esperar,
  pausar, cerrar proveedor y retirarse; cuenta ajena rechazada, ausencia de modelo
  y dueño desconectado. Registrar separado lo probado con modelo real y sin él.

## Reutilización y límites

Revisar antes del código AgentControl, órdenes/epochs, LocalServer, perfiles M5,
capacidad/plazas, wizard y controles existentes. Este corte requiere control e
identidad, no arte nuevo; reutiliza el aspecto de la ficha. El inventario Unreal/FAB
del proyecto no sustituye el ciclo de vida/autoridad del host. Si se añade UI/animación
nueva, comprobar candidatos concretos antes de producir assets. Este documento no
concede movimiento ni combate al grant público L03f y no cambia runtime, SQL o protocolo.
