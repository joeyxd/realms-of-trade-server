# Bucanero: reacción original y retroceso diferenciado

2026-10-11. Continúa el corte público alpha.59 por decisión del autor: combate y animaciones.

## Alcance antes de código

Adaptar `hit_to_body_01` del GLB original al rig de juego de 15 huesos como una capa visual breve.
No sustituir la malla armada por una figura desarmada. Un mixer privado muestrea el esqueleto fuente;
sus deltas de rotación, relativos al primer fotograma neutro del clip, se aplican al torso/cabeza y, cuando está quieto
o staggered, a los brazos. Al correr o disparar se conservan brazos, piernas y puntería procedurales.
Entrada/salida con envolvente suave; un golpe confirmado nuevo reinicia la reacción. Dash, nado,
muerte y acciones especiales la cancelan; nunca se retiene un golpe para reproducirlo después.
El evento `hurt` existente conserva predicción/deduplicación. Sin estado de red ni reglas de daño nuevas.
Ausencia/fallo de clip mantiene flinch procedural. Idle de ficha y nado nativo quedan cubiertos por regresión.

Mouse derecho: retroceso del brazo más fuerte y lento que el izquierdo, junto al destello pesado ya
existente. Feedback transmite `secondary` a la vista, sin inferirlo por cadencia o alternancia de mano.
No alterar recargas, daño, alcance, parry/interceptación, progreso, perfiles, controles ni SQL.

## Arte y presupuesto

Se reutiliza el clip entregado por el autor, no arte nuevo: 1,292 s, 195 tracks, 65 huesos y unos
16.160 B de accesores en la fuente. Es candidato concreto preferible a importar otra reacción de
Unreal/FAB; no necesita texturas ni otra descarga. Derivados conservan idle+swim+hit, malla, skin,
IBM y canales/samplers/accesores originales; albedo 1024 escritorio / 512 móvil. Medir bytes reales
y repetibilidad. No añadir draw calls ni una segunda malla visible al recibir daño.

## Aceptación

CPU: fuente inmutable, mapeo de huesos/jerarquía y deltas finitos, envolvente/reinicio/cancelación,
armas y locomoción preservadas, ausencia/fallo recuperable; impulso derecho mayor y retorno normal.
Retener las regresiones de idle, swim, assets y doble gatillo/interceptación.
Chrome real local: ambos dispositivos, daño quieto y al correr/disparar, repetición, dash/agua/muerte,
pistolas visibles, retorno a pose base y fallback. Capturas claras inspeccionadas y recibo de errores.
Publicación por actualizador habitual después de pruebas; verificar revisión/imagen/salud y entrada
pública sin forzar encuentros o reiniciar jugadores. Balance y FPS en teléfono físico siguen pendientes.
