# D08c.12 — primera ruta con una amenaza naval

Fecha: 2026-10-08. Continúa [D08c.11](../delivery/d08c11-raft-recovery.md).

Objetivo: navegar el barco-hogar con una tarea visible, tomar decisiones de movimiento ante
disparos legibles y volver al mismo puerto con daño reparable. Primera entrega opcional de
práctica, dentro del mundo costero actual; no decide el formato final de combate/piratería.

Contrato de la ruta:

- En el timón del barco propio, a 24 m o menos del amarre, **Probar ruta** inicia un ensayo.
  Tres boyas en orden, luego regresar despacio y usar el atraque real para completarlo.
  No se completa por tocar la zona de puerto ni por recuperar/teletransportar el barco.
- Una cañonera anclada en coordenadas reales lanza salvas al entrar en alcance. El objetivo
  queda fijo al disparar; trayectoria visible y aviso ámbar durante 120 ticks (2 s).
  Giro, corriente y captura de ráfaga existentes permiten salir del área antes de la caída.
- Colisión del área de caída con rectángulos de flotadores vivos, en la pose girada del tick.
  Impacto de una única pieza por salva; desempate de IDs determinista. Seis HP por impacto,
  máximo 24 HP por ensayo, y esa amenaza no baja una pieza del 50% de su HP máximo.
  La costa conserva sus reglas de daño previas; estas cifras son tuning de práctica.
- Solo el capitán con época vigente inicia/cancela. Invitados reciben la ruta de la nave
  mientras participan, sin controlar progreso/objetivo/daño. Nada se toma del cliente salvo
  la acción y su época. No se añaden fondos, XP, bienes, drops, notoriedad ni pérdidas de carga.
- Cancelación explícita, desembarco, timeout, atraque temprano, recuperación o invalidación
  terminan el ensayo sin éxito. Cancelar corta la amenaza de este ensayo; no es una política
  de huida para futuros encuentros públicos. Daño existente se conserva y se repara con materiales.
- Progreso/salvas/resultados son de sesión. Desconexión borra el ensayo; el save existente
  conserva condición/pose confirmadas del barco. No se restaura tripulación ni proyectiles.

Autoridad: `NavalRoute.plan` trabaja sobre candidatos posteriores a movimiento/contacto.
Solo después de calcular todos los cuerpos se confirman daño, ruta, impactos y perfil.
Tick bloqueado/fallido no consume una salva ni concede progreso. Dos proyectiles máximo por
ruta, cuatro ensayos activos máximo. Sin reloj o aleatoriedad no determinista en simulación.
Snapshot privado `route` versión 1; protocolo 27. Perfil continúa en versión 1.

Geometría: boyas/cañonera derivadas del muelle del mapa, búsqueda acotada de ambos flancos
y escalas menores; agua y límites verificados en puntos y segmentos. Si no cabe, el ensayo
se declara no disponible. Esto no es un planificador general de rutas para barcos gigantes.

Reutilización antes de implementar: inventario D08-REUSE y candidatos verificados por Luna.
No se encontró casco/cañón naval portable listo; `BP_ZombieAI` de Dreamrise no porta IA JS.
`_SplineVFX/Demo/Geometry/Meshes/Barrel.uasset`, `NiagaraExamples/FX_Weapons/Impacts/NS_Impact_Wood.uasset`,
`_SplineVFX/NS/NS_Spline_WaterSplash.uasset` y `SlashTrailElemental/Resource/Audio/Water/SW_Water_Slash_01.uasset`
son referencias, sin exportación/estilo/audición probados. Se reutilizan escena, agua, VFX,
audio sintetizado y primitivas de casco; cero bitmap nuevo. `C:\Unreal` permanece intacto.

Luna: presentación/navegador, tests y revisión independiente. Root: contrato, simulación,
autoridad, integración y aceptación. Un escritor por archivo y una sesión de navegador/GPU.
Verificar ruta/orden/épocas, hit/dodge, límite de daño, conservación, tick rechazado y lifecycle;
capturas de controles/objetivo/salva/resultado en escritorio y móvil. Declarar fixtures.
Dispositivo físico, FPS, audición y balance humano siguen pendientes.

Después: armas navales y rival móvil/derrotable, con colisiones y presupuesto de IA propios.
D09/M5 deben cerrar custodia/pérdidas antes de aplicar riesgo económico público permanente.
Sin SQL, publicación o cambios de despliegue en este corte.
