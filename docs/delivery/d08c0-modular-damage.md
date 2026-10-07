# D08c.0 — base de daño modular en la bahía

2026-10-06. [Contrato y plan](../briefs/d08c0-modular-damage.md).
Bahía local: <http://127.0.0.1:5180/>. No desplegado ni activado en la partida del jugador.

## Resultado

Los bloques tienen ID/HP por instancia; los destruidos permanecen en el plano y desaparecen de la
lista operativa/render. Masa/flotación/vela se recalculan al cambiar piezas; el rebase conserva el origen
y la velocidad de puntos del barco. Sin flotadores se detienen las maniobras, con estado explícito.

Las rocas de costa tienen contacto por barrido, daño perpendicular, roce protegido y rebote/deslizamiento.
La barra superior muestra HP de casco agregado; Ajustes → Casco y bloques permite seleccionar una pieza,
aplicarle golpes de prueba y acercar el fixture intacto a una roca. Reiniciar restaura solo la prueba.
Impactos usan spray del pool y sonido procedural con gesture gate, mute/pausa y máximo tres sonidos.

## Comprobaciones

**114/114 pertinentes, 19 archivos**, Node v24.14.0, exit 0, duración 4.649,2989 ms; chunk `2ea4c3`.
23 casos nuevos de estructura/contacto/cuerpo/integración y dos de feedback. Comando:

```powershell
$navalTestPaths = @(rg --files tests | Where-Object { $_ -match 'naval.*\.test\.mjs$' })
node --test --test-concurrency=1 @navalTestPaths tests/raft-renderer.test.mjs tests/raft-materials.test.mjs
```

Verifican IDs/HP retenidos, casco/vela diferenciados, cuerpo inutilizado, blueprint/lastre intactos,
conservación al cambiar masa, choque fuerte frente a tangencial, barrido rápido y contacto parado sin
daño repetido. FX expira dentro del mismo pool en escritorio/móvil/movimiento reducido; audio acotado.
Incluyen regresión de manejo, corriente/ráfaga, entrada, reloj, HUD, cámara, renderer/material y servidor
loopback. No equivalen a aceptación de balance, audición humana, FPS físico ni World/naval multiplayer.

Revisión independiente Luna detectó avisos/audio de navegación tras perder toda la flotación: corregidos.
También se neutraliza la captura/boost al perder vela y se evita mostrar métricas del rig visual anterior
como estadísticas funcionales cuando no hay flotación.

Captura inspeccionada en Chrome, viewport nativo 1707×825:
`shots/naval-structure-20261006/desktop-block-destroyed.jpg` (evidencia local ignorada por Git).
Dos golpes de 40 HP al primer cimiento producen 0/60, eliminan esa pieza visual y cambian la barra
a 180/240, con seis entradas del plano conservadas. Esta captura precede al ajuste final de avisos para
vela/casco inutilizados; no se usa para acreditar esos ajustes.
También se recargó la versión final en vista estrecha 390×844 y se inspeccionó
`shots/naval-structure-20261006/narrow-hull-hud.jpg`: HP, timing y controles quedan legibles.
La banda de avisos se desplazó a y=180 para dar sitio a la barra nueva; HP ocupa y=65–101 y la marca
de timing y=129–134. La lectura de diagnóstico confirma versión final, seis partes vivas y pausa;
viewport restablecido al cerrar. Es viewport emulado con perfil gráfico de escritorio, no prueba
de teléfono, FPS físico ni recorrido de maniobras móvil.

El autor conserva su playtest conjunto para después de estructura/features. No se le requiere otro
recorrido para continuar; sus sensaciones y los dispositivos reales permanecen sin aceptación nueva.

## Límites y siguiente corte

No activa World/LocalServer/protocolo, cubierta móvil, daño online ni guardado de destrucción. Colisión
de círculo contra proxies de costa es aproximada; no simula giro puro ni malla de cada bloque.
Módulos vivos sin soporte todavía pueden quedar suspendidos: falta grafo estructural/desprendimiento.
No hay hundimiento, fragmentos navegables, reparación, reembolso ni botín/pérdidas de mercancías.

Continuar por [D08c de autoridad/piloto/cubierta](../briefs/d08c-live-navigation-bridge.md), conservando
los contratos de identidad, plano y cuerpo. Daño/pecios/recuperación con bienes reales dependerán de
operaciones M5. Mantener separado el trabajo concurrente de arena/puerto y de hooks de perlas.
