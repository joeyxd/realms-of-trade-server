# Casas, barcos modulares y piratería — discusión de diseño

Fecha: 2026-10-04. Estado: **propuesta para discutir**, sin cambios de mecánicas ni de milestones.

## Lo que pidió el autor

- Construir una casa en tierra o habitar un barco modular que también sea taller, almacén, transporte y arma.
- Barcos aéreos después; conservar una base de construcción reutilizable.
- Referencia: Cosmoteer para distribución, módulos y daño localizado.
- Comercio entre ciudades con riesgo real, guerras navales y piratería divertidas.
- Evitar que una derrota borre todo el patrimonio y provoque abandono.
- Conversar primero; investigar proyectos Unreal/FAB después, con agentes GPT-6 Luna y revisión del principal.

La prioridad es decisión del autor. Todas las reglas concretas siguientes son recomendaciones pendientes.

## Recomendación central

Separar **identidad y construcción**, **estado operativo del barco** y **carga de la expedición**.
El barco puede perder piezas, movilidad, combate y carga, incluso hundirse. Conservar su plano, nombre,
personalización y patrimonio decorativo; recuperarlo en un astillero con materiales/servicio y un plazo corto.
La restauración no devuelve mercancías, munición consumida, botín ni resultados del viaje.

Un plano conservado no basta si reconstruir cuesta semanas: medir el coste de volver a jugar, especialmente
para alguien que pierde dos veces. Tampoco basta conservar el plano si desaparecen muebles/trofeos difíciles
de obtener. La identidad debe incluir esos objetos, con reglas explícitas de vínculo y una sola instancia.

| Modelo | Ventajas | Costes y riesgos |
|---|---|---|
| Pérdida total, incluida la casa | Botín grande, demanda de fabricación, tensión extrema | La decoración se convierte en responsabilidad; veteranos pueden expulsar a nuevos; exige reconstrucción muy barata |
| Casa y barco operativos reaparecen gratis, solo se pierde carga | Entrada sencilla, combate frecuente, creatividad segura | Barcos de guerra vacíos tienen poco que arriesgar; menos demanda de reparación; puede promover acoso |
| Plano/patrimonio conservados, daño y recuperación pagados, carga expuesta | Une creatividad, derrota significativa y recuperación | Requiere separar propiedad/carga y cerrar duplicados; balancear coste y comodidad |

Recomendación: tercer modelo. No es una decisión ya aprobada ni una afirmación de que otro juego lo use igual.

## Qué se protege y qué se arriesga

| Categoría | Propuesta |
|---|---|
| Plano, nombre, pinturas, recetas desbloqueadas | Persisten |
| Muebles/trofeos domésticos vinculados | Persisten como patrimonio; pueden romperse visualmente durante el combate, sin funcionar como blindaje inmortal |
| Casco y módulos funcionales instalados | Se dañan/desactivan; restaurar cuesta materiales/servicio. Primera versión sin robo permanente de módulos raros |
| Mercancías, recursos sin instalar, botín, munición y provisiones de la travesía | Expuestos según la ruta/encuentro, aunque estén en un cofre privado |
| Reservas almacenadas en tierra/puerto seguro | Seguras en ese lugar; retirarlas y transportarlas las expone |

**Privado** significa permisos de acceso, no inmunidad a pérdidas. No permitir un almacén flotante invulnerable
que transporte mercancías comerciables entre ciudades. La protección sigue a la categoría/propiedad, no al
nombre del contenedor. Un objeto doméstico protegido no puede convertirse en mercancía transportable o
materiales vendibles gratis en destino. Decidir reglas de vínculo/desmontaje antes de ofrecer esa protección.

Valor inicial propuesto para cerrar esas transiciones: mercancías retiradas de un almacén de puerto pasan a
estar expuestas inmediatamente; producción a bordo entra en la bodega expuesta. Decoración protegida usa
entradas específicas de catálogo vinculadas, sin venta ni devolución de materiales mientras conserve esa
protección. No basta renombrar, colocar en una pared o marcar como «personal» un bien para protegerlo.

La mochila/equipo del pirata y las perlas ya tienen sus propias reglas de muerte; esta propuesta no las cambia
automáticamente. El tratamiento del equipo personal a bordo es una decisión pendiente.

Si se quiere proteger también materia prima acumulada dentro de la casa flotante, discutir una reserva doméstica
limitada y no comerciable, o reservas locales en puerto. No prometer ambas cosas: almacenamiento ilimitado seguro
y comercio con riesgo. Es una tensión de diseño real, no un problema que resuelva un candado.

## Derrotas y recuperación

- Daño localizado: vela reduce propulsión; timón reduce maniobra; cañón deja de disparar; brecha introduce agua.
  Redundancia y compartimentos importan. Daño visual decorativo puede acompañar ese estado.
- Evitar que romper un único cimiento borre instantáneamente los pisos superiores y todo su inventario.
  Primero daño/inestabilidad con aviso y tiempo de respuesta; hundimiento por flotabilidad/inundación suficiente.
- Capturar o forzar rendición permite tomar carga más intacta. Hundir destruye una parte y deja pecio/carga
  recuperable. Los porcentajes quedan por medir; el ganador necesita espacio y tiempo para retirarlos.
- La carga recuperable sigue siendo disputable; no otorgar dinero automáticamente por matar. El pirata tiene
  que volver a vender, y puede ser interceptado también.
- Tras hundimiento, restauración en el último puerto seguro registrado, sin llevar mercancías al destino.
  Un único barco operativo por identidad; restos/salvamento y restauración no pueden duplicar los mismos módulos.
  Primera versión propuesta: pecio entrega carga real y un presupuesto limitado de chatarra, no una copia
  comerciable del cañón raro instalado. Cada pieza conserva una identidad y un estado autoritativo; restaurar
  activa el estado reparado solo cuando su instancia anterior quedó retirada. El presupuesto de chatarra no
  debe compensar el coste de restauración, aun usando aliados para recogerlo.
- Reparación de emergencia a bordo: limitada, cuesta suministros, exige exponerse; no reconstrucción instantánea
  de un acorazado mientras recibe daño. Astillero: acción agrupada «Restaurar plano» con coste visible.
- Bote de emergencia económico para no quedar bloqueado. El objetivo inicial a medir es volver a navegar en
  unos 10–20 minutos tras perder un barco inicial/intermedio; no un derecho a restaurar gratis cualquier mega barco.
- No ataques mientras alguien está desconectado en puerto. Desconectar durante combate no cancela el combate:
  estado autoritativo con resolución acotada/reconexión y reglas comprensibles antes de zarpar.
  Protección del amarre seguro funciona conectado o desconectado. Una desconexión en mar abierto no crea una
  víctima que quede expuesta indefinidamente: cerrar el encuentro activo con límites definidos y conservar su
  resultado. Duración, piloto automático y transferencia de zona siguen pendientes de diseño.
- No permitir respawn repetido sobre el barco ya capturado ni devolver al derrotado inmediatamente a farmear
  el mismo encuentro. No se propone una confiscación permanente de la casa.

Primera versión de rescate: servicio en especie, no indemnización libre de oro. Cualquier combinación de
salvamento y recuperación debe consumir valor neto; hundir barcos propios/aliados repetidamente no genera riqueza.
No basar valor asegurado en precios elegidos por jugadores.

## Combate naval: construir modifica cómo se pelea

La geometría y la carga deben cambiar masa, flotación, velocidad, giro, perfil y arcos de tiro. Munición,
tripulación operativa y logística limitan armas; poner más cañones no equivale a disparar todos gratis.
Mobiliario decorativo puede tener un peso visual/cosmético acotado para no castigar cada objeto que hace hogar.
Blindaje, almacenes y módulos funcionales sí pagan su coste físico.

Roles viables: corredor rápido, mercante voluminoso, escolta, abordador y fortaleza lenta. Deben existir ventajas
de terreno/ruta, maniobra y escape para barcos pequeños. Un barco grande puede ser fuerte: no debe ser mejor
simultáneamente en transporte, giro, velocidad, mantenimiento, sigilo y fuego.

Secuencia deseada: avistar/decidir → perseguir/maniobrar → inutilizar un sistema → acercarse/abordar/escapar
→ disputar o entregar carga → reparar y vender. Escapar con la mercancía es victoria del comerciante.
Separar mando naval y movimiento del personaje. Solo: órdenes simples y tripulación básica automatizada.
Cooperativo: jugadores reparten timón, disparo, reparación y abordaje, sin hacer obligatorio reclutar amigos.
Combate de cubierta reaprovecha tatuajes, guardia, proyectiles y perlas; interacciones con casco requieren
balance naval específico para no convertir cualquier habilidad de personaje en cañón de asedio.

La casa amarrada puede ser lugar social, taller y mercado. Navegar debe conservar esa sensación doméstica:
caminar por cubierta, recibir visitas, cultivar, organizar bodegas y guardar recuerdos, además de disparar.

Tierra y mar comparten piezas/recetas/propiedad, pero no las mismas ventajas: vivienda terrestre ofrece
almacenamiento local seguro y producción eficiente; barco ofrece movilidad y autonomía, pagando peso,
propulsión y exposición. Evitar que producir todo a bordo elimine las especialidades de las ciudades.
La futura nave aérea necesitará compromisos de carga, sustentación y mantenimiento propios para no hacer
obsoletas todas las rutas navales. Es una dirección de diseño, no contenido para la primera versión.

## Rutas, piratería y economía

Propuesta inicial: puertos protegidos; rutas patrulladas con margen menor y riesgo PvE; rutas disputadas con
PvP anunciado y ganancias potenciales mayores. Los márgenes salen de mercados/distancia/tiempo, no de crear
dinero por atravesar una frontera. Las opciones seguras deben seguir siendo viables, aunque menos rentables.

No hacer PvP obligatorio para progresar en vivienda. Una ruta más corta puede ser peligrosa; una más lenta,
mejor protegida. Cargas mayores elevan beneficio y pérdida. Contrabando, convoyes, escoltas y rumores aportan
objetivos sin necesitar que todo barco lleve todas sus posesiones.

Ejemplo **ilustrativo**, no balance confirmado:

- Compra de carga: 400; venta si llega: 650; operación ordinaria por viaje: 40.
- Éxito: +210. Derrota total de carga más reparación de 60: −500.
- Beneficio esperado por intento: `(1-p)*210 - p*500`. Con 15% de derrotas: +103.5; con 30%: −3.
- La duración también importa: comparar oro neto por hora, dispersión de pérdidas y probabilidad de quebrar tras
  varias derrotas, no solo medias. Medir jugadores solos y veteranos por separado.

El pirata busca mercancías, suministro y oportunidades de venta, no premios infinitos por hundir balsas vacías.
Permitir pago/rendición mediante transferencia validada por el servidor y cese de combate limitado si se acepta;
la duración, reincidencia y múltiples atacantes requieren decisión. No afirmar que el sistema impide pactos fuera
de juego; solo garantizar lo que se ofrece en la interfaz.

Para barco vacío, beneficio de ataque bajo pero coste militar no cero. Reconocimiento, patrullas, puertos de
reventa, notoriedad y escoltas deben hacer la profesión pirata jugable sin garantizarle víctimas fáciles.
No comenzar con recompensas explotables por kills ni con marcadores globales permanentes de todo mercante.

Puertos seguros tampoco deben dar fuego impune desde una frontera ni inmunidad instantánea al perseguido:
definir bloqueo de atraque/transferencia durante combate y protección de la salida. Las grandes flotas y la
escasez de población requieren pruebas específicas; no afirmar que reputación o patrullas garantizan equidad.

## Posibilidades por alcance

- **Primera buena versión:** construir casa/barco, cargar una mercancía, elegir dos rutas, enfrentar un NPC,
  reparar un módulo y recuperar el mismo hogar. Después probar un encuentro entre dos jugadores.
- **Versión muy fuerte:** puentes/abordaje, compartimentos inundables simplificados, incendios contenidos,
  carga física que expulsar para correr, convoyes y escoltas, rescate de pecios.
- **Visión extraordinaria:** fortalezas habitadas y ciudades portuarias con producción complementaria; una
  caravana transporta materiales para un proyecto visible y los piratas intentan capturar la carga intacta;
  dirigibles modulares más adelante con sustentación en lugar de flotación. Mismo lenguaje de piezas y propiedad,
  con locomoción y riesgos propios, sin convertir barcos viejos a aire gratis.

La construcción compartida no significa resolver tierra, agua y aire al mismo tiempo. No comenzar con física
completa de miles de fragmentos, tripulación individual masiva ni guerras persistentes contra casas offline.

## Correspondencia con el repo, verificada hoy

- `src/sim/economy/raft.js`: colocación, soporte, conectividad, coste/devolución, flotación/peso/velocidad,
  capacidad y producción. No implementa combate, daño vivo por pieza ni recuperación del propietario.
- `src/data/raftparts.js`: `hp` y funciones de 28 piezas; no confundir esos datos con destrucción ya jugable.
- `src/sim/economy/voyage.js`: viajes abstractos y eventos con semilla. La piratería actual resuelve una pérdida
  de carga del 25% sin escolta; no es combate naval interactivo.
- `src/sim/economy/cargo.js`, `market.js`: capacidad, perecederos y comercio. Falta política central de acceso,
  estado de cargamento/saqueo y liquidación de pérdidas.
- `PLAN-M6.md`: fase visible por hacer; P6 reserva mar, cañones, daño por pieza y reparación.
- M5 es un requisito previo a una economía PvP pública de bienes persistentes: propiedad, movimientos y
  liquidaciones duraderas/idempotentes. Se puede prototipar todo en solo/memoria sin anunciar persistencia real.
- M8 usa edificios/solares; aún no un editor libre compartido de casas y barcos. El sistema común requiere trabajo.

Antes de persistir daño: separar el plano intacto del estado operativo. `sanitizeRaft` elimina piezas inválidas
reconstruyendo por orden; no debe usarse para borrar silenciosamente el hogar después de daño estructural.
Revisar identificadores estables de piezas, autoridad sobre carga, topes derivados del casco y conflictos de
escritura. El sanitizer actual usa un tope genérico de bodega, no una política final de carga por barco.

## Referencias y qué enseñan

- [Cosmoteer, página del desarrollador](https://cosmoteer.net/index.html): módulos colocados individualmente,
  tripulación/logística, módulos destruibles y barcos que se parten. La misma página distingue Career solo/co-op
  y modos PvP: no demuestra que su economía sea un MMO persistente con casas vulnerables.
- [Cosmoteer, anuncio de julio de 2022](https://blog.cosmoteer.net/2022/07/): salvamento, almacenamiento,
  refinado y fabricación. Evidencia histórica del bucle, no prueba de la frecuencia con que se pierde un barco.
- [Sea of Thieves, anuncio oficial de Season 15](https://www.seaofthieves.com/news/season-15-launch): bandera
  emisaria aumenta recompensas e invita ataques. Lección propuesta: exposición visible con recompensa legible.
- [EVE Online, seguro](https://support.eveonline.com/hc/en-us/articles/212726885-Insurance): cubre casco,
  excluye módulos y carga. Lección propuesta: distinguir categorías; copiar ese nivel de pérdidas puede ser
  demasiado duro para una casa cuya construcción es el centro del juego.

## Decisiones que falta conversar

1. Cuánto patrimonio material debe quedar protegido dentro de una vivienda flotante, además del plano/decoración.
2. Pérdida de toda la carga de viaje en aguas disputadas frente a un saqueo limitado por encuentro.
3. Coste/tiempo aceptable de recuperación y grado de destrucción visual/funcional.
4. Captura solo de carga al principio frente a captura temporal/permanente de barcos bajo condiciones especiales.
5. Alcance de protección de puertos y rutas, y reglas para solos, rendición y desconexión.

Estas preguntas no autorizan aún implementación de las mecánicas propuestas. Actualización del autor, 2026-10-04:
la exploración Unreal puede comenzar en paralelo mientras redacta su respuesta. Falta la ruta concreta de los
proyectos; seguimiento en `docs/research/unreal-assets/README.md`.
