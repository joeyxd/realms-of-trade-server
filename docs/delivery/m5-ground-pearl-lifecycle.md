# AREA15 — perlas recuperadas bajo el único dueño de tick

Corte acotado de arranque, recogida y devolución de perlas actuales. Implementación `e002341`,
pruebas de host/proceso `11102f2`, corrección Carga `72f3a47` y guards `8698921`, base final
`4edbf30` con INV02b e inferencia concurrentes.
[Contrato](../briefs/m5-ground-pearl-lifecycle.md). No añade SQL, flag público ni protocolo.

## Comportamiento implementado

`GameHost.mountGroundPearls()` es un montaje explícito de confianza antes de `prepare()`, con
mundo ya adoptado, cuentas y cero bots. Recupera SQL019 y mundo/reloj antes de leer las filas
actuales de perlas y botín. Instala una sola vez en frontera síncrona detenida, proyectando
plazos desde el reloj durable a tick local cero. Conserva la pausa offline. No restaura
snapshots históricos ni reenvía eventos de gameplay. Si hay botín ordinario, rechaza el arranque
antes de instalar filas: su dueño común aún falta.

Los selectores de proximidad/expiración preparan `ground` con versión actual, bajo
GroundHostAuthority y su único `beforeTick`. Perfil, ubicación, mundo, reloj y recibo se
confirman juntos. El adaptador de recogida actualiza perfil, ledger y versión/confirmed/last
de ProfileSessions en el mismo drain; la devolución conserva UID y prepara la nueva ubicación.
Los adaptadores validan baseline y revierten sus propias escrituras tentativas ante fallo.
Desconexión/cierre ambiguo cercan el host; el arranque posterior consulta el estado confirmado.

## Compatibilidad encontrada y corregida

La primera suite amplia detectó dos rechazos de progreso válido en el coordinador anterior de
perlas: al capturar un nivel mayor, `syncProfile` recalculaba capacidad/peso, pero la comparación
solo permitía cuatro campos escalares. También faltaba aplicar/revertir los límites derivados.
Se corrige esa frontera sin permitir cambios de mochila, atributos o bienes: solo acepta los
límites calculados para el nivel capturado y los aplica/restaura en el mismo objeto pack.

[Ensayo previo](m5-ground-pearl-lifecycle/before-carry-fix.json) y
[TAP con los dos fallos](m5-ground-pearl-lifecycle/before-carry-fix.tap) se conservan como diagnóstico,
no como aceptación. La ampliación encontró también una fixture de swallow que cambiaba el nivel
sin actualizar el peso derivado; [ensayo](m5-ground-pearl-lifecycle/before-fixture-fix.json) y
[TAP](m5-ground-pearl-lifecycle/before-fixture-fix.tap) conservan el diagnóstico. Se corrigió la
fixture para usar un perfil canónico, sin relajar el servidor. La suite final incluye captura,
IO, staging, swallow y leave, además de pruebas con capturas falsas canónicas y rollback de
capacidad tras un save fallido.

Al integrar RNV07 alpha.44/protocolo 50 se encontró otra carrera: el inicio de llenado podía
continuar después de una lectura de recibo, aunque otra autoridad hubiera reservado el mundo
o la cuenta durante la espera. `607e489` vuelve a comprobar la disponibilidad justo antes de
iniciar la recolección. La regresión autenticada retiene esa lectura, toma la reserva real y
verifica respuesta `busy`, cero recolección/eventos/perfil/escrituras; tras liberarla, el mismo
comando puede completarse. Los contenedores de agua conservan el saneado y los límites de Carga.

## Evidencia local

**594/594 en 58 archivos**, cero fallos/omisiones y fuentes congeladas antes/después:
[manifest](m5-ground-pearl-lifecycle/acceptance.json), [TAP](m5-ground-pearl-lifecycle/acceptance.tap).
Los conteos incluyen regresiones existentes y se solapan con informes anteriores.

Después de integrar RNV07 y la evidencia de activación INV02b, **226/226 en 25 archivos**, cero
fallos/omisiones, fuentes congeladas, base `95595b0` alpha.44/protocolo 50:
[manifest de integración](m5-ground-pearl-lifecycle/concurrent-integration.json) y
[TAP](m5-ground-pearl-lifecycle/concurrent-integration.tap). Incluye la regresión de llenado
autenticado frente a la reserva real y repite host/SQL/proceso de perlas, autoridad común,
atributos, economía, carga, contenedores y purificador. Los conteos se solapan con la base de 594.
El [ensayo anterior sin congelación](m5-ground-pearl-lifecycle/concurrent-integration-unfrozen.json)
pasó 225 aserciones mientras se añadía esa regresión; no se acepta porque cambiaron fuentes.
Su [TAP](m5-ground-pearl-lifecycle/concurrent-integration-unfrozen.tap) conserva el diagnóstico.

La entrega GM05 concurrente quedó integrada en `52665ea`, alpha.45/protocolo 51:
**246/246 en 29 archivos**, cero fallos/omisiones y fuentes congeladas,
[manifest](m5-ground-pearl-lifecycle/terrain-integration.json) y
[TAP](m5-ground-pearl-lifecycle/terrain-integration.tap). Repite la selección anterior y añade
autoridad de terreno, contenido activo, obstáculos y proyección. Confirma la protección de
huellas de perlas persistidas; no habilita la activación GM con el piloto montado. Conteos solapados.

- 7 pruebas nuevas de hidratación, 7 del adaptador pickup y 4 de devolución: selección,
  elegibilidad, ownership, identidad de fuentes, CAS de sesión y rollback de pickup inyectado.
- 10 de host con SQL real local: arranque y pausa offline, rechazo de botín antes de instalar,
  recogida autenticada retenida hasta drain, bolsa llena/distancia/disponibilidad, devolución
  automática, reapertura y recogida con versión nueva, checkpoint, desconexión y cierre.
  La recogida conserva nivel 3, Carga 2, mochila de 18 y peso máximo 60 en perfil SQL.
- 2 SIGKILL reales del proceso sobre PGlite en disco: después de preparar la intención y después
  del commit SQL, antes de aplicar. Reabre sin repetir migraciones, resuelve el diario común y
  carga filas actuales: perla en un solo dueño, cero suelo duplicado y cero eventos históricos,
  mundo v10/reloj 501. Son caídas locales de **pickup**; no hay SIGKILL integrado de devolución.
- Regresión del dueño común/familias, adopción SQL023, checkpoints, coordinadores anteriores,
  muerte/ahogamiento, SQL001–029 con recursos v3/taller/balsa/atributos, GM, agentes e inferencia.

[Preflight VPS](m5-ground-pearl-lifecycle/preflight-status.json) y
[dominio SQL](m5-ground-pearl-lifecycle/preflight-domain.json) son lecturas sin mutación:
SQL023 readiness 1, recursos v3, cero filas consultadas y mundo público sin reloj común.
La verificación de publicación de este corte se registra por separado al terminar el actualizador.

## Límites y continuación

El montaje público permanece apagado. Falta integrar captura completa de muerte, consumo y
expiración del botín ordinario, mint de loot nuevo y comandos give/swallow/leave/batch al mismo
dueño. Después corresponde transición detenida con exclusión del actualizador/escritor anterior,
adopción explícita y canario autenticado de caída/reinicio VPS. No se ejecutó SQL ni adopción en
el dominio real y no se mató su proceso para este corte.

El piloto conserva otra exclusión existente: `beginContentSwitch()` rechaza activaciones GM
mientras `groundPearls` está montado, incluso inactivo. GM05 protege las huellas persistidas
frente a cambios de altura, pero la combinación de activación GM y piloto montado no se habilita
en este corte. Debe componerse y probarse antes de permitir ese cambio de geometría en caliente.

No acredita cada cambio permanente, pérdida eléctrica/disco, concurrencia entre backends,
lease entre procesos, custodia offline, XP/misiones, producción autónoma ni backups/restauración.
La devolución tiene commit/aplicación/reinicio de host; su caída específica sigue pendiente.

Reutiliza GameHost, contratos M5, SQL018/019/023, hidratación y helpers actuales. El candidato
Unreal `BP_JigServerSave.uasset` se verificó físicamente (580554 bytes); el Blueprint no ejecuta
en Node/PostgreSQL. No se modifica la fuente Unreal ni se añade arte/UI.

Trabajo y validación en `C:\DEV\real of trade\area15-resource-live`; el checkout IDE concurrente
recibe solamente checkpoint/brief/evidencia, conservando runtime, migraciones, entorno y trabajo ajeno.
