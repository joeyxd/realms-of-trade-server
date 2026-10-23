# D09f-2b.3 — efecto de perla compartido y probado

2026-10-06. Fuente `26ef249f8c5d50c42f874357f54dd7541c3e5a10`, base `60a4773`.
[Contrato y reutilización](../briefs/m5-pearl-common-effect.md),
[evidencia estructurada](d09f-common-effect-evidence.json).

## Resultado

La sim y el staging durable usan `applyPearlChange` para el reset de G, el
enfriamiento mínimo, el reloj acuático y `refreshStats`. Se elimina la duplicación
de reglas sin cambiar números, controles, maldiciones ni circulación del juego.

`changed()` conserva dirty/evento después del efecto en swallow, spit y muerte.
El adaptador server-only conserva su fila ECS separada, perfil actualizado clonado,
verificación y rollback. La elegibilidad se captura antes de storage; el efecto usa
estado vivo actual al aplicar en tick. Un Promise no escribe en el mundo.

## Verificación

- **68/68** smoke de perlas, kit y staging; revisión independiente Luna sin defectos materiales.
- **745/745** regresión completa, 74 archivos, v24.14.0, 135146 ms; cero fallos, cancelados, omitidos o TODO.
- Archive aislado del commit exacto; SHA256 de los tres módulos registrados y contenido
  igual a la fuente commiteada tras normalizar solo CRLF/LF (Git autocrlf de Windows).
  Three.js físico en el árbol de pruebas para validar realpath del lab.
- Pruebas existentes cubren los cuatro poderes, spit/reemplazo/muerte, predicción,
  RPC/diario lentos, progreso/gear/cooldowns actuales, fences y rollback local completo.
  No se añadieron tests que reproduzcan la implementación.

Cruce Unreal/FAB acotado: inventario/stats/guardado empaquetados no ofrecen lógica JS
portable para este efecto; se reutilizan sim/stats propios. Fuentes intactas, sin arte nuevo.

## Límites y siguiente

Alpha.4/protocolo 16 conservados. Sin SQL nueva/live, conexión de staging al host,
reinicio, publicación o QA visual. El refactor no necesita capturas al no cambiar render/UI.
M5 P4/P6 siguen parciales: lote atómico multi-UID, hooks completos, restauración/scope/reloj/adopción
y leases antes de activar circulación durable. Afinidad permanente queda como misión separada.
Móvil D06b y aceptación visual/humana D08a conservan su cola; las maniobras navales siguen propuestas.
Trabajo concurrente de lote en el checkout no forma parte de esta fuente ni de su aceptación.
