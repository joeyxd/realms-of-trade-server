# D09f-2b.19 — perla ligada hasta morir y pérdida de EXP/bolsa

Base fija 126a543a419314cf51a309b7e8aef7c496bd9e38. [Contrato](../briefs/m5-pearl-release-staging.md).
Decisión del autor del 2026-10-07: no se puede escupir una perla tragada; queda hasta morir, y morir
quita EXP además de la bolsa. Sustituye la propuesta spit durable y la creación de reemplazos previa.

## Resultado

Simulación y staging rechazan escupir/reemplazar, incluso con UID anterior confirmado o cliente antiguo.
La UI elimina ambas opciones, explica el compromiso y bloquea tragar otra mientras haya una dentro.
Mantiene dejar/vender/entregar las perlas sin tragar. Recibos, diario, UID y recuperación históricos intactos;
no reescribe SQL ni historial de propiedad.

Muerte: cae toda la bolsa de objetos y perlas, incluida la tragada, en cualquier zona. Pierde por ahora
**10 % de la EXP del nivel actual**, sin bajar nivel; valor ajustable en tuning.combat.deathXpLoss.
El autor todavía no confirmó la cantidad: default provisional, no balance aceptado. Maestría/tatuajes/oro
permanecen; equipo/pociones siguen con la regla adicional de Cala y el arma inicial protegida.
El perfil refleja la EXP actual y la bolsa vacía para los guardados ordinarios, incluido reingreso.
Una segunda llamada de daño durante la misma muerte no aplica otra penalización ni duplica drops.

Dejar desde bolsa tiene staging trusted durable: helper real separado, cuenta/UID reservados antes de
consultar versión, posición/reloj congelados, CAS y recibo/diario exactos. SQL001–008 existentes;
UID termina sin holder y con suelo registrado antes de apply. Solo drain publica/aplica el drop y
perfil, preservando poder, inputs, progreso y drops ajenos. Fallo local después de SQL revierte únicamente
la tentativa y deja fence. Request público/activación automática siguen pendientes.

## Evidencia

**1151/1151**, 92 archivos, sin fail/cancelled/skipped/todo. Node v24.14.0, concurrencia 2,
108.505,8524 ms. Archivo Git fijo + 19 overlays propios; **322 fuentes SHA256 LF** antes/después,
overlays del checkout coincidentes al aceptar. [JSON de evidencia](d09f-pearl-bound-death-evidence.json).
46 checks nuevos en 28 pruebas superiores: leave y muerte. La composición cambia por la decisión:
40 casos netos de creación de reemplazo retirados/sustituidos por guardas de rechazo, conservando
pruebas de storage/diario/recuperación; se incorporan 14 checks navales ya aceptados en la base.
No se presenta el aumento neto de 20 como toda la cobertura nueva.

Leave: memoria + SDK/SQL001–008 local, helper real, respuesta lenta/perdida y reintento idéntico,
reconstrucción con sesiones/mundo nuevos sobre el mismo backend, conflicto CAS externo sin replan,
generaciones avanzadas, cuatro tipos, progreso durante IO, checkpoint/cubierta, otro drop asignado,
preflight/lifecycle/rollback y frontera real de host. No prueba un reinicio real de proceso.
Muerte: cuatro elementos, XP cero/fracciones, nivel/maestría conservados, Cala y exterior, recuperación
por otro pirata, reingreso sin duplicación y SAVE real de LocalServer. Comandos viejos denegados.

UI: Chrome aislado/local, módulos reales pearlHtml/CharPanel, desktop 1280×1000 y móvil emulado
390×844; capturas inspeccionadas. Sin botón spit, swallow deshabilitado con perla tragada, acción leave
conservada y swallow habilitado en slot vacío, texto explícito/no overflow, cero errores de runtime.
Capturas locales retenidas en shots/review/m5-pearl-bound-desktop.png y m5-pearl-bound-mobile.png;
hashes en JSON. Fixture de panel, no recorrido del juego completo ni aceptación de teléfono/FPS físicos.

GPT-6 Luna auditó rutas/muerte, adaptó seis archivos de pruebas y revisó el resultado sin defecto
material. Cohorte dirigida 156/156; aceptación final del principal incluye todos esos archivos.
El primer diagnóstico propio descubrió que importar la UI en Node requería GSAP del navegador;
se separó la revisión visual real. Después 81/81 dirigidas y la suite completa final. La galería
usa import map local completo de Three.js/GSAP y viewport CDP exacto, sin depender de red externa.

Unreal/FAB: BP_JigServerSave 580.554 B y BP_InventoryComponent 24.878.603 B verificados por stat.
Blueprint sin runtime Node/CAS portable: se reutilizan circulación/onDeath/syncProfile y gate/cola/diario.
Fuentes Unreal intactas; sin assets nuevos. Ediciones de chat, arte, host y protocolo paralelos excluidas.

## Lo que sigue

**La muerte completa todavía no es una sola transacción durable.** EXP, bolsa y equipo siguen el
pipeline actual de sim/guardado; SQL batch pearl-only no garantiza atomicidad con ellos ni suelo de objetos
ordinarios tras crash. Hace falta unir la muerte durable antes de activar toda la circulación de M5.
Pickup/retorno/mint/venta, finalizador del progreso posterior al recibo, epoch/políticas/scope/reloj/adopción,
leases y afinidad permanente por personaje/tipo siguen pendientes. Una autoridad por scope.

No SQL nueva, env/secrets, Supabase real, schema/protocolo nuevo, push, despliegue ni reinicio del host PC.
P4/P6 parciales. Animales y cuerpos elementales legendarios quedan para después.
