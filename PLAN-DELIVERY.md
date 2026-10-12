# Plan de ejecución — juego, assets y equipo de agentes

**Bucanero — reacción original + retroceso, alpha.62/protocolo 59:**
[Contrato](docs/briefs/buccaneer-combat-reaction.md), [entrega](docs/delivery/buccaneer-v1/combat-reaction/README.md).
Golpe original adaptado al rig armado, sin desplazar raíz/piernas ni impedir correr/disparar;
cancelación al hacer dash/nadar/morir. RMB más fuerte/lento visualmente, con manos independientes.
Idle/nado conservados, +57 KB por GLB, texturas 1024/512; reglas de combate y SQL propios intactos.
Tras integrar recursos GM/compañeros/perlas: 76/76 focales + 36/36 integración, Chrome local 16/16,
seis capturas inspeccionadas. Suite general no repetida. Enviado en `b466ed9`, publicado en `6f25a0f`:
actualizador194/194, imagen validada/saludable, público14/14 y 28 hashes iguales a Git; cero errores/pendientes.
Golpe público es sonda cosmética, daño confirmado aceptado localmente; balance/FPS físico pendientes.
[Recibo](docs/delivery/buccaneer-v1/combat-reaction/publication.json).

**AREA01 GM04d, 2026-10-11 — recursos funcionales publicados, alpha.63/protocolo 59:**
[Contrato](docs/briefs/gm04d-functional-resources.md), [entrega](docs/delivery/gm04d/DELIVERY.md).
Palmera talable/piedra recogible en Recursos; borrador privado y publicación con admisión SQL036
append-only. IDs existentes conservan ciclos, agotamiento y ledger al mover/retirar/republicar.
SQL036 reaplicada, contrato vivo 4/4 y guard de semántica en store: el readiness 1 anterior no bastaba.
418/418 CPU y 8/8 SQL seriales, UI local 9/9 ES/EN escritorio/móvil.
Suite amplia no verde: fallo de receta reproducido en upstream y OOM resuelto al repetir serial;
ver evidencia y alcance en la entrega. VPS `c146b08` sano: 194/194 del actualizador,
29/29 fuentes de contenedor + 20/20 públicas, entrada WSS y GM autenticado 9/9.
Cierre integrado 137/137 y compañeros 27/27, conteos solapados. Borrador privado;
base generación 8 conservada, sin canario de recursos compartidos.
El autor eligió [Taller de habilidades](docs/briefs/skill-studio-vision.md): ajustar las actuales
primero e incluir la adaptación real de un efecto Niagara; intake realizado, implementación pendiente.

**L03f — emparejamiento local integrado, alpha.63/protocolo 59:**
[Contrato](docs/briefs/l03f-local-pairing.md) y [uso/evidencia](docs/delivery/l03f-local-pairing/README.md).
Mis compañeros → Permitir conexión → Conectar en mi PC; código de un uso/cinco minutos,
controlador WSS saliente y capacidad solo chat. Perfil M5 y plaza normal; máximo dos controladores.
SQL025/027/034 existentes, sin SQL nuevo. Detener/revocar/salir/caducidad/reinicio invalidan el permiso.
Documentos, journal y presupuesto permanecen en la PC, conservados al reemparejar; refresco manual r + Enter.
Canario público reanudado 6/6 en alpha.60: controlador real por WSS, respuesta de stub HTTP local,
journal con ámbito y stop durable. Tres filas de registro del fixture siguen pendientes de aprobación de borrado.
Origin HTTPS y tolerancia acotada de reloj corregidos; 42/42 focales, 68/68 integración y 11/11 mundo/GM
tras el merge alpha.63. Navegador local previo 14/14 ES/EN; conteos solapados, suite general no repetida.
La publicación del cliente corregido se verifica aparte. Qwen 127.0.0.1:8080 sigue inaccesible; el stub no prueba Qwen.

**Bucanero a distancia + swim, alpha.59/protocolo 58:**
[Contrato](docs/briefs/buccaneer-ranged-swim.md) y [entrega](docs/delivery/buccaneer-v1/ranged-swim/README.md).
Dos gatillos, armas/manos/recargas distintas, interceptación física 3D y nado original con rig nativo.
85/85 focales CPU, 27/27 recheck, assets19/19 y catálogo39/39 (solapados); navegador local20/20.
Suite general no verde, límites en CPU.md. Tras integrar SRV02: focales49/49 y navegador20/20.
Publicado por el actualizador habitual en `62490c8`, alpha.59: imagen validada, contenedor saludable,
24 hashes públicos y entrada/gatillos/nado/regreso a tierra ES/EN 12/12 escritorio/móvil emulado.
Cero errores o pendientes; choque aceptado localmente. Recibo y límites visuales nocturnos en la entrega.

**AREA03 SRV02, 2026-10-11 — SQL035 activo; grog aceptado en público, alpha.62/protocolo 59:**
[Contrato](docs/briefs/srv02-special-meals.md) y [entrega/evidencia](docs/delivery/srv02-special-meals/README.md).
Pescado asado +10 % HP máximo, grog +25 % recuperación de aguante,
galleta reforzada +10 unidades de carga cómoda; una activa por 15 min conectados, pausa offline,
se pierde al reaparecer. Operación freshwater/M5, SQL035 readiness 1 y flag activo.
WSS público 11/11 en `e625a5c`: grog, coste/replay/colisión, pausa offline/reentrada y denegación caliente.
Navegador público 12/12 en `6f25a0f`: botón real y perfil guardado, ES/EN escritorio/móvil vertical y horizontal emulados.
Cuenta/perfil temporales eliminados, recibos conservados y autoridad sana; 403 solo del acceso GM denegado.
194/194 actualizador previo, SQL 33/33 y recheck alpha.62 33/33, conteos solapados. Primer rechazo SQL sin causa
confirmada; consumo público con cocina propia encendida pendiente. [INV03](docs/briefs/inv03-existing-backpacks.md)
completará aceptación de las mochilas 18/30/42 ya existentes con Carga; no rehacer sobrepeso.
Primer avance INV03: [SQL001–036 11/11](docs/delivery/inv03-existing-backpacks/README.md), segundo tier,
Carga/coste/conservación/denegación/replay; recorrido público pendiente.

**L03e creación durable de compañeros — aceptada en el alfa público, protocolo 56:**
[Entrega y evidencia](docs/delivery/l03e-companion-creation/README.md), [brief](docs/briefs/l03e-companion-creation.md).
Wizard privado: nombre, oficio, personalidad, rasgos y aspecto; aleatorio y revisión de documentos antes de confirmar.
Un compañero preparado por cuenta/mundo, con identidad, configuración SQL025 y control SQL027 detenido en SQL034.
57/57 focales; navegador local 12/12 con SQL034 en PGlite persistido y auth simulada; recheck de integración 21/21
solapado tras conservar los cambios concurrentes. Supabase SQL034 instalado/readiness 1 y flag de VPS habilitado.
Aceptación autenticada pública 11/11 en 96af1aa, alpha.56: creación, documentos, recarga/reentrada y limpieza
verificada de la cuenta temporal. Updater 176/176. Salud posterior comprobada en 66fcf82, alpha.57:
una autoridad sana, diez módulos de imagen y seis públicos iguales a Git, cero errores/escrituras pendientes.
Sin modelo/inferencia, spawn ni permisos concedidos; siguiente corte: emparejamiento local revocable y adaptador real de red.

**AREA15, 2026-10-11 — soltar perlas con recibo; piloto común apagado:**
[Entrega/evidencia](docs/delivery/m5-ground-pearl-leave.md), [contrato](docs/briefs/m5-ground-pearl-leave.md).
`leave` autenticado reserva cuenta/UIDs antes de IO, conserva progreso ECS y resuelve generación durable;
confirma perfil/ubicación/mundo/reloj antes de aplicar juntos sesión, suelo, ledger e índices.
Rollback y cerco ante deriva/cierre/desconexión, incluso callback nulo antes del comando.
28/28 nuevos; cohorte 625/636 en 73 archivos congelados, base e625a5c.
Tres archivos con fallos de asignación/clonación repiten 49/49 sin cambios; quedan dos fallos heredados
HTML localizado y Cometa/agua reproducidos en upstream limpio. Cohorte completa no verde. Dos SIGKILL nuevos
con recuperación/recogida únicas y cero efectos históricos. Conteos solapados.
Integración de compañeros alpha.60: 122/122 en 17 archivos seriales; GM036 alpha.61: 83/83 en 12 archivos.
VPS verificado en `6b713d2`, alpha.60/protocolo 59: actualizador 194/194, entrada pública 6/6 y
16 módulos iguales a Git; montajes comunes nulos, sin adopción ni SQL nuevo para `leave`.
Los recursos GM activos aún excluyen el piloto común: esa composición queda pendiente.
Sigue `give` transaccional, después `swallow` y sobre completo kill/cofre; luego transición/adopción y canario VPS.
Regla del autor: `give` solo entrega sin pago un UID en la bolsa del dueño. Tragada no se entrega ni vende.
Compraventa entre jugadores aprobada como dirección; requiere su propio corte y confirmar juntos perla y pago.

**AREA15, 2026-10-11 — perlas nuevas de élites/cofres; piloto común apagado:**
[Entrega/evidencia](docs/delivery/m5-ground-pearl-mint.md), [contrato](docs/briefs/m5-ground-pearl-mint.md).
Captura antes del suelo/evento, UID `mint:<UUID>` y recibo SQL004/018/019 bajo el mismo dueño;
muerte primero, mints en orden y publicación al terminar todos. Aplicación síncrona reversible,
filas actuales y pausa offline. 16/16 nuevos; 1063/1064 en 106 archivos congelados, base ff45e49;
único fallo Cometa/agua reproducido en upstream sin cambios, registrado en la entrega.
Dos SIGKILL nuevos con recuperación y recogida únicas, sin efectos históricos. Conteos solapados.
Integración alpha.56/protocolo 56: 137/137 en 24 archivos congelados (base c535e5d), conteos solapados.
Alpha.57/protocolo 56: 28/28 en 6 archivos (base b89a2d9); core de servidor/suelo sin cambios.
VPS verificado en 056d275, alpha.57/protocolo 56: actualizador 176/176, imagen 78/78,
14 módulos idénticos a Git y entrada pública 6/6. Sin SQL AREA15 nuevo ni activación/adopción pública.
El sobre completo de kill/cofre y candidatos sin intención durable no están aceptados.
Siguen comandos restantes de perlas y loot completo; después transición detenida/adopción y canario VPS.

**Bucanero, ficha animada — alpha.57/protocolo 56, sin SQL propio:** [entrega](docs/delivery/buccaneer-v1/idle/README.md).
Idle auténtico en rig nativo independiente; giro/zoom, miniaturas quietas y gates de visibilidad.
Un GLB por dispositivo, +353.260 B por clip; 42/42 CPU y 24/24 navegador. Tras integrar el corte
concurrente de compañeros: 57/57 focales; SQL034 conserva su activación separada.
Publicado en `66fcf82`: 176/176 actualizador, 15 hashes y entrada pública escritorio/móvil verificados.

**AREA01 GM04c, 2026-10-11 — dispersión decorativa publicada, alpha.57/protocolo 56, sin SQL GM nuevo:**
[Contrato](docs/briefs/gm04c-decoration-brush.md) y [entrega](docs/delivery/gm04c/DELIVERY.md).
Pinceles de copias independientes con preview privado, formas/densidad/separación/semilla/escala y undo atómico.
Modelo cargado: geometría, texturas, archivo/ahorro y costes medidos, con presupuestos por trazo y acumulados.
Sin tala/recolección ni cambios de recursos. Modelos existentes reutilizados; fuentes intactas.
293/293 regresión y 87/87 integración actual; local/público GM 10/10 cada uno, capturas inspeccionadas.
Release `056d275` sana, 21/21 fuentes activas y 15/15 públicas; entrada real y mapa base generación 8.
Conteos solapados; alcance de costes, móvil emulado y límites en la entrega.

**AREA03 INV02d, revisión 2026-10-11 — existente; corrección legacy enviada, alpha.54/protocolo 55:**
[Revisión y evidencia](docs/delivery/inv02d-existing-audit.md). La otra sesión ya implementó sobrepeso,
70 %/40 %, bloqueo de nuevos dash, HUD/ficha ES/EN y predicción; no volver a empezar desde INV02c.
Corregida una discrepancia: sin Carga adoptada, una mochila antigua por encima del techo conserva
su movimiento normal; capacidad sigue impidiendo añadir mercancías. 83/83 en 14 archivos y 14/14
tras integrar el Bucanero concurrente (conteos solapados). Código `e874bed` enviado, sin SQL nuevo.
VPS último comprobado: `f26aae2`, alpha.52, dos jugadores/dos sockets, cero errores o pendientes;
el actualizador espera mundo vacío. Despliegue de la corrección y aceptación pública pendientes.
Siguen SRV02/comidas especiales y bolsas INV03 conservando volumen, como cortes separados.

**Bucanero, tamaño — alpha.53/protocolo 55, sin SQL:** el autor lo siente pequeño en mundo y ficha.
[Ajuste y comparación](docs/delivery/buccaneer-v1/size-review/README.md): modelo +12,2 %, ficha
×1,10 y rostro del icono ×1,60. 36/36 focales, cuatro sesiones/16 vistas sin cortes; sin nuevos assets.
La publicación se comprueba y registra aparte.

**Bucanero v1, 2026-10-11 — alpha.52/protocolo 55 sin SQL:**
[Entrega](docs/delivery/buccaneer-v1/README.md): modelo e icono del autor incorporados al aspecto 2.
Derivados escritorio/móvil y originales conservados; 36/36 focales, 19 comprobaciones de navegador,
capturas de poses/armas/herramienta y comparación de fidelidad. Despliegue registrado aparte en
la entrega. El creador modular conserva sus gates.

**Antorcha y luz de proyectiles, 2026-10-11 — alpha.51, protocolo 55 sin cambios, sin SQL:**
[Entrega](docs/delivery/torch-light.md). La antorcha (N) siempre pidió 1 tabla básica (`madera`, SQL022), no troncos;
el panel de fuego ahora lo muestra (tarjeta de material, aviso «2 troncos por tabla» y botón a fabricación) y pasa al
kit azul. La antorcha entra como receta a mano en el menú de fabricación (TAB y banco) con la misma intención `fire`
del panel, sin tocar `resource craft`. Balas, perdigones y proyectiles enemigos son luces móviles en los huecos libres
de `LocalLights` (hasta 4, sin quitar faroles) más destello de boca. Suite completa 4721/4743; los 17 fallos también fallan en origin `5da58e9` (18 allí).

**AREA17, 2026-10-11 — disponibilidad del centro público; creación aún pendiente:**
[Entrega](docs/delivery/l03d-public-inference-availability.md), [contrato](docs/briefs/l03d-public-inference-availability.md).
Sin conexiones y sin configuración previa, explica la disponibilidad y oculta el formulario de gasto.
Con valores previos, los conserva de solo lectura. ES/EN, Volver/Recargar; sin SQL/protocolo ni proveedor.
56/56 UI/cliente/red; navegador y despliegue se registran en la entrega. El Studio local no crea
compañeros en cuentas públicas: faltan vínculo durable, emparejamiento y adaptador real de red.
Navegador local 19/19; código `1983733` desplegado en `6fd7f68`, alpha.51/protocolo 55.
Una autoridad sana, seis hashes Git/imagen/URL coincidentes; entrada pública invitada 7/7
y autenticada real 7/7, ES/EN y móvil, sin errores. Cuenta temporal retirada y verificada.
No se forzó relevo ni desconexión; creación/emparejamiento/modelo públicos siguen pendientes.

**AREA15, 2026-10-11 — muerte y botín compuestos; código publicado, montaje común apagado:**
[Entrega/evidencia](docs/delivery/m5-ground-death-lifecycle.md), [contrato](docs/briefs/m5-ground-death-lifecycle.md).
Captura fatal real, pérdidas/XP/PK y fuentes en el recibo común; recogida/expiración automática,
hidratar filas actuales y pausa offline. Aplica perfiles/ECS/sesión/eventos juntos tras SQL confirmado.
1015/1015 en 100 archivos congelados (base 97d32a1), cuatro SIGKILL nuevos;
SQL001–032, Carga/agua/terreno y supervivencia/respawn conservados. Conteos solapados.
Integración final 278/278 en 43 archivos congelados (base 58a097b):
INV02d/carga, SQL033/materiales GM y exclusión de activación, cantimplora y Companion Studio.
RNV08a/costa 74/74 en 14 archivos congelados (base cd2a97b), conteos solapados.
VPS `cd2a97b` sano, 0.6.0-alpha.50/protocolo 55: 176/176 del actualizador,
63/63 sin red en la imagen exacta, diez módulos iguales a Git y entrada pública 6/6.
Una autoridad/timer activo; sin SQL nuevo, adopción ni montaje público. Sigue mint y comandos
restantes de perlas; después transición detenida/adopción y canario autenticado de caída/reinicio VPS.

**AREA07 RNV08a, 2026-10-11 — publicada y desplegada; alpha.50/protocolo 55:**
[Brief](docs/briefs/RNV08a-shore-resupply.md) y [entrega](docs/delivery/rnv08a-shore-resupply.md).
Parada seca autoritativa: mercado físico y agua/comida de mochila disponibles; bodega, barriles y
construcción bloqueados. Reembarque conserva el mismo viaje y recalcula masa de recipientes/agua.
M5/SQL030/032 existentes, sin nueva migración o flag; referencias estables en commits y rechazos.
Runtime `cd2a97b`, una instancia sana, 176/176 en Docker y 21/21 hashes públicos iguales a Git.
WSS autenticado 5/5: consumo, replay y reconexión durables; cuenta temporal retirada, cero errores/pendientes.
Navegador local ES/EN con fixture de ubicación: comercio, agua/comida y el mismo viaje tras reembarcar.
Puerto Sol aún necesita geografía/anclas físicas; este corte no acepta la ruta completa ni descarga.

**INV02d, 2026-10-11 — sobrepeso, ficha de personaje y fabricación a mano, alpha.49/protocolo 54, sin SQL:**
[Entrega](docs/delivery/inv02-survival.md). Sobre INV02a–c y RNV07b sin tocar sus operaciones M5, SQL029/032 ni contratos.
Con Carga adoptada, cómodo = techo / 1,25 (40 + 4 por punto): entre cómodo y techo 70 % de velocidad y sin dash,
por encima del techo 40 %; nunca inmoviliza ni borra. Sin Carga adoptada no cambia nada. Nivel de carga calculado
por la autoridad y predicho (columna `load`); natación intacta. Ficha de personaje del kit UI con los controles INV02c
y medidores SRV01; los alimentos abren el panel de agua y provisiones (consumo durable RNV07b). Menú de fabricación
(TAB/HUD) y hacha/pico a mano con 3 troncos + 2 piedras. Paleta del kit en HUD y paneles. Retirado el borrador
SQL028/`attr`/`eat`. Pendiente: comidas especiales SRV02 como operación `freshwater` + ampliación SQL032.
Suite completa **4598/4659**; los 55 fallos también fallan en origin `c33ed9c` (68 allí) salvo uno de red que pasa
aislado. HUD vertical **36/36** (origin 28 solapes; corregido el bloque del jugador con barras) y ficha en 4 viewports.

**AREA01 GM05b, 2026-10-11 — pintura publicada, alpha.48/protocolo 53:**
[Contrato](docs/briefs/gm05b-terrain-paint.md) y [entrega](docs/delivery/gm05b/DELIVERY.md).
Hierba/tierra/arena/roca, borrar gradual y pinceles circular/cuadrado/elíptico compartidos con escultura.
Documento v4/terreno v2, hash de materiales y alturas; versiones anteriores conservadas.
SQL033 aplicada por el autor y readiness del servicio comprobado. Reutiliza las texturas optimizadas actuales.
267/267 casos acotados, imagen 37/37 y navegador público 11/11; capturas ES/EN escritorio/móvil inspeccionadas.
Release `0a2dfc0` sana, 35/35 fuentes activas verificadas; cadena durable y entrada real aceptadas.
Canario retirado: mapa base generación 8 y borrador original restaurado en r27. Sigue optimización/dispersión y GM06.
Integración concurrente alpha.49/protocolo 54: público 11/11, suites focales 31/31 y entrada real verificadas; evidencia separada en la entrega.

**AREA17 L04c, 2026-10-10 — continuidad del Studio local implementada:**
[Entrega/evidencia](docs/delivery/l04c-companion-continuity.md), [brief](docs/briefs/l04c-companion-continuity.md).
Captura tras chat confirmado sin inferencia; continuación desde fuentes y refresco que cancela tardías
sin renovar sesión/cuota ni reactivar stop. Resumen manual y automático opt-in por presión/pausa;
un intento automático por cuota durable compartida con compactados manuales, originales conservados.
Regresión integrada: 250 aprobadas/una omitida por symlink Windows; navegador 9/9 simulado con C01 real local.
AgentMind relee observación tras I/O del presupuesto; stop/archivos y frescura corporal conservan sus límites.
Sin SQL, protocolo, JEV ni activación pública. Sigue identidad/ledger central y wizard ingame;
calidad del modelo, memoria semántica y compañía humana conservan aceptación propia.

**AREA07 RNV07b, 2026-10-11 — publicada y activada, alpha.47/protocolo 53:**
[Brief](docs/briefs/RNV07b-canteen-survival.md) y [entrega](docs/delivery/rnv07b-canteen.md).
Cantimplora reutilizable de tres dosis, relleno desde manantial/cubeta/barril/provisiones y comer/beber;
HUD ES/EN y SRV01 en el mismo perfil/recibo M5, pausa offline y penalizaciones sin muerte por hambre/sed.
SQL032 aplicada por el autor; readiness 1 y MN_CANTEEN_OPERATIONS=1 comprobados en el VPS.
Runtime ef59c5c, una instancia sana, 153/153 en la imagen y 19/19 fuentes públicas iguales a Git.
WSS autenticado: fabricación pagada, relleno, bebida/comida, replay sin doble gasto, colisión y reconnect;
cinco controles correctos, cinco recibos conservados y cuenta temporal retirada; cero errores/pendientes.
Navegador local ES/EN aprobado en dos viewports con 14 capturas; fixture sin enemigos, encuentro pendiente.
Sigue ruta Salty Shore–Puerto Sol; después purificador avanzado con componente de Bahía Ceniza.

**AREA03 INV02c, 2026-10-11 — ficha de Carga ES/EN publicada, alpha.46/protocolo 52:**
[Contrato](docs/briefs/inv02c-attribute-controls.md) y [entrega/evidencia](docs/delivery/inv02c-attribute-controls.md).
Adopción explícita, asignación de un punto y confirmación de la única reasignación gratuita en C/Atributos;
puntos/peso/volumen y límites visibles. ACK privado más perfil canónico; retry exacto y consulta sin acciones
para invitados/solo. Cubeta/agua SQL030 conservadas. Runtime `2a51c8d`, imagen y 21 hashes fijos:
navegador público autenticado **6/6**, recarga/reconexión conservan mochila, tres tablas y agua.
Cuenta QA retirada, tres recibos conservados; Supabase durable y cero errores/pendientes al cerrar.
Pruebas locales **67/67**, integración concurrente **32/32**, imagen VPS **127/127** (conteos solapados);
fixture ES/EN **24 casos, 10 comprobaciones**, desktop/portrait/landscape y capturas inspeccionadas.
No requiere otro SQL. Sigue INV02d: sobrepeso/movimiento y mochila, preservando natación/predicción;
70 % sobre el cómodo, 40 % por encima del techo, nunca inmovilizar. Efectos todavía pendientes.

**AREA17 L03d-e2b, 2026-10-10 — Brisa local con conversación y memoria entre procesos:**
[Entrega/evidencia](docs/delivery/l03d-local-companion-studio.md), [brief](docs/briefs/l03d-local-companion-studio.md).
Wizard, cinco oficios/aspectos, personalidad/metas/manual/journal vacío; red C01 real y recuperación
de «Faro de Jade» desde disco. Ledger local fijado; seis llamadas/19.182 tokens confirmados, sin
uso pendiente. 67/67 focales y UI 1280×1000/390×844 inspeccionada. Modelo mezcla ES/EN y resumen
rechazado; original intacto. Mundo efímero y cuentas de ensayo; sin SQL o proveedor público.
Sigue vínculo durable/contabilidad central y montaje del wizard dentro del juego, con preview humano.

**AREA15, 2026-10-10 — arranque y circulación de perlas implementados; montaje público apagado:**
[entrega](docs/delivery/m5-ground-pearl-lifecycle.md), [contrato](docs/briefs/m5-ground-pearl-lifecycle.md).
Recuperación de filas actuales después del diario común, pausa offline y recogida/devolución
bajo el único `beforeTick`; perfil y metadatos de sesión se aplican juntos tras SQL confirmado.
Base 4edbf30: 594/594 en 58 archivos congelados, dos SIGKILL locales de pickup; devolución con commit/aplicación/reinicio de host;
compatibilidad SQL001–029 con recursos v3/taller/Carga/atributos alpha.43/protocolo 49.
SQL023 confirmado; no añade ni ejecuta SQL. Sigue componer muerte, botín ordinario, mint y comandos
restantes; después transición detenida/adopción y canario autenticado de caída/reinicio VPS.
Integración RNV07 alpha.44/protocolo 50: 226/226 en 25 archivos congelados (base 95595b0);
reserva de llenado revalidada tras la lectura del recibo. Conteos solapados con la base 594.
Integración GM05 alpha.45/protocolo 51: 246/246 en 29 archivos congelados (base 52665ea);
conserva exclusión de activación GM con piloto montado. Conteos solapados.
Código verificado en VPS `ea982f8` sano, 0.6.0-alpha.45/protocolo 51: 127/127 del actualizador,
31/31 sin red en la imagen exacta y entrada pública 6/6. Una autoridad, timer activo; montaje apagado.

**AREA01 GM05a, 2026-10-11 — escultura publicada, alpha.45/protocolo 51:**
[Contrato](docs/briefs/gm05a-terrain-sculpt.md) y [entrega](docs/delivery/gm05a/DELIVERY.md).
Cinco pinceles de suelo seco, borrador v3, preview/undo/cancelación y recorrido sobre alturas editadas.
SQL031 aplicado por el autor como 029 (mismo hash); readiness del servicio confirmado.
309/309 en 56 archivos, imagen 20/20 y actualizador 127/127. Público: 11 controles del editor
y cadena HTTP autenticada con Supabase real, cliente nuevo con hash exacto/WELCOME y rollback.
Release `839393a` sana; mapa base generación 6, borrador original restaurado en r25. Evidencia por capa en la entrega.
Sigue GM05b para pintar familias de suelo; GM06 para costa y nueva tierra. Conserva las activaciones del servidor.

**AREA07 RNV07a, 2026-10-11 — publicado y activado, alpha.44/protocolo 50:**
[Entrega](docs/delivery/rnv07-freshwater.md), [dirección](docs/briefs/RNV07-freshwater-progression.md), [WSS público](docs/delivery/rnv07-freshwater/public/acceptance.json), [health/fuentes](docs/delivery/rnv07-freshwater/public-readonly.json) y [activación SQL030](docs/delivery/rnv07-freshwater/activation.json). Runtime comprobado `80e46df8ca4664f93aa59df8350c27cc17589b53`, desplegado 04:47Z; imagen `sha256:b883545f9317c7ba3ed03e7e0ec5d27c62a997b3d0a8c717504980e3f338f353`. SQL030 aplicado por el autor, readiness RPC 1; `MN_FRESHWATER_OPERATIONS` enabled/ready y atributos siguen enabled/ready. WSS público 6/6, anónimo denegado; lectura pública 7 hashes fuente y health 200. Evidencia de agua visual/recogida completa sigue siendo fixture local sin enemigos; no se afirma recolección/transporte completo live y el encuentro en navegador queda pendiente para RNV07b.
Sigue RNV07b: cantimplora y consumo coordinados con supervivencia; el purificador avanzado después.


**AREA03 INV02b, 2026-10-10 — Carga durable activa y comprobada en público:**
[Contrato](docs/briefs/inv02b-durable-attributes.md) y [entrega](docs/delivery/inv02b-durable-attributes.md).
SQL029 aplicado por el autor; readiness comprobado desde el contenedor. Activación inicial
en `024610b`, alpha.43/protocolo 49; `MN_ATTRIBUTE_OPERATIONS=1` y una autoridad en reposo.
Tras integrar la entrega paralela de agua, el actualizador instaló `80e46df`, alpha.44/protocolo 50.
[Canario activo repetido](docs/delivery/inv02b-public/20261011T044746Z-active/README.md) **5/5**:
adopción, asignación, reset, replay sin rollback, conflicto durable y reconexión. Masa 50 → 60 → 50,
volumen 18 constante. 14 hashes de imagen iguales a Git; Supabase durable, cero errores/pendientes.
Cuenta QA retirada y cuatro recibos conservados por corrida; evidencia inicial/flag apagado separada.
Regresión integrada repetida 20/20; pruebas locales previas: atributos 19/19, composición SQL023/029
1/1 con reapertura, UI existente ES/EN 6/6 y regresión 106/106 (conteos solapados).
Taller y crédito de Tala offline conservan Carga. Sigue ficha ES/EN INV02c para administrar puntos;
después movimiento/sobrepeso. La pantalla de atributos todavía no está montada. No requiere otro SQL
para comenzar INV02c; el flag permanece apagado por defecto en instalaciones nuevas.

**AREA03 HUD/INV02a, 2026-10-10 — HUD público verificado; Carga sin montar:**
[HUD y evidencia](docs/delivery/hud-portrait/README.md), [contrato de Carga](docs/briefs/inv02a-durable-carry.md)
y [entrega INV02a](docs/delivery/inv02a-carry-contract.md). Pantalla vertical con filas separadas para jugador,
controles, minimapa y avisos; horizontal compacto conserva espacio de combate. 36/36 casos locales,
ES/EN, ratón/toque emulado, escala 100/130 %; capturas inspeccionadas. WSS público 36/36 en
`6c42e84`, alpha.41/protocolo 47, revisión/imagen fijas y autoridad sana antes/después.
Carga: asignación/reasignación pura, 11/11 propias y 21/21 con carry/taller/Tala (solapadas).
Código publicado sin imports de gameplay: no cambia capacidad, movimiento ni perfiles públicos.
Sigue recibo M5 y adopción explícita, después UI ES/EN y sobrepeso; conservar crédito offline de Tala.
Sin SQL nuevo. El borrador anterior de supervivencia sigue separado.

**AREA01 GM04b, 2026-10-10 — plantillas publicadas, alpha.41/protocolo 47:**
[Entrega](docs/delivery/gm04b/DELIVERY.md), [navegador público](docs/delivery/gm04b/public-browser-evidence.json)
y [despliegue](docs/delivery/gm04b/deployment.json). Conjuntos de 1–120 decoraciones, fantasma completo,
copias independientes y undo/redo por colocación. Biblioteca local por cuenta–servidor–mundo, 32 plantillas,
CAS e import/export de 2 MiB; misma semilla/revisión base. Regresión GM 199/199 en 35 archivos;
navegador local 17/17 y público autenticado 19/19, sin errores ni mutaciones remotas.
Release `6c42e84` sana, Supabase durable y timer activo; mapa base generación 4 conservado.
Capturas ES/EN/844×390 inspeccionadas; luz de referencia solo del renderer cliente, sin escrituras al reloj.
Documento v2, protocolo y autoridad M5 conservados; sin SQL/arte nuevo. Siguen materiales/dispersión y GM05.

**AREA17 L03d-e2a, 2026-10-10 — transporte del modelo local probado, sin montaje:**
[Entrega/evidencia](docs/delivery/l03d-local-model-probe.md) y [brief](docs/briefs/l03d-local-model-probe.md).
Endpoint loopback sin clave y modelo exacto verificados; wait/reply estructurados y cancelación con
bloqueo pasaron usando extensión explícita de plantilla sin razonamiento. Default 192 no admitió chat y 512 lo truncó;
se conservan ambos ensayos. 20/20 HTTP local simulado; ocho intentos reales, siete usos conocidos y
uno cancelado desconocido, sin retries después. Coste null y cero acciones/chat/memoria enviados.
Reply mezcló ES/EN y tardó 5,8 s: calidad/latencia pendientes. Herramienta fuera del bundle/VPS;
sin proveedor público, ledger central o integración AgentMind. E1 permanece la entrega ingame publicada.

**AREA17 L03d-e1, 2026-10-10 — centro de inferencia configurado y publicado, alpha.42/protocolo 48:**
[Entrega](docs/delivery/l03d-inference-config.md) y [contrato](docs/briefs/l03d-inference-config.md).
Configuración privada por mundo/cuenta: techo conjunto, una fila de límite por conexión y modelo por
compañero existente. SQL028 CAS/replay, aislamiento, stop obligatorio y borrador ante conflicto/incertidumbre.
Integración final 97/97 en 17 archivos y navegador local 12/12 con seis capturas; conserva GM04b/HUD
y frontera de suelo/Carga sin activar. Regresión anterior 54/54 solapada; autenticación local simulada.
Publicado y comprobado en `8a779b5`: una autoridad sana, timer activo, 109/109 del actualizador,
32 hashes de imagen iguales a Git y WSS público 21/21 con entrada real y denegaciones privadas.
SQL028 aplicado/readiness 1, canario de servicio revertido; M5 sin errores/pendientes/bloqueo en la captura.
Catálogo VPS vacío, sin importe/modelo preseleccionados ni proveedor/generación. Los techos son metadata,
todavía no ledger. Guardado de dueño autenticado público y canario de proveedor conservan aceptación propia.
Sigue ledger central, endpoint/modelo local y límites elegidos; después mente/memoria con fuentes.

**AREA15, 2026-10-10 — frontera común de familias implementada y probada, montaje apagado:**
[entrega](docs/delivery/m5-ground-family-boundary.md), [contrato](docs/briefs/m5-ground-family-boundary.md).
Suelo de perlas, lotes, muerte y botín usan una entrada de confianza al mismo dueño de tick/SQL018/019;
SQL preparado no aplica efectos. Reservas hasta el drain síncrono; cierre sin callbacks históricos.
206/206 en 34 archivos, incluidas las cuatro familias SQL, compatibilidad SQL001–027 con
recursos v3/taller/balsa y dos SIGKILL nuevos. Integración final GM04b/HUD/Carga sin montar: 58/58 en diez archivos, solapada con la anterior.
Integración concurrente posterior alpha.42/protocolo 48: 83/83 en doce archivos, solapada;
frontera de familias sin cambios. SQL028 pertenece al frente independiente de inferencia.
SQL023 instalado/readiness confirmado en VPS;
mundo público todavía sin reloj común ni adopción. No requiere SQL nuevo ni cambia flags/protocolo.
Código `e4c5f0d` verificado en VPS alpha.41/protocolo 47: 109/109 del actualizador, 13/13
focales sin red en la imagen exacta y entrada pública 6/6; una autoridad sana y timer activo.
Sigue conectar selectores, hidratación y coordinadores autónomos al mismo dueño, después transición
detenida con exclusión del actualizador y canario autenticado de reinicio/caída VPS.

**AREA07, revisión del autor 2026-10-10 — agua dulce manual → purificador avanzado:**
[Dirección y cortes RNV07](docs/briefs/RNV07-freshwater-progression.md). Primero cubeta/fuente
interior con enemigos/barril, después cantimplora con supervivencia; sigue viaje Salty Shore–Puerto Sol.
Purificador tardío: mucho más hierro/tablas y componente raro de origen en la tercera ciudad.
20 hierro + 30 tablas + núcleo en Bahía Ceniza es propuesta ajustable. Coordinar AREA01/04/08
y `inv02-survival`, sin crear otra autoridad ni otra sed. Este checkpoint registra diseño/cola,
sin cambiar la receta desplegada ni anunciar contenedores implementados.

**AREA01 GM04a, 2026-10-10 — multiselección publicada, alpha.40/protocolo 47:**
[Entrega](docs/delivery/gm04a/DELIVERY.md), [navegador público](docs/delivery/gm04a/public-browser-evidence.json)
y [despliegue](docs/delivery/gm04a/deployment.json). Shift/casillas, pivote común y movimiento/giro/escala,
duplicar/eliminar y undo atómicos de decoración base/añadida, hasta 120 elementos. Documento v2;
colisiones individuales y selección temporal. Integración final 331/331 en 53 archivos (329+2),
navegador local alpha.39/46 17/17 y público autenticado alpha.40/47 19/19, sin errores.
Runtime `c4ffc62` sano y timer activo; mapa base generación 4 conservado.
Canario solo en borrador local nuevo, sin mutaciones remotas ni SQL. Capturas diurnas finales con luz
solo del renderer cliente; captura nocturna real conservada. Siguen plantillas GM04 y terreno GM05.

**AREA17 L03d-d, 2026-10-10 — detención durable publicada, alpha.38/protocolo 46:**
[Entrega](docs/delivery/l03d-companion-control.md) y [contrato](docs/briefs/l03d-companion-control.md).
Stop inmediato, guardado privado SQL027 y permiso explícito para una conexión nueva; CAS durable
separado del epoch, recuperación antes de escuchar y fallo/timeout/tardía sin reanudación automática.
Conserva el allowlist de vínculos del operador; no provisiona ni activa agentes/proveedor.
SQL027 aplicado y canario de servicio revertido; aceptación alpha.38 `d962055` sana, una autoridad y timer activo.
109/109 del actualizador y 28/28 focales de alpha.38 con hashes Git. Integración posterior
alpha.39/protocolo 47: 30/30 locales y WSS público 17/17; selecciones solapadas.
Las 65/65 focales y el navegador invitado 7/7 corresponden a alpha.37; la UI de compañeros no cambió.
El [baseline de Tala](docs/delivery/prg01d-timing-baseline.md) corrigió el conflicto; alfa recuperado y canario Tala público 6/6.
Local 190/190 y navegador 14/14 con autenticación simulada y SQL027 en disco; conteos solapados.
Stop/resume de un dueño autenticado público sigue pendiente. No es aceptación de memoria inteligente.
Sigue conexión/modelo admitidos y techo de gasto compartido; después personalidad/metas en la mente,
memoria basada en eventos confirmados y canario social/PvE con acuerdo recordado en otra sesión.

**AREA07 RNV06, 2026-10-10 — purificador publicado, alpha.39/protocolo 47:**
[Contrato](docs/briefs/RNV06-purifier.md) y [entrega](docs/delivery/rnv06-purifier.md).
Editor B, coste 3 hierro + 2 tablas; una agua dulce cada 96 s simulados, con dueño conectado y balsa
amarrada. Bodega/masa/transferencia/comercio existentes; panel H/toque ES/EN, pausa por daño/espacio/viaje.
Integración 120/120 en 20 archivos; PC ES/móvil EN aceptados, 14 capturas. Sin SQL ni autoridad de
guardado nueva; agua aún no es consumo por sed. VPS `b977b7c` sano, una autoridad, salud/página 200,
cero pendientes/errores; actualizador 109/109, imagen 29/29 con 12/12 hashes Git, entrada pública
WSS/minimapa/mapa aceptada; conteos solapados.
Tala `d962055` integrada; SQL026 instalado. Construcción/agua/transferencia probadas con cuenta local
desechable; falta canario de materiales de cuenta pública. Sin atribuir Supabase ni crash durability al fixture.
La revisión RNV07 anterior pone fuente/cubeta/barril y cantimplora antes del viaje comercial
Salty Shore–Puerto Sol, coordinado con AREA01/08.

**AREA17 L03d-c, 2026-10-10 — ficha privada durable publicada, alpha.36/protocolo 45:**
[Entrega](docs/delivery/l03d-companion-config.md) y [contrato](docs/briefs/l03d-companion-config.md).
Personalidad/objetivos por cuenta–mundo–personaje ya vinculado; CAS/replay, borrador conservado
ante conflicto/incertidumbre y editor ES/EN. SQL025 aplicado, readiness VPS y canario de servicio
real aprobados; fixture revertido. Runtime `f04cd7d` sano, una autoridad y temporizador activo;
109/109 del actualizador, 45/45 focales en imagen con hashes Git, WSS público 15/15 y navegador
público 7/7. Local: 140/140 y selección naval 58/58; navegador 13/13 con auth simulada y base en disco.
Pendiente save/load de un dueño autenticado en navegador público. No alimenta la mente ni crea
vínculos/conexiones, memorias o presupuesto; stop sigue de proceso. Sigue conexión/modelo/límites
conjuntos y memoria con fuentes antes del canario L03d completo.

**AREA07 RNV05, 2026-10-10 — natación costera publicada, alpha.36/protocolo 45:**
[Contrato](docs/briefs/RNV05-coastal-swimming.md) y [entrega](docs/delivery/rnv05-coastal-swimming.md).
Playa/agua/playa, resistencia y carga autoritativas/predichas, aviso de agotamiento y daño gradual
con muerte actual y compatibilidad M5 probada localmente, sin activar ese montaje VPS. G baja por
un borde cercano del viaje propio detenido; F devuelve a cubierta
como caminante. Sin SQL/writer nuevo. Integración 121/121 en 17 archivos; regresión previa 104/104,
selecciones solapadas. PC ES y móvil EN emulado recorren costa/agua/tierra y G/F desde balsa propia;
VPS `56155bb` sano, imagen específica 34/34, actualizador 109/109 y entrada pública 10/10
con minimapa/mapa M. Continuidad compañeros/i18n integrada 51/51; conteos solapados.
Sigue RNV06: un purificador útil para provisiones/hogar.

**AREA01 GM03b2, 2026-10-10 — publicado alpha.35/protocolo 44, canario aceptado:**
[entrega](docs/delivery/gm03b2/DELIVERY.md), [evidencia pública](docs/delivery/gm03b2/public-evidence.json) y [despliegue](docs/delivery/gm03b2/deployment.json).
Online registra revisiones y activa o vuelve atrás con mundo vacío, CAS y exclusión del actualizador.
Dos clientes nuevos verificaron el mismo modelo/colisiones antes de entrar; canario real 6/6 sin errores,
incluidos rechazo con jugadores, rollback y generación antigua. Borrador restaurado por CAS r19→r21.
Runtime `2006667` sano; gen3 canaria → gen4/mapa base, volumen durable y timer activo.
Integración alpha.35 175/175; regresión histórica alpha.34 308/308; actualizador Linux 22/22 independiente.
Solo decoraciones y colisiones estáticas; terreno, objetos funcionales y migración entre runtimes siguen
para cortes posteriores. GM03b2 no requiere otra migración SQL ni cambia la autoridad de gameplay M5.

**AREA03 PRG01d, 2026-10-10 — SQL026 confirmado; taller y Tala públicos verificados:**
[contrato](docs/briefs/prg01d-starter-workshop.md) y [entrega/evidencia](docs/delivery/prg01d-starter-workshop.md).
Encargo personal de diez tablas, crédito único, caja por kit en banco, tabla 2:1, palmera 3–6
y mochila con volumen/masa; sin barrera de Tala 60 ni comunidad.
Construcción/capacidad/reconexión: 33 comprobaciones públicas en alpha.37, antes de que el recorrido
fallara al navegar a la palmera. Tala aislada: 6/6 en alpha.38/protocolo 46, con desafíos reales,
rechazos sin mutar, recompensa durable, replay y tabla en banco. La repetición combinada posterior
alpha.39/protocolo 47 pasó 36/36 por WSS autenticado; perfil/Auth QA retirados y veinte recibos conservados.
SQL026 corrigió el ID real de balsa; alpha.38 `d962055` alineó el baseline económico antes de Tala.
Ambas recuperaciones conservaron perfil/mundo; sus cuentas QA se eliminaron y recibos se conservaron.
[Verificación independiente VPS](docs/delivery/prg01d-starter-workshop/activation/timing-deployment-independent.json):
revisión/imagen y hashes Git confirmados, salud pública 200, una autoridad, timer activo,
cero errores, pendientes o datos sin guardar. Local final 20/20; imagen 28/28. Conteos solapados.
[Navegador autenticado alpha.40/protocolo 47](docs/delivery/prg01d-starter-workshop/activation/browser-alpha40-20261011-0247/README.md): 8/8,
entrega UI durable y progreso tras recargar; perfil/Auth QA retirados y un recibo conservado.
Capturas ES escritorio/EN portrait inspeccionadas: panel legible; el solapamiento de fondo
observado entonces quedó corregido en el [corte HUD posterior](docs/delivery/hud-portrait/README.md).
Revisión `88f61ea` e imagen fijadas antes/después, cero errores/pendientes y una autoridad.
Entrada pública histórica 14/14 conserva su alcance anterior.
[Checkpoint](docs/delivery/prg01d-starter-workshop/activation/README.md). No requiere otro SQL.
Mundo común suelo/perlas/muerte sin adoptar/activar; SIGKILL propio, pausa offline nueva,
balance y teléfono físico pendientes. INV01–03 (huecos/pilas, Carga y sobrepeso) continúa aparte.

**AREA15, 2026-10-10 — adopción SQL023 preparada, montaje apagado:**
[entrega](docs/delivery/m5-ground-world-adoption.md), [contrato](docs/briefs/m5-ground-world-adoption.md). Snapshot/versión exactos, reloj inicial desde el
tick de recursos y recibo inmutable sin reescribir mundo; cerco persistente de escritores legacy.
V1 rechaza perlas/suelo/botín previo. Regresión 235/235 en 34 archivos y final GM 74/74 en doce,
solapadas; 22 casos propios y dos SIGKILL de adopción. Integra GM03b2, I18N04b, L03d y SQL022.
VPS `9266c40` sano alpha.34/protocolo 43: 107/107 de imagen, 11/11 focales sin red y entrada
pública 6/6. SQL023 instalado y readiness confirmado durante PRG01d; no se adopta el mundo real ni se activa el montaje común.
Sigue composición perlas/muerte/botín, transición detenida con exclusión del writer anterior,
recuperación y canario autenticado VPS.


**AREA17 L03d-b, 2026-10-10 — Mis compañeros publicado, alpha.34/protocolo 43:**
[entrega](docs/delivery/l03d-owner-center.md), [brief](docs/briefs/l03d-owner-center.md). Estado/stop
ingame por cuenta, revisión exacta, ES/EN y teclado/móvil. Stop de proceso sin duración tras reinicio;
sin proveedor, inferencia, SQL o activación propios. VPS `ee88690` sano, una autoridad: 107/107
del actualizador, 22/22 en imagen con hashes Git, WSS público 12/12 y navegador público 7/7.
Regresión local corregida 111/111 y navegador local 14/14; pruebas solapadas. Stop autenticado
de dos dueños verificado con fixtures, no con agentes públicos. Sigue configuración durable y límites conjuntos.

**AREA12 I18N04b, 2026-10-10 — publicado, invitado ES/EN y reconexión verificados:**
[Entrega/evidencia](docs/delivery/i18n04b.md).
Cierre público `822ddc2`, alpha.35/protocolo 44; primera aceptación histórica `1f0f158` alpha.32.
Selector desde arranque/cuenta/ajustes; cliente/editor GM y feedback en caliente conservan datos y
solicitudes. QA local: 11 grupos cliente/20 capturas y 6 editor/8 capturas; integración 86/86 y
regresión final 20/20 (solapadas). HUD real post-intro: seis combinaciones ES/EN, escala 1.3, scroll
y antorcha sin solapes. Público: tres grupos, once capturas, WebSocket/reconexión y ajuste real de
tamaño, cero errores; imagen 109/109 y salud/Supabase verificadas. Auth/firma, permisos GM y
operaciones durables conservan aceptación propia; CAS remoto local simulado. Sin SQL/flags propios.
Sigue I18N04c: promoción ES/EN.

El recorrido completo pertenece a `bbbf39e`; `822ddc2` añade tres traducciones de oficios,
con [muestreo público NPC propio](docs/delivery/i18n04b/public-npc/evidence.json) y nombres intactos.

**AREA07 RNV04, 2026-10-10 — combustible privado, alpha.31 / protocolo 42:**
[Entrega](docs/delivery/rnv04-fire-fuel.md), [contrato](docs/briefs/RNV04-fire-fuel.md).
Mano 20 min, faroles/antorchas privadas 60 min por madera, fogata/parrilla 30 min provisionales;
municipales infinitas. Un slot y apagado conservador; panel ES/EN, N/V y tres piezas construibles.
SQL022 aplicada y canario real 8/8. Integración 91/91, imagen 107/107 y composición común 33/33
solapadas; cuatro vistas locales PC/móvil bajo/alto aceptadas. Publicado y activo en `fe50ab1`,
alpha.32/protocolo 42: imagen 107/107 y 30/30 de fuego, navegador autenticado público 9/9 con
saldo/madera tras recargar y mapa/minimapa. Otros flags conservados. Sigue agua/reembarque.
Revalidación pública final `ee88690`, alpha.34/protocolo 43: 9/9 y capturas inspeccionadas;
cuenta/perfil QA eliminados, cuatro recibos retenidos y 35/35 de identidad cliente/agente.

**AREA15, 2026-10-10 — GameHost económico/checkpoint publicado, montaje apagado:**
[entrega](docs/delivery/m5-ground-host-authority.md), [contrato](docs/briefs/m5-ground-host-authority.md).
Un dueño de tick/época/SQL018/019, drain antes del ACK y guardados de mundo/reloj juntos.
355/355 pruebas en 44 archivos, doce casos nuevos y dos SIGKILL nuevos de GameHost; integra GM03b1.
SQL018–021 readiness real confirmada; dominio legacy sin reloj común. Sin activación de esta API
ni artesano; sigue adopción atómica y composición perlas/muerte/botín, luego canario autenticado VPS.
VPS `cf5857f` sano a 22:04:34 UTC, alpha.30/protocolo 41: 107/107 de imagen, 8/8 del montaje
sin red en Node 22 y entrada pública 6/6. Regresiones solapadas; no se activa esta API por publicar código.

**GM03b1, 2026-10-10 — publicado alpha.30/protocolo 41, release `6e6f421` sana:**
[preparar revisión](docs/delivery/gm03b1/DELIVERY.md), [contrato](docs/briefs/gm03b1-prepared-revision.md).
Online valida el head privado exacto y descarga documento/dependencias/base/colisiones por hash.
Errores enfocan objetos; cambios invalidan el paquete y conflictos conservan diseños. Proyección de
colisiones compartida con caminar, todos los assets base y variantes móviles fijados, sin escrituras
de gameplay/SQL/flags. 183/183 regresión, navegador local simulado 41/41, actualizador 107/107 y
navegador público Supabase real 23/23. 57 dependencias base; ES/EN inspeccionados y borrador previo
restaurado por CAS r6→r13. [Evidencia pública](docs/delivery/gm03b1/public-evidence.json).
Sigue GM03b2: registro durable, activación/rollback con admisión exacta y exclusión del actualizador.

**AREA03 PRG01c, código publicado 2026-10-10:** [artesano/Bodega](docs/delivery/prg01c-artisan.md), alpha.29/protocolo 41.
Lección personal tras Tala y carpintería, colocación/retiro de Bodega por recibo M5 exacto, sin otro
writer. 114/114 integración, 107/107 release con solapamiento y 32 checks UI ES/EN/banco existente.
SQL021 después de 001–020; feature apagada hasta readiness, activación y canario autenticado;
precio inicial de lección dos maderas provisional. El resto del editor conserva CAS anterior.
VPS `67e307e` sano, una autoridad, imagen 107/107 y entrada pública 8/8; artesano apagado.
Siguiente cierre AREA03: aceptación autenticada de este ciclo antes de minería.

**GM03a publicado, 2026-10-10 — alpha.28 / protocolo 40 integrado:** [borradores remotos privados](docs/delivery/gm03a/DELIVERY.md).
Online permite guardar/cargar explícitamente por cuenta/mundo, CAS, recuperación exacta y exportación de
ambas copias; conflictos conservan el diseño local. SQL020 aplicada y canario real 14/14. Suites locales
102/102 y regresión 113/113 (solapadas), navegador local 35/35, imagen 107/107 y navegador Supabase real
17/17, cero errores. Runtime `9f23be3` sano; copia remota previa restaurada por CAS. No activa mapas ni
escribe gameplay; sigue GM03b publicación/activación/rollback bajo M5.

**AREA17 L03d-a, herramienta publicada 2026-10-10:** [contabilidad nativa durable](docs/delivery/l03d-native-metering.md)
prepara el canario L03d con ledger v2 separado, tarifa/modelo declarados fijados, uso desconocido
retenido y cargo derivado distinto de factura. Sin proveedor ni inferencia real; panel/runner
conservan modo simulado. Falta elegir proveedor/modelo y aceptar transporte, memoria/conversación/PvE
y coste reales. Fuente `e614ca4` integrada con alpha.28/protocolo 40, sin SQL ni cambio de gameplay
propios; evidencia local y de continuidad del alfa en la entrega.

**AREA15, diario del sobre 2026-10-10:** [SQL019](docs/delivery/m5-ground-transaction-journal.md),
petición completa antes del efecto y cierre atómico con SQL018; recuperación detenida desde filas actuales.
266/266 pruebas y tres SIGKILL locales; no montado en GameHost ni aplicado SQL018/019 live. Sigue dueño de tick/época/legacy,
sin ampliar la aceptación a perlas/muerte/botín públicos.
Código/imagen `6748f9a` verificados, alpha.27/protocolo 39: 107/107 offline y 6/6 públicas.

**AREA15, corte local 2026-10-10:** [SQL018: operación, mundo y reloj en un commit](docs/delivery/m5-ground-transactions.md).
Reutiliza familias M5, valida recibos y conserva pausa offline con sesión/drain detenidos. No monta
GameHost ni activa SQL; sigue composición de tick/diario/legacy y aceptación real de perlas/muerte/botín.
APIs publicadas y verificadas en `e648d1b`/alpha.27/protocolo 39, imagen 107/107 y entrada pública 6/6;
esto no activa los coordinadores ni prueba gameplay durable de perlas/muerte/botín.

**Checkpoint GM02 publicado (2026-10-10):** [decoración existente y prueba caminando](docs/delivery/gm02-draft-walk.md), alpha.25/protocolo 37, release `e2ff69e` sana desde 19:37:56Z. Escena edita/oculta/restaura rocas naturales/costeras, flores y guijarros; círculos XZ y recorrido privado. Documento v2 migra v1; IndexedDB/CAS/recuperación locales. 162/162 pruebas (51 GM), navegador local 28/28, actualizador 107/107 y público Supabase real 12/12. Sin escritura de mapas/M5 ni terreno; sigue GM03 guardado remoto/publicación.

**Hotfix GM01 publicado (2026-10-10):** [bloqueo en calidad media/alta/ultra](docs/delivery/gm01-render-fix.md)
corregido en `e78c2c3`, integrado sin cambios en alpha.23 (`4c6743b`, sana desde 18:43:12Z). Local alpha.21:
102/102 pruebas y navegador 16/16, cuatro calidades/arrastre. Actualizador 107/107; navegador público 7/7
con Supabase real, GM en calidad alta con contornos, colocación/guardado local y logout sin errores de render.

Fecha: 2026-10-04. Este es el **orden operativo** para avanzar paso a paso desde el juego actual hacia
casas/barcos habitables, comercio, combate naval y ciudades productivas. Integra mecánicas y pruebas de assets;
no es otra lista de ideas ni anuncia que las entregas estén hechas.

## 1. Punto de partida y documentos que mandan

- AREA07 RNV03 (2026-10-10), **alpha.28/protocolo 40, implementado y activo**:
  [noche casi negra y farol de cinturón](docs/delivery/rnv03-dark-night.md). Hora compartida obligatoria,
  N/toque, luz pública y apagado en muerte/reentrada; sin SQL, objetos económicos ni nuevo writer.
  650/650 locales y 107/107 imagen; VPS `9f23be3`, entrada pública comprobada (detalle/solapamiento en entrega). Sigue agua costera/reembarque
  con contrato previo de carga/agotamiento/rescate, después provisiones/hogar.

- AREA07 RNV02 (2026-10-10), **integración alpha.27/protocolo 39**: [farol funcional](docs/delivery/rnv02-naval-lantern.md).
  Editor doce piezas, V/toque, luz móvil cálida y estado por instancia en perfil del dueño, con daño/reparación.
  Sin SQL ni combustible. 631/631 integradas, 107/107 release con solapamiento, cuatro vistas y probe F/E/V.
  VPS `e648d1b` sano hasta las 20:15:21 UTC, imagen 107/107 y timer activo; entrada pública WSS,
  mapa/minimapa y catálogo comprobados, evidencia/límites en la entrega.
  Sigue noche casi negra.

- AREA17 L06b-2b (2026-10-10), **alpha.26/protocolo 38**: [comercio explícito y presupuesto](docs/delivery/l06b-agent-trade.md).
  Compra/venta con capacidades separadas, cuenta/ciudad derivadas y mandato acumulado SQL017 sin refill;
  consumo y recibo en la misma M5 humana. Recuperación exacta, stop y revocación cubiertos localmente.
  917 aprobadas, cero fallos y cinco omisiones Windows; suplemento SQL/host 20/20. Publicado en `cafff18`,
  sano desde 19:58:06 UTC; VPS 107/107 y público 10/10. Piloto/comercio/proveedor de agentes apagados. SQL017 y canario
  autenticado live pendientes. Conserva Tala/refugio del upstream. Sigue L03d social/PvE con proveedor,
  memoria y coste medidos, con activación económica independiente.

- AREA07 RNV01 (2026-10-10), **alpha.24/protocolo 37**: [refugio naval](docs/delivery/rnv01-naval-refuge.md),
  techo con soporte vivo, puerta abatible V/toque, colisión/predicción y apertura por instancia en perfil M5
  del dueño. Editor de once piezas; coste/HP existentes, visitantes sin cerradura y vista interior.
  516 pruebas tras integrar Tala, 107 del actualizador con solapamiento y tres vistas UI repetidas.
  Activo en VPS `29a9e46`, sano a las 19:24:26 UTC, imagen 107/107 y entrada pública/mapa/protocolo
  comprobados; evidencia/límites en la entrega. Sigue farol, luego noche oscura.

- AREA03 PRG01b2 (2026-10-10), **Tala activa, alpha.26/protocolo 38**: [aceptación SQL016](docs/delivery/prg01b2-logging.md).
  Adopción exacta v1→v2 en `758a217`; reparto 7/3, crédito offline/reentrada, hito 60 y cadencia 45 ticks
  comprobados por comandos autenticados. Reinicio ordenado en `454e2da` conservó perfiles/nodos/ledger;
  nueve replays sin duplicar bienes/práctica y cleanup de dos cuentas QA, reteniendo nueve recibos.
  31/31 de regresión actual y público 6/6; revisión/imagen sana y una autoridad a las 20:08:38 UTC.
  Las 230 pruebas y ocho vistas locales iniciales conservan su evidencia. Sigue artesano y enseñanza
  personal de `raft_storage` PRG01c; el hito no concede recetas automáticamente.

- AREA07 PRG02b (2026-10-10), **alpha.23/protocolo 36**: [Pilotaje II](docs/delivery/prg02b-pilot-learning.md),
  primer hito único `pilot_coastal` tras atraque real de la lección, timón +15 % y progreso común v2.
  Reutiliza CAS M5 y distingue aprendizaje local/pendiente/confirmado; sin SQL ni premio repetible.
  174 pruebas integradas, 38 de agentes y tres vistas de navegador aprobadas; 22 casos recursos/naval
  pasan juntos con solapamiento. Publicación/VPS se registran en la entrega. Sigue techo/puerta funcionales,
  después farol; no oscurecer la noche antes de tener luces utilizables.

- AREA15, 2026-10-10: [recursos/crafting M5](docs/delivery/m5-resource-authority.md), live en
  `a5b8f127340c1febbd4c0b29cb83bbc2fa83fe98` (alpha.23/protocolo 36; activación inicial 4c), SQL015
  y recursos listos; 107/107 offline.
  Suite runtime 57/57; ocho operaciones públicas confirmadas y 23 replays exactos tras dos reinicios ordenados
  y un SIGKILL post-ACK. Pausa offline de 12 918 ms verificada. SIGKILL comprobado desde `a5b8f127`
  (solo docs/tools GM/AREA17, runtime equivalente a 4c); proceso exit 137 y reinicio manual del
  contenedor, no autoreinicio Docker. Cleanup QA comprobado; AREA15 no cierra todo M5. Alcance y evidencia
  en la entrega. [Contrato](docs/briefs/m5-resource-authority.md).

- Checkpoint PRG02a (2026-10-10), **alpha.19/protocolo 33**: lección naval voluntaria con salida, boya de maniobra (radio 9 m, ≤0,8 u/s durante 0,75 s) y atraque real. Estado de sesión server-owned; sin XP/rango/perfil/SQL ni salvas. **219/219 pruebas seleccionadas y 3/3 vistas de navegador aprobadas**, capturas representativas inspeccionadas. [Contrato](docs/briefs/prg02a-coastal-lesson.md) · [entrega](docs/delivery/prg02a-coastal-lesson.md). Frenado local: 85 ticks/3,32 m vacío y 112/4,37 m con cuatro maderas desde 4 u/s. La fixture de navegador reubica candidatos y no acredita pilotaje humano. Sigue PRG02b de aprendizaje común; la regla de oscuridad AREA07 requiere faroles disponibles antes de bajar la luz ambiente. Publicación/despliegue se registran en la entrega.

- AREA17, 2026-10-10: [L06b-2a](docs/delivery/l06b-agent-market.md) conecta inventario vigente y
  mercado/cotización autorizada al contexto de mente y CLI, sobre las reglas humanas existentes.
  Introducido en alpha.20/protocolo 35, publicado en `4c6743b`/alpha.23/protocolo 36, con
  46/46 pruebas de integración, 107/107 del VPS y 8/8 públicas; revisión/imagen/entrada WSS verificadas.
  Integra prerrequisitos locales L05/L06a/L06b-1; piloto público apagado.
  Sin proveedor real, SQL nuevo ni movimiento de bienes por 2a. Compra/venta local 2b queda registrada
  arriba; después sigue canario social/PvE con proveedor y su puerta económica independiente.
  Implementación, pruebas y despliegue se distinguen en la entrega.

- Revisión A1/M5 del autor (2026-10-09): continuidad tiene otro dueño. **M5 mantiene la única
  autoridad de guardado de GameHost**; no continuar desde A1 un segundo montaje de sesiones/mochila.
  A1b1–A1b2b4 quedan como banco de contratos/regresión; aportes se integran en la mochila M5.
  [Frontera, cobertura real y aceptación del servidor con amigos](docs/briefs/a1-m5-authority-boundary.md).
  Esta línea vuelve después a receptor/tablero/artesano/recetas. Sin activación ni despliegue por este registro.

- Checkpoint A1b2b4 (2026-10-09): sesiones autenticadas opcionales conectadas al diario;
  admisión/mutación/tokens/drain bloqueados durante incertidumbre, recuperación exacta y filas actuales.
  Close/revocación detienen el siguiente envío tras prepare y ocultan respuestas tardías.
  **34 nuevos y 165 casos pertinentes únicos** locales; [entrega](docs/delivery/a1b2b4-journal-sessions.md).
  Sin montaje GameHost/M5, SQL live, lease o cambio visual; integración de autoridad a cargo de M5
  según la frontera anterior, antes de receptor/tablero/artesano/aprendizaje.

- Checkpoint A1b2b3 (2026-10-09): diario opcional de guardados/aportes con petición exacta previa,
  cierre transaccional y barrera local de recuperación por mundo/época. **27 nuevos y 131 casos
  pertinentes únicos** locales; rollback, respuesta perdida, reapply y reapertura con pendiente.
  [Entrega](docs/delivery/a1b2b3-operation-journal.md). Sigue conectar diario/barrera a sesiones y
  cerrar una sola autoridad con GameHost/M5; sin lease, SQL live, montaje jugable o despliegue.
  Conserva alpha.16/protocolo 32 y costes; después receptor/tablero/artesano/aprendizaje.

- Checkpoint A1b2b2 (2026-10-09): creación inicial de personaje y vínculo por mundo/época en una
  transacción; reentrada devuelve perfil actual, sin reiniciar materiales. **22 casos nuevos** y
  **104 pertinentes únicos** locales; SDK/PostgreSQL, rollback, respuesta perdida y reapertura.
  [Entrega](docs/delivery/a1b2b2-character-bootstrap.md). Reutiliza vínculos/admisión A1b2b1;
  sigue diario/startup y una sola autoridad GameHost/M5 antes del tablero/artesano/aprendizaje.
  Alpha.16/protocolo 32; migraciones opcionales sin aplicar live, sin cambio de UI o despliegue.

- Checkpoint cartografía (2026-10-09): minimapa real en tierra/timón y panel M comparten terreno,
  proyección y marcadores del mapa activo; reemplazo/revisión de atlas y bounds/POIs declarados para
  mapas nuevos. **14/14** cartografía/terreno, **22/22** regresiones navales, **3/3** vistas de mapa y
  **3/3** flujos completos del HUD; quince capturas de mapas. [Entrega](docs/delivery/cartography.md).
  Local, alpha.16/protocolo 32; sin geografía/pueblos/streaming nuevos ni despliegue público.

- Checkpoint D08c.7d (2026-10-08), **alpha.16/protocolo 32**: hacha/pico de piedra fabricables
  desde recogida manual, dos ranuras fijas de cinturón guardadas, banco con tres recetas.
  Hacha exige propiedad para las 96 palmeras; 24 rocas grandes y 6 vetas nuevas requieren pico,
  progreso compartido, grietas/astillas/pico/audio y rendimiento final único. 206 nodos; los 176
  anteriores conservan identidad/XZ y S21. Mineral bruto separado de hierro, sin fundición/stock
  de mercado. **121 casos únicos pertinentes verificados** (120/121 serial + 5/5 tras actualizar
  whitelist de snapshot), **3/3 vistas emuladas** desde mochila vacía y reentrada firmada, capturas
  inspeccionadas. [Entrega e incidencias](docs/delivery/d08c7d-tools.md). Nodos de sesión;
  cero texturas nuevas, sin SQL/publicación ni nuevos permisos L02c. Siguen mantener/timing
  opcional y después recetas/pueblos; aprendizaje/aportes siguen pendientes.

- Dirección del autor 2026-10-08: preparar el juego de alfa con **Salty Shore** en la isla existente y tres
  pueblos especializados con obras compartidas. [Plan de alfa del mundo](PLAN-ALFA-MUNDO.md) concreta
  cadena de recursos/recetas, contrato de arte, vivienda y metas espaciales/de instancia. Primera meta
  propuesta: ocho personajes humanos/agentes y ocho balsas simultáneas; todavía sin benchmark ni activación.
  Confirmado después por el autor: servers separados con población/economía/progreso propios, mundo continuo
  y persistente hasta wipe explícito, con cargas de sector permitidas. Cupo simultáneo y residentes totales
  se diseñan por separado; `WORLD_ID` no acredita todavía aislamiento completo de personajes/partidas.
  El autor añade dos pueblos conectados por tierra, con recursos/bandidos y comercio por camino o mar.
  El autor aprobó el plan como base de trabajo: Salty Shore–Puerto Sol en la misma isla; Ceniza aparte,
  sin mover los anclajes de Puerto Sol/Ceniza; S21 ya cambia el terreno de la isla actual, y A3/corredor sigue pendiente. Nombres secundarios y cifras se pueden ajustar con implementación/medición.
  Miles de residentes, conectados por mundo y reunidos en una zona son capacidades distintas. A0–A7
  concretan M6/M7/M8 y el corredor A3; A8 propone filtro de interés/regiones/handoff después del alfa
  pequeño, conservando D09/M5 y los gates de persistencia/capacidad/publicación.

- Checkpoint S21 de terreno (2026-10-08), autorizado por el autor como pase solo de terreno: [informe](docs/delivery/map-revamp-v1.md). Base 400/N401 y RNG legacy conservadas; postpass determinista 560/N561, resolución 1. Suelo seco muestreado +63,148347 % (paso 2, umbral >0,65). Dos conexiones suaves de terreno permiten llegar caminando a puntos interiores (171 y 109 aristas; ascenso máximo 0,1412 y 0,1377 por paso, límite 0,15); se conservan los núcleos húmedos, sin puentes ni assets nuevos. Pueblo en cotas 2,4/6,4/10,4, rampas y seis pads planos de huts existentes. Mantiene orden/identidad/XZ de 1.259 props y 176 recursos; Y se proyecta al suelo. Volcán/boss, PvP, llegada y muelle protegidos. Sin nuevo pueblo, gameplay, colisiones, recursos o assets. No mueve los anclajes de Puerto Sol/Ceniza ni implementa el corredor A3. 0.1.0-alpha.15/protocolo 31 requiere recarga de host/peers. 220 pruebas, 30 capturas de escena + 2 del panel M, cinco contextos emulados, 20 chequeos de datos de calidad y geometría reutilizada. Catálogo rev. 37 (110 filas, 54 aplicadas); fuentes y enlaces HTTP comprobados. Local, no publicado; FPS físico y multijugador humano pendientes.

- Checkpoint D08c.7c (2026-10-08), **alpha.14/protocolo 30**: el autor prioriza recolectar por la isla.
  **96 palmeras cortables, 69 piedras recogibles y 11 troncos sueltos**; F/touch, tres hachazos
  → dos troncos, hacha/sonido/astillas/caída/tocón, regeneración compartida de sesión. Materiales
  → mochila → banco por tandas → construcción/reparación de balsa; guardado firmado conservado.
  Catálogo completo al admitir/cambiar estado, omitido en snapshots de movimiento sin cambios.
  **87/87 seleccionadas en serial + 3/3 vistas emuladas**, capturas inspeccionadas; incidencia
  de admisión y un pase concurrente previo registrados en [entrega](docs/delivery/d08c7c-harvest.md).
  Reutiliza palmeras S05, piedra S02 y banco S19/S14; cero texturas nuevas. Nodos/golpes aún no
  sobreviven al reinicio del host. Sin SQL/publicación/cambio de terreno o cupo; conserva L02c.
  Después sigue contrato atómico de aportes de PLAN-ALFA-MUNDO §8.1.

- Checkpoint D08c.7b (2026-10-08), **alpha.13/protocolo 29**: banco de materiales con panel,
  cantidades y preparación por tandas de la receta actual de madera. Confirmación de servidor/revisión,
  cierre/reapertura y replay del mismo ID sin doble débito. **61/61 seleccionadas + 3/3 vistas emuladas**,
  capturas inspeccionadas y reentrada firmada. [Entrega](docs/delivery/d08c7b-workbench.md).
  Reutiliza banco S19/atlas S14; no activa obra comunitaria ni recetas aprendidas. A1 necesita primero
  commit conjunto de inventario/proyecto/recibo; contrato inmediato en PLAN-ALFA-MUNDO §8.1.
  Sin SQL/publicación/cambio de terreno ni cupo; se conserva autoridad de agentes L02c.

- Checkpoint D08c.12 (2026-10-08), **alpha.12/protocolo 27**: ensayo naval opcional,
  tres boyas en orden y regreso con atraque real. Batería anclada con salvas/aviso fijo de 2 s;
  daño por pieza viva y casco girado, hasta 6 HP por impacto/24 por ensayo y piso del 50%.
  Carga/plano conservados, daño guardable/reparable; sin botín/XP. Progreso/resultados de sesión.
  **15/15 nuevas + 371 previas seleccionadas + 9/9 host**, 395 casos únicos entre pases documentados,
  **3/3 vistas emuladas** y capturas inspeccionadas. [Entrega y evidencia](docs/delivery/d08c12-naval-route.md),
  fixtures/incidencias explícitas y reutilización Unreal/runtime registrada.
  Sin SQL/publicación. Siguen armas y rival móvil/derrotable; D09/M5 antes de pérdidas públicas permanentes.
- Checkpoint D08c.11 (2026-10-08), **alpha.11/protocolo 26**: IDs/HP por instancia y última pose
  confirmada en perfil; reentrada estacionada sin piloto/tripulación y recuperación desde puerto
  sin sanar ni duplicar carga. Costa válida permite reembarcar; pose incompatible vuelve al amarre
  conservando condición/bienes. **617/617 pertinentes + 3/3 vistas emuladas**, capturas inspeccionadas.
  [Entrega](docs/delivery/d08c11-raft-recovery.md). HMAC guest y cuenta/CAS en memoria locales;
  ventana periódica y replay de blobs guest conservados, sin exposición offline/Supabase live/SQL/publicación.
  Sigue primera ruta o amenaza PvE acotada; D09/M5 aún condicionan pérdidas públicas permanentes.
- Checkpoint D08c.10 (2026-10-07), **alpha.10/protocolo 25**: reparación material del astillero,
  condición por instancia conservada al atracar/remontar durante la sesión, reconstrucción misma pieza,
  refuerzo sin curación relativa y retiro según HP. Carga/producción toman piezas vivas y recuperación
  desde muelle conserva plano/bienes. **355/355 + 3/3 vistas emuladas**, capturas inspeccionadas.
  [Entrega](docs/delivery/d08c10-raft-repair.md). Condición/pose aún no sobreviven recarga/desconexión;
  siguen persistencia del viaje/daño antes de amenaza de ruta. Sin publicación ni SQL.

- Checkpoint D08c.9 (2026-10-07), **alpha.9/protocolo 24**: porte mínimo de estructura/
  desplazamiento seguro, masa de piloto/invitados y sus mochilas; zarpe/carga rechazados sin pérdida.
  Refuerzo 1:1 de cimiento con costo, revisión/recibo y cinchas existentes. Reembarque/recuperación
  excedida sigue disponible. **344/344 pertinentes**, **3/3 vistas emuladas** con rechazo de zarpe,
  refuerzo real, reentrada firmada y timón/HUD; capturas inspeccionadas, cero errores en el pase final.
  [Entrega](docs/delivery/d08c9-raft-load-limits.md). Cifras iniciales, sin publicación ni SQL.
  Siguen reparación material, pose/daño durable y amenaza de ruta; tiers y depósitos de puerto posteriores.

- Checkpoint D08c.8 (2026-10-07), **alpha.8/protocolo 23**: masa/volumen independientes,
  volumen legacy conservado, masa de catálogo para economía/rig y lectura privada de porte nominal/
  espacio. Bodega y editor muestran estado confirmado y previsión de obra; HUD reutilizado.
  **208/208 focales**, **3/3 vistas emuladas** con transferencia, colocación real, reentrada y timón/HUD;
  capturas inspeccionadas. Cámara de construcción estabilizada. [Entrega](docs/delivery/d08c8-raft-capacity.md).
  La fórmula estructural/materiales/reserva/tripulación y límites de carga/zarpe se incorporan en D08c.9;
  cifras iniciales no son balance físico. Fuentes Unreal intactas, cero texturas nuevas,
  sin publicación ni SQL. Recolección/crafting D08c.7 se conserva.

- Actualización conjunta 2026-10-06: [demo PC/ngrok](docs/delivery/demo-update-20261006.md), fuente
  `f89bec5` subida a la rama de continuidad. **745/745**, 146 archivos de paquete y 153 archivos HTTP
  verificados; dos invitados por HTTPS/WSS. Alpha.4/protocolo 16, balsa/editor/bodega/producción activos;
  D08a sigue laboratorio aparte. Móvil D06b, visual D08a y activación durable M5 mantienen sus gates.

- Fotografía al redactar este plan: base de mecánicas commiteada Escarcha, `40949b2`, `0.4.8-alpha.2`, protocolo 9;
  Brasa y circulación también hechas. HEAD `20d8ee6` incorpora dirección naval.
- Tormenta tiene cambios y evidencia de pruebas locales en el checkout, aún sin commit al redactar este plan.
  Esta entrega documental no los revalida ni acepta. Al retomar, comprobar HEAD/HANDOFF y actualizar D01/D02;
  si Tormenta ya está aceptada, pasar a Tinta. No pisar ni reasignar archivos activos sin identificar al dueño.
- Checkpoint posterior D01: Tormenta integrada en `66e6e67`, `0.4.8-alpha.3`, protocolo 10. Mecánica y recorrido
  visual en escritorio/móvil emulado aceptados; GPU, teléfono/mando reales y publicación pendientes.
  Evidencia: [informe D01](docs/delivery/d01-tormenta.md). Al preparar A01, D02 Tinta se implementaba en paralelo
  en el checkout compartido; su aceptación se registra debajo. A01 probado en aislamiento y aplazado para humo de
  fogatas: [resultado](docs/delivery/a01-noise00.md); código/PNG experimentales no incorporados al runtime principal.
- Checkpoint posterior D02: Tinta integrada, `0.4.8-alpha.4`, protocolo 11; marca/nube/IA y reloj autoritativo.
  Regresión 271/271 y capturas inspeccionadas en escritorio/móvil emulado. GPU y dispositivos reales pendientes.
  Evidencia: [informe D02](docs/delivery/d02-tinta.md). M5 conserva su plan.
- Checkpoint posterior D03: kit integrado y pulido, `0.4.8-rc.1`, protocolo 12. Regresión 278/278, balance
  reproducible sin cambiar cifras y paletas revisadas en escritorio/móvil emulado. Es un candidato: GPU,
  teléfono/mando físicos, audición en juego y publicación pendientes. [Informe D03](docs/delivery/d03-pearlkit.md).
- Checkpoint posterior D07a: M5 P1 implementado localmente desde `61a34a5`, con memoria/Supabase, RPCs
  versionadas y ciclo de perfiles del host. Login, mundo persistente y conexión real pendientes;
  D04 conserva su lugar en la cola y las decisiones navales abiertas. [Informe D07a](docs/delivery/d07a-store.md).
- Checkpoint posterior D07b: M5 P2 local desde `da757d3`, cuentas por correo/contraseña, token verificado e
  importación única de partida firmada con identidad. Pruebas 323/323 y UI contra Auth local simulado;
  conexión real comprobada, migraciones/aceptación Supabase, economía P3 y publicación pendientes.
  Integrado sobre M6 P1 `a01294c`. [Informe D07b](docs/delivery/d07b-accounts.md).
- Checkpoint posterior D07c: modal de cómic y selector de aspectos/nombre, 43/43 pruebas pertinentes y UI
  desktop/móvil horizontal/vertical. SQL aplicado, Auth/DB reales verificados con fixture eliminado al cerrar;
  entrega de correo, economía P3 y publicación pendientes. [Informe D07c](docs/delivery/d07c-comic-account.md).
- Checkpoint posterior D07d: P3 economía persistente integrada localmente: carga antes de admitir,
  snapshots CAS cada 60 s/cierre, reloj/RNG/mercados/solares. Reinicio y conflicto comprobados en un mundo
  Supabase temporal eliminado al cerrar. P4–P6 y publicación pendientes. [Informe D07d](docs/delivery/d07d-world.md).
- Checkpoint posterior D09a: operación atómica de perla/perfiles/recibo aceptada localmente, desde `6402462`.
  Reintentos no repiten efectos y guardados/importaciones no contradicen un UID gestionado. SQL 003 estaba
  pendiente; cola/ack del juego y backfill abiertos al aceptar. [Informe](docs/delivery/d09a-pearl-operations.md).
- Checkpoint posterior D09b: SQL 003 aplicada/verificada en Supabase, canarios temporales limpiados. Cola de
  sesiones ordena perfiles/operación/guardados posteriores y resuelve recibos; join valida UIDs registrados.
  Staging/ack de simulación, adopción y suelo durable pendientes; P4/P6 parciales. [Informe](docs/delivery/d09b-pearl-sessions.md).
- Checkpoint posterior D09c: transacción de perfiles/UID/ubicación/recibos aceptada localmente, con mint y
  relocación de suelo. SQL 004 estaba pendiente al aceptar ese corte; cola/restauración/staging del juego y
  adopción seguían abiertos. [Informe](docs/delivery/d09c-pearl-ground.md).
- Checkpoint posterior D09d: SQL 004 aplicada/verificada real; cola de suelo comparte reservas y compara
  perfiles/UID/ubicación al recuperar respuestas perdidas. Canarios temporales limpiados; diario durable de
  intenciones, restauración/staging y adopción pendientes. [Informe](docs/delivery/d09d-pearl-ground-queue.md).
- Checkpoint posterior D09e: diario opcional de request/UUID, reservas recargadas y recuperación de recibo/estado
  actual aceptados localmente. Reanudación explícita sin builder; **005 aplicada/verificada real**, 21/21 checks,
  procesos nuevos de ProfileSessions y fixtures de juego limpiadas; cuatro auditorías terminales conservadas.
  Host/juego sin conexión al diario. [Verificación](docs/delivery/d09e-journal-live.md),
  [Brief D09f](docs/briefs/m5-pearl-game-staging.md) para transferencia de un UID antes de mutar, en aislamiento.
- Checkpoint posterior D09f-1, base `1b5c2fa`: coordinador server-only dormant give → commit → apply en tick,
  sin efectos/éxito previo, con reserva hasta apply/fence y guardados diferidos. **184/184** pertinentes en
  árbol aislado, incluidas 38 nuevas. Reutiliza `transferPearl` sobre vista separada, no edita archivos D06b
  ni conecta host/LocalServer. [Informe](docs/delivery/d09f-pearl-staging.md). Sigue gate común de rutas/lifecycle.
- Checkpoint posterior D09f-2a, base `0e82162`: reserva común server-only para staging, admisión/guardados
  y ambas familias de la cola; **226/226**, 42 nuevas. Permisos internos y lifecycle invalidation, sin hooks/activación de sim.
  [Contrato/evidencia](docs/delivery/d09f-mutation-gate.md); [parche siguiente D09f-2b](docs/briefs/m5-pearl-common-gate.md).
- Checkpoint posterior D09f-2b.1, base `0ec0b9d`: CAS/recibo/cola/diario de un UID bag→swallowed vacío,
  same-holder en familia ground. **306/306**, 80 nuevas, seis procesos independientes SQL/sesiones.
  **006 nueva pendiente de aplicar/verificar real**; staging ECS/lotes/hidratación/hooks siguen abiertos.
  [Contrato y evidencia](docs/delivery/d09f-same-holder.md). Sin activar juego ni cambiar archivos D08.
- Checkpoint posterior D09f-2b.2, base `d7398d8`: staging swallow server-only y efecto ECS actual en tick,
  sin publicación anticipada ni rollback SQL. **356/356**, **50 nuevas**; memoria y SDK/SQL006, progreso
  y cuatro poderes conservados. [Contrato/evidencia](docs/delivery/d09f-swallow-staging.md). Sin nueva SQL/env;
  006 real, lotes, efecto común con sim, hooks/hidratación/políticas pendientes; host sin conexión/activación.
- Actualización D09f 2026-10-06: 006 aplicada por el autor; **6/6 probes Supabase de solo lectura**
  verifican validadores/denegación pública ([alcance](docs/delivery/d09f-sql006-readonly.md)). Commit nuevo
  live y hooks del juego aún pendientes. Afinidad del personaje por tipo, conservada tras perder/recuperar
  perla, confirmada como requisito; [implementación pendiente](docs/briefs/m48-pearl-affinity.md).
- Aceptación posterior D09f 2026-10-06: **commit same-holder 006 real, 21/21**, cuatro procesos Node
  SDK/ProfileSessions; replay/CAS/rollback/progreso, recuperación sin envío y reanudación exacta una vez.
  Fixture sintética limpiada; dos auditorías terminales retenidas. [Evidencia](docs/delivery/d09f-same-holder-live.md).
  Afinidad, lotes, efecto común/hooks/hidratación/políticas siguen abiertos; host/juego aún sin activación.
- Checkpoint posterior D09f-2b.3 (2026-10-06), fuente `26ef249`: efecto común sim/staging extraído,
  G/cooldown/agua/stats conservados. **745/745** en 74 archivos de commit aislado, 68/68 smoke;
  sin nueva mecánica, SQL/host/activación o protocolo. [Informe](docs/delivery/d09f-common-effect.md).
  Lotes, hooks completos, restauración/adopción/leases y afinidad siguen abiertos.
- Checkpoint posterior D09f-2b.4 (2026-10-06), base `4414665`: lote atómico de storage para perlas
  de muerte/reemplazo, perfil CAS + todos los UIDs/suelo + un recibo. **481/481** pertinentes aisladas,
  **125 nuevas**, cuatro procesos Node de lectura/replay. **007 pendiente real**, diario/cola/staging
  de lote y hooks/restauración abiertos; afinidad no implementada. [Entrega](docs/delivery/d09f-pearl-batch.md).
- Checkpoint posterior A02: primera caja Dreamrise integrada en los `crate` estáticos, 51,7 KB/204 triángulos;
  siete casos visuales/fallback aceptados en software, GPU/dispositivos físicos y publicación pendientes.
  [Resultado A02](docs/delivery/a02-crate.md); [punto de partida D04](docs/delivery/d04-raft-readiness.md).
- Inventario Unreal terminado: tres proyectos, 7.406 archivos contando copias; ningún candidato importado
  al crear este plan. Ahora el manifiesto contiene A02. No reiniciar la investigación desde cero.
- Checkpoint posterior D04 P1 (2026-10-05): balsa propia visible y replicada, `0.6.0-alpha.1` / protocolo 13;
  P2 transitar cubiertas sigue pendiente. [Informe](docs/delivery/d04p1-raft.md).
- [HANDOFF](docs/HANDOFF.md): checkpoint real, pruebas y siguiente tarea. [DESIGN](DESIGN.md): diseño general.
- Prueba adicional desde PC: [lanzador Windows y HTTPS/WSS para dos jugadores](docs/delivery/pc-host-playtest.md),
  15/15 pruebas pertinentes y movimiento compartido público. No sustituye aceptación humana/FPS ni D04 P2.
- Prueba de arte posterior sobre D04 P1: [balsa cómic y presupuesto móvil](docs/delivery/raft-comic-material.md),
  atlas original 1024/512 WebP; siguiente corte jugable sigue siendo D04 P2. No sustituye A05 (kit FAB modular).
- Checkpoint posterior D04 P2 (2026-10-05): cubierta transitable aceptada localmente en software sobre `d028a42`,
  protocolo 13 conservado; 383/383, 18 capturas PC/móvil emulado inspeccionadas, atlas 1024/512 confirmado.
  [Informe](docs/delivery/d04p2-raft-walk.md). Sigue D05: editor autoritativo; banco Dreamrise para D06 y hut
  prefabricada para M8 son candidatos, no un kit modular exportado. Dispositivos/publicación pendientes.
- Checkpoint posterior D05 (2026-10-05): editor autoritativo de siete piezas, compras cotizadas de materiales,
  retirada segura y guardado exacto; `0.6.0-alpha.2`, protocolo 14. Regresión 413/413 y 24 capturas inspeccionadas
  PC/móvil horizontal/vertical; atlas 1024/512. [Informe](docs/delivery/d05-raft-editor.md).
  Sigue D06 (bodega/producción/mercaderes), luego prototipo D08. Host/dispositivos físicos sin aceptar.
- Checkpoint posterior D06a (2026-10-05): bodega mochila↔balsa y mercados de Aldea/Cala aceptados
  localmente en software; **0.6.0-alpha.3 / protocolo 15**, H/botón táctil, cotización y recibos exitosos de sesión.
  8 pruebas nuevas, regresión 493/493 sobre commit `bcd0886` y 45 capturas PC/móvil inspeccionadas, atlas 1024/512.
  [Informe](docs/delivery/d06a-cargo-market.md), [reutilización FAB](docs/research/unreal-assets/D06-REUSE.md).
  Sigue [D06b producción](docs/briefs/d06b-production.md), candidato banco Dreamrise; después D08.
  Reservas seguras de puerto/movimientos con riesgo durable requieren D09; producción/hamaca/luces pendientes.
- Checkpoint D06b (2026-10-05): red/parrilla y trabajo por módulo implementados localmente;
  **0.6.0-alpha.4 / protocolo 16**, nueve piezas y pestaña Producción. Fuente `5b253a4`, 16 pruebas nuevas,
  547/547 sobre commit aislado; escritorio aceptado (12 capturas), móvil pendiente en [entrega](docs/delivery/d06b-production.md).
  [Unreal/FAB](docs/research/unreal-assets/D06B-REUSE.md): reutilizar atlas/modelos, banco aplazado.
  Cerrar aceptación móvil D06b y seguir D08; P4 agua/hamaca/luces y publicación siguen pendientes.
- Checkpoint D08a (2026-10-05): bahía aislada implementada, fuente `eab3e5c`; 26 pruebas propias,
  regresión 695/695 en 72 archivos fijados. Carga/acomodo/viento constante y medidas repetibles;
  UI/controles preparados, **aceptación visual pendiente** por revisión automática de Chrome/límite de uso.
  [Entrega](docs/delivery/d08a-handling-lab.md), [Unreal/FAB previo](docs/research/unreal-assets/D08-REUSE.md).
  No activa pilotaje/carga real; cerrar móvil D06b y revisar bahía antes de integración naval.
- [Hoja naval](docs/NAVAL-ROADMAP.md): dirección acordada y decisiones pendientes. Este plan organiza su
  entrega; no convierte automáticamente recomendaciones de topología, pérdidas o abordaje en acuerdos.
- Porte aprobado por el autor el 2026-10-07: [masa/volumen separados y upgrades de capacidad](docs/NAVAL-ROADMAP.md#21-porte-y-mejoras-del-barco--revisión-2026-10-07).
  Fórmula conceptual acordada; cifras, calibración e implementación pendientes. Recolección/crafting
  conserva el siguiente lugar del loop; esta decisión no activa límites ni pérdidas.
- Checkpoint D08c.6 (2026-10-07): integración local en la **partida ordinaria**, alpha.6/protocolo 21.
  Timón/cubierta, movimiento con carga real, corrientes/ráfaga, cámara/audio/VFX/HUD/touch y contacto/HP
  por pieza reutilizan D08a–c.5. Circuito costero: zarpar → desembarcar → explorar → reembarcar → atracar;
  recuperación de sesión conserva plano/bodega y no crea bienes. [Entrega](docs/delivery/d08c6-live-coastal-loop.md).
  Siguiente rebanada: recolección madera/piedra → materiales/crafting → ampliar/reparar en puerto.
  Riesgo/pérdidas durables D09, encuentros/rutas D10, dispositivos y publicación pendientes.
- Checkpoint D08c.7 (2026-10-07): recolección/preparación básicas implementadas localmente,
  **alpha.7/protocolo 22**. Nodos compartidos de troncos/piedra, mochila y banco del puerto
  (1 tronco → 1 madera), consumo en editor y guardado/reentrada; **154/154 focales**.
  [Contrato](docs/briefs/d08c7-resource-loop.md), [entrega](docs/delivery/d08c7-resource-loop.md).
  **3/3 recorridos emulados** PC/horizontal/vertical rotado, entradas reales y capturas inspeccionadas;
  fixtures y límites en la entrega. Nodos de sesión, sin receta de piedra ni tiers.
  Sigue lectura única masa/volumen y porte restante; D09/D10/dispositivos/publicación abiertos.
- Corrección de publicación del HUD ordinario (2026-10-09): [informe](docs/delivery/live-hud-publication.md).
  Escritorio comparte composición compacta con touch, sin barra anterior/sticks, teclas Q/I/E y V/M
  según acción asignada; casco integrado, viento y porte reales. 21/21 focales y 3/3 recorridos con
  capturas inspeccionadas. Avance acumulado en Git `1a3ef18`/`be1634f`; URL pública no verificada.
- [Inventario y prioridades](docs/research/unreal-assets/SUMMARY.md),
  [candidatos](docs/research/unreal-assets/CANDIDATES.csv), [portabilidad](docs/research/unreal-assets/PORTABILITY.md)
  y [contrato de assets](docs/ASSETS.md): evidencia técnica, distinta de exportación/integración comprobada.
- Los `PLAN-M*.md` conservan sus pasos/contratos por milestone. Los IDs Dxx de aquí son paquetes de trabajo,
  no nuevas versiones del juego ni renumeración de milestones.

**Dirección Web3 añadida, 2026-10-07:** [PLAN-WEB3](PLAN-WEB3.md) desarrolla tierra, equipo premium y
creaciones comerciables. El autor elige **equipo y tierra** para el primer piloto, con **apariencias y
equipo funcional** bajo [reglas claras](docs/briefs/w00-equipment-rules.md); W00–W06 son cortes
con derechos/pérdidas/custodia/economía/prioridad general pendientes. Red elegida el 2026-10-08:
**Polygon PoS**, piloto **Amoy**, capa opcional para el juego ordinario; plantilla alineada y apagada
por defecto ([alcance](PLAN-WEB3.md#51-polygon-pos-elegida-amoy-para-pruebas)). Origen/proveedor y
verificación real pendientes. Desarrollo autorizado: [W01 aislado](docs/delivery/w01-asset-registry.md)
implementa registro/transferencias internas recuperables, 25/25 pertinentes + 56/56 regresión seleccionada.
W01 no integra wallets/tokens, proyección al juego, SQL live o publicación; conservar esta cola y cerrar contrato de producto.
[W00-equipo](docs/delivery/w00-equipment-content.md) incorpora validación/hash de ambas modalidades y
paridad con las reglas de equipo existentes; pérdidas/licencias y economía siguen por concretar.
[W02a](docs/delivery/w02a-wallet-link.md) agrega vínculo cuenta/wallet por firma EOA, nonce durable y HTTP
opt-in, 29/29 nuevas + 61/61 regresión local, sin proyección jugable.
[W02b](docs/delivery/w02b-wallet-browser.md) añade el panel de navegador con proveedor simulado,
109/109 seleccionadas y 3/3 vistas emuladas; extensión real/testnet/RPC/Supabase live pendientes.
Sin tokens, pagos o publicación; `npm start` conserva Web3 desactivado.
[W02c](docs/delivery/w02c-wallet-runtime.md), 2026-10-08, permite montar esa opción desde configuración
explícita al arrancar: apagada por defecto, exige cuentas/store Supabase y comprueba SQL/ACLs antes de escuchar.
Verificación local aislada; sin SQL live, host del autor, extensión/testnet o cambio de esta cola.
[W02d](docs/delivery/w02d-wallet-preflight.md) añade diagnóstico opt-in independiente SQL/RPC antes
de activar el piloto: red explícita, errores sin secretos y bloque observado. Solo fixtures locales;
no selecciona proveedor/red ni inicia el juego, aplica SQL o modifica esta cola.
[W02e](docs/delivery/w02e-erc721-reader.md) incorpora lector ERC-721 server-only en bloque por
número/hash y CLI separado; 14 nuevas + 13 regresión W02d locales. Contrato/red explícitos,
sin fallback RPC ni proyección al juego; contrato/testnet reales y decisiones W03/W04 pendientes.
[W02f](docs/delivery/w02f-erc1155-reader.md) añade lectura server-only de copias ERC-1155 por
holder/tipo/bloque y CLI independiente; 15 nuevas + 27 regresión W02d/e locales, saldo decimal exacto
incluso cero. Sin inferir tirada/licencia, reservar copias o cambiar permisos, SQL, host o esta cola.
[W02g](docs/delivery/w02g-local-evm-rehearsal.md) ensaya lectores/CLIs sobre bytecode Solidity en EVM
local con mint, transferencias e historial; 7 nuevas + 42 regresión seleccionada. Paquete privado aislado,
sin contratos públicos, proveedor RPC, permisos jugables o cambio de esta cola.
[W02h](docs/delivery/w02h-amoy-rpc-check.md): diagnóstico RPC Amoy por hash, 9 nuevas + 49 regresión
locales y CLI público satisfactorio sin gas. Selector aceptado/identity echo/bloque estable; no finalidad,
NFT público o elección de proveedor permanente. Sin SQL, host, permisos ni cambio de esta cola.
[W02i](docs/delivery/w02i-amoy-erc721-pilot.md): contrato ERC-721 experimental y artefacto
reproducible; operador explícito inmutable, constructor/mint solo Amoy, transferencias estándar
y metadata sin derechos. 68/68 seleccionadas locales (10 nuevas + 58 previas), 80002 simulado;
sin contrato público, gas, pagos o permisos. Siguiente W02j requiere dirección/wallet y evidencia
de deploy/mint/transfer/lectura pública; conservar las decisiones de producto y esta cola.
[W02j-a](docs/delivery/w02ja-amoy-deployment-review.md): preparación offline de constructor/datos
de creación y runtime esperado con operador explícito; 78/78 locales (10 nuevas + 68 previas).
Sin RPC/firma/envío; sigue simulación/estimación W02j-b y evidencia pública W02j-c con direcciones/wallet.
[W02j-b](docs/delivery/w02jb-amoy-deployment-simulation.md), 2026-10-09: herramienta read-only de
simulación de creación/runtime y estimación por bloque, 97/97 locales (19 nuevas + 78 previas).
GasPrice observado y productos en wei de POL de prueba, sin cotización mainnet/permiso de gasto.
Sin RPC externo de ese corte/firma/envío; corrida pública necesita direcciones/RPC explícitos.
W02j-c, Supabase/pagos/permisos y esta cola conservan sus gates.
**Dirección W05 aprobada, 2026-10-08:** [taller modular](docs/briefs/w05-modular-equipment-direction.md),
pocas piezas de sable primero, componentes de catálogo con diferencias de stats; diseño/plano,
receta/materiales/oficio e instancia separados. GLB/IA/escultura/armaduras después; creación y
juego sin wallet. No implementa piezas/editor/recetas ni adelanta W05 sobre equipo/tierra o esta cola.

## 2. Regla de entrega

Cada paquete cierra **una mejora jugable y su evidencia**. Puede tener una prueba de arte paralela, pero no se
bloquea todo el milestone por un modelo que no exporta o un efecto que no mejora lo procedural.
Primero probar un recurso pequeño; adoptarlo solo cuando su coste/estilo/legibilidad encaje. Mantener fallback.
Avanzar en M4.8 mientras se preparan assets de forma aislada; después alternar construcción/economía y arte
que mejore la parte que ya se puede jugar. Nunca hacer un reemplazo completo de la isla de una sola vez.

Estados: **pendiente → preparado → en curso → en revisión → integrado → aceptado**; `aplazado` registra un
experimento que no conviene ahora. `publicado` requiere evidencia adicional de servidor/URL real y no sustituye
aceptación. Una integración con rendimiento/dispositivos pendientes debe nombrar esa limitación.

## 3. Entregas y dependencias

Todas salvo D00 son trabajo futuro o en curso al redactar; actualizar estado y evidencias al cerrar cada una.

| ID | Mecánica o resultado | Prueba/mejora de assets asociada | Depende de / aceptación principal | Estado actual |
|---|---|---|---|---|
| D00 | Inventario y dirección naval | A00: catálogo, miniaturas y candidatos | CSV/JSON reconciliados, límites de evidencia registrados | Hecho |
| D01 | M4.8 P3: Tormenta | A01 fase A: preparar Noise00 fuera del runtime comprobado | Cadena/carga/maldición coherentes cliente-servidor, pruebas y recorrido visual | Integrado `66e6e67`; 259/259, visual emulado aceptado; dispositivos/publicación pendientes, A01 sin integrar |
| D02 | M4.8 P4: Tinta | Humo/tinta procedural; recursos nuevos se comparan por separado | D01 integrado; marca/nube/IA y maldición día-noche probadas | Integrado alpha.4; 271/271, visual emulado aceptado; dispositivos/publicación pendientes ([informe](docs/delivery/d02-tinta.md)) |
| D03 | M4.8 P5: cierre integrado | A01 fase B terminada/aplazada para fogatas; A03 opcional tras probar recurso | D01–D02; kit/indicadores legibles, fallback y regresión. Arte nuevo puede aplazarse | Candidato rc.1, 278/278; aceptación física/publicación pendientes ([informe](docs/delivery/d03-pearlkit.md)); A01 no lo bloquea |
| D04 | M6 P1–P2: balsa visible y cubierta transitable | A02 caja: hook de isla y caja de balsa; preparar banco | D03; muelle → cubierta, paredes/escalera, snapshots. Un mesh no crea almacenamiento | P1–P2 local aceptado en software ([P2](docs/delivery/d04p2-raft-walk.md)); dispositivos/publicación pendientes |
| D05 | M6 P3: editor de construcción | Renderer/atlas existentes y caja A02; no nuevo kit A05 | D04; fantasma/motivo/rotación/colocar/quitar con servidor como autoridad | Local aceptado en software, 413/413 y 24 capturas ([informe](docs/delivery/d05-raft-editor.md)); dispositivos/publicación pendientes |
| D06 | M6 P4 parcial + M7 P1–P2: carga/comercio y primera producción | Caja A02 y atlas/modelos existentes; red/parrilla sin export útil; iconos A06 pendientes | D05; autoridad, lotes completos, fracciones guardadas; reservas de puerto D09 | D06a aceptado; D06b local alpha.4/protocolo 16, 547/547 y escritorio con 12 capturas ([producción](docs/delivery/d06b-production.md)); móvil D06b pendiente. Agua/hamaca/luces/iconos abiertos |
| D07 | M5 P1–P3: almacenamiento/cuentas/mundo | Medir carga total de los pocos assets aceptados | Contratos del principal; memoria y persistencia distinguidas. Puede comenzar junto a D04–D06 | P1–P3 local; Auth/perfil y mundo reales comprobados con fixtures aislados ([D07c](docs/delivery/d07c-comic-account.md), [D07d](docs/delivery/d07d-world.md)); correo humano/publicación pendientes |
| D08 | M6 manejo: materiales, navegación, distribución y carga | Piezas de A05 y feedback visual de sobrecarga | D05; una familia/tier inicial, comparar vacío/cargado/giro, datos explicables | D08c.6 integrado localmente en partida ordinaria: manejo/carga real, timón/cubierta, costa y circuito desembarcar/reembarcar/atracar ([informe](docs/delivery/d08c6-live-coastal-loop.md)); progresión, dispositivos y publicación pendientes |
| D09 | M5 P6: movimientos/recuperación sin duplicados | Arte de daño como visual; plano y estado operativo separados | D07 y contratos de D04–D08; depósito/retirada/jettison/reintentos/recuperación conservan bienes | Base D09a–e, 003–006 reales; same-holder commit/recuperación 21/21 ([informe](docs/delivery/d09f-same-holder-live.md)). Staging swallow/ECS y efecto común con sim listos; refactor 745/745 aisladas ([informe](docs/delivery/d09f-common-effect.md)). Afinidad, lotes, hooks/restauración/adopción y operaciones navales pendientes |
| D10 | M6 P5–P6 inicial + M7 rutas: primer viaje/naval PvE | A07: un impacto de madera/agua; A04 un sonido si puente listo | D06,D08; D09 para riesgo persistente. Dos rutas, NPC vencible, reparar/recuperar | Pendiente |
| D11 | Dos jugadores: huida, rendición, saqueo, notoriedad/patrulla | Señales/banderas legibles, efectos pequeños | D09–D10 y reglas legales/de pérdidas definidas; dos clientes y liquidación única | Pendiente |
| D12 | Abordaje inicial, formato por definir | A05 cobertura/pasarela; reutilizar personajes actuales | D11 y formato decidido; solo/cooperativo, colisiones y latencia. Recomendación: cubiertas enganchadas | Pendiente |
| D13 | M7 P7/P10 + M8 talleres: red regional inicial; afinidad como tarea separada | A06 iconos/productos; recursos/props seleccionados; sonido puntual | D06,D07,D09; pocas cadenas de harvesting/crafting/comercio y aprendizaje validado | Pendiente |
| D14 | M8 vivienda terrestre modular + pedido/obra/caravana | A05 kit terrestre; A02 props; hut completa solo como prefab donde encaje | Editor D05, remesas D09 y oficios D13; una obra visible y una remesa escoltable/asaltable | Pendiente |
| D15 | Más tiers, clima, tecnologías, flotas y aire posterior | A08 clima; A09 personaje/rig solo con caso útil | Evidencia D10–D14; alcance por módulo/presupuesto. Aire no entra en la primera versión | Futuro |

D04–D06 y D13–D14 pueden subdividirse en misiones de un renderer, un comando o un panel; no asignar una fila
entera grande a un único agente. M5 comienza en paralelo cuando haya contratos estables; D09 es puerta
obligatoria antes de publicar bienes persistentes en riesgo. Viaje abstracto sirve para prototipo/comercio,
pero no sustituye el combate vencible que espera el jugador.

Afinidad no se añade silenciosamente al cierre de M4.8: definir mejoras/llave/XP y migración antes de su misión.
Navegación y nivel propio de barco, legalidad, pérdidas/rescate y topología se concretan al preparar sus fases;
las decisiones abiertas no bloquean texturas, el kit actual o la cubierta/editor básicos.

### 3.1. Pilar esencial — humanos y agentes; chat primero

[PLAN-EXTRA-LLM](PLAN-EXTRA-LLM.md), promovido por el autor a **parte esencial el 2026-10-07**;
sustituye la prioridad baja del 2026-10-05. Mente LLM para conversar/decidir, cuerpo determinista para
actuar y feedback textual. Humanos y agentes comparten canales de mundo, cercanía y susurros.

**Primera entrega propia C01:** [chat ingame](docs/briefs/c01-chat.md), reutilizando `ws` y la sesión
del juego; identidad/audiencia y radio desde el servidor, whispers privados, límites, UI PC/táctil y
confirmaciones. Después **L00 → L01 → L02 → L03 → L04/L05 → L06**. C01 no necesita proveedor LLM;
L03 incorpora respuestas del modelo sobre mensajes entregados al personaje. BYOK, economía compartida,
PvP, autonomía offline y monetización conservan sus fases/decisiones. D09/M5 sigue siendo puerta para
bienes en riesgo; las entregas navales/visuales continúan con sus dueños. No relegar agentes a capacidad sobrante.

Checkpoint C01, 2026-10-07: [chat implementado y verificado localmente](docs/delivery/c01-chat.md),
**17/17 pertinentes**, dos invitados por UI, escritorio/844×390/390×844 inspeccionados; alpha.5/protocolo 20.
Regresión general 1707/1708 con timeout de servidor que pasó aislado; causa exacta abierta.
Sin despliegue, LLM ni historial durable. L00 y L01a/b/c avanzan localmente; L01b reutiliza el chat común.

Ampliación C01 del mismo día: [burbujas de conversación](docs/delivery/c01-chat-bubbles.md), Cerca inicial
y susurros privados sobre el personaje; panel como historial. 18/18 pertinentes y tres clientes por UI,
capturas en escritorio/vertical/horizontal. Local, sin nuevo protocolo de chat ni publicación.

Planificación acordada por el autor: [ruta por líneas de acuerdo](PLAN-EXTRA-LLM.md#4-cortes-de-desarrollo-y-aceptación),
22 líneas L00a–L06e con dirección acordada; L00, L01a/b/c y L02a/b tienen evidencia local;
L02c añade autoridad opt-in, L03a API/mente simulada, L03b conversación, L03c metas/feedback, L04a memoria local con resúmenes simulados y L04b administración local verificados. [L04c](docs/delivery/l04c-companion-continuity.md) añade captura/refresco/resumen acotados del Studio local; montaje central y L05–L06
siguen pendientes. Cada corte tiene demostración
y estado separado de diseño/implementación. **Base de L00a acordada:** personaje propio/plaza normal,
autonomía dentro de capacidades y gasto del dueño, stop y archivos de personalidad/memoria/objetivos
visibles. **D-A2 acordada:** primera prueba de conversación, movimiento y ayuda PvE; después
comercio, construcción y barcos. **L00b acordada:** percepción con frescura/confirmado/predicho/recordado
separados y poda/compactado del contexto dentro de presupuesto; contrato L00, ensamblador en L03,
memoria persistente L04. Contar compactado en el gasto y verificar historial grande sin prompts ilimitados.
**L00c acordada:** órdenes identificables/acotadas/cancelables y feedback de envío, ejecución,
confirmación, rechazo e incertidumbre. **L00d acordada:** ciclo con decisiones simuladas, fallos y
historial enorme antes del LLM. Las cuatro líneas L00 tienen contrato/pruebas de laboratorio locales:
[contrato v1](docs/agents/interface-v1.md), [evidencia](docs/delivery/l00-agent-interface.md).
**L01a acordada:** cliente textual sin gráficos, jugador normal, observación/acciones con
feedback y personaje/archivos visibles. **L01b acordada:** chat del runner por Mundo/Cerca/susurros
con identidad/reglas comunes y audiencia del personaje. **L01c acordada:** limpieza en stop/muerte/
desconexión y reentrada con estado fresco; descartar órdenes antiguas y conservar incertidumbre sin
repetir acciones automáticamente.
L01a/b/c tienen adaptador invitado local, incluido ciclo de vida/reentrada. **L02a acordada:** ir/seguir/mantener
distancia con colisiones y feedback de progreso/llegada/bloqueo/cancelación, sin LLM por cada paso.
[Controlador local L02a verificado](docs/delivery/l02a-agent-movement.md): rutas directas,
seguimiento/radio y bloqueo por falta de avance observado; navegación general pendiente.
**L02b acordada:** modos agresivo, defensivo y de apoyo para atacar/proteger/retirarse/reaccionar a
amenazas en PvE mientras la mente piensa, con recursos/daño/colisiones/recargas del jugador.
[Controlador y encuentro L02b verificados localmente](docs/delivery/l02b-agent-pve.md), con
defaults de ensayo. **L02c acordada:** stop/revocación prevalecen; el servidor invalida
el control anterior, cancela tareas, limpia entradas pendientes y rechaza respuestas tardías, con un
único controlador autorizado por personaje. [Implementación opt-in verificada localmente](docs/delivery/l02c-agent-authority.md):
cuentas separadas, epoch/CAS, prioridad y neutralización de cola antes del siguiente tick permitido;
provisioning, UI, vínculo persistente y operación multi-host pendientes.
**L03a acordada:** mente LLM intercambiable, decisiones estructuradas, contexto relevante/compacto
y límites de tokens/gasto/tiempo; latencia o fallo no detienen el cuerpo.
[API y modelos simulados verificados](docs/delivery/l03a-agent-mind.md); proveedor/tokenizer/facturación
reales y gasto durable pendientes.
**L03b acordada:** personalidad en Mundo/Cerca/susurros dentro de permisos, solo mensajes entregados,
charla y órdenes autorizadas diferenciadas, sin ampliar permisos ni crear bucles entre agentes.
[Turnos explícitos y C01 verificados con modelos simulados](docs/delivery/l03b-agent-conversation.md),
con audiencia fijada y supresión por proceso; proveedor/calidad/experiencia humana pendientes.
**L03c acordada:** metas ajustadas con feedback dentro de permisos/gasto,
objetivos visibles mientras el cuerpo actúa y validar el ciclo junto a un humano en PvE.
Metas/archivos y ensayo PvE local simulados verificados; encuentro y aceptación humana pendientes. **L04a acordada:** personalidad/objetivos/recuerdos entre
sesiones, fuentes/vigencia, recuperación relevante y compactado trazable dentro del presupuesto del prompt.
Journal/recuperación y reentrada local verificados con resúmenes simulados; calidad/proveedor reales pendientes. **L04b acordada:** consulta/exportación de archivos reales,
borrado de recuerdos con sus resúmenes/índices derivados, aislamiento por dueño y reglas de retención.
Consulta/exportación/borrado y retención/migración explícitas verificados localmente en L04b. **L05a acordada:** límites del dueño y reserva antes de inferencia
incluido compactado, consumo registrado, bloqueo de nuevas llamadas sin presupuesto suficiente,
aviso y claves fuera del juego. Operación/importes/pruebas pendientes. **L05b acordada:** panel del dueño
con modelo/estado/tarea/consumo/límites, medición/estimación/desconocido, archivos reales, ajuste de límites
y stop. Panel/pruebas pendientes. **L06a acordada:** piloto social/PvE pequeño con agentes identificables,
percepción/permisos del personaje exigidos por el servidor y aislamiento/carga comprobados antes de
ampliar acceso. Piloto/autoridad/pruebas pendientes. **L06b acordada:** inventario/compra/venta dentro de
permisos y presupuesto del juego separado de inferencia; reglas humanas, guardado/recuperación verificados
por operación y reintentos/reconexiones sin duplicar cobros ni objetos. Comercio/contratos/pruebas pendientes.
**L06c acordada:** construcción con cuerpo/comandos comunes, planos válidos, propiedad y límites de
materiales/gasto; desmontar/destruir como capacidades autorizadas por separado. Construcción/permisos/pruebas pendientes.
**L06d acordada:** tripulación/navegación autorizadas, mente para destino/táctica, cuerpo para mandos
humanos y permisos del barco/carga/colisiones; ruta costera y tarea de cubierta. Cuerpo naval/permisos/pruebas pendientes.
**L06e acordada:** evaluación con humanos de experiencia/recuperación/efectos económicos/coste de
inferencia/carga y decisión de ampliar o ajustar el piloto con evidencia. Evaluación y decisión pendientes.
Las 22 líneas L00a–L06e cierran la dirección del plan; L00 tiene contrato/fixture verificados localmente.
[L01a](docs/delivery/l01a-agent-network.md): invitado/plaza normal por WebSocket, movimiento visible
en navegador, swing PvE de práctica y archivos reales/scope/hashes. 73 aprobadas, una omitida por
EPERM al crear symlink; 12/12 de regresión chat/red en esa entrega.
[L01b](docs/delivery/l01b-agent-chat.md): chat por C01, tres clientes ordinarios, privacidad de
susurros, rechazo/reintento y contexto podado con omisiones visibles. 87 aprobadas, una omitida
por symlink Windows; 20/20 de regresión chat/burbujas/red y dos capturas inspeccionadas.
[L01c](docs/delivery/l01c-agent-lifecycle.md): muerte/corte/stop, archivo acotado y reentrada
explícita con conexión/estado frescos; IDs anteriores bloqueados e incertidumbre protegida en contexto.
96 aprobadas, una omitida por symlink Windows; 20/20 de regresión chat/burbujas/red.
[L02a](docs/delivery/l02a-agent-movement.md): ir/seguir/mantener distancia, feedback confirmado,
cancelación por CLI y bloqueo en terreno de ensayo por inputs normales. 114 aprobadas, una
omitida por symlink Windows; 20/20 de regresión chat/burbujas/red.
[L02b](docs/delivery/l02b-agent-pve.md): modos agresivo/defensivo/apoyo, guardia/interposición,
retirada, reservas/recarga y bloqueo con inputs normales. 142 aprobadas, una omitida por symlink
Windows; 63/63 de regresión chat/burbujas/red/combate/armas/Sin ley/items en esa entrega.
[L02c](docs/delivery/l02c-agent-authority.md): binding server-owned y runner autenticado opt-in,
exclusividad, prioridad directa/meta/reflejo, epoch/CAS y limpieza de cola/carry/último input.
163 aprobadas, una omitida por symlink Windows; 206/206 de regresión de host/cuentas/naval/chat/combate.
Protocolo 28; sin aplicar migraciones ni tocar servicios externos.
[L03a](docs/delivery/l03a-agent-mind.md): mente intercambiable, salida estructurada, payload completo
podado/compactado, reservas de consumo/uso desconocido, timeout y una consulta en curso. 211 pruebas
de agentes aprobadas, una omitida por symlink Windows; 206/206 de regresión. WebSocket y CLI locales,
modelos simulados; proveedor/tokenizer/facturación reales pendientes.
[L03b](docs/delivery/l03b-agent-conversation.md): conversación explícita sobre chat entregado, personalidad,
audiencia fijada, contexto inspeccionable y límites contra respuestas repetidas; WebSocket/CLI locales simulados.
[L03c](docs/delivery/l03c-agent-goals.md): metas con feedback, archivo real revisado, prioridad/fences y
ciclo PvE local frente al cuerpo sin modelo. [L04a](docs/delivery/l04a-agent-memory.md) añade memoria
local persistente, recuperación pertinente y resúmenes con originales/fuentes/incertidumbre; escritura,
reentrada y presupuesto de compactado verificados con modelos simulados. [L04b](docs/delivery/l04b-agent-memory-admin.md)
añade administración local, exportación byte exacta, borrado con derivados/pendientes y retención/migración explícitas.
Sigue L05a; proveedor/calidad/encuentro y experiencia humana pendientes.
Los límites son de ensayo; provisioning/UI, percepción, proveedor/gasto durable, operación remota de memoria y experiencia
humana siguen pendientes. Sin publicación ni despliegue.

### 3.2. Ruta visual — puerto tropical ilustrado

**Personajes modulares, 2026-10-07:** el autor aprobó el orden del creador y pidió iniciar bases masculina y
femenina. [Plan del creador](PLAN-CHARACTER-CREATOR.md): P01 bases/rig, P02 anatomía/UV de producción,
P03 apariencia, P04 vestuario, P05 creador, P06 identidad guardada, P07 equipo visible y P08 rendimiento/entrega.
[Primer corte](docs/delivery/characters-base-v0.md): dos láminas, dos GLB articulados v0 y visor aislado en
`http://127.0.0.1:5194`. El corte visual conserva las dependencias de M5/D08/agentes; el acabado pintado y
su integración a la partida avanzan por sus propios gates. Los nuevos modelos se registran como prototipos
preparados en el catálogo, con fuentes y evidencia, antes de aplicarlos al juego.

**Anatomía P02a, 2026-10-07:** [bases v1](docs/delivery/characters-base-v1.md) conservan la v0 y añaden
cuerpo continuo, relieve facial, UV y estudio de material. El visor compara versiones, muestra cuadrícula
UV y carga mapas 1024/512 por dispositivo. [Superficies P02b / v2](docs/delivery/characters-base-v2.md)
conservan v0/v1, añaden anillos/parches, uniones con pesos coherentes, extremidades simplificadas y atlas
corporal por regiones: 7.080 triángulos por cuerpo, con tres poses/16 muestras CPU y QA escritorio/móvil
emulado. Refinamiento artístico, dedos y atlas final siguen en P02; el creador y la identidad/equipo
en partida conservan sus entregas posteriores.

**Rostro y extremidades P02c, 2026-10-08:** [bases v3](docs/delivery/characters-base-v3.md), dedos/pulgar
estáticos conectados, mandíbula/ojos/relieve refinados y pies redondeados. Guía de cabezas alpha generada
con prompt/origen, acercamientos de mano/pie y comparación v0/v1/v2/v3. 10.216 tris por base y mapas
1024/512; tres poses/16 muestras CPU y QA escritorio/móvil emulado. Atlas/pintura artística, anatomía
fina, ropa base e integración siguen abiertos; conserva la cola de creador/identidad/equipo.

**Apariencia P03a, 2026-10-08 — prototipo técnico rechazado visualmente:** el autor rechazó las bases
procedurales existentes y estas mallas por feas y alejadas de la referencia más reciente de Horizon Tides.
Su contrato modular puede servir de referencia. El informe CPU histórico pasó 13/13 pruebas; el informe
de navegador falló (error de red en escritorio y cierre de página/navegador durante móvil), y la evidencia
HTTP está pendiente. El catálogo de arte en revisión 31 no contiene `char-appearance-male-v1` ni
`char-appearance-female-v1`; no hay registro nuevo aceptado. No se cierra P02/P03 ni se integra el arte.

**Kit ilustrado alpha v1, 2026-10-08 — QA técnica local aprobada:** 13/13 aserciones, ocho capturas,
26 solicitudes PNG móvil y evidencia HTTP de 62 recursos. De 29 intentos se seleccionaron 27 (26 alpha y
1 puerto opaco); fuentes elegidas 32,320,538 B y derivados móviles elegidos 4,290,112 B. Se descartaron
ojos azules v1 por alpha y barba corta v1 por contorno flotante; v2 queda seleccionado para ambas familias.
El montaje usa máscara `base` para seguir la mandíbula; offsets/recortes ajustados en runtime, sin alterar
PNG originales. [Entrega](docs/delivery/character-alpha-v1.md). El autor aceptó el look para el piloto 3D
el 2026-10-08; registro global en catálogo pendiente. No cierra P02/P03 ni integra modelos a la partida.
[Piloto Meshy](docs/delivery/character-3d-pilot-v1.md): MCP 0.6.1 instalado y configurado fuera del checkout,
handshake directo/24 herramientas comprobados; falta API key. Primera petición preparada, sin enviar;
todavía no hay malla 3D de este piloto.

[PLAN-VISUAL-PORT](PLAN-VISUAL-PORT.md), solicitado el 2026-10-06: análisis de la referencia y de la
lista del autor, diagnóstico del renderer actual, biblioteca de materiales/modelos y cortes **V00–V08**.
El autor precisó estilo ilustrado moderno/tipo sprite cercano a Borderlands y trabajo por filas:
[catálogo HTML local](tools/art-catalog/README.md), referencias/archivos/estado/ficha de integración,
80 piezas desde arena/palmas hasta puerto y efectos. Las entregas subidas quedan versionadas fuera
del bundle; aplicado requiere registrar captura/informe de integración real.
Primer objetivo: un rincón de costa/muelle/puesto coherente antes de extender el pueblo. Reutilizar atlas
de balsa/crate y geometría actual; A05 sigue siendo el kit compartido. El toon actual no conserva
roughness/metallic/AO importados: nuevas respuestas de material requieren consumidor y revisión propios.
Estado del entorno: **plan propuesto**, sin puerto implementado ni rendimiento nuevo verificado.
Catálogo local implementado: [entrega](docs/delivery/art-catalog.md), **7/7**, guardado/uploads y
PC/móvil emulado en fixture; 14 enlaces HTTP verificados en su entrega inicial. Originales encontrados
en `materials/references/`; arena registrada. [S01 familia arena](docs/briefs/visual-s01-sand-family.md):
cinco acabados + objetos separados. El autor entregó color/normal: seca, mojada (normal seca compartida),
ondulada, huellas y orilla. [Entrega aplicada local](docs/delivery/sand-family-v1.md), **10/10**,
nueve mapas únicos WebP 1024/512 y capturas del mapa real PC/móvil emulado; variante única verificada.
La orilla usa recorte de arena y conserva agua/espuma animadas. Compactada llega en S03; conchas grandes pendientes;
repetición/densidad y aceptación artística final abiertas. `PROBAR-ARENAS.cmd` / puerto 5192.
Ampliación S02: [rocas de playa](docs/delivery/coast-rocks-v1.md), SM_Rock reutilizado desde copia aislada,
GLB 7.964 B/64 tri sin texturas nuevas. Tres siluetas pintadas en ocho rocas existentes; colisiones conservadas.
**41/41** pertinentes y PC/móvil/low/fallback revisados, catálogo revisión 6. Arte final/FPS físico abiertos;
conchas/cantos y palmas siguen por filas. Ensayo local sin cambiar gates de M5 ni publicar.
Ampliación S03: [hierba, tierra y transiciones](docs/delivery/ground-family-v1.md), ocho PNG nuevos intactos,
cuatro pares en dos atlas acolchados PC 2048/móvil 1024. Suelo de hierba, bordes y centro de senderos
y alrededores del pueblo aplicados; plaza de piedra y máscaras/colisiones conservadas. **46/46**,
PC/móvil/low y fallos de color/normal/noassets revisados; shader con 14 samplers de 16. Catálogo revisión 7,
80 filas. Arte fino/FPS físico/publicación abiertos; no altera prioridad ni gates de M5.
Ampliación S04: [conchas y cantos](docs/delivery/beach-details-v1.md), tres conchas propias y grupos
de SM_Rock reutilizado; cuatro GLB/49.176 B, sin texturas nuevas. Distribución solo de renderer,
100 conchas/58 grupos en la semilla actual, límites 144/96; props/RNG/colisiones intactos. **50/50**,
PC/móvil/low/404/GLB inválido/noassets revisados; catálogo revisión 9 y 33 enlaces exactos verificados.
Arte final/FPS físico/publicación pendientes. Siguiente pieza visual: palmeras; M5/D08 conservan su cola.
Ampliación S05: [familia de palmeras](docs/delivery/palm-family-v1.md), tres GLB (377.204 B, 1.016–1.112
triángulos) y atlas compartidos color/normal v2 del autor (1024 PC/512 móvil; 1.052.630/357.894 B por par).
234 posiciones de la semilla actual (93/77/64), seleccionadas por hash local del renderer; RNG, colisiones y
datos del mapa intactos. **56/56**, cuatro chequeos de sintaxis y dos verificaciones deterministas pasaron.
Alpha 0,35 recorta frondas en color/normal/contorno y MeshDepth; se conserva el viento. Las capturas señalan
dos huecos cambiantes bajo sombra de escritorio con viento 0/2,1; móvil medium sin error de shader y huecos
pequeños ausentes en low/1024. Ocho casos visuales (tres modos y cinco fallos) completados sin errores JS/shader;
snapshots de seis fuentes verificados con --check. Catálogo revisión 10: 80 filas, 24 aplicadas y 52 enlaces de
palma exactos por bytes en 5190. Conjuntos S01/S03/S02/S04 con 47/44/13/33 enlaces, todos pasan; repetir el
registro conserva revisión 10. Revisión artística fina, FPS físicos y publicación pendientes. Próxima pieza
propuesta: base/raíces. Entrega local, sin mover M5/D08.

Ampliación S06: [raíces y plantas bajas](docs/delivery/palm-bases-v1.md), dos GLB/125.680 B/950 triángulos. Atlas
nuevo de hojas color+normal: 512×256 PC/74.944 B y 256×128 móvil/30.006 B; bark S05 se reutiliza. Total nuevo por
dispositivo 200.624 B PC/155.686 B móvil. 144 bases junto a palmeras existentes (74 open/70 lush), hash local del
renderer; sin RNG, cambios de colisiones ni props, con rechazos de camino/agua/muelle/pendiente/NPC/obstáculo.
Seis snapshots inmutables --check pasaron y S05 histórico quedó intacto. **62/62 pruebas**, sin omisiones.
Ocho QA (PC/móvil/low + cinco fallos), sin errores JS de juego ni GL y programas enlazados; atlas cargados
512×256 PC / 256×128 móvil. Modelos perdidos/inválidos usan geometría nativa; sin albedo las hojas tienen
silueta geométrica, sin normal conservan pintura y noassets añade cero solicitudes S06. Fallos de assets
esperados en sus fixtures y mensajes auxiliares 404 en consola documentados en la entrega.
Catálogo revisión 11: 82 filas/26 aplicadas, 47 enlaces HTTP únicos exactos. Conjuntos S01/S03/S02/S04/S05
(47/44/13/33/52 enlaces) también pasan. Galería temporal 1×; contacto real conserva el dither S05.
Arte fino, FPS físicos y publicación pendientes. El arbusto independiente avanzó después en S07;
M5/D08 conservan su cola.

Ampliación S07: [arbustos tropicales](docs/delivery/shrubs-v1.md), tres GLB/79.208 B/1.376 triángulos,
atlas color/normal 512² PC (170.924 B) / 256² móvil (59.020 B). En el seed local 99282957: 784 plantas,
262 sustituciones y 522 adicionales, tres siluetas; 80 anclajes inseguros mantienen el arbusto anterior.
Distribución cosmética por hash con límite 900 y accesos despejados; no altera RNG/props/colisiones.
Recorte alfa 0,35 y viento en color/contorno/sombra, normal suave 0,16. **63/63** pruebas pertinentes,
ocho QA (tres modos y cinco fallos) sin errores JS de juego ni GL; carga PC/móvil real y fallbacks
verificados. Seis snapshots de integración y generadores de modelos/texturas --check aceptados.
Concepto y fuentes generadas conservados en el catálogo junto a modelos, previews y evidencia del mapa.
FPS físicos, revisión artística fina y publicación pendientes; mantiene las dependencias de gameplay.

Ampliación S09: [madera varada](docs/delivery/beach-debris-v1.md), 34 conjuntos de ramas/troncos/tablones,
tres GLB de 18.740 B y reutilización de SM_Logs como tablones tras inspección de su forma. Material opaco
compartido con vetas, instancing, distancia/cantidad por calidad y sin texturas nuevas. **77/77** pertinentes,
seis casos PC/móvil/low y fallbacks revisados. Fuentes/modelos/capturas en `restos-playa`; once snapshots
inmutables. +3/+4/+3 llamadas de dibujo en la vista medida; FPS físicos/publicación pendientes.

Ampliación S10: [algas someras](docs/delivery/seaweed-v1.md), tres formas pintadas con oscilación que
sustituyen la geometría básica en 197/216 posiciones submarinas existentes. Un material opaco sin mapas
nuevos, LOD de 16 triángulos, instancing y límites por calidad. **83/83** pertinentes y cuatro casos
PC/móvil/low/noassets revisados; ocho snapshots inmutables. Fila `hierbas-algas`, catálogo revisión 17,
83 filas/30 aplicadas y 31 enlaces HTTP exactos. Espuma/cáusticas actuales aún limitan el detalle visible;
calibración del agua, FPS físicos y publicación pendientes. No altera M5/SQL, navegación ni chat/agentes.

Ampliación S11: [claridad del agua](docs/delivery/water-clarity-v1.md), espuma fina/discontinua,
cáusticas suaves compartidas entre SSR/terreno-low y refracción 0,02. Corrige el depth del framebuffer
al alternar calidad. **88/88** pertinentes, seis contextos finales y 24 cambios de calidad sin errores
GL; 27 capturas de comparación y once fuentes finales congeladas. Filas mar/espuma y fondo marino,
catálogo revisión 18, 83 filas/32 aplicadas y 44 enlaces HTTP exactos. Sin mapas/pases nuevos;
contacto completo jugador/barco, FPS físicos, aceptación artística del autor y publicación pendientes.

Ampliación S12: [roca natural ilustrada](docs/delivery/rock-faces-v1.md), pintura compartida sobre
33 rocas de playa/interior, con fracturas finas y humedad junto al mar. Las 35 volcánicas/arena de combate/
lava mantienen su shader previo; mallas/colisiones/instancias/matrices intactas y cero imágenes nuevas.
Batches 34→38, mismos 5.312 triángulos y dos materiales de color; FPS físicos pendientes. **92/92**
pertinentes, seis QA finales/24 cambios de calidad sin errores JS de juego/assets/GL, programas enlazados.
27 comparaciones, nueve fuentes finales congeladas; catálogo revisión 20, 85 filas/34 aplicadas,
43 enlaces HTTP exactos. Filas roca-cara/roca-natural aplicadas a objetos; acantilados/remates/arcos,
arte fino y publicación abiertos. Sin cambiar terreno, M5/SQL, navegación, recursos ni chat/agentes.

Ampliación S13: [tablones del muelle](docs/delivery/dock-wood-v1.md), 67 tablas y dos vigas de
cubierta con atlas compartido de balsa 1024/512, cuatro recortes y sus espejos. Misma geometría/posición,
fallback anterior, cero imágenes nuevas; añade 19.872 B de UV y un material de color propio.
**105/105** pertinentes, siete casos finales/28 cambios de calidad GL=0 y 20 comparaciones; ocho fuentes
finales congeladas. Catálogo revisión 22, 86 filas/35 aplicadas, 37 enlaces exactos. M01 extendida y
`muelle-tablones` aplicada; soportes, paredes, kit modular, arte/FPS físicos/publicación pendientes.
No altera terreno, SQL, navegación, recursos, chat o personajes.

Ampliación S14: [madera del pueblo](docs/delivery/town-wood-v1.md), nueve pares color/normal del autor
en seis casas, un puesto y ocho postes. Dos atlas 2048/1024 compartidos con normales lineales suaves,
fallback independiente; mismos chunks/geometría, +1.350.720 B de UV/máscara y un material de color.
**109/109** pertinentes, ocho casos finales / 32 cambios de calidad GL=0 y 44 capturas; doce fuentes
congeladas. Catálogo revisión 24, 97 filas / 44 aplicadas, 101 enlaces exactos; 88 filas previas intactas.
Kit modular/huecos/techos/toldos, arte fino/FPS físicos/publicación pendientes. Naval/M5/chat y personajes
conservados; siguiente pieza visual sugerida: techos/toldos que acompañen la madera ilustrada.

Ampliación S15: [paja/toldo del pueblo](docs/delivery/town-covers-v1.md), pintura nativa en seis casas
y lona del atlas existente 1024/512 en el mercado. Sin imágenes/mallas/pasadas nuevas; mismos atributos
anteriores/mapa/sombras, +1.350.720 B de máscara/coordenadas. **113/113** pertinentes, siete casos
finales / 28 cambios de calidad GL=0, 40 capturas, ocho fuentes finales congeladas. Catálogo revisión
28, 101 filas / 46 aplicadas, 55 enlaces exactos; 99 filas previas intactas. Kit modular, techo irregular,
telas animadas, arte/FPS físicos/publicación pendientes. Siguiente pieza sugerida: cuerdas/amarres.
Naval/M5/chat/agentes/Web3/personajes conservados.

Ampliación S16: [cuerdas del muelle](docs/delivery/dock-ropes-v1.md), vueltas en ocho postes y dos
rollos laterales con atlas existente 1024/512 y fallback nativo. +1 malla/material, 4.160 triángulos,
108.672 B de buffers; sin imágenes/descargas nuevas. Geometría previa/mapa/RNG conservados.
**118/118** pertinentes, siete QA finales / 28 cambios de calidad GL=0, 30 capturas y ocho fuentes
congeladas. Catálogo revisión 29, 102 filas / 47 aplicadas, 44 enlaces exactos; 101 filas anteriores
intactas. Ficha con 32 imágenes / 77 enlaces. Cuerda física/conexión a barcos/nudos complejos,
arte fino/FPS físicos/publicación abiertos; prioridades de gameplay intactas.

Ampliación S17: [barriles y cajas](docs/delivery/port-cargo-v1.md), pintura del atlas de pueblo
existente sobre ocho barriles y siete cajas estáticas. Duela/aros ilustrados y veta horizontal;
sin imágenes, descargas, mallas o pasadas nuevas. Geometría/mapa conservados. **122/122** pertinentes,
tres contextos previos y nueve finales, 36 capturas / 36 cambios de calidad finales GL=0;
ocho fuentes congeladas. Catálogo revisión 31, 104 filas / 48 aplicadas; otras 102 filas intactas,
58 enlaces HTTP exactos y ambas fichas revisadas sin errores. Variantes, almacenamiento funcional,
arte fino/FPS físicos/publicación pendientes.

Ampliación S18: [faroles y señalización](docs/delivery/town-fixtures-v1.md), ocho faroles con
madera/jaula y dos letreros ilustrados. Atlas compartidos 2048/1024, dos canvas 256² sustituyen
los anteriores; cero descargas nuevas. +640 triángulos / 117.840 B de buffers; sin mallas/pasadas/luces
nuevas, mapa/colisiones/fuentes de luz conservados. **127/127** pertinentes, un QA previo y ocho
finales / 36 capturas / 32 cambios finales de calidad GL=0, siete fuentes congeladas `final-v2`.
Catálogo revisión 32, 106 filas / 50 aplicadas, 104 filas anteriores intactas; 53 enlaces exactos
y ambas fichas con 40 imágenes / 98 enlaces sin errores. Arte fino/FPS físicos/publicación pendientes.
Continuado por S19. Prioridades de gameplay intactas.

Ampliación S19: [banco y mobiliario](docs/delivery/town-furniture-v1.md), banco con repisa/tornillo/martillo
y madera ilustrada en mesa/taburete/postes/caja de agujas de Doña Sepia. Reutiliza atlas 2048/1024,
cero descargas nuevas; banco 6 → 2 mallas incluyendo gema y +96 triángulos. Ancla/nodos/crafting
conservados, respaldo sin color intacto. **147/147**, un PC previo y siete finales / 24 capturas /
28 cambios finales de calidad GL=0; nueve fuentes congeladas. Catálogo revisión 33, 108 filas / 52
aplicadas, 106 anteriores intactas; 43 rutas HTTP exactas, fichas 28 imágenes / 76 enlaces sin errores.
Continuado visualmente por S20; plaza/capitanía funcional y kit de obra Salty Shore A0/A1 siguen pendientes.
Arte fino/FPS físicos/publicación y prioridades de gameplay conservan sus gates.

Ampliación S20: [fachada Salty Shore](docs/delivery/town-hall-v1.md), tela roja con ancla/letras,
soportes de madera y mástil en el lateral de una hut existente. Atlas S14 compartidos, canvas 256²,
cero descargas nuevas; +218 triángulos / 28.376 B de buffers / una malla, sin luces nuevas.
Selección render sin mover casa, puerta, mapa, colisiones o Capitana Brea; no interacción nueva.
**152/152**, un PC previo y siete finales / 24 capturas / 28 cambios de calidad GL=0;
25 mallas estáticas intactas y un chunk ampliado. Siete fuentes congeladas; catálogo revisión 34,
109 filas / 53 aplicadas, 108 anteriores intactas; 42 rutas HTTP exactas, ficha 28 imágenes / 76 enlaces.
Sigue kit de obra cosmético con ancla/huella A0 coordinadas; A1 durable, FPS físicos/publicación y demás colas pendientes.

Ampliación S08: [pasto volumétrico](docs/delivery/grass-patches-v1.md), tres formas nativas de hojas
opacas y viento, 522 matas en 184 grupos del seed local. Instancing, dos niveles de geometría y
presupuesto high 600/radio 55, móvil-medium 320/38, low 160/28. **69/69** pertinentes, PC/móvil/low/noassets
y cambios de calidad comprobados; capturas inspeccionadas. Misma vista: +8/+6/+2 llamadas de dibujo,
+918/+464/+108 tri visibles; no certifica FPS físico. Fuentes congeladas y ficha propia en catálogo,
revisión 15 con 83 filas/28 aplicadas. Mantiene las dependencias de gameplay; publicación pendiente.

Ampliación del autor: [huellas al caminar](docs/delivery/sand-footprints-v1.md), alternadas y con
desvanecimiento 18–5 s; banda estática desactivada. **35/35**, caminata/desaparición PC y móvil
emulado revisadas; catálogo revisión 5 con 47 enlaces verificados. Solo efecto visual local.
Preparado
[brief V00](docs/briefs/visual-v00-port-baseline.md); después composición gris V01 y rincón acabado V02.
Ensayos visuales aislados pueden avanzar en paralelo; nueva topología/cubiertas funcionales se integran
con D08/D14/M8. No altera la aceptación ni las dependencias pendientes de D06/D08/D09.

## 4. Cola de assets: progresión comprobable

**Candidato → preparado → conversión verificada (si aplica) → importador revisado → integrado en un consumidor
→ revisado visualmente → aceptado/aplazado → publicado cuando corresponda.** Un PNG suelto no requiere
exportación Unreal. Una miniatura, un `--dry` exitoso o un manifiesto correcto no prueban integración ni rendimiento.

| ID | Candidato y primer uso | Paso concreto / límite |
|---|---|---|
| A00 | Inventario existente | Completado; conservar rutas y confianza, sin deduplicar/borrar fuentes |
| A01 | `Noise00.png` (sA, Survival), ruido de un VFX actual | Aplazado para humo de fogatas: comparación día/noche high y low móvil sin mejora clara frente a procedural por 287 KB/~5,33 MiB. [Resultado](docs/delivery/a01-noise00.md); experimento aislado, sin entrada en manifiesto principal. [Brief](docs/briefs/assets-a01-texture-canary.md) |
| A02 | `SM_StoragePart_03` y `SM_RepairBench` (Dreamrise) | Caja exportada y aceptada localmente por `prop:storage-crate`/`crate`: [resultado](docs/delivery/a02-crate.md), 51,7 KB/204 tri, siete pares visuales/fallback. GPU/dispositivos/publicación pendientes; banco sin exportar, requiere hook propio |
| A03 | SlashTrailElemental/SwordTrail/ArrowTrail | Un efecto y un recurso por prueba; Niagara se recrea, no se ejecuta en Three.js |
| A04 | `SW_Water_Slash_01` u otro sonido corto seleccionado | Audición/exportación pendientes; nuevo puente de audio y publicación. Conservar SFX sintetizado |
| A05 | Piezas para construcción/tierra/naval | No identificado kit completo en C:\Unreal; geometría procedural primero, probar medidas/pivotes/uniones al traer uno |
| A06 | Icono/mercancía/herramienta/arma | Elegir por panel/uso existente; UI/prop propio. Un icono no trae el widget UMG ni gameplay |
| A07 | Impacto de madera/metal, splash/humo | Un evento ya autoritativo y efecto con pooling; diferenciación clara entre daño a nave/personaje |
| A08 | BigNiagaraBundle clima | Después del mar legible; recrear con presupuesto de partículas, aviso y respuesta jugable |
| A09 | Humanoide o enemigo nuevo | Después de caso jugable/rig/peso revisados. Quince huesos procedurales; clips UE no se reproducen hoy |

Para los candidatos `.uasset`, comprobar exportador/versión/dependencias al iniciar la misión. No dar por
disponible una instalación compatible ni por exportable cada archivo. Trabajar en copia/staging dentro del
workspace o temporal; **C:\Unreal permanece de solo lectura**, sin lanzar herramientas que le escriban caches,
configuración o assets. No ejecutar scripts/plugins de proyectos fuente como requisito del inventario.
Importar al juego solo los recursos finales seleccionados, nunca un proyecto, megapack o módulo base completo.

Los originales permanecen en su lugar. Guardar materiales/shaders/exportaciones intermedias y dependencias
de trabajo fuera del bundle final, con rutas explícitas. No añadir al manifiesto assets preparados que todavía
no tienen consumidor: el registro actual precarga sus entradas y aumentan descarga/memoria.

### Evidencia mínima por prueba

- Fuente exacta y hash; si hay conversión, herramienta/versión, configuración, dependencias y hash del resultado.
- Bytes del archivo y resolución/canales de textura; para GLB triángulos, materiales, bounds y pivote/escala.
  El importador solo reporta bytes para PNG: verificar decodificación y dimensiones aparte.
- ID del manifiesto, consumidor real, fallback, capturas antes/después en el mismo escenario/cámara y estado.
- Día/noche y calidad representativa; combate/objetivo/indicadores siguen visibles. Móvil emulado para layout,
  dispositivo real para rendimiento/controles antes de cerrar su aceptación de publicación.
- Descarga, memoria de textura decodificada y draw calls/triángulos; perfil de escena comparable y dispositivo
  identificado. El panel `?debug`/`renderer.info` aporta datos; capturas congeladas no acreditan temporización/FPS.
- Decisión del principal: aceptar, ajustar de forma acotada o aplazar; motivo, limitaciones y entrada siguiente.

Presupuestos iniciales de [ASSETS](docs/ASSETS.md): props apuntan a ≤6.000 triángulos, humanoides ≤20.000,
modelos mayores ≤40.000; preferir texturas 1024. El importador advierte >15 MiB, no lo bloquea: revisar también
coste total por escena/descarga. Estos techos no garantizan rendimiento; medir antes/después y mantener low útil.
La compresión KTX2, clips importados, Niagara y audio no tienen soporte automático por existir en el pack.

### Comandos existentes y herramientas pendientes

Desde raíz del repo, ejemplos que usan un archivo ya preparado; no exportan `.uasset` ni verifican un efecto:

```powershell
node tools/import-asset.mjs 'RUTA_PREPARADA/Noise00.png' --id=tex:a01-noise00 --dry
node tools/import-asset.mjs 'RUTA_PREPARADA/StoragePart_03.glb' --id=prop:storage-crate --props=crate --dry
node tools/import-asset.mjs 'RUTA_PREPARADA/SM_RepairBench.glb' --id=build:repair-bench --kind=model --dry
node tools/import-asset.mjs --check
```

Solo el principal importa al manifiesto compartido después de revisar el recurso. El CLI actual no escribe
`data:true` mediante `--data`: usar ese campo del manifiesto para ruido/máscaras y comprobarlo en el loader.
El importador no prepara audio; A04 requiere carga/reproducción y ajustar `tools/build-artifact.mjs`, que hoy
lista modelos/texturas pero no formatos de audio. Verificar archivos/HTTP reales en el bundle antes de publicar.
Modelos con alpha blend se recortan en el camino toon genérico; humo/fuego suave entra por VFX dedicado.

## 5. Trabajo entre agentes

Máximo disponible: **principal + tres GPT-6 Luna**, cuatro agentes en total. No lanzar una cuarta tarea worker
si ya están ocupados los tres slots. Usar Luna para implementaciones delimitadas, inspección, preparación
de recursos y QA que ahorren trabajo; el principal autoriza contratos de arquitectura/diseño, integra y acepta.

| Rol de una ola | Responsabilidad | Límite |
|---|---|---|
| Principal | Elegir una entrega, fijar contrato y writable paths, integrar datos/eventos/UI, decidir arte, revisar y commit | Dueño de manifiesto, protocolo, entrypoints y documentación compartida salvo delegación exclusiva explícita |
| Luna mecánica | Un sistema/comando/renderer delimitado y sus pruebas pertinentes | No abarcar sim+cliente+arte de varias entregas sin corte; pedir ampliación de archivos al principal |
| Luna recurso/cliente | Preparar un asset o implementar un consumidor/panel en archivos disjuntos | No editar la misma escena/manifest/shared file a la vez que otro worker |
| Luna revisión | Comprobar contratos, estado real, regresiones/evidencia y pendientes | Read-only por defecto; no aceptar cambios sin inspección del principal |

Roles se reasignan por ola; no mantener agentes ociosos ni repetir un inventario que ya existe. Si solo hay dos
trabajos útiles, usar dos workers. Si una tarea necesita todos los archivos de otra, serializar o usar worktrees
aislados y luego integrar secuencialmente. Crear worktree no justifica borrar ni resetear trabajo ajeno.

Antes de empezar, el principal registra dueño y rutas de cada tarea. En checkout compartido, **un solo escritor
por archivo**. Shared files como `src/main.js`, `src/render/scene.js`, `src/net/localServer.js`, protocolo, UI
central, `assets/manifest.json` y `tools/look.mjs` se reservan al principal o a un dueño exclusivo nombrado.
Un worktree desde HEAD no contiene cambios pendientes de otro: no probarlo como si incluyera Tormenta sin
integrar esos cambios. No stagear todo el árbol; commits selectivos por misión aceptada.

Briefs: [plantilla](docs/briefs/delivery-template.md) y [primera prueba A01](docs/briefs/assets-a01-texture-canary.md).
Cada brief fija objetivo, base, lecturas, contratos, archivos propios, entregables, validación, fallback y reporte.
Los workers reportan cambios/pruebas/rutas/limitaciones; no hacen commit, push o despliegue. El principal realiza
una aceptación consolidada por ola. Pruebas dependientes de una integración van después de ella.

Un solo recorrido de navegador/GPU a la vez para evitar capturas/mediciones contaminadas. Los workers pueden
preparar casos/pruebas en paralelo; agrupar regresión al tener la integración estable. Repetirla solo si cambios
o fallos nuevos lo justifican. Para arte reversible no crear tests que solo copien valores de implementación.

## 6. Primera ola preparada para retomar

| Slot | Tarea inmediata | Salida y restricción |
|---|---|---|
| Principal | Identificar/revisar dueño de Tormenta y fijar base de aceptación; preparar consumidor A01 | Preservar edits activos; integración de manifiesto/wiring solo tras liberar archivos |
| Luna 1 | D01 Tormenta, si sigue asignada a su dueño actual | Lógica/cliente y evidencia del brief de milestone; no crear un segundo escritor para los mismos archivos |
| Luna 2 | A01 fase A, según el brief | PNG preparado, decode/hash/dry y propuesta de hook aislado; sin tocar runtime comprobado ni manifiesto |
| Luna 3 | Preparar D02 Tinta o revisar D01 cuando llegue | Lectura/contratos/casos de prueba; implementación después de liberar rutas o en aislamiento comprobado |

Integrar D01 → implementar D02 → integrar A01 si mejora → cerrar D03. A02 puede prepararse después, sin frenar
M4.8 si aún falta exportador. Este documento prepara la ola; no afirma que esas tareas se hayan lanzado o acabado.
La entrega que creó el plan solo hizo documentación; los workers usados para redactar briefs no ejecutaron A01.
Si D01 ya tiene aceptación y commit cuando se retome, registrar ese checkpoint y usar Luna 1 para D02;
no repetir Tormenta. La preparación A01 puede continuar en paralelo con cualquiera de las dos.

## 7. Aceptación, recuperación del trabajo y publicación

Al cerrar una misión: diff acotado, contrato coherente, checks apropiados, recorrido visual si cambia producto,
fallback probado y evidencia. Simulación/red/economía requieren pruebas de autoridad y reintentos relevantes;
no basta un renderer bonito. El principal revisa resultado, registra aceptación y crea commit selectivo.

Al fallar un asset, mantener la versión procedural y registrar motivo; tras una corrección acotada, decidir si
merece otra prueba. No sustituir un problema de rig/coste por incorporar un runtime/engine entero.
Al faltar un dispositivo o herramienta, registrar exactamente lo verificado y mantener esa aceptación pendiente;
avanzar trabajo independiente. Sin GPU real no declarar 60 fps; sin URL comprobada no declarar despliegue.

Checklist de cierre que se registra en HANDOFF:

- ID Dxx/Axx, commit base/final, dueño y qué cambió; estado separado de pendiente/en curso/aceptado/publicado.
- Pruebas y resultados reales, capturas inspeccionadas/medición; limitaciones y riesgo que queda.
- Fuente/derivado final/hook y decisión de asset; actualizar fila de candidato solo con evidencia obtenida.
- Próxima tarea exacta, dependencias y writable paths. Si una decisión sigue abierta, vincularla a la hoja naval.
- Bundle desde lo commiteado con recursos referenciados; publicación y servidor/cliente compatibles son una
  fase separada. Continuar PR #1; un push no es una actualización del servidor ni del artefacto.

Registrar futuros resultados durables en `docs/delivery/`: un informe corto por misión, sin crear documentos
vacíos ahora. Capturas/mediciones grandes pueden vivir en `shots/` ignorado; copiar un resumen durable al informe.
Preparaciones locales `.scratch/`/staging no se stagean ni entran en el bundle; verificar su exclusión antes de
crear copias de proyecto. Actualizar este plan y HANDOFF en el mismo commit de cada checkpoint aceptado.

## 8. Estado de esta entrega de planificación

- Plan unificado y briefs preparados; integración de los nuevos assets todavía pendiente.
- Al redactar, Escarcha era la base commiteada y Tormenta trabajo ajeno/concurrente, sin aceptación aquí.
- Investigación C:\Unreal permanece de solo lectura. No se exportaron/importaron recursos al redactar el plan.
- Próximo paso operativo: primera ola §6, coordinada con el dueño del trabajo activo.

**M5 económico, 2026-10-10 — publicado y verificado:** mercado cotizado, compra de materiales
desde el editor de la balsa, transferencias de carga y aportes usan perfil/mundo/recibo en una
transacción M5; sin montar otra autoridad A1. Meta provisional aprobada: 40 madera + 20 piedra.
SQL014 y permisos verificados en Supabase; alfa público 0.6.0-alpha.17. Diez operaciones reales,
diez replays tras reconexión y diez tras reinicio real, sin segundo débito ni retroceso.
[Contrato](docs/briefs/m5-economic-authority.md) · [Entrega](docs/delivery/m5-economic-authority.md).
No cierra recursos/crafting, todo M5 ni crecimiento automático del edificio.

**Checkpoint GM01 (0.6.0-alpha.18; desplegado y sano):** imagen `marea-negra:alpha-d3159949f9ef`, commit `d3159949f9ef6fbbab51ce7e7a1b928d25f428a0`, activa desde 2026-10-10T16:20:39Z. QA local 100/100 (30 GM) y navegador 13/13 con autenticación simulada; producción 6/6 con Supabase real, cero errores. [Evidencia pública](docs/delivery/gm01/public-evidence.json) confirma la sesión GM permitida, colocación/guardado local y revocación; [evidencia de despliegue](docs/delivery/gm01/deployment-evidence.json). El borrador continúa local en IndexedDB y no existe publicación de mapas. GM00: 14 capturas/2 ángulos con loader real; sin FPS móvil físico ni aceptación gameplay. Sigue GM02 edición existente/walktest y GM03 borradores remotos durables/publicación/rollback; terreno en GM05–GM06.
