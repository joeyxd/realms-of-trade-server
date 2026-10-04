# PLAN M4.8 — «Perlas negras» (diseño acordado; los pasos se detallan al empezar)

> Acordado con el autor durante M4.7 (2026-10-04). Se construye **después** de M4.7. Las perlas legendarias
> únicas dependen de M5 (mundo persistente en el servidor): aquí solo las raras.

## 0. La idea

Inspirado en las frutas del diablo, pero nuestro: te tragas una **perla negra** de la Marea y el mar te maldice.
Los tatuajes (M4.7) son lo que entrenas: cualquiera los aprende y se cambian fácil (el «Haki»). La perla es tu
destino: rara, poderosa, con un precio, y **fluye**: se te cae al morir.

## 1. Decisiones del autor

- **Una perla tragada por pirata.** Da cuatro cosas: una **habilidad propia en la tecla G**, un **elemento que
  tiñe todo tu kit** (arma, artes y tatuajes), una **pasiva** y una **maldición**.
- **Raras pero disponibles** (con copias): botín de élites, jefes y cofres de Marea (más con la Marea alta).
- **Se cae al morir**, para que circulen y sean algo importante.
- **Niveles**: las raras primero; las **legendarias** después (M5): **únicas por servidor**, todo el mundo sabe
  quién la trae y, si su portador no entra en unos días, vuelve al mar.
- Las zonas tipo MOBA quedan aparcadas: primero la base divertida, luego la estructura (economía, construcción,
  barcos, comercio entre pueblos; ver `DESIGN.md`).

## 2. Propuesta (por afinar al empezar)

### 2.1 Elementos: muchas perlas sin hacer un kit entero cada vez
Cada golpe del pirata lleva su elemento (`elem`; M4.7 deja la columna y el paso por `strike`). Un elemento es un
estado al golpear + una paleta de VFX + una capa de sonido, y vale para **todo** el kit: con Brasa, la Tromba es un
tornado de fuego que deja el suelo ardiendo, el Timón deja estela de lumbre y el Abordaje cae con explosión.

| Elemento | Al golpear | Tinte |
|---|---|---|
| Brasa | quema (daño en el tiempo) | naranja / rojo |
| Escarcha | ralentiza; 3 acumulaciones congelan 0.6 s (jefes no) | azul hielo |
| Tormenta | salta a un enemigo cercano (× 0.5) | amarillo eléctrico |
| Tinta | marca: el enemigo recibe +10 % de daño | negro / morado |

### 2.2 Las cuatro primeras perlas (raras)
Las G reutilizan los tipos de lanzamiento de M4.7 (`ground`, `dir`, `charge`) con su marca y su carga.

| Perla | G | Pasiva | Maldición |
|---|---|---|---|
| Brasa | «Cometa» (`dir`): sales disparado como bola de fuego, estela que quema | quemar | «El agua te apaga»: en el agua pierdes vida poco a poco |
| Escarcha | «Ancla de hielo» (`ground`): campo helado que frena a los enemigos **y a sus balas** | ralentizar | el fuego y la lava te hacen × 1.5 |
| Tormenta | «Rayo de mástil» (`charge`): cuanto más cargas, más saltos | encadenar | «Imán de tormenta»: las balas enemigas se curvan un poco hacia ti |
| Tinta | «Nube de tinta» (`ground`): dentro no te ven y disparan a ciegas | marcar | «La luz te quema»: de día las pociones curan × 0.7; de noche +10 % de daño |

Legendarias (M5): versiones únicas con nombre propio («Corazón del Kraken», «Ojo del Huracán»…): la misma base,
una G más fuerte, aspecto propio y cartel de **SE BUSCA**.

### 2.3 Al morir
- La perla (y las que lleves sin tragar) sale de tu cuerpo y queda en el suelo con un pilar de luz visible desde
  lejos. Cualquiera puede tomarla; tú también, si vuelves corriendo.
- Si nadie la toma en 90 s (afinable), **vuelve a la marea**: reaparece en una playa al azar con aviso («Una
  perla negra volvió al mar cerca de…»). Siempre sigue en circulación.
- Tomarla la guarda **sin tragar** en la bolsa: un objeto que se vende y se cambia (la mercancía más valiosa del
  juego). Tragarla con otra ya dentro: la vieja sale (con confirmación). Escupirla: fuera de combate.

### 2.4 Lo técnico
- Hueco G: `SLOTS` gana `g` (M4.7 escribe los huecos sobre esa lista), `BTN.G`, `KeyG`, botón táctil, mando por
  decidir.
- La perla es un objeto con `uid` único.
- **Duplicados**: hoy la partida vive firmada en el navegador del jugador, así que alguien puede guardar una copia
  de antes de morir y recuperar la perla. En M4.8, mitigación en memoria (el servidor recuerda qué `uid` salió de
  qué partida y quita la perla de una partida vieja, hasta que se reinicie). M5 lo cierra con base de datos.
  En solo no importa: es tu partida.

## 3. Pasos

Por detallar al empezar M4.8.
