# RNV07 — expediciones por agua dulce y purificador avanzado

Dirección del autor, 2026-10-10, posterior a [RNV06](RNV06-purifier.md). **Diseño registrado; este
documento no modifica el gameplay desplegado.** Sustituye el purificador barato como objetivo inicial
de provisiones. Sigue el circuito manual de agua, antes del viaje comercial completo.

## Experiencia acordada

Al principio, conseguir agua exige entrar en la isla, afrontar enemigos y llevar una reserva al hogar o
barco. Construir recipientes mejora esa logística. Más adelante, el purificador ahorra expediciones y
facilita preparar viajes largos.

| Pieza | Función en la progresión |
|---|---|
| Cubeta reutilizable | Recoger agua dulce en un manantial/río interior identificado y llevarla hasta la reserva |
| Barril construible | Guardar agua recogida en casa o balsa; empieza vacío, tiene capacidad finita y no genera agua |
| Cantimplora reutilizable | Llevar varias dosis, beber y rellenar desde la reserva o fuente; conserva el recipiente al vaciarse |
| Purificador avanzado | Automatizar el agua con mucho más hierro/tablas y un componente raro de origen exclusivo en la tercera ciudad |

Recipientes, agua interior con enemigos y purificador tardío están acordados. Capacidades, recetas,
tiempos y recompensa exacta requieren tuning del corte; no son cifras aprobadas por el autor.

## Propuesta inicial, aún ajustable

- Primera expedición corta a un manantial del interior de Salty Shore, con enemigos locales vencibles
  en solitario. Guardan el lugar; matar no produce agua como botín ni abre una llave permanente.
  Recoger queda expuesto a ataques y la interacción se interrumpe al recibir daño.
- Cubeta y primer barril con materiales tempranos; sin componente avanzado, Tala 60 o acceso a otra
  ciudad para resolver la primera necesidad de agua. Una reserva debe cubrir una salida útil con pocas
  interacciones de relleno; evitar combatir por cada sorbo o volver al manantial cada pocos minutos.
- **Receta candidata del purificador: 20 hierro + 30 tablas + 1 núcleo de destilación.** Nombre y cifras
  son propuestas. Bahía Ceniza es el destino candidato por ser la tercera ciudad de la ruta aprobada.
  Núcleo mediante expedición/encargo local comprobable; rareza sin depender solo de RNG. Si se permite
  comerciarlo, la reventa no crea otro origen: tiendas iniciales, recetas y drops comunes no lo generan.
  Adquisición directa frente a compra a otro jugador se concreta con AREA08.
- Revisar ritmo del purificador, funcionamiento durante viajes y mantenimiento después de medir
  necesidades/reservas; RNV06 no decide esos valores finales.

## Base existente y coordinación

El catálogo ya tiene `agua` con masa/volumen, transferencias y comercio; RNV06 la produce en bodega.
Un barril decorativo no es un depósito funcional. El contrato de RNV06 tampoco tiene un componente raro.
No atribuir esas funciones a un modelo o a una fila del catálogo.

El frente paralelo `inv02-survival` prepara hambre/sed, perfil `surv:{v:1,sat,hyd}` y consumo
`{type:'eat',g}` desde mochila; es trabajo local ajeno sin integrar. Reutilizar su consumidor/guardado
al integrarlo, sin crear otra sed. Ese comando aún no representa beber una dosis de cantimplora.
Ambos frentes usaron protocolo 47: resolver la versión conjunta al integrar snapshots. SQL028/readiness
del frente de supervivencia deben verificarse con su propietario antes de publicar; este diseño no los activa.

Una única cantidad respalda fuente → cubeta → barril → cantimplora → consumo. Definir identidad,
capacidad y contenido por instancia, con defaults/saneado y proyección privada. Reutilizar `agua` donde
corresponda, sin convertir unidades antiguas en recipientes ni contar el mismo contenido en depósito y bodega.
Peso/volumen/porte incluyen contenido y recipiente; vaciar no elimina su masa base. Salir/reentrar, morir,
retirar un barril lleno y repetir órdenes deben conservar o liquidar una sola cantidad, sin duplicación
ni pérdidas silenciosas. La construcción terrestre requiere su propio contrato antes de habilitar casas.

GameHost/M5 conserva la autoridad: fuente, alcance, propiedad, capacidad, revisión y saldo los valida
el servidor. Respuesta inmediata del cliente conciliable con confirmación durable; sin otro reloj,
writer o namespace de operaciones. No duplicar supervivencia ni el guardado existente.

## Orden de entrega

1. **RNV07a — fuente, cubeta y reserva naval:** ubicación alcanzable/agua dulce explícita con AREA01,
   encuentro local con AREA04, recoger/trasvasar y barril construible con contenido conservado.
   Primero circuito completo en balsa; casas después de la construcción terrestre funcional.
2. **RNV07b — cantimplora y consumo:** integrar supervivencia, dosis/relleno/agotamiento del contenido,
   HUD y acciones PC/touch ES/EN. La cantimplora vacía sigue siendo útil. Respetar supervivencia:
   hambre/sed penalizan máximos/recuperación, sin añadir daño o muerte por sí mismas. El draft actual
   impide consumir a bordo porque el viaje congela la carga: resolver ese contrato con la autoridad
   naval antes de prometer beber navegando; no permitir un decremento local que el viaje sobrescriba.
   Hasta resolverlo, hidratarse antes de zarpar o después de llegar, fuera del viaje activo.
3. **Viaje Salty Shore–Puerto Sol:** preparar reservas, cargar, llegar físicamente, descargar y regresar;
   mercados M5 con AREA08, sin exigir purificador para el primer viaje.
4. **RNV07c — purificador avanzado:** origen jugable del núcleo en Bahía Ceniza, adquisición/gasto únicos,
   receta/feedback/balance y comercio. Publicar cuando esa ciudad sea accesible.

El coste barato desplegado es una base técnica temporal, no la progresión deseada. Cambiarlo con una
alternativa manual utilizable; conservar módulos ya colocados, condición, agua y fracciones. Documentar
su transición antes del cambio, sin borrar patrimonio ni devolver un núcleo al desmontar un purificador
antiguo que nunca lo pagó.

## Aceptación del próximo corte

Fabricar recipientes → llegar a fuente → resolver encuentro → recoger → regresar → llenar barril →
retirar agua; después rellenar/beber cantimplora en RNV07b. Comprobar lleno/vacío, peso/porte, alcance,
daño durante interacción, dos jugadores, replay/reconexión, retiro/rotura y guardado real. No atribuir
durabilidad ante crash a un fixture en memoria. Inspección visual PC ES/móvil EN; aceptación local y
publicación/imagen/entrada pública se registran aparte.

Antes de implementar, verificar candidatos concretos del inventario
[Unreal/FAB](../research/unreal-assets/README.md) y geometría de barril existente; fuentes de solo lectura.
Este corte de diseño no exporta assets ni acepta modelos. Recetas, capacidades y duración se cierran
en el brief de implementación y se prueban sin convertir la logística en grind.
