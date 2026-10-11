# INV02d sobrepeso + ficha de personaje, kit de UI y fabricación a mano

Fecha: 2026-10-11. Estado: **integrado sobre alpha.47 (`c33ed9c`) como alpha.48 / protocolo 54. Sin SQL nuevo.**
Decisiones del autor: `PLAN-PROGRESSION.md` §15.7 (guía local compartida).

Esta entrega se apoya en lo ya publicado y no lo duplica:

- Carga, puntos de nivel, adopción y reasignación: INV02a–c ([durable](../briefs/inv02b-durable-attributes.md),
  [controles](inv02c-attribute-controls.md)), con su operación M5 y SQL029.
- Hambre, sed, comer y beber: RNV07b ([cantimplora y supervivencia](rnv07b-canteen.md)), con su operación
  `freshwater` y SQL032. Esa entrega partió del mismo modelo SRV01 (valores, penalizaciones, `surv`).

El borrador previo de esta rama (SQL028 «carry points», comandos simples `attr` y `eat`, medidores propios) se retiró
para no crear un segundo camino de Carga ni una segunda sed.

## Qué cambia para el jugador

- **Sobrepeso (INV02d), solo con Carga adoptada.** Cómodo = techo / 1,25, es decir 40 + 4 por punto (techo 50 + 5 por
  punto, el de INV02a). Entre el cómodo y el techo se camina al 70 % y sin dash (chip «CARGADO» junto al oro); por
  encima del techo, al 40 % («SOBRECARGADO»). Nunca inmoviliza ni borra mercancías. **Sin Carga adoptada no cambia
  nada**: el techo por nivel sigue siendo un límite sin zona lenta. Cuentan las mercancías y el agua de los recipientes.
- **Ficha de personaje (kit de UI).** Pantalla completa con vitales (vida, aguante, carga, saciedad e hidratación con
  su penalización), figura 3D giratoria, equipo y cinturón. La pestaña Personaje incluye los controles de Carga de
  INV02c sin cambios de contrato. En Inventario, los alimentos llevan borde naranja y abren el panel de agua y
  provisiones, donde se come y bebe con la operación durable de RNV07b.
- **Fabricar a mano.** TAB (o el botón de martillo del HUD) abre el menú de fabricación en tierra. Hacha y pico de
  piedra se fabrican a mano con 3 troncos + 2 piedras, sin banco; las tablas siguen en el banco.
- **Kit visual.** Paleta azul marino común en HUD, paneles, comercio, cartera y banco de trabajo.

## Pendiente (no incluido)

- **Comidas especiales (SRV02)**, aprobadas por el autor: pescado asado +10 % vida máxima, grog +25 % recuperación de
  aguante, galleta reforzada +10 de carga cómoda; 15 min, una activa, se pierde al reaparecer. Para ser durables deben
  entrar como operación de la familia `freshwater` con su validación SQL (ampliación de SQL032) y aplicarse antes de
  publicar. Las recetas que el borrador usaba (asado = 1 pescado con fuego; grog = ron + agua; galleta reforzada =
  galleta + harina con fuego) siguen siendo provisionales.
- Comer a bordo durante un viaje: RNV07b responde `busy`, como el resto del consumo.
- Huecos y pilas (INV01) y bolsas (INV03): el autor eligió conservar el volumen.
- Flotabilidad y peso de la balsa: plan aparte.

## Contrato y despliegue

1. **Sin SQL.** Nada nuevo que aplicar en Supabase.
2. **Protocolo 54**: nueva columna predicha `load` (nivel de carga). Recargar pares.
3. El nivel de carga lo calcula la autoridad en `applyCommand` desde el perfil (`packLoadTier`) y viaja en el estado
   predicho; el movimiento lo aplica igual en servidor y cliente. La natación conserva su umbral propio (`swimLoad`).
4. Perfil y recibos sin cambios: el sobrepeso solo lee `attr` y la mochila.
5. Corrección menor en `syncNeeds` (RNV07b): un mundo de prueba sin las columnas SRV01 ya no lanza; arregla
   `attribute-profile` («preserve adopted max mass»), que fallaba en origin.
6. HUD: las barras de hambre y sed alargaban el bloque del jugador y lo montaban sobre la fila de botones (vertical) y
   sobre los avisos (escritorio). Con las barras visibles, esa fila baja 28 px en vertical y la lista de grupo y los
   avisos 16 px en escritorio (`--needs-h`, `--needs-d`). Por debajo de 360 px de ancho el botón de fabricar del HUD
   se oculta para conservar objetivos táctiles de 44 px; el banco sigue fabricando todo.

## Pruebas y QA

- [overload](../../tests/overload.test.mjs) 2: cómodo solo con Carga, 70 %/40 %, sin dash, sin cambios sin adoptar.
- [harvest-tools](../../tests/harvest-tools.test.mjs) y [tools-ui](../../tests/tools-ui.test.mjs): recetas a mano.
- Focales con Carga, supervivencia y cantimplora: 134 pruebas; el único fallo restante (ficha antigua ES/EN,
  `i18n04b-character`) también falla en origin.
- Suite completa (`node --test tests/*.test.mjs`): **4598 / 4659**, 55 fallos. En origin `c33ed9c`, a la vez:
  4582 / 4656 y 68 fallos. Todos los fallos de esta rama fallan también en origin salvo uno de red
  (`agent-network`), que pasa aislado 19/19 en ambos.
- QA de navegador `tools/qa-character.mjs`: 1280×720, 1920×1080, 844×390 y 390×844 aprobadas.
- `tools/qa-hud-portrait.mjs`: **36/36 casos sin fallos** (origin `c33ed9c`: 28 fallos de solape por las barras).
