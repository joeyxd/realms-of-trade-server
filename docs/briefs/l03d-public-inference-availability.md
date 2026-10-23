# L03d — disponibilidad del centro público

2026-10-11. Incidencia del autor: en el alfa público intentó crear un compañero y solo
encontró un importe máximo de gasto; no llegó a introducir una URL.

La pantalla permite preparar metadatos privados, pero el runtime público no monta el
controlador de compañeros ni ofrece creación o conexión al modelo. SQL025/027/028
están listos; instalar esas migraciones no activa ese recorrido. El Studio local tiene
un ensayo distinto y no vincula sus personajes con la cuenta pública.

## Corte autorizado

- Explicar en ES/EN que la creación y conexión no están habilitadas en este servidor.
- Sin catálogo y sin configuración previa, mostrar disponibilidad y navegación;
  ocultar los campos de gasto, conexiones y compañeros y el botón Guardar.
- Sin catálogo pero con configuración o borrador previo, conservar todos los valores
  visibles y deshabilitados. No escribir, borrar, asignar un modelo ni renovar cuotas.
- Mantener Volver y Recargar, foco de teclado y un único scroll accesible en móvil.
- Preservar el formulario existente cuando haya conexiones admitidas, la validación
  de autoridad, los contratos M5 y el protocolo. Sin SQL ni llamadas a proveedores.

Se reutilizan los paneles y estilos actuales. No necesita arte, modelos o scripts de
Unreal/FAB; no se accede ni modifica ninguna fuente de assets.

## Aceptación

Pruebas de UI/cliente/red, navegador con host real local y auth simulada sin
`agentControl` ni catálogo, ES/EN y 390×844/1440×900. Configuración previa conservada
en SQL028 local. Capturas inspeccionadas. Publicar a la rama existente y verificar
revisión/imagen, salud y entrada pública; no interrumpir jugadores.

## Próximo corte funcional: todavía pendiente

El primer recorrido público necesita creación autenticada y vínculo durable
propietario/personaje, emparejamiento revocable con un controlador local, incorporación
del adaptador real en el cliente de red y estado visible de conexión, stop y consumo.
Ese controlador puede llamar al modelo loopback y abrir WSS saliente al juego; el VPS
no puede alcanzar el `127.0.0.1` del jugador. La memoria/documentos siguen siendo del
compañero y no conceden autoridad de gameplay. Presupuestos y cancelación deben
conservarse entre reconexiones, con evidencia de consumo confirmado o incierto.

Esta es la dirección del siguiente corte, no implementación ni activación aceptada.
Cambiar el texto o activar un controlador vacío no completa creación, chat o memoria
de un compañero dentro de la cuenta pública.
