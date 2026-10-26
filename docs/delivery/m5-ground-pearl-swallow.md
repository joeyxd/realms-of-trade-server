# AREA15 — swallow bajo el dueño común

Corte del 2026-10-13, base `a19f5e15ac6b50a858ef76c1f66bbe0bfb68adff`.
[Contrato previo](../briefs/m5-ground-pearl-swallow.md), continuación de
[give](m5-ground-pearl-give.md) y de la [matriz](../CONTINUITY-MATRIX.md).

Una cuenta autenticada puede pasar su perla de bolsa a la ranura tragada vacía
mediante el recibo común. Sigue ligada hasta morir. Reemplazo, escupir y dar/soltar
el UID tragado continúan denegados. No cambia la afinidad ni el balance.

## Implementación

[Planner](../../server/groundPearlSwallow.mjs) ejecuta `swallowPearl` sobre perfil
y ECS separados. Usa el efecto actual para los cuatro poderes y conserva la
fracción de HP, equipo, maestría y cooldown mayor ya existente. El
[lifecycle](../../server/groundPearlLifecycle.mjs) admite solamente el selector
de UID; deriva sesión, cuenta, kind y generación del servidor.

Antes del primer await reserva la cuenta y todos sus UIDs. Asienta el progreso
ECS y los autosaves anteriores dentro de esa reserva; lee UID/ubicación actuales
y construye un CAS de perfil `from=to=cuenta`, `ground:null`. SQL006/018/019
confirman perfil, generación, tombstone, mundo/reloj y recibo exacto juntos.
No crea otro writer, SQL, flag o protocolo.

La promesa de almacenamiento no cambia bolsa, poder, inputs ni eventos vivos.
Apply síncrono comprueba baseline completo y dueño, aplica perfil/ECS/sesión
juntos y publica un `pearlChanged(swallow)` con el elemento resultante.
`preparePearlInputs` limpia acciones ya recibidas y buffers; conserva movimiento
y secuencia. Un input posterior sigue siendo una orden nueva.

Fallo de apply restaura su proyección local y cerca el host. SQL confirmado
permanece como autoridad; desconexión, muerte, reciclaje, cierre o cambio de
callback impiden aplicarlo a otra identidad. Recuperación usa el mismo UUID y
request, carga filas actuales y deriva el poder al reingresar, sin callback ni
eventos históricos.

## Evidencia local

Las fuentes de cada cohorte se registran por SHA256; no se suman los conteos
solapados. Resultados finales se registran en los JSON/TAP de
[este directorio](m5-ground-pearl-swallow/).

- Aceptación: 45/45 en cuatro archivos, incluidas dos pruebas SIGKILL.
  [Manifest](m5-ground-pearl-swallow/acceptance.json), [TAP](m5-ground-pearl-swallow/acceptance.tap).
- Regresión pertinente: 266/267 en 24 archivos: give/leave/mint,
  pickup/retorno/muerte, dueño y SQL común, efectos/input/staging anteriores,
  construcción/fuego y exclusiones GM/compañeros/antorchas.
  [Manifest](m5-ground-pearl-swallow/regression.json), [TAP](m5-ground-pearl-swallow/regression.tap).
  El único fallo es el test anterior de leave que enviaba un swallow válido y esperaba
  que siguiera deshabilitado. Ahora envía `replaceUid`, que permanece prohibido.
  Seguimiento focal: 13/13 en dos archivos;
  [manifest](m5-ground-pearl-swallow/regression-followup.json), [TAP](m5-ground-pearl-swallow/regression-followup.tap),
  [diferencia de fuentes](m5-ground-pearl-swallow/followup-scope.json).
  Solo cambió ese test; runtime idéntico a la cohorte. No se reetiqueta 267/267 ni se repite la cohorte completa.

Los SIGKILL ocurren después de preparar journal y después del commit SQL antes
de apply. PGlite en disco se abre en un proceso nuevo **sin ejecutar migraciones**.
Se comprueban UUID/request exactos, diario committed, un recibo de swallow,
un holder/copia y generación posterior, un perfil CAS, tombstone y mundo/reloj
coherentes. Reentrada autenticada recupera Escarcha; cuatro comandos sobre el
UID ligado no crean nuevos recibos. No se repiten callbacks ni eventos.

La primera cohorte de desarrollo obtuvo 44/45; su manifest identifica fuentes
cambiantes durante la revisión y no es aceptación. El único fallo esperaba que
el host cercado no añadiera eventos: su cierre correcto añade despawn de las
tres sesiones. Se corrigió la expectativa para exigir esos despawns exactos,
perfil/ECS/inputs restaurados y ausencia de publicación swallow. No se cambió
runtime por ese fallo. Se conserva [JSON](m5-ground-pearl-swallow/fixture-review.json)
y [TAP](m5-ground-pearl-swallow/fixture-review.tap); la aceptación final usa fuentes congeladas.

## Publicación y límites

Lectura posterior `5ad1029`, alpha.68/protocolo 61, también publicada:
actualizador 197/197, imagen exacta 38/38 en tres archivos
de swallow/ruta/dueño con 27 hashes contrastados; entrada pública 6/6 y cero errores/pendientes.
[Imagen posterior](m5-ground-pearl-swallow/latest-exact-image-tests.json),
[actualizador posterior](m5-ground-pearl-swallow/latest-updater-validation.json),
[estado posterior](m5-ground-pearl-swallow/latest-status.json),
[dominio posterior](m5-ground-pearl-swallow/latest-domain.json),
[entrada posterior](m5-ground-pearl-swallow/latest-public-smoke.json).
Montajes comunes nulos; presencia del compañero apagada. El código nuevo conservó
swallow; estas lecturas no activan ni aceptan el canario de presencia/SQL039.

Código publicado en `46902fe7942c766e8a452fe606e711c6214725f5`, alpha.67/protocolo 60.
El actualizador confirmó 197/197; pruebas en la imagen exacta
100/100, aisladas sin red/credenciales, y 27 hashes de módulos/SQL
iguales a Git. Entrada pública ordinaria 6/6. Supabase/cuentas activos,
imagen saludable, cero errores/guardados pendientes; montajes comunes nulos.
[Imagen](m5-ground-pearl-swallow/exact-image-tests.json),
[actualizador](m5-ground-pearl-swallow/updater-validation.json),
[entrada](m5-ground-pearl-swallow/public-smoke.json),
[estado final](m5-ground-pearl-swallow/final-status.json),
[dominio SQL](m5-ground-pearl-swallow/final-domain.json).
Las lecturas estado/dominio llevan tiempos separados; no constituyen un snapshot SQL conjunto.
Los merges concurrentes de documentación/modelos y región inicial conservaron
las 1.193 fuentes runtime/tests/SQL de la cohorte final sin cambios.
Las pruebas de imagen usan memoria; SIGKILL y SQL real de fixture se acreditan localmente arriba.

La primera selección de pruebas de imagen dio 100/101: el archivo de inputs
importaba estáticamente el helper SQL/PGlite, ausente en la imagen de producción
sin dependencias de desarrollo. [Intento conservado](m5-ground-pearl-swallow/image-fixture-selection.json).
La selección corregida obtuvo 100/100 en diez archivos, sobre la misma imagen;
los inputs se verifican en el planner de swallow y en la cohorte SQL local.
No se instaló PGlite en producción ni se cambió runtime para esa corrección.

Integración posterior `a21c47f` de provisiones/rotación móvil conservada: cambios
de presentación y tests, sin delta en `server`, `src/sim`, `src/net` o `src/data`
respecto a `46902fe`. Compatibilidad de presentación Carga/comidas y reglas de
comidas: 9/9 en dos archivos. La evidencia de publicación de swallow anterior
se mantiene fijada a `46902fe`, sin atribuirle las capturas o activación de ese
otro corte. [Fuentes antes de esa integración](m5-ground-pearl-swallow/post-merge-sources.json).

Integración posterior L03g de `5ad1029` (alpha.68/protocolo 61):
[78/78 en ocho archivos](m5-ground-pearl-swallow/presence-integration.json),
[TAP](m5-ground-pearl-swallow/presence-integration.tap), con las cuatro pruebas
de swallow/ruta/proceso repetidas y los contratos store/SQL/política/red de presencia.
[Guard de composición 9/9](m5-ground-pearl-swallow/presence-boundary.json)
en un archivo: Ground válido conserva presencia apagada y rechaza pairing/presencia
simultáneos. Fuentes congeladas, sin sumar cohortes. No monta ambas autoridades
ni acredita la composición pública: SQL039 y presencia son el corte independiente
de [L03g](l03g-companion-presence/README.md). Sus marcas de cuerpo residente no
añaden campos a la propiedad/perfil de la perla; el guard debe mantenerse hasta
componer ingreso, retirada, vida/pose y recuperación con el dueño común.

El piloto común público continúa apagado. Esta entrega publica código del
montaje explícito; no acredita swallow público con recibo, adopción del mundo,
SIGKILL en VPS, pérdida de energía/disco ni leases entre procesos. La entrada
ordinaria comprueba el alfa existente, sin acciones durables o GM.

Sigue el candidato completo kill/cofre: recompensa, oro/equipo, XP/misiones y
cursor RNG desde antes de preparar la intención durable. Después, componer
recursos/puntero GM, compañeros/control/presupuesto, bots y antorchas/resina/coco
antes de la adopción detenida y el canario público. Las exclusiones existentes
permanecen; este corte no aplica SQL ni habilita flags opcionales.
