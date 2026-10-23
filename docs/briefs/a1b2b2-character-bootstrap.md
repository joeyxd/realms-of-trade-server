# A1b2b2 — creación inicial del personaje por mundo

2026-10-09. Complementa el vínculo y la admisión A1b2b1 que avanzan en el checkout compartido.

## Resultado acotado

Crear el personaje inicial y su vínculo inmutable con una cuenta en **una transacción**, sin adoptar
una mochila del navegador ni reiniciar una existente. Reutilizar el contrato y la tabla de vínculos
comunitarios 003; añadir los RPC de creación/consulta en la migración opcional comunitaria 004.
Mantener guardados y aportes sobre la misma fila comunitaria existente.

Un vínculo por cuenta/mundo/época es la cardinalidad del circuito actual. No añade un selector de
personajes, cambios de propietario o un procedimiento de wipe. La época es configuración del
servidor, no un claim del jugador.

## Contrato y recuperación

- `loadIdentity({accountId,worldId,worldEpoch})` devuelve vínculo y **fila actual**, o `null`.
- `allocateIdentity({binding,data})` valida un perfil de revisión inicial 1. Si la cuenta ya tiene
  vínculo, devuelve su personaje actual aunque el candidato sea distinto; nunca sobrescribe con
  el perfil inicial. Un candidato ya existente, incluso sin propietario, se rechaza como `occupied`.
- Cuenta y personaje se bloquean en el mismo orden/namespaces que comunitaria 003; creación usa
  además el lock de personaje de guardados/aportes. Personaje y vínculo se insertan juntos.
- `CharacterProvisioning` obtiene una referencia autenticada congelada exclusivamente de un
  resolver confiable. Crea un perfil nuevo del servidor; el UUID proviene de `node:crypto` o de una
  fábrica confiable de fixture. No recibe token, perfil, cuenta, mundo o personaje del protocolo.
- Mientras la operación está en vuelo reserva la cuenta dentro de este controlador. Una respuesta
  perdida conserva la reserva; recuperación consulta primero. Si falta evidencia, permanece
  pendiente. Reintento explícito conserva el request original. Cierre o reemplazo de la referencia
  autenticada impide devolver el resultado como éxito a la conexión antigua.
- Este controlador solo prepara identidad: **no abre ni publica un cuerpo, ni autoriza mutaciones**.
  La admisión preexistente `BoundProfileSessions` sigue siendo quien administra esas sesiones.

## Límites

No montar en GameHost ni junto al perfil M5 para la misma mochila. A1b2 permanece parcial hasta
cerrar una sola autoridad de perfil, las mutaciones/capturas de gameplay, perlas/muerte, recuperación
de intenciones y publicación ECS. No crear leases, importar perfiles M5, aplicar SQL live, leer
`.env`, cambiar protocolo, terreno, costes o arte. No confundir estas reservas de creación con una
exclusividad de gameplay entre procesos.

## Verificación y reutilización

Probar con memoria y SDK Supabase contra PostgreSQL local: colisiones, mundo/época separados,
perfil actual tras guardar/aportar, rollback del vínculo sin personaje huérfano, respuesta perdida,
cierre/cambio de identidad, reintento exacto y reapertura limpia de disco. Conservar la regresión
comunitaria y verificar ACLs/aislamiento de los RPC opcionales.

Inventario Survival revisado y archivos fuente confirmados: `SM_RepairBench.uasset` (101.896 B)
y `SM_StoragePart_03.uasset` (24.248 B) son candidatos visuales para el taller/recepción; no aportan
un contrato de identidad PostgreSQL/web. Se reutilizan validadores, tabla de vínculos, lock/CAS,
sesiones y perfil inicial del repositorio. No requiere exportaciones ni assets nuevos; Unreal intacto.
