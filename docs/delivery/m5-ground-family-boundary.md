# AREA15 — frontera común de familias de suelo

Implementado sobre `a7f9e6dc57ed16a75ba7ba30b7292f09fbbc3cd3`; código opt-in, sin activar el mundo público.
[Contrato](../briefs/m5-ground-family-boundary.md) y [aceptación con hashes](m5-ground-family-boundary/acceptance.json).

`GroundHostAuthority.stageFamily` compone las familias existentes `ground`, `batch`, `death` y `drop`
con el mundo y el reloj actuales. Valida antes de reservar cuentas/UID/botín, prepara SQL019 y usa
SQL018 bajo el cerco SQL023. Una respuesta SQL únicamente prepara el resultado; el único `beforeTick`
aplica el adaptador síncrono y avanza los metadatos de WorldState antes de resolver la promesa.
El cierre no aplica estas familias. Un fallo cerca el host y los perfiles afectados; startup recupera
el sobre exacto y carga filas actuales.

## Verificación local

- **206/206, 34 archivos**, sin fallos, omisiones ni cambios de fuentes durante la corrida.
  La selección incluye regresiones de economía/checkpoints/diario, adopción, taller/Tala, natación,
  purificador, controles de compañeros, admisión GM y supervisor. Se solapa con entregas anteriores.
- Dieciséis casos nuevos: cinco contratos de frontera con RPC en memoria; ocho casos SQL con las
  cuatro familias, reserva/orden/cierre/fallo/replay; dos SIGKILL reales de proceso; una integración
  SQL001–027 con recolección, taller y construcción autenticados sobre recursos v3.
- SIGKILL después de preparar intención: antes de recuperar no hay efecto/recibo y el mundo sigue
  en v1. Después del commit, antes de aplicar: ya existe un recibo/ubicación y mundo v2. Ambos reabren
  PGlite en disco **sin migraciones**, terminan con exactamente un efecto y no invocan aplicaciones
  históricas. Se comprueba ubicación persistida; no se hidrata una entidad de perla en gameplay.
- La compatibilidad actual conserva mochila, progreso de taller e ID de balsa. El fixture histórico
  SQL001–021 ahora declara `starter:false`, pues `newProfile()` pasó a crear la mochila del taller;
  conserva la prueba legacy y evita mezclar contratos de distintas migraciones.

La base final `6c42e84` incorpora plantillas GM04b, ajuste del HUD portrait y el cálculo de Carga
sin montar. Los archivos existentes de servidor, simulación, protocolo, supervisor y los 34 tests
anteriores permanecen idénticos. La integración focal adicional pasó **58/58 en diez archivos**, con fuentes congeladas, y se registra en
[manifest](m5-ground-family-boundary/final-integration.json) y [TAP](m5-ground-family-boundary/final-integration.tap);
sus selecciones se solapan con las 206 anteriores. La aceptación visual de GM/HUD pertenece a
sus propias entregas; este corte no la sustituye ni activa Carga.

## SQL y mundo público

[Lectura previa](m5-ground-family-boundary/preflight-domain.json): SQL023 devuelve readiness v1,
recursos v3; no hay reloj común ni filas de suelo/perlas/botín/intenciones de las familias consultadas.
No se ejecutó adopción, migración, mutación de gameplay autenticada ni cambio de flags en este corte.
No requiere SQL adicional.

## Publicación verificada

Código [`e4c5f0d`](https://github.com/joeyxd/realms-of-trade-server/commit/e4c5f0da669cbc2dc3cced850dad158e8a8ac1cc) activo en
**alpha.41/protocolo 47**, revisión e imagen comprobadas después del cambio. Salud pública correcta,
una autoridad (el supervisor rechaza más de un contenedor), temporizador activo y cero errores de
simulación/almacenamiento. [Estado](m5-ground-family-boundary/live-status.json).

- **109/109** del actualizador en la imagen exacta antes de sustituir la autoridad:
  [comprobación](m5-ground-family-boundary/updater-validation.json).
- **13/13** focales en la misma imagen, contenedor aislado sin red ni credenciales vivas:
  [resultado/hash runtime](m5-ground-family-boundary/image-tests.json). Cinco contratos nuevos de
  frontera y ocho previos del host, con fixtures en memoria; no son prueba SQL durable.
- **6/6** de salud, identidad GM y entrada ordinaria WSS con WELCOME/SNAPSHOT/PROFILE:
  [evidencia](m5-ground-family-boundary/public-smoke.json). No hay acción durable autenticada.
- [Lectura final SQL de solo consulta](m5-ground-family-boundary/final-domain.json),
  2026-10-11T03:28:27.809222+00:00: SQL023 readiness v1, recursos v3, cero filas de las familias
  consultadas y ausencia de reloj común. La instalación de SQL023 está confirmada; adoptar/activar
  sigue pendiente del ensamblaje autónomo.

[Comparación de fuentes](m5-ground-family-boundary/published-source-check.json) conserva código y
assertions: la publicación Git normaliza finales Windows CRLF a LF. La comprobación de imagen usa
el SHA256 de los bytes Git, y los manifiestos locales conservan sus hashes originales.

El trabajo de código permanece en `C:\DEV\real of trade\area15-resource-live`, rama
`codex/area15-resource-live`; el checkout IDE concurrente recibe solamente este checkpoint,
contrato y evidencias. No se copia runtime, pruebas, entorno ni migraciones sobre sus cambios.

## Integración concurrente posterior

La rama incorpora después el centro privado de inferencia alpha.42/protocolo 48. Se revisaron
las adiciones de host/store/index: servicio y mensajes privados, sin reemplazar `beforeTick`,
escritor del mundo ni la frontera de familias. **83/83 en doce archivos**, con fuentes congeladas:
host/store/economía, taller actual SQL001–027 e inferencia SQL028, cliente/UI/red/store.
[Manifest](m5-ground-family-boundary/concurrent-integration.json),
[TAP](m5-ground-family-boundary/concurrent-integration.tap). Se solapan con los conteos previos.

El módulo de familias es idéntico byte a byte en Git al aceptado en `e4c5f0d`.
[Lectura VPS posterior](m5-ground-family-boundary/current-source-status.json) vuelve a comprobar
su hash, revisión/imagen activa, salud pública y montaje apagado. La publicación/aceptación
alpha.41 anterior mantiene su revisión exacta; esta integración local no declara publicada
alpha.42 ni acepta su entrada pública. SQL028 pertenece a la entrega independiente de inferencia;
este corte de continuidad no añade ni ejecuta SQL.

## Límites y siguiente corte

Esta entrada de ensamblaje no conecta todavía los coordinadores autónomos, sus selectores ni su
hidratación. El adaptador de aplicación sigue a cargo de elegibilidad, geometría, perfil/ECS y
metadatos de ProfileSessions. Debe revertir sus cambios si falla; la frontera cerca el host, pero
no reconstruye arbitrariamente sus efectos. No hay ACK durable de estas familias en el VPS.

Sigue conservar el orden de los coordinadores actuales, sus reservas y adaptadores bajo el único
dueño, incluyendo muerte por ahogamiento; después transición detenida/adopción y canario autenticado
con caída/reinicio VPS. Producción autónoma del purificador, XP/misiones, custodia offline y backups
mantienen sus propias ventanas pendientes. No acredita pérdida de energía/disco, concurrencia entre
backends PostgreSQL, un lease entre procesos ni permanencia completa del juego.

Reutilización: GameHost, los DTO/coordinadores M5 existentes y SQL018/019/023. Verificación física de
`BP_JigServerSave.uasset` (580554 bytes) y decisión de no portar el Blueprint en el contrato; fuentes
Unreal intactas, sin cambios de arte o UI.
