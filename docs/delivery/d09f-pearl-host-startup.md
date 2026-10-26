# D09f-2b.17 — recuperación del host antes de admitir

Base `14ede6d43632ac27ef13d1dfb3589c3ae31c06d4`; conserva el montaje aceptado .16 y excluye
las ediciones paralelas visuales/navales. [Contrato](../briefs/m5-pearl-host-startup.md).

## Resultado

GameHost monta el diario en ProfileSessions desde construcción y compone su Startup antes de
prepare/transport. Configuración trusted exige ID/scope coincidente, bots cero, staging previo,
mapClock puro explícito y piloto `accounts-only`; sin invitados/importación/adopción implícita.
El flujo anterior, incluidos sus saves firmados, sigue por defecto.

Prepare comparte una Promise y adquiere la barrera global antes de await. Preparación económica y
recuperación/lecturas actuales de suelo se asientan antes del drain inicial. Solo ready abre health,
upgrade/admisión/listener/sim/perfiles/comandos/tick. No reproduce eventos históricos ni reenvía un
request sin recibo. El status añade solo estado/readiness, sin identidades/filas/requests.

El primer rechazo detiene el host y cancela la autoridad hermana; espera ambas preparaciones antes
del flush. Close durante recuperación no instala suelo ni borra reservas y rechaza startup incompleto.
La lectura económica abortada conserva el contrato previo: su respuesta tardía se consume sin instalar.
El montaje permanece en API interna; el entrypoint no configura ni activa la circulación durable.

## Evidencia

**1030/1030** pertinentes, cero fallos/canceladas/skips/todo. Node v24.14.0/concurrencia 2,
79 archivos de pruebas, 227 fuentes SHA256 normalizadas LF antes/después. Archivo Git fijo .16 más
cuatro overlays propios: dos fuentes de host, dos rutas económicas del helper SQL y nueva prueba.
Conserva los 992 anteriores y suma **38 checks nuevos en 23 pruebas superiores**.
[Regresión/hashes](d09f-pearl-host-startup-evidence.json).

GameHost/World/ProfileSessions reales, memory y SDK con transporte SQL001–008 local. Ensaya waits de
economía/diario/suelo y Promise compartida; preparada sin publicación mientras economía espera;
ubicación actual tras recibo histórico; ausencia de recibo con requests/reservas exactos; cierre durante
cada espera; ambos órdenes de fallo, incluido diario fallido con carga económica tardía; clock async/
mutante rechazado; cuenta admitida y staging con el diario recuperado. Invitado nuevo, guardado HMAC
verificado e importSave rechazados antes de cargar perfil. HTTP health/status y upgrade WebSocket en
loopback real. No reemplaza World, sesiones ni los adapters del montaje con implementaciones manuales.

Revisión read-only GPT-6 Luna: detectó espera indefinida cuando el diario fallaba antes que economía;
se corrigió fail-stop inmediato, manteniendo settle y primer error. Revisión posterior sin defecto
material en ese cierre. La revisión principal corrigió los fixtures iniciales de reloj/calma/versiones
y comprobó la firma real del guardado de invitado antes de la aceptación final exacta.

Unreal/FAB comprobado por stat de ambos candidatos Blueprint, sin runtime Node/CAS portable;
reutilizados Startup/hidratación/diario/gate/WorldState existentes. Sin assets nuevos, modificación visual
o payload de juego; no se repite GPU/navegador/dispositivos. No env/secrets, Supabase real, nueva SQL,
push, despliegue, reinicio del host del PC ni edición de trabajo paralelo.

## Lo que sigue

Arranque trusted del host integrado; **P4/P6 y activación pública siguen incompletos**. Falta escoger
políticas definitivas y despachar comandos/circulación/efectos autónomos durables del juego. El piloto
de restauración no sustituye esas rutas y aún no sirve para activar una economía persistente pública.
Finalizador durable, epoch de inputs, muerte completa y transacciones conjuntas perfil/mundo/barco
siguen separados. Afinidad permanente por personaje/tipo permanece pendiente; animales/legendarias
después. Una autoridad por scope hasta leases.
