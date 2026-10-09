# Perlas y tesoros del mar — dirección de salvamento

Dirección aprobada por el autor el 2026-10-09: «me encanta la propuesta … save it and lets continue».
Guarda la propuesta de recuperación desde la balsa; no acredita una mecánica implementada.

## Experiencia acordada

Las perlas se descubren como tesoros: botín, cofres y futuras fuentes marinas. Ningún NPC las compra
ni las vende. Las perlas sin tragar todavía se pueden entregar a otro pirata; el mercado entre
jugadores no se define aquí. Una perla tragada permanece hasta morir.

El primer acceso al mar será **salvamento desde el barco que habitas**:

1. Navegar y descubrir una pista: restos flotantes, burbujas sobre un naufragio o brillo de ostras.
2. Colocar y estabilizar la balsa, y recuperar con un gancho o una pequeña draga.
3. Una interacción breve de mantener/soltar controla la tensión durante la recuperación.
4. Obtener materiales o tesoros útiles con frecuencia; encontrar una perla será raro.

El encuentro debe servir a la exploración y a la tripulación: uno pilota, otro recupera y otro vigila.
La recuperación también debe ser posible jugando solo. Estos roles describen la experiencia;
no crean oficios, permisos o multiplicadores de recompensa nuevos por sí solos.

## Orden posterior

- **Pesca manual:** pescado para comida y capturas especiales, como una ostra negra o un cofre
  pequeño. Zonas y mareas pueden variar las capturas.
- **Buceo:** aire, corrientes y naufragios como expedición; exige diseñar movimiento, cámara,
  acceso al barco y rescate antes de integrarlo.

No se fija un catálogo, probabilidad, duración, herramienta fabricable, coste, penalización al fallar
o dificultad. Definirlos y comprobar la interacción será un corte de diseño/implementación posterior.
El objetivo es una recuperación corta e interesante, sin convertir cada intento en espera vacía.

## Base existente y dependencias

Hoy existen tiradas de perla en élites/jefes y cofres de Marea. Las redes de la balsa producen pescado
de forma pasiva; no tienen un minijuego ni producen perlas. El agua profunda no tiene nado/buceo.

Primero retirar la venta antigua a Tía Perla (M5 .38). Mantener la cola de persistencia:
composición del lifecycle/startup, creación de UIDs gestionados para botín/cofres, dominio/reloj,
recuperación y autoridad antes de activar circulación durable completa. Una fuente marina futura
debe usar esa misma autoridad; no basta con un efecto visual o una tirada local.

La elección de gancho/draga y sus assets requiere revisión acotada de Unreal/FAB antes de implementar.
Se pueden reutilizar interacción/recompensas del juego como base, pero este documento no exporta
arte, monta un sistema de pesca, cambia la red pasiva ni concede loot.

Planes vigentes: [M4.8](../../PLAN-M4.8.md#1-decisiones-del-autor),
[M5](../../PLAN-M5.md), [M6](../../PLAN-M6.md).
