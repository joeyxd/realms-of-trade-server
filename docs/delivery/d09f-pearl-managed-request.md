# D09f-2b.18 — solicitudes con versiones consultadas por el servidor

Base fija `9bf582663a37c4a8621e621b174a712a335abb0d`. Continúa
[el arranque trusted del host](d09f-pearl-host-startup.md). [Contrato](../briefs/m5-pearl-managed-request.md).

## Resultado

PearlStaging ofrece `request({action,uid,source,target?,replaceUid?})` para give, swallow y replace.
El caller identifica sesión/entidad y perla; la entrada rechaza versiones, holder, tipo, scope,
UUID, perfiles, campos extra y getters. Los métodos trusted anteriores conservan su contrato.

Elegibilidad/helper/captura y reserva ocurren sincrónicamente. La misma operación/reserva ocupa
el límite y la lista de tasks durante las lecturas, el commit y la espera de apply. Consulta
loadUnique en el store de sus sesiones y valida cada generación, tipo y dueño registrado;
ausencia o generación agotada no se adoptan. Ambas lecturas de reemplazo se asientan incluso
si una rechaza. No libera y vuelve a reservar entre consultas y cola.

Revalida autoridad/ledger/perlas tras IO y refresca el baseline con el progreso actual antes del
save. La cola vuelve a consultar ledger/ubicación y SQL verifica CAS. Un conflicto no genera
otro plan ni UUID; los reintentos de transporte conservan el request exacto. La respuesta inicial
solo identifica trabajo pendiente. Perfil, ECS, drops y eventos se aplican en drain síncrono.

Fallos se asientan en el contexto y llegan al fence existente; las reservas permanecen hasta
recargar autoridad. El close real del host espera la consulta pendiente y no hace apply ni dispatch
tardío. No agrega una segunda cola, un estado de resolución sin límite ni callbacks del cliente.

## Evidencia

**1131/1131**, sin fallos/canceladas/skips/todo, Node v24.14.0/concurrencia 2.
87 archivos de prueba y 250 fuentes SHA256 normalizadas LF antes/después; 222.635,27 ms.
Conserva 1030 checks previos, suma **58 nuevos en 18 pruebas superiores** y 43 navales aceptados.
Aceptación y hashes en [evidencia](d09f-pearl-managed-request-evidence.json). Nuevos casos con
memoria y SDK/SQL001–008 local: give→give back→swallow con generaciones 1/2/3, reemplazo con
generaciones independientes 3/1, lecturas lentas y límites entre cuentas independientes,
registros inválidos/ausentes, lifecycle/ledger/perfil cambiados, progreso durante IO, reentrada
de captura, cambio real entre lectura y verificación de cola, cambio entre verificación y CAS,
respuesta de commit perdida, apply en host real y cierre esperando IO sin aplicar.

Regresión en archivo Git fijo más dos overlays propios. Conserva el conjunto anterior y añade
pruebas de costa/daño/pilotaje ya aceptadas en la base. Las ediciones de chat, arte y planes
paralelos quedan fuera. Hashes LF de fuentes antes/después y de overlays del checkout verificados.
No cambios visuales; navegador/dispositivo/FPS físicos no revalidados.

Revisión de solo lectura GPT-6 Luna detectó el baseline viejo tras una lectura lenta; se corrigió
con captura validada fresca antes de save y pruebas dedicadas. Revisión posterior sin defecto
material, sin ejecutar pruebas por el agente. El primer diagnóstico de fixtures SQL detectó dos
scopes distintos entre helpers; el journal del fixture se enlazó explícitamente al scope correcto.

Unreal/FAB: BP_JigServerSave 580.554 B y BP_InventoryComponent 24.878.603 B verificados por stat.
Blueprints sin runtime Node/CAS portable; se reutilizaron helpers, gate, store, cola, diario y
efectos existentes. Fuentes Unreal intactas y sin assets nuevos.

## Lo que sigue

El servidor puede planear estas tres acciones sin una versión aportada por el caller. Falta
conectar el dispatch público junto a todas las rutas durables de circulación y efectos autónomos;
el entrypoint sigue sin activarlas. P4/P6 continúan parciales. Scope/adopción/reloj definitivos,
epoch de inputs, finalizador durable, muerte completa y transacciones perfil/mundo/barco abiertos.
Afinidad permanente por personaje/tipo pendiente; animales y legendarias después.

Sin nueva SQL, env/secrets, Supabase real, cambios de protocolo, push, despliegue ni reinicio del
host del PC. Una autoridad por scope hasta leases.
