# D09f-2b.25 — golpes fatales automáticos y tick terminal

## Resultado

Implementado y aceptado localmente sobre bb25e57. Un montaje interno opcional conecta killPlayer/hurtPlayer
y el daño elemental por agua al coordinador durable de muerte completa. Termina el tick una sola vez;
retiene publicación y tick siguiente hasta recibir/aplicar todos los recibos. Ninguna configuración de
CLI/env activa este piloto por defecto.

Reglas conservadas: perla swallowed ligada hasta muerte, pérdida configurable de XP actual sin perder nivel,
bolsa/perlas globalmente y riesgo adicional de equipo/pociones en Cala. Oro/maestría quedan conservados.
No se implementa afinidad permanente en este corte.

[Contrato de frontera, ensamblaje y fallos](../briefs/m5-fatal-combat.md).
[Evidencia fija y hashes](d09f-fatal-combat-evidence.json).

## Cambio y criterio de continuidad

CombatDeath marca provisionalmente dead=1 antes de cualquier pérdida/reset/spill. El actor no vuelve a
recibir daño ni respawnea durante los comandos restantes. afterTick captura solo después de terminar
stepWorld; normaliza los marcadores propios y conserva cada comando/RNG/ACK/sistema ya ejecutado.

El estado normalizado no sale por eventos, snapshots, heartbeat, perfil ni save. Acciones/admisión se
bloquean; inputs/PING/PONG siguen llegando. No acumula catch-up. Un error parcial no captura/repite el tick
y cierra la autoridad. Disconnect invalida antes de despawn; close espera IO sin aplicar y rechaza flush
incompleto.

Muertes del mismo tick usan recibos separados en orden fatal. Cada siguiente plan parte de las versiones
confirmadas anteriores, incluyendo killer compartido y killer causal ya muerto. Todos los participantes
tienen baseline exacto aunque aún esperen su reserva individual. Un prefijo confirmado no se repite si
falla una muerte posterior; no se afirma atomicidad de todo el tick/mundo.

Eventos: tick terminal retenido, luego death/spill en orden de recibos, luego siguiente tick admitido.
El XP/coordenadas/reloj de drops corresponden al tick completo. Respawn solo cuenta tras apply.

## Verificación

**1376/1376** pruebas en **107 archivos**, sin fallos/canceladas/skipped/todo, Node v24.14.0.
Network 2/2, concurrency 1: 6548.1702 ms.
Core 1374/1374, concurrency 2: 106765.4733 ms.
Total 113313.6435 ms. Fuentes fijadas/verificadas antes y después: **353** hashes LF SHA-256: 352 del repositorio y
three.module.js de la copia privada de Three. Las 352 fuentes del repositorio coinciden con el árbol del commit.

22 casos nuevos prueban golpes en comandos, agua Brasa, varios actores/killer compartido/muerto, pérdida
durable con SDK sobre SQL001–010 local, ausencia de publicación/respawn temprano, XP completado, primera
secuencia, baseline de víctimas pendientes, rechazo del segundo recibo, partial tick, close/detach,
join en curso, hooks Promise/malformados/reentrantes y comparación independiente del post-apply. Revisión independiente de solo lectura y revisión
del principal del contrato/implementación/evidencia.

Three 0.160.0 privado: 954 archivos verificados por hash para servir el laboratorio sin escapar del root;
PGlite 0.5.8 y SDK 2.117.2 verificados por versión. Otras dependencias mediante junctions, sin afirmar
hash completo de ellas. El protocolo fijo probado es 19; el compartido 22 contiene trabajo ajeno.

El checkout compartido conserva navegación, chat, recursos/capacidad y arte concurrentes. Merge de host y
LocalServer probado por reversión de solo nuestros cambios y comparación con el texto ajeno anterior.
El commit contiene las fuentes exactas aceptadas y nuestros documentos; no acepta por extensión todo
el checkout dirty.

Comprobación focalizada final en el checkout compartido: **22/22**, 7807.6854 ms; fuentes
propias/integradas relevantes estables durante ese proceso. No extiende la aceptación al resto del trabajo ajeno.

## Estado y siguiente corte

SQL010 aplicada según el autor; sin canario Supabase externo ni SQL nueva. Sin leer env, reiniciar el
servidor, push o deploy. Falta completar pickup/expiry durable de drops comunes, recuperación/restauración
del suelo común tras restart y reloj estable; después cerrar ensamblaje/configuración del piloto y probar
restart/reconexión de extremo a extremo. Afinidad permanente y su escalado elemental conservado al perder
la perla permanecen pendientes. No se acepta todavía toda la persistencia del juego ni WAN/dispositivo.
