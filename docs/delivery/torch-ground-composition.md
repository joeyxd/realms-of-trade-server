# AREA15 — antorchas, resina y coco componen con el recibo común Ground

Primer corte del paso 3 de la [matriz de continuidad](../CONTINUITY-MATRIX.md). Ticket T-1020-05, sobre
la base `710763b` (alpha.77, protocolo 62). Sin SQL, flag, dependencia, protocolo ni versión nuevos.

## Resultado

El guard `groundTransactions !== null` de `torchResinCoconutOperations` (`server/host.mjs`) se quitó.
Los prerrequisitos propios de antorcha (workshop, fuego y cantimplora) se conservan. Ground sigue siendo
opt-in por opción del host; no hay variable de entorno nueva. Sin Ground el comportamiento no cambia.

La antorcha no tiene operaciones propias: son tres sabores de comandos de la familia económica, y todos
se confirman por `economicAuthority` → `groundAuthority.commitEconomic` (recibo externo SQL018/019 con el
recibo interno SQL014 anidado) y se aplican en el borde de tick. SQL037 sustituye validadores por nombre y
SQL018 los llama por nombre, de modo que no hace falta migración.

| sabor | comando | evidencia |
|---|---|---|
| A. cargar antorcha | `fire/load` `kind:'handTorch'` `rules:2` | coste 2 tronco + 1 resina aplicado una vez; una fila externa y una interna; reenvío con el mismo `opId` es réplica sin segundo cobro |
| B. extras de tala | `resource/gather` `lootRules:1`, golpe final de palmera con beneficiarios | botín igual a `harvestLoot(kind, node.id, finalRev)` en la bolsa del actor; nodo `rev 4`, `hits 3`; el contribuyente recibe práctica y no botín |
| C. comer coco | `freshwater/eat` `source:'coco'` | coco −1; hidratación +25 (60 → 85) y tope en 100 (85 → 100); saciedad intacta; réplica sin segundo consumo |
| D. recuperación | B detenido tras el commit y antes del apply | un host nuevo sobre el mismo PGlite/diario recupera el botín exactamente una vez (sin nuevo sorteo), el reenvío con el mismo `opId` responde `replay` sin cambios y siguen 1 fila externa + 1 interna |

El caso D usa el hueco de la regla de la matriz «tras commit, antes de apply»: se avanza el host hasta
que el commit está listo y no se da el siguiente paso; se comprueba que el perfil vivo aún no tiene botín
mientras SQL ya lo tiene, se cierra ese host y se arranca otro sobre la misma base.

## Archivos

- `server/host.mjs`: solo la cláusula del guard de antorcha.
- `tests/torch-ground-host.test.mjs` (nuevo): A–D con SQL real 001–037 en PGlite sobre el fixture
  `tests/helpers/ground-host-authority-sql.mjs`; aplica 022–037 en orden tras el fixture base y sustituye
  las sondas de readiness posteriores a SQL021 por las funciones SQL reales.
- `tests/ground-host-authority.test.mjs`: un caso nuevo (antorcha compone con Ground y conserva sus
  prerrequisitos). No se debilitó ningún caso.
- `docs/CONTINUITY-MATRIX.md`: cabecera y línea del paso 3 de antorchas.

## Evidencia (checkout `area15-resource-live`, base `710763b`)

Línea base antes de editar, sin el archivo nuevo, 7 archivos del conjunto dirigido: 36 pruebas, 36 pasan, 0 fallan.

```
env -C "C:/DEV/real of trade/area15-resource-live" node --test --test-concurrency=1 \
  tests/torch-ground-host.test.mjs tests/torch-resin-coconut-host.test.mjs tests/torch-resin-coconut-sql.test.mjs \
  tests/fire-ground-host.test.mjs tests/ground-host-authority.test.mjs tests/ground-host-authority-sql.test.mjs \
  tests/ground-workshop-compatibility.test.mjs tests/ground-family-host.test.mjs
```

Resultado final del conjunto dirigido: 41 pruebas, 41 pasan, 0 fallan (36 de la línea base + 4 nuevas A–D + 1 caso de configuración). Archivo nuevo solo: 4/4. Puerta del actualizador (29 archivos de `deploy/vps-update.py` TESTS): 202 pruebas, 202 pasan, 0 fallan.

## Pendiente

Sigue excluido de Ground lo que la matriz ya nombra (emparejamiento, presencia, agentes, recursos GM).
Los tests nuevos no están en la selección del actualizador: es decisión del operador.
