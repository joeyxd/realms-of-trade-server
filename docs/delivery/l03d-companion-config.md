# L03d-c — Ficha privada durable del compañero

2026-10-10. [Contrato](../briefs/l03d-companion-config.md), continuación de
[Mis compañeros](l03d-owner-center.md) y del [Inference Center](../briefs/l03d-inference-center.md).

## Resultado y límites

El dueño de un compañero ya vinculado puede editar personalidad y objetivos desde «Mis compañeros».
La ficha se guarda por cuenta, mundo y personaje en SQL025 de la misma instancia M5. No comparte
datos con otra cuenta ni modifica el perfil o mundo de gameplay. CAS evita pisar una revisión nueva;
ante conflicto o respuesta incierta se conserva el borrador y se exige cargar la versión del servidor.
No se reenvía un guardado automáticamente.

Esto conserva metadatos, todavía sin conectarlos a la mente. No crea compañeros, vínculos durables,
conexiones de proveedor, credenciales, permisos, presupuestos o memorias. El stop de L03d-b sigue
siendo de proceso. La mente local existente mantiene sus archivos actuales. Proveedor/modelo,
límites conjuntos y canario de conversación/PvE/memoria/coste siguen abiertos.

## Implementación

- Servicio asíncrono fuera del tick. Sesión autenticada y binding del host determinan la autoridad;
  el mensaje no elige dueño o mundo. Rate limit y single-flight acotan solicitudes y trabajo pendiente.
- Validador JS/SQL exacto, límites UTF-8 y rechazo de campos extra/secretos aparentes. La ficha admite
  personalidad y hasta 16 objetivos con estado, texto y condiciones.
- Tabla privada y RPCs de servicio con `search_path` vacío. Sin acceso directo de clientes/servicio
  a la tabla. Readiness comprueba esquema, RLS, grants y funciones; un fallo no detiene el juego.
- Replay inmediato exacto devuelve el mismo head; no es un historial de recibos. Desconectar no
  revierte un commit iniciado, pero retira respuestas y datos privados de la sesión anterior.
- Subvista DOM ES/EN dentro del diálogo existente, con foco/teclado, controles táctiles y scroll.
  No se simula disponibilidad de modelo ni se promete memoria inteligente.

## Evidencia

Las pruebas locales, el recorrido de navegador, la aplicación SQL y el despliegue se registran
por separado en [el directorio de evidencia](l03d-companion-config/).

[Pruebas locales](l03d-companion-config/local-tests.json): **140/140**, sin fallos, cancelaciones ni
omisiones; incluyen SQL, WebSocket real, privacidad, CAS, sesiones tardías y regresiones de M5/control.
[Navegador local](l03d-companion-config/browser.json): **13 comprobaciones** con autenticación simulada
y SQL025 en disco. Guardado, recarga, reentrada, conflicto, borrador, aislamiento, cierre de sesión,
teclado y vistas ES/EN en escritorio y móvil; la base reabierta conserva la revisión. Las cuatro
capturas se inspeccionaron. Sin errores de página/juego; el fixture registra tres respuestas HTTP 503
en consola, cuya causa no acredita este recorrido. Esta prueba no acredita autenticación ni guardado
en el navegador público.

SQL025 se aplicó desde la sesión administrativa existente de Supabase. [Readiness](l03d-companion-config/readiness.json)
respondió `{version:1}` por HTTP desde el contenedor activo con su entorno de servicio. El
[canario real](l03d-companion-config/live-canary.json) comprobó save/load, replay inmediato, conflicto
CAS y aislamiento usando `service_role`; su transacción revirtió todas las escrituras de fixture y
confirmó su ausencia. Esto no es un guardado del dueño desde el navegador público ni activación de agentes.

## Siguiente tramo

Conexión admitida/modelo y límites conjuntos; después integración real de la mente y memoria basada
en eventos confirmados, fuentes visibles, recuperación, exportación y borrado de derivados. Una
segunda sesión debe demostrar que recuerda un acuerdo sin confundir instrucciones con hechos.
