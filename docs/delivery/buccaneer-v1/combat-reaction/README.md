# Bucanero: reacción a golpes y pistola potente

2026-10-11. [Contrato previo a código](../../../briefs/buccaneer-combat-reaction.md).

Un golpe confirmado reproduce el movimiento de `hit_to_body_01` (1,292 s) como capa aditiva sobre
el rig de juego. Muestreo privado de 65 huesos, referencia neutra en el primer fotograma, deltas
globales convertidos a ejes locales y entrada/salida suaves. Torso/cabeza reaccionan; brazos también
si está quieto. Correr o disparar conserva los brazos procedurales. No se cambia la malla armada,
las piernas, la posición autoritativa ni las acciones. Dash, nado, muerte, cosecha y acciones especiales
cancelan sin reproducir después un golpe antiguo. Repetir daño restaura la base y reinicia una vez
desde el evento existente. Ausencia/fallo mantiene flinch procedural; despawn libera el mixer.

El mouse derecho produce retroceso visual ×1,45 y decae en 0,42 s; el izquierdo, ×1 y 0,18 s.
Cada evento identifica su mano y disparo secundario, con canales independientes. Cadencia, daño,
rango, devolución de balas, inventario y SQL no cambian. La vista de prueba también demuestra
ambos gatillos con sus propias cadencias. Idle de ficha y nado original se conservan.

Derivados: 2.117.640 B escritorio y 1.546.564 B móvil; +57.436/+57.440 B respecto a alpha.59.
Conservan los datos exactos de idle/swim/hit, 9.164 triángulos, skin de 65 huesos e IBM originales.
Albedo 1024/512 sin cambios, una descarga por dispositivo; no hay nueva malla visible ni draw calls
por la reacción. Dos preparaciones consecutivas dieron hashes idénticos; fuentes/retratos intactos.
[Recibo de assets](../../../art/buccaneer-v1/asset-evidence.json).

CPU: 29/29 en assets, rig, reacción, figura, nado y recoil; 47/47 en combate, pistolas,
interceptación, trayectorias 3D y nado; catálogo 39/39. Conteos de rechecks solapados no se suman.
Se probaron referencia inmutable, orientación rest no identidad, finitud, restauración sin acumulación,
reinicio, máscaras de brazos, cancelación y fallback. La suite general no se volvió a ejecutar;
sus fallos heredados están documentados en [el corte anterior](../ranged-swim/CPU.md).

Integrado con los cambios concurrentes de compañeros, recursos GM y perlas en `c836f77`,
alpha.62/protocolo 59: 76/76 Bucanero/combate y 36/36 comprobaciones de integración, seriales;
[comandos y recibo](integration.json). Sin cambios de protocolo propios.

Chrome local integrado: 16/16, escritorio y móvil emulado, cero errores;
[harness](../../../../tools/qa-buccaneer-reaction.mjs) y [recibo/capturas](qa/acceptance.json).
Daño real de la autoridad aislada llega a Feedback y reinicia el clip; recuperación completa,
brazos preservados al correr/disparar, ambos gatillos reales, cancelación dash/agua/muerte,
fallback inyectado y regreso desde el nado original. Las sondas numéricas de máscaras/cancelación
son directas del cliente y se distinguen del daño confirmado por red. Una sola variante GLB por dispositivo.
Se inspeccionaron las seis capturas: silueta, piernas y pistolas conservadas, sin segunda malla visible.
La cámara cercana y los avisos de arena/HUD cubren parcialmente cabeza/brazos en algunas capturas móviles;
las sondas de rig complementan esa limitación, sin acreditar sensación ni FPS en un teléfono físico.

Enviado en `b466ed9`; publicado por el actualizador normal en su descendiente `6f25a0f`, alpha.62/protocolo 59.
Las 194/194 comprobaciones de la imagen pasaron; revisión activa, imagen validada y contenedor saludable
coinciden. `/health` 200, Supabase durable/world ready, cero errores y escrituras pendientes al terminar.
El relevo inicial esperó a que se cerrara una conexión; no se forzó. [Recibo de publicación](publication.json).

Aceptación pública: 14/14, siete por dispositivo, 28 hashes iguales a Git `efd05a7`, sin diferencias de runtime
respecto al árbol probado. Entrada guest real, mouse/touch para ambos gatillos, recoil ×1/×1,45, sonda visual
del golpe conservando rig15/malla/armas, recuperación, movimiento normal hasta agua y vuelta a tierra,
loop de nado65 con texturas 1024/512 y controles ES/EN. Cero errores del navegador o de la autoridad.
[Recibo/capturas públicas](public/acceptance.json), [script](../../../../tools/qa-buccaneer-reaction-public.mjs).
Se inspeccionaron las capturas de golpe, loop y tierra de ambos dispositivos, de día; el modelo pequeño
en la cámara pública móvil limita leer detalles finos de pose, complementados por las vistas locales cercanas.
El probe público de reacción es solamente visual del cliente; daño confirmado se comprueba en la
autoridad local aislada. Los eventos observados al disparar pueden ser predichos: acreditan input y recoil,
no un acuse de daño autoritativo. No se fuerza un encuentro público. Balance y FPS en teléfono físico pendientes.
