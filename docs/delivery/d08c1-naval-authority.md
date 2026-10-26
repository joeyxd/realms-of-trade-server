# D08c.1 — entrega del cuerpo naval autoritativo interno

2026-10-06. [Contrato](../briefs/d08c1-naval-authority.md). Base final de integración `5068d77` y siete
archivos de fuente/pruebas de este corte, verificados contra la copia de QA por SHA-256.

## Resultado

El mismo World autoritativo puede avanzar una copia naval propia a 60 Hz. El cuerpo combina plano,
identidad/HP, masa/flotación/vela, COM y pose; el controlador reserva un handle opaco para el dueño
actual, aplica ejes/daño en tick y rechaza fuentes obsoletas. Timeout frena sin inventar otro ACK.
Un error al calcular un cuerpo no publica parcialmente los otros ni consume el daño pendiente.

Este ensayo está apagado por defecto y separado de la pose ECS pública. Navegar visiblemente en la
partida sigue pendiente: puesto de mando, cuerpo del piloto, cubierta móvil y cliente deben activarse
juntos. No hay campo de perfil, cambio de protocolo, arte nuevo, deployment ni operación Supabase.

## Comprobaciones

- **259/259 pertinentes**, Node v24.14.0, ejecución del principal en árbol aislado sobre `5068d77`:
  35 archivos de navegación/balsa, combate/tatuajes, World host/state y acceso/efectos del tick de M5.
  Incluyen **18/18 nuevas**: 10 contratos de autoridad y ocho de cuerpo. Exit 0, 53.325,1996 ms;
  la duración es evidencia de ejecución, no benchmark de juego. Lista exacta y hashes en el registro.
- Autoridad: opt-in/server-only y LocalServer apagado; propiedad y handles falsos; 32 cuerpos + rechazo
  del 33º; ejes/rangos/secuencias y coalescing; ACK solo en tick; timeout/freno; cambios de fuente/sesión;
  desconexión, baja/reciclaje ECS y cierre; dos Worlds con resultado idéntico.
- Fallo multibody: segundo candidato sale del rango, el primero conserva body/HP/ACK y el World no
  avanza; tampoco se mueve el bot testigo ni se consume RNG. Tras retirar el culpable, reintentar
  el mismo tick aplica los 40 HP una vez y coincide con un World de control que avanzó un solo tick.
- Cuerpo: inverse de COM/origen con varios headings; copia congelada; destruir vela/flotador mantiene
  IDs y origen X/Z; último flotador inmoviliza sin borrar el plano; creación/paso fuera de rango rechazados.
- Con daño aplicado, perfil/barco completo, mercancías, revisión, HP guardado, pose ECS,
  `publicRafts`, `RaftDeck` y publicación de eventos permanecen intactos.
- Sintaxis de controlador/World y `git diff --check` pertinentes pasan. Revisión independiente Luna:
  el principal corrigió publicación parcial de tick y validación de salidas fuera de límites.
- Regresión general anterior, base `ac47564`: **1.347/1.348**, 109 archivos, exit 1. El único fallo
  fue un HTTP 404 de Three.js porque la copia aislada carecía de su paquete local. Tras copiar el
  paquete real instalado, el archivo afectado pasó **6/6**; también pasa en las 259 finales. No se
  cambió la confinación ni la fuente del servidor del laboratorio. Esa ejecución general precede
  el ajuste final del orden del World y no incluye el archivo nuevo de autoridad; la pasada final
  de 35 archivos sí verifica ambos cambios y la integración con el commit posterior de M5.

Regresión general y hashes: [registro de evidencia](d08c1-naval-authority-evidence.json).
La copia de QA contiene únicamente el commit base y la fuente de este corte; los cambios concurrentes
de arena/puerto/otros entrypoints sin commit no entran en ella. Las dependencias Node resuelven desde
los paquetes instalados; Three.js tiene copia real dentro del árbol para la ruta HTTP confinada.

## Límites y siguiente corte

Sin navegación pública, montaje físico, pasajeros, predicción naval, costa del mapa real, fragmentos,
soporte estructural, reparación ni riesgo durable. Daño/carga de ensayo no se adoptan en inventario.
Las pruebas de límite usan fixtures (incluido un mapa extendido); no prueban 32 barcos de 600 piezas
en producción. Medición de servidor/GPU, teléfono/mando físicos y balance humano siguen pendientes.
No se cambió UI, así que no hay nueva aceptación por capturas ni se vuelve a pedir playtest al autor.

El siguiente corte une control del piloto y soporte móvil antes de publicar pose; ACK/predicción y
reconciliación deben mantener personaje/barco juntos. M5/D09 conserva la puerta de bienes, pérdidas,
recuperación y reparación. GPT-6 Luna escribió adaptador/pruebas y revisó el contrato; el principal
integró y comprobó el resultado. Reutilización FAB acotada registrada en el brief, fuentes intactas.
