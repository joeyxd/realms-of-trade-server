# Bucanero: dos pistolas, interceptar balas y nado original

2026-10-11. Petición del autor: Bucanero a distancia, pistolas diferentes con mouse izquierdo/derecho,
devolver un proyectil enemigo al acertarle con una bala en movimiento y usar el swim del GLB entregado.

## Diseño del corte

- Reutilizar el kit `pistolas`, sus habilidades/maestría/equipo y armeros. La apariencia sigue separada
  del arma autoritativa. Seleccionar Bucanero propone pistolas para un personaje nuevo; no reemplaza
  silenciosamente el equipo durable de un personaje existente.
- Izquierdo: pistola corta de latón, rápida, mano izquierda, 0,20 s entre tiros, 0,7 ATK,
  20 u/s y 0,90 s de vuelo (18 u). Derecho: pistola larga de acero, mano derecha, 0,60 s,
  1,5 ATK, 26 u/s y 0,95 s (24,7 u), menor dispersión. Cooldowns independientes.
  RMB/K/LT/botón táctil derecho se interpretan como disparo secundario con este kit;
  el sable conserva su guardia. Ambos botones pueden mantenerse y dispararse juntos.
- Una bala debe chocar físicamente con un proyectil hostil: barrido continuo relativo en 3D,
  primer impacto, desempate estable por ID. La bala propia se consume y la enemiga vuelve
  en dirección contraria a su trayectoria, desde el contacto, con propiedad del tirador.
  Ambos tiros devuelven proyectiles parreables; solo el tiro fuerte devuelve pesados.
  Un pesado consume un tiro ligero y sigue; imparables conservan su regla. Sin afectar balas aliadas.
- Reutilizar `shot`, `shotEnd` y `parry` para feedback/red. El choque es autoritativo en el paso
  de balas del servidor, a tiempo de mundo actual, como el impacto de un disparo en una entidad;
  el cliente predice el disparo, pero confirma la devolución por eventos. Esta es una extensión
  explícita a PLAN-M3.5: las interacciones instantáneas espada/guardia siguen dentro del comando,
  mientras el contacto de dos proyectiles en vuelo usa el paso autoritativo de `Shots`.
  No conceder XP/chain de excelente por disparar desde lejos; el choque aporta riposte acotado.
  Respetar terreno/obstáculos y el impacto anterior en una entidad; ningún disparo devuelve dos balas.
- Campo reconciliado nuevo `shotAltCd`; revisar versión de protocolo. Sin cambios de perfil/SQL.
  HUD/ficha/táctil/ayuda/tutorial deben explicar las dos pistolas y no pedir guardia con ese kit.

## Reutilización de arte y nado

Inventario Unreal/FAB consultado: no hay una pistola exacta portable en los candidatos relevantes.
Se reutiliza el par procedural de `charlooks.js` con siluetas y colores diferentes; sin texturas nuevas.
El GLB archivado ya contiene `swim` (5,708 s, 195 tracks), más fiel que otro clip del inventario.
Conservar `idle+swim` en el mismo derivado 1024/512: coste medido +94.844 B desktop / +94.840 B móvil,
sin segunda descarga ni duplicar geometría/textura. Originales y claves de ambos clips intactos.

Durante nado vivo, mostrar una instancia lazy del rig nativo de 65 huesos y ocultar la malla/armas
procedurales. Posición/yaw siguen la simulación; en una copia runtime del clip se fija el avance Z
del Hips para quitar los 2,59 m de root motion y el salto de repetición. Mantener bob y rotaciones.
Salir del agua/morir vuelve al rig de 15 huesos; un fallo conserva el nado procedural existente.
Ajustar únicamente el offset visual si la superficie lo necesita, sin tocar stamina/ahogo/colisiones.

## Aceptación

Pruebas: botones, simultaneidad, cooldowns, daño/rango/manos, prohibición de fuego nadando;
cruce rápido entre frames, roce fallido, altura, primer contacto/obstáculo, pesado/imparable,
devolución única y propiedad, eventos de red/duplicados/reconciliación, regresión sable/skills.
Assets: bytes de clips/skin/IBM intactos; rig nativo independiente, loop sin deriva, salida/muerte/fallback.
Navegador real local y público: ambas pistolas y feedback, HUD/táctil ES/EN, dos dispositivos,
swim visible en agua durante más de un loop, encuadre y vuelta a tierra. Capturas inspeccionadas.
Publicación por el actualizador habitual sin interrumpir jugadores. Balance y FPS físicos pendientes.
