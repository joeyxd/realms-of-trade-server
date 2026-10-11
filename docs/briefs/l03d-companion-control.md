# L03d-d — Detención durable del compañero

Siguiente corte de [AREA17](../../PLAN-EXTRA-LLM.md), después de la
[ficha privada](l03d-companion-config.md). Cierra una dependencia del centro de inferencia:
una decisión confirmada de detener no puede desaparecer al reiniciar el host.

## Resultado y autoridad

El dueño autenticado puede detener un compañero ya provisionado por el operador y permitir
explícitamente que vuelva a conectarse. La detención revoca el control y vacía las entradas de
inmediato; solo se presenta como durable cuando SQL confirma el guardado. Permitir conexión no
inicia una mente, no renueva el grant anterior y requiere una conexión autenticada nueva del runner.

El allowlist estático de AgentControl sigue definiendo dueño, personaje y capacidades. SQL027
almacena exclusivamente la restricción por mundo–dueño–personaje; no crea vínculos, cuentas,
personajes, grants, conexiones, credenciales, presupuesto ni memoria. La ficha de SQL025 sigue
separada y todavía no alimenta la mente. GameHost/M5 conserva toda autoridad de gameplay.

## Contrato

- Head privado exacto `{revision, stopped, savedAt}`; revisión 0 significa detenido por defecto,
  todavía sin fila guardada. El primer permiso de conectar requiere decisión explícita del dueño.
- CAS con revisión durable independiente del epoch de control; replay inmediato exacto. La UI
  envía ambos baselines. Un conflicto conserva la evidencia remota sin reanudar localmente.
- SQL027 usa tabla privada, RLS y RPCs definer exclusivos de servicio con `search_path` vacío.
  Readiness comprueba columnas, restricciones, ACLs y seguridad de funciones. No hay escritura
  directa desde el navegador ni privilegios de tabla para service_role.
- Antes de escuchar, el host durable recupera todos sus controles configurados. Si SQL o la
  recuperación no están disponibles, los agentes permanecen detenidos y las personas pueden entrar.
  Un mundo con agente configurado exige un identificador de mundo persistente.
- Las rutas legacy de stop/revoke/resume no pueden saltarse CAS en modo durable. Se responde
  `durable_control_required`; direct/cancel siguen sujetos a los grants vigentes. La liberación
  del propio runner retira su sesión, no cambia la decisión durable del dueño.
- Operaciones asíncronas fuera del tick: una por socket/personaje, hasta 32 solicitudes y 30
  por cuenta/minuto. Timeout de respuesta de 8 segundos; el trabajo real conserva su slot hasta
  terminar. No hay reintento automático ni reanudación por una respuesta tardía.
- Después de un resultado incierto, Actualizar recupera la evidencia. Leer nunca levanta una
  detención local. Si el guardado no confirmó stop, se ofrecen Confirmar detención y Permitir
  conexión como decisiones distintas. Salir de la cuenta retira la proyección privada.
- Una sola autoridad activa. No se acredita propagación de revocación entre réplicas; el alfa
  conserva el relevo exclusivo ya existente.

En el laboratorio con store de memoria se conserva el control anterior de sesión. El montaje
del contrato nuevo sobre memoria solo se permite mediante opción programática explícita de QA.
No existe fallback silencioso de un store durable a memoria.

## Reutilización y aceptación

Se reutilizan el transporte de cuenta, AgentControl, los paneles DOM ES/EN y patrones CAS/RPC de
SQL025. Se contrastó el candidato [VibeUE](../research/unreal-assets/myproject/FINDINGS.md): es un
plugin Win64 del editor Unreal y no ofrece controles o persistencia portables al juego web.
Los flujos de Nitro permanecen como referencia del [Inference Center](l03d-inference-center.md),
sin copiar administración global ni instalar Hermes. Fuentes intactas; sin arte nuevo.

Aceptar aislamiento entre dueños/mundos, ausencia de fila, CAS/replay, reinicio/recuperación,
inputs ya en cola, grants obsoletos, bypass legacy, fallo/timeout y cierre de sesión; comprobar
la UI real en escritorio/móvil emulado ES/EN. La base local en disco, el canario SQL real, el
runtime publicado y un dueño autenticado público son evidencias diferentes.

Sigue conexión/modelo y admisión de gasto conjunta. Después, integración de personalidad/metas
en AgentMind y memoria durable con eventos confirmados, fuentes, vigencia y borrado trazable.
