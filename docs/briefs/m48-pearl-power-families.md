# Perlas: kit elemental y transformaciones posteriores

Dirección confirmada por el autor, 2026-10-06. Seguimos con las perlas y M5; las formas animales
y las legendarias de cuerpo elemental quedan para después. Inspiración: las frutas del diablo de
One Piece, con identidad, nombres y poderes propios de Marea Negra.

## Kit actual comprobado

Una perla tragada aporta un poder G, elemento del kit, pasiva y maldición. Brasa quema; Escarcha
ralentiza y puede congelar enemigos comunes; Tormenta salta a otro enemigo; Tinta marca para
potenciar golpes posteriores. Los ataques de arma, artes y tatuajes que golpean heredan el elemento.
Una habilidad de movimiento sin golpe no aplica un estado solo por pulsarla. El alcance PvP de
cada efecto conserva sus reglas actuales; esta dirección no amplía los estados de NPC a jugadores.

`src/data/pearls.js` define las cuatro perlas; `refreshStats` instala su elemento y G en el ECS.
Los proyectiles conservan el elemento de salida aunque el portador cambie o escupa la perla antes
del impacto. Los efectos secundarios evitan reaplicación recursiva; no se otorga otro salto o
quemadura por el propio daño secundario.

Comprobación local de esta aclaración, en el checkout actual: **60/60** pruebas existentes,
sin cambios de runtime, el 2026-10-06:

```powershell
node --test --test-concurrency=2 tests/pearlkit.test.mjs tests/pearls.test.mjs tests/escarcha.test.mjs tests/tormenta.test.mjs tests/tinta.test.mjs
```

Es evidencia del kit actual, no de transformaciones, afinidad permanente ni activación durable del host.

## Ampliaciones acordadas, pendientes

| Poder | Dirección del autor | Falta diseñar antes de implementarlo |
|---|---|---|
| Transformación animal | Perlas que cambian al pirata en un animal | Animales iniciales, activación/duración, relación con armas y skills, movilidad, hitbox, animaciones y maldición |
| Cuerpo elemental legendario | Perlas legendarias que convierten el cuerpo en su elemento, además de influir en el kit | Elementos iniciales, forma/activación, daño recibido y respuesta rival, costes, maldición, efectos y legibilidad |

El cuerpo elemental amplía la propuesta anterior de una legendaria como versión con G más fuerte
y aspecto propio. La categoría legendaria mantiene el requisito de unicidad por servidor de M5;
una perla elemental rara actual no pasa a ser legendaria por tener fuego, hielo, rayos o tinta.
La transformación por sí sola todavía no define invulnerabilidad, inmunidades ni resistencias.
La rareza y disponibilidad de las formas animales siguen abiertas.

## Afinidad y orden de trabajo

La [afinidad confirmada](m48-pearl-affinity.md) pertenece al personaje y al tipo de poder, separada
del UID físico. Perder, morir, vender o prestar la perla conserva el aprendizaje; recuperarla vuelve
a usar el dominio propio. El receptor no hereda XP del objeto. Para nuevos poderes se aplicará esa
misma separación, con su catálogo y balance definidos al abrir cada entrega.

Primero cerrar M5 activo: hooks completos de host/sim, startup y publicación; política de
scope/reloj/invitados/adopción; muerte completa y recuperación. La afinidad tiene su propio corte
con defaults, saneado, crédito autoritativo y balance. Después diseñar e implementar las formas
animales y el cuerpo elemental legendario. Este documento no activa ninguna familia nueva.

Antes de esos cortes visuales, revisar candidatos concretos del inventario
[Unreal/FAB](../research/unreal-assets/SUMMARY.md). `ArrowTrail` y `SlashTrailElemental` son
referencias existentes para VFX; no acreditan un cuerpo transformado ni un rig animal compatible.
La selección/exportación y el presupuesto móvil se resolverán con las formas elegidas, manteniendo
los proyectos fuente intactos.
