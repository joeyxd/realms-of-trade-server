# D08c.2 — pilotaje con cubierta móvil

Entrega local del 2026-10-06. El piloto, la cubierta y la balsa avanzan juntos en el tick del World;
el cliente predice el mismo cuerpo y reconcilia un ACK naval separado. Entrada y salida pertenecen
a la sesión del propietario. El servidor ordinario sigue con navegación apagada.

Abre `PROBAR-PILOTAJE.cmd` desde la raíz, o ejecuta `node tools/naval-lab.mjs --port=5180` y visita
<http://127.0.0.1:5180/tools/naval-pilot/>. El laboratorio ofrece una balsa y una casa de 29 piezas,
W/S para acelerar/frenar, A/D para girar, botones táctiles y ambiente activado por gesto.
Tras bajar al muelle, «Preparar otro ensayo» crea una sesión temporal nueva. No carga cuentas ni guarda progreso.

## Qué quedó conectado

- `NavalPilotServer` resuelve propietario y puesto desde la sesión; entradas acotadas por epoch/secuencia.
  No admite pasajeros ni combate terrestre durante el puesto. Cambiar la fuente, perder soporte,
  salir o desconectar termina el cuerpo temporal y restaura el amarre conservando plano, bodega y HP guardados.
- La pose pública transitoria mueve RaftDeck y el piloto ECS juntos. No duplica el barco guardado.
  El cliente local y los observadores usan una misma transformación de barco/piloto por frame.
- Heartbeats de ticks retenidos por M5 son de solo lectura. Snapshots duplicados aún actualizan
  el estado público, sin repetir la reconciliación naval; snapshots inválidos o viejos se rechazan.
- El harness usa GameClient y el servidor real mediante mensajes clonados y encolados. Reutiliza
  materiales/atlas/caja FAB, personaje, cámara, agua, espuma y audio existentes. Se revisaron los candidatos
  Unreal de movimiento y splash antes de implementar; no hubo exportaciones ni cambios en las fuentes.

La revisión encontró y corrigió dos problemas concretos del laboratorio: el muelle contaba como tierra
en el primer giro, y el desvanecimiento de objetos cercanos ocultaba la balsa. El fixture usa un amarre
exterior; el renderer del ensayo conserva la silueta y evita bob/pitch/roll independientes que separarían los pies.
El freno al perder foco envía un paquete neutral real y conserva los ejes de freno hasta la siguiente entrada.

## Evidencia

- **301/301** pruebas pertinentes, sin omisiones, en una copia aislada de `d47353b` con las fuentes de este corte.
  Incluye **26** nuevas: geometría 4, predicción 8, autoridad 6 y cliente 8. Duración 82,49 s.
- **73/73** de compatibilidad al incorporar después los cambios M5 de `39edbe8`: snapshot canónico de perfil,
  acceso/apply/efectos del tick, host y cliente naval. Duración 23,90 s. No se presenta la pasada de 301 como ejecutada
  sobre ese commit posterior.
- Chrome aislado: escritorio 1280×800, móvil emulado 390×844 y 844×390. Embarque, giro, ACK,
  alineación del piloto, freno al perder foco, salida y conservación pasaron en los tres tamaños.
  En móvil se accionaron los botones con eventos táctiles confiables vía CDP; la casa se revisó en escritorio.
  Cero errores de página, consola, carga de assets o WebGL y sin desborde horizontal.

Capturas: [balsa en escritorio](d08c2-pilot-deck/desktop-1280x800-canvas-v1.png),
[casa](d08c2-pilot-deck/desktop-house-canvas-v1.png),
[UI móvil vertical](d08c2-pilot-deck/mobile-portrait-390x844-ui-v1.png),
[UI móvil horizontal](d08c2-pilot-deck/mobile-landscape-844x390-ui-v1.png).
[Registro de navegador](d08c2-pilot-deck/evidence.json) y
[fuentes, hashes y pruebas](d08c2-pilot-deck-evidence.json).

Se usó SwiftShader para estas capturas. No prueba rendimiento en GPU, teléfono físico, red WAN ni aceptación
auditiva con hardware. El autor mantiene pendiente su playtest conjunto de manejo/balance.
El cierre no incluye push, despliegue ni activación en la demo pública.

## Lo siguiente

D08c.3: caminar en coordenadas relativas y transportar pasajeros con soporte y salida seguros.
Después conectar contacto costero y HP por pieza a la autoridad, predicción y feedback.
La barrera actual muestrea esquinas de foundations; no es colisión continua ni daño por choque y puede
omitir terreno estrecho entre ticks. P5/P6, recuperación y bienes disputables siguen abiertos.

El laboratorio ya usa `renderRafts(alpha)` y la pose local coherente. `src/main.js` se preservó por el trabajo
visual concurrente: al activar navegación en partida habrá que conectar esa vista y su cámara, además de
las puertas M5/D09. Ancla/drift, remolino, encuentros y pérdidas persistentes conservan sus cortes propios.
[Contrato detallado](../briefs/d08c2-pilot-deck.md), [plan M6](../../PLAN-M6.md).
