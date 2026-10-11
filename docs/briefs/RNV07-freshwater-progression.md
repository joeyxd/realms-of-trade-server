# RNV07 — expediciones por agua dulce y purificador avanzado

Dirección del autor, 2026-10-10, posterior a [RNV06](RNV06-purifier.md). **Diseño registrado; este
documento separa dirección y entregas comprobadas.** Sustituye el purificador barato como objetivo inicial
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

El borrador paralelo `inv02-survival` se revisó sin modificar su árbol. RNV07b reutiliza la dirección SRV01
y el campo `surv:{v:1,sat,hyd}`, con consumo integrado en la familia `freshwater` del recibo M5 existente.
No se monta el comando local antiguo `{type:'eat',g}` ni un segundo writer. SQL032 y protocolo 53
son el contrato conjunto candidato; su activación exige readiness verificado.

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


## Checkpoint RNV07a, 2026-10-11

[RNV07a publicada y activada](../delivery/rnv07-freshwater.md), alpha.44/protocolo 50. Runtime comprobado `80e46df8ca4664f93aa59df8350c27cc17589b53`, desplegado 04:47Z con imagen `sha256:b883545f9317c7ba3ed03e7e0ec5d27c62a997b3d0a8c717504980e3f338f353`. SQL030 aplicado por el autor y readiness RPC 1; agua y atributos siguen enabled/ready. [WSS](../delivery/rnv07-freshwater/public/acceptance.json), [health/fuentes](../delivery/rnv07-freshwater/public-readonly.json), [activación](../delivery/rnv07-freshwater/activation.json). Pruebas: selección integrada 129/129, suite del host 5/5 y WSS público 6/6 con denegación anónima. [Evidencia visual local](../delivery/rnv07-freshwater/local/evidence-2026-10-11T04-35-22-891Z.json): 14 capturas, 7 por viewport; la fixture sin enemigos valida el recorrido feliz, no el recorrido live completo. La aceptación del encuentro en navegador queda pendiente para RNV07b. Cantimplora, beber, casas y purificador avanzado siguen fuera de RNV07a.

## Checkpoint RNV07b, 2026-10-11

[Brief de implementación](RNV07b-canteen-survival.md) y [entrega/evidencia](../delivery/rnv07b-canteen.md).
Cantimplora, dosis/rellenos y consumo SRV01 publicados y activos: alpha.47/protocolo 53, runtime ef59c5c.
SQL032 aplicada/readiness 1; 153/153 en el actualizador/VPS, SQL032 13/13 local y navegador ES/EN aprobado.
WSS público autenticado confirma coste, consumo, replay y reconexión duradera; 19 hashes públicos iguales a Git.
La fixture visual sin enemigos no acepta el encuentro completo. Sigue ruta comercial Salty Shore–Puerto Sol.

## Checkpoint RNV08a, 2026-10-11

**AREA07 RNV08a, 2026-10-11 — implementación local, publicación en curso; alpha.48/protocolo 54:**
[Brief](../briefs/RNV08a-shore-resupply.md) y [entrega](../delivery/rnv08a-shore-resupply.md).
Parada seca autoritativa: mercado físico y agua/comida de mochila disponibles; bodega, barriles y
construcción bloqueados. Reembarque conserva el mismo viaje y recalcula masa de recipientes/agua.
M5/SQL030/032 existentes, sin nueva migración o flag; referencias estables en commits y rechazos.
Puerto Sol aún necesita geografía/anclas físicas; este corte no acepta la ruta completa ni descarga.
