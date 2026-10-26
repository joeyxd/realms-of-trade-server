# SRV02 — comidas especiales

Corte de AREA03 sobre INV02d/RNV07b. Antes de empezar se revisó upstream `cd5df25`:
sobrepeso, supervivencia y consumo ya existen; no hay comidas especiales implementadas.
El VPS está en alpha.57, sano, con un jugador; no se fuerza ningún relevo.

## Reglas y alcance

Decisiones del autor en `PLAN-PROGRESSION.md` §15.7 del checkout compartido:
pescado asado +10 % vida máxima; grog +25 % recuperación de aguante de combate;
galleta reforzada +10 de carga cómoda. Quince minutos de juego conectado, una activa;
la nueva reemplaza a la anterior. Pausa offline y durante una espera de commit; se pierde
al reaparecer. Aumentar el máximo de vida no cura por sí solo; permanece la curación
normal de comida del 5 %. Hambre/sed conservan sus penalizaciones, incluso sin regeneración
en cero. Natación y capacidad naval siguen sus modelos actuales.

Recetas **provisionales**, preparadas y consumidas al momento, sin mercancía nueva:
asado = 1 pescado; grog = 1 ron + 1 agua de provisiones; galleta = 1 galleta + 1 harina.
Restauran los medidores como sus ingredientes alimenticios actuales (35/0, 5/55, 25/0).
Se pueden preparar con medidores llenos para obtener/reemplazar el efecto. Asado y galleta
exigen una fogata o parrilla propia, viva, cercana y con combustible encendido.
El viaje activo bloquea consumo; una parada seca permite grog de mochila, conservando
el bloqueo de acceso a las instalaciones de la balsa.

## Contrato técnico

- Campo opcional `meal: {v:1, kind, ticks}`; tres IDs estables `roastFish`, `grog`,
  `heartyBiscuit`; ticks enteros 1–54000 a 60 Hz. Ausencia = sin efecto; datos inválidos
  se rechazan. `surv` v1 y perfiles antiguos conservan su forma.
- Descuento desde comandos aceptados, como SRV01; capturar/guardar el tiempo restante
  en el perfil común. Sin reloj de pared, segunda autoridad o tabla nueva.
- `freshwater/meal` usa los ocho campos actuales, revisión y recibo económico M5.
  Consumir ingredientes, restaurar necesidades y reemplazar efecto es una transición
  atómica. Replay devuelve el recibo, sin volver a curar ni renovar tiempo.
- SQL035 amplía validación/transition/readiness; delegados históricos intactos.
  Otros comandos no pueden crear, borrar o refrescar una comida como efecto colateral.
- Columnas predichas `mealKind`/`mealTicks` y revisión de protocolo. Carga cómoda derivada,
  nunca cambia `maxMass`, volumen, puntos ni atributos guardados.
- `MN_SPECIAL_MEAL_OPERATIONS` apagado hasta aplicar SQL035 y verificar readiness.
  Clientes antiguos y despliegue sin migración siguen con consumo anterior.

## Presentación y reutilización

Panel de agua/provisiones existente: preparar/comer, coste, efecto, fuego requerido,
duración restante y aviso de reemplazo, ES/EN y touch. Reutiliza UI y fuego actuales.
Se cruzó el inventario Unreal/FAB: `BP_Holdable_Food` de Dreamrise_SMSK y sus props de
pan/botella aportan referencia del flujo, no lógica portable ni un icono aceptado de
estos platos. Ver [resumen](../research/unreal-assets/SUMMARY.md) y
[supervivencia](../research/unreal-assets/survival/FINDINGS.md). Sin nuevas texturas,
modelos o exportaciones; fuentes intactas.

## Aceptación

Perfil estricto y ausencia legacy; consumo y reemplazo de las tres recetas; fuego ajeno,
apagado, roto o lejano; medidores llenos; carga tras caducidad sin borrar; HP actual y máximo;
aguante con hambre; respawn; predicción; commit retenido; replay/colisión; reconnect/reinicio;
SQL real en PGlite con historia/ACL; UI ES/EN escritorio/móvil. Separar prueba local,
SQL aplicado, activación y aceptación pública. No declarar publicación antes de evidencia.
