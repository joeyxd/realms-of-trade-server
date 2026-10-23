# SQL 006 — commit same-holder y recuperación aceptados en Supabase

2026-10-06. Base `532691a`; migración 006 ya aplicada por el autor. **21/21 comprobaciones reales**
con SDK/Supabase y ProfileSessions en **cuatro procesos Node independientes**, sin fallos.
[Evidencia estructurada](d09f-same-holder-live-evidence.json),
[contrato y reutilización](../briefs/m5-pearl-same-holder-live.md).

## Resultado

- Bag→swallowed vacío confirma un solo perfil CAS, ledger y ubicación a la vez. Conserva dueño,
  `since`, oro/XP/equipo y orden de las otras perlas. Perfil/UID/tombstone avanzan una sola generación;
  los otros UIDs siguen en la suya. Recibo ground exacto, sin hijo 003 para swallow.
- Aceptados tanto UID con tombstone previo como UID gestionado 003 sin ubicación previa. No se adopta
  un objeto desconocido: los cuatro UIDs fueron registrados por operaciones 003/004 antes de la prueba.
- Oro indebido, CAS de perfil antiguo o generación UID incorrecta, mundo/kind incorrecto y reordenar la mochila: rechazados.
  Estado completo de ambos perfiles, cuatro ledgers/ubicaciones y recibos permanece intacto; el fallo
  tardío de mundo revierte también las escrituras provisionales de la transacción.
- Replay exacto devuelve el recibo original sin segundo efecto; UUID con otro payload se rechaza.
  Después de guardar XP nuevo, repetir el recibo histórico conserva ese progreso y versiones actuales.
- Otro proceso recupera el commit pendiente de cierre del diario **sin enviar RPC de mutación**.
  El segundo request preparado/unsent conserva una cuenta reservada; reanudar explícitamente manda
  exactamente su payload/UUID una vez, sin builder nuevo. Un tercer proceso abre los perfiles actuales
  sin dispatch. Journals terminales idempotentes; no se pueden reabrir como rejected.
- El cliente público recibe 42501 al intentar `mn_commit_pearl_ground`; estado fixture intacto.

## Fixture y limpieza

Scope: `canary-swallow-187a3c31-18ed-4bb4-b21a-789319469ae9`.
Dos perfiles sintéticos, cuatro UIDs derivados del token y operaciones UUID enumeradas. Su ausencia
se comprobó antes de cualquier escritura. No usuarios Auth, jugadores existentes, mundo o host.
Las lecturas de tablas se limitaron a los IDs de la fixture y el diario a su scope aislado.

El cuarto proceso eliminó los recibos, ledger/ubicaciones y perfiles sintéticos tras verificar estado
settled; ausencia confirmada. **Dos filas committed del diario se retienen como auditoría inmutable**.
Manifest y log locales en `.scratch/m5-swallow-live-*.json` y
`shots/review/m5-swallow-live-canary.{json,log}` (ignorados). Ninguna credencial en salida/evidencia.

Runner reproducible: `node tools/verify-pearl-same-holder.mjs --live`. Sin ese opt-in termina antes
de leer `.env` o usar red. Errores acotados por categoría/código, sin cuerpos/mensajes/stderr del proveedor.
Revisión Luna de solo lectura contrastada por el principal; 21 fuentes de runtime/SQL coincidentes
con HEAD antes y después. Sin cambio de migraciones, `.env`, sim, cliente, protocolo o host.

## Límites y siguiente

Esto cierra la aceptación live de almacenamiento same-holder 006, ampliando las
[6/6 probes previas de validadores](d09f-sql006-readonly.md). Las **356/356** de staging/ECS anteriores
siguen siendo pruebas locales aisladas. Los procesos nuevos son de ProfileSessions; no se reinició
GameHost ni se aceptaron hooks de juego, navegador, concurrencia multi-host/leases o publicación.

La [afinidad permanente por personaje/tipo](../briefs/m48-pearl-affinity.md) está confirmada,
pero aún falta su implementación/crédito/escalado/UI. Este canario conserva XP ordinario; no prueba
afinidad. Continúan lotes atómicos de varios UIDs para muerte/reemplazo, efecto común con sim,
hooks completos y restauración/scope/reloj/adopción antes de activar circulación durable. M5 P4/P6
siguen parciales. Trabajo naval concurrente conservado; sin reinicio ni despliegue de la demo.
