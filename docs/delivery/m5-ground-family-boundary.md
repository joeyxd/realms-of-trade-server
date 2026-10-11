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
