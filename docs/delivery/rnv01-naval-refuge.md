# RNV01 — Refugio naval con techo y puerta

2026-10-10 · **0.6.0-alpha.24 / protocolo 37**. [Contrato](../briefs/rnv01-naval-refuge.md) y
[plan AREA07](../briefs/area07-naval-action-plan.md). Integración aislada en `codex/area07-pilot`, conservando
recursos M5, Pilotaje II, mercado de agentes, hotfix GM y Tala cooperativa concurrente. El checkout
compartido dirty no se empaqueta. Tala conserva su flag opt-in y requisito SQL016, todavía separados
de publicar este runtime; no se habilita como parte del refugio.

El editor **B** añade puerta y techo con materiales, masa y HP del catálogo. El techo necesita pared/pilar
vivo o una casilla de voladizo desde techo directamente soportado; retirar el soporte se rechaza.
No crea otro piso. Al entrar debajo se ocultan los lotes de techo de esa nave; salir los restaura sin
modificar materiales compartidos.

**V en PC o botón contextual en móvil** abre/cierra la puerta cercana, con prioridad en el prompt y
F/E/G conservados. Hoja abatible 90°: cerrada bloquea; abierta mantiene jambas y hoja lateral como
obstáculos. Dueño y visitantes vivos pueden usarla desde ambos lados, sin cerradura. Un cuerpo o
aterrizaje reservado impide añadir un blocker encima. Abrir no cambia revisión del plano ni expulsa
miembros de cubierta. Servidor, movimiento terrestre y predicción comparten estado, incluso entre
snapshots con el mismo tick/ACK.

`ship.openDoors` opcional conserva IDs de instancias vivas en el perfil del dueño. Retirar/reponer crea
otra ID; daño/destrucción sanea apertura inválida. Perfiles cerrados conservan su forma anterior.
Reintentos no alternan otra vez; payload distinto, revisión/estado obsoletos, pausa, tick bloqueado,
distancia y tamaño de save se rechazan. Un visitante valida también acceso al perfil del dueño.
Se usa el CAS M5 existente, sin SQL, writer ni ledger nuevos. El ACK no prueba commit durable:
una caída previa al save confirmado puede perder el cambio más reciente.

## Verificación local

- **516/516** casos seleccionados después del merge `a05878f`: balsa, navegación/costa/cubierta,
  daño/reparación, editor, perfiles/progresión y autoridad/SQL de recursos/Tala. Los 478 previos
  se repitieron junto a los 38 nuevos de Tala. Incluye soporte destruido, coste/retiro atómicos,
  puerta reconstruida, cuatro orientaciones, replay del mismo tick y reservas del dueño/visitante.
  La prueba GameHost de reentrada usa un store en memoria que declara capacidad durable: comprueba
  la ruta CAS, no Supabase público.
- **107/107** comprobaciones del actualizador VPS en serial local. Hay solapamiento con las anteriores;
  no sumar como casos únicos. [Registro](rnv01-naval-refuge/verification.json).
- **3/3 vistas**: PC 1280×720, táctil 844×390 y retrato 390×844, GameHost efímero/WebSocket,
  editor DOM, V real y toque contextual, cierre ocupado y techo oculto/restaurado. Sin errores de
  página/consola/red ni overflow horizontal. Repetidas después del merge:
  [JSON y 18 capturas JPEG](rnv01-naval-refuge/evidence-2026-10-10T19-14-36-609Z.json).
  Capturas representativas de las tres vistas inspeccionadas; retrato conserva la rotación apaisada actual.

QA declara materiales/reubicaciones y fija la casilla del preview; coste/colocación sí recorren editor y
servidor normal. La primera fixture encerraba al personaje con puerta hacia el agua y la protección de
salida la rechazó. La final construye en popa con puerta hacia la cubierta. No acredita recolección previa,
caminar sin asistencia en navegador, navegación humana, balance o FPS físico. El caso de crew desplaza
la pose y reconcilia membresía, no hace una travesía física. Tutorial/minimapa presentan solapamiento previo
visible: este corte acepta el refugio, no todo el HUD.

Se reutilizan atlas/geometría procedural sin texturas/dependencias nuevas. El prefab terrestre Unreal
inspeccionado no aporta piezas navales exportadas/modulares; las fuentes permanecen intactas.

## Publicación y continuación

Preparado para el actualizador de `claude/loving-lovelace-ptbif7`; revisión Git, imagen y entrada pública
se registran tras el envío. La sonda previa de las 19:02 UTC observó una autoridad sana en `a5b8f12`,
página/health 200, Supabase durable y sin jugadores/sockets/guardados pendientes. No prueba RNV01 activo.
No se cambian SQL, flags de recursos ni configuración del servicio.

Sigue **RNV02: farol utilizable**, después noche casi negra sin luz. Aún no aplica lluvia, temperatura,
descanso, cerraduras ni colapso en cadena al destruir soportes; un techo existente no se derrumba por
fractura estructural compleja. Luces primero; luego oscuridad, natación/reembarque, provisiones/hogar,
rutas, rival móvil y cooperación/riesgo.
