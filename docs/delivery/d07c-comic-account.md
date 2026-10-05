# D07c — acceso de cómic y selección de pirata

Continuación de cuentas P2 `9726201`, integrada con el checkout compartido `0aaae71`.
Versión `0.6.0-alpha.1`, protocolo 13 conservado. Implementación local y probes reales de Auth/DB;
no hay push, publicación ni despliegue de esta UI.

## Resultado

El modal tiene una portada original con insignia pirata SVG, rayos, trama de imprenta, papel cálido y
contornos/sombras de tinta. Usa amarillo para volver a bordo y cian para registro. No añade imágenes,
dependencias ni otra descarga de fuentes. Login, registro, confirmación y selección comparten el dossier.

- Modos explícitos de acceso/registro; Enter ejecuta el seleccionado. Correo, campos requeridos y repetición
  de contraseña se validan antes de llamar a Auth. Mostrar contraseña se reinicia al cerrar o enviar.
- Confirmación con dirección visible, vuelta al login y reenvío explícito. Los errores conocidos de correo
  sin confirmar, contraseña débil y límite de intentos tienen textos fijos; los detalles del proveedor no salen.
- Escape funciona desde los campos, el foco queda dentro del diálogo incluso durante solicitudes, vuelve
  al acceso al cerrar y pasa al nombre del pirata tras entrar. Movimiento reducido y scroll táctil respetados.
- Tras login, cinco aspectos existentes con sus retratos reales, nombre de 16 caracteres y selección marcada.
  Los cambios sincronizan título/settings y llegan al HELLO. «¡ZARPAR!» inicia la partida; importación opcional
  conserva el contrato P2. No hay estadísticas inventadas ni slots ficticios de personajes.

La cuenta sigue teniendo **un perfil de progreso** por UUID. Nombre/aspecto son las preferencias actuales
de este navegador, no campos de personaje sincronizados entre dispositivos. Un creador detallado o varios
personajes requieren su propio contrato de almacenamiento; quedan para una entrega posterior.

## Evidencia

- **43/43** tests pertinentes de Auth, host, importación y store/SQL: `shots/review/m5-auth-comic-tests.log`.
  Auth cliente tiene 11 casos, incluyendo redirect/reenvío, respuestas malformadas y errores redactados.
- `tools/account-review.mjs`: SDK oficial sobre Auth local simulado y WebSocket real. Escritorio 1280×720,
  móvil horizontal 844×390 y vertical 390×844: login/registro con Enter, validación sin petición, contraseña,
  Escape/Tab, confirmación/reenvío, cinco retratos, nombre/aspecto en servidor, importación 57, rechazo y reload.
  Diálogo dentro del viewport, acciones alcanzables con scroll y correo largo legible. Cero errores JS de página.
  Logs/resultados/capturas: `shots/review/m5-auth-comic-browser.log`, `m5-auth-comic/`.
- Capturas inspeccionadas; Chrome SwiftShader, fondo congelado y fuentes Google bloqueadas. Estas pruebas
  revisan UI y red, no acreditan GPU, FPS, teclado virtual ni teléfono físico.
- Sintaxis y diff verificados. Se conserva el trabajo ajeno de balsa/assets y los dos hunks históricos del handoff.

## Supabase real después de aplicar SQL

El autor ejecutó 001 y 002. Las cuatro tablas y los RPCs de lectura responden HTTP 200 con servicio;
`mn_initialize_profile` aparece en el esquema. La RPC de perfiles con clave pública responde 401 / `42501`.
Log redactado: `shots/review/m5-p2-service-probe.log`.

Canario aislado en `m5-auth-comic-live.log`: alta mediante enlace administrativo de signup **sin enviar correo**,
confirmación OTP real, login por contraseña con clave pública, RPC denegada al usuario autenticado,
token verificado por el servidor y entrada WebSocket. Perfil guardado con CAS y restaurado con oro 73 tras
reiniciar el servidor. Se eliminaron únicamente el perfil y usuario temporal creados para este canario.
No se mostraron claves, contraseñas ni tokens y no se consultaron partidas existentes.

Esto comprueba Auth y persistencia reales. **No comprueba entrega de correo ni el recorrido humano del enlace.**
El registro público, confirmación y reenvío del modal sí tienen cobertura local; completar la prueba con un
correo del autor. La URL del juego debe estar permitida en Auth → URL Configuration; signup/resend solicitan
volver al HTTP base del juego, por ejemplo `http://localhost:5173/` durante desarrollo. Referencias:
[redirects](https://supabase.com/docs/guides/auth/redirect-urls),
[signup](https://supabase.com/docs/reference/javascript/auth-signup),
[resend](https://supabase.com/docs/reference/javascript/auth-resend),
[generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink).

Vista previa local preparada en `http://localhost:5173/`, con la configuración privada del `.env` ignorado.
La clave de servicio sigue solo en el servidor. Las cuentas ya pueden crear/cargar su perfil; economía P3,
leases P5, transferencias P4/P6 y aceptación de correo/publicación permanecen pendientes.
