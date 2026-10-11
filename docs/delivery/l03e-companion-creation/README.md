# L03e — creación durable de compañeros

**Estado: implementación y readiness instaladas; aceptación de producción pendiente.**

La creación L03e quedó integrada en `alpha.55`, protocolo 56, junto con los cambios upstream del Bucanero y de carga. Los commits `a53c651` y `d91bc66` se enviaron por continuidad. La migración SQL034 se aplicó a Supabase mediante la UI autenticada; `mn_companion_creation_ready` respondió `{"version":1}` el 2026-10-11 a las 17:23:14 UTC. `MN_COMPANION_CREATION=1` está configurado en el entorno restringido del VPS con respaldo. El actualizador seguía su flujo seguro para jugadores al registrar esta evidencia y estaba probando la revisión previa `fb4276f`; no se forzó un reinicio. La revisión `d91bc66` y el flujo público todavía requieren aceptación en producción.

El corte crea un compañero a partir de un preset revisado, ligado al dueño y mundo del host. La escritura durable reúne identidad, configuración inicial y control detenido mediante la ruta SQL034/SQL025/SQL027. No inicia un agente, llamada de inferencia, spawn ni concesión de permisos; tampoco cambia perfil o inventario.

## Evidencia local

- 57/57 pruebas focales en 9 archivos tras la integración.
- [browser.json](browser.json): 12/12 comprobaciones del wizard y reentrada en navegador. Usó la migración SQL034 real en una base PGlite persistida en disco, con autenticación simulada y memoria de juego simulada. Incluye recorridos ES/EN de escritorio, móvil vertical y horizontal; las capturas fueron inspeccionadas.
- [Brief de implementación](../../briefs/l03e-companion-creation.md).
- [QA local](../../../tools/qa-companion-creation.mjs).

La evidencia local demuestra el contrato durable de la migración y la UX, no un despliegue público activo. La respuesta de readiness de Supabase confirma la instalación de esquema y RPC, no la revisión montada por el servidor.

## Aceptación de producción — PENDIENTE

Completar cuando el actualizador alcance `d91bc66` sin interrumpir jugadores. Registrar la revisión/imagen realmente activa y salud del host; recorrer creación autenticada, recarga y reentrada con el mismo dueño; comprobar aislamiento de invitado/otro dueño, configuración inicial y estado detenido; adjuntar evidencia sin secretos y verificar escrituras/errores y limpieza del canario. No marcar aceptado hasta que esa evidencia corresponda a la revisión activa.

**Siguiente paso:** emparejamiento local para continuar la experiencia de creación. La aceptación pública queda pendiente por separado.
