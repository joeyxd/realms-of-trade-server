# D08a — bahía de manejo aislada

2026-10-05. **Implementada y comprobada por código/mediciones; aceptación visual pendiente.**
Fuente `eab3e5c64f80984d3fcad1e9224d1c3cd628ff98`; no activa pilotaje en la partida. El juego conserva alpha.4/protocolo 16;
no hay release, push, publicación ni reinicio del host por este corte.
[Brief](../briefs/d08a-handling-lab.md) · [evidencia](d08a-evidence.json) · [Unreal/FAB](../research/unreal-assets/D08-REUSE.md).

## Abrir la prueba

Doble clic en [PROBAR-NAVEGACION.cmd](../../PROBAR-NAVEGACION.cmd), o desde la raíz:

```powershell
node tools/naval-lab.mjs
```

Abre http://127.0.0.1:5180/ en el navegador. Node y dependencias del repo deben estar instalados;
puerto alternativo: `node tools/naval-lab.mjs --port=5181`. Ctrl+C cierra este servidor independiente.
No abre un navegador automáticamente. No accede a cuentas, perfiles, mercancías o al host del juego.

- **W / arriba:** dar propulsión; **S / abajo:** frenar; **A/D:** timón.
- Botones en pantalla con punteros independientes; mando estándar: stick X, RT/LT.
- **J:** soltar solo lastre de prueba; **R:** restaurar fixture. Pausa/blur/pestaña oculta limpian entrada.
- Cinco configuraciones y viento a favor/lateral/en contra/calma. Línea de trayectoria, centro de masa y
  lastre como referencias opcionales. Tabla de comparaciones calculada por la misma simulación.

## Resultado comprobado

**26/26 pruebas propias**; regresión **695/695**, 72 archivos sobre fuente commiteada aislada,
sin fallos/skips. Cuerpo agregado puro a 60 Hz, entrada, aislamiento HTTP y reloj de render.
Flujos a 30/60/120 FPS ejecutan la misma secuencia de ticks y resultado exacto dentro del presupuesto;
un bloqueo largo descarta tiempo superior a 250 ms. Esto no prueba FPS físicos ni render del navegador.
10.000 ticks mixtos permanecen finitos; la velocidad lateral se amortigua y el rumbo se normaliza.

Mediciones con viento inicialmente a favor, constante en el mundo:

| Configuración | Peso total | Velocidad tras 6 s (u/s) | Freno desde 2 u/s | Giro 90° desde 2 u/s |
|---|---:|---:|---:|---:|
| Balsa ligera | 21 | 4.84 | 1.03 s / 1.00 u | 3.92 s |
| Carga centrada | 45 | 3.74 | 1.67 s / 1.63 u | 5.02 s |
| Carga en extremos | 45 | 3.74 | 1.67 s / 1.63 u | 11.90 s |
| Carga alta a un lado | 45 | 3.74 | 1.67 s / 1.63 u | 9.82 s |
| Casa 4 × 4 | 143 | 2.84 | 2.27 s / 2.21 u | 8.08 s |

Pesos expresados en unidades del catálogo; lastre sintético situado explícitamente, sin equivalencia
con capacidad/mercancías de la bodega actual. La carga centrada y periférica tienen el mismo peso:
aceleración/freno iguales, momento de inercia y giro distintos. Casa 4 × 4 incluye dos velas.
Se midieron los 20 pares de configuración/viento, con techo 60 s y bandera de llegada en la evidencia.
Son valores experimentales para comparar sensación, no balance definitivo.

Soltar lastre conserva la pose y velocidad de los puntos del casco. Cambia la referencia del centro de
masa, sin teletransporte ni impulso añadido; el calado visual se ajusta hasta 0,18 u. El freno no invierte
la marcha de una vela. La calma permite avanzar con una ayuda de remo provisional.

## Arte, revisión y límites

Revisión acotada de candidatos Unreal antes de implementar; fuentes intactas. Se reutilizan renderer,
caja Dreamrise, atlas cómic y agua/pipeline actuales. Sin nuevos modelos/texturas/audio ni exportaciones.
La variante móvil 512 y render ligero se seleccionan para puntero grueso; UI informa tamaño decodificado
si carga. **Selección/resolución y apariencia reales no se aceptan en este corte sin navegador.**
Revisión estática Luna detectó y se corrigieron fondo ausente del pase de profundidad SSR, sombra del sol,
océano que quedaba atrás al navegar, y botones visualmente pulsados al pausar. Sintaxis y rutas HTTP
comprobadas; estas correcciones aún requieren capturas. Cámara interpola, mira hacia el avance y limita
inclinación visual; no hay colisión/caminantes sobre cubierta móvil ni estela nueva aceptada.

**Bloqueo:** la revisión automática rechazó ejecutar el arranque de Chrome por límite de uso al cerrar D06b.
Fue un fallo de revisión, no una evaluación de acción insegura. No se intentó evitarlo. Escritorio,
táctil 844 × 390 / 390 × 844, sensación humana y GPU/teléfono/mando reales quedan pendientes.

## Siguiente exacto

1. Cuando se resuelva la revisión, cerrar móvil D06b y revisar la bahía por teclado y controles táctiles:
   captura inicial/vacía/cargada/periférica/casa; giro/freno; soltar lastre durante giro sin salto del casco;
   pausa/blur y cambio de selección; atlas 1024/512 realmente cargado y agua en ambas calidades.
2. Probar sensación con el autor y ajustar coeficientes sin convertirlos en niveles/tier finales.
3. Diseñar el corte siguiente de autoridad/predicción y cubierta móvil. Viajes/pérdidas persistentes
   conservan la puerta D09; XP, viento cambiante, ancla, combate y topología siguen abiertos.
