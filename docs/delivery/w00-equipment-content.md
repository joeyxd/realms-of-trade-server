# W00a-equipo — apariencias y piezas funcionales

Fecha: 2026-10-07. **Ambas modalidades elegidas por el autor; contrato interno implementado y probado
localmente. Uso jugable, tokens, mercado y pagos pendientes.**
[Reglas/brief](../briefs/w00-equipment-rules.md), [plan](../../PLAN-WEB3.md),
[evidencia](w00-equipment-content-evidence.json).

## Resultado y reglas

El equipo premium incluye apariencias coleccionables y piezas funcionales comerciables. El contrato
separa lo que contiene cada modalidad: una apariencia identifica diseño/base compatible y aporta cero
stats; una pieza funcional conserva base, nivel, rareza y afijos y calcula los mismos `itemStats` del
equipo ordinario. Revender conserva la definición y su hash, sin volver a generar atributos.

No se conceden niveles, maestría ni XP por una transferencia del registro. La apariencia no entrega el
arma ni tiene campos para atributos, afijos o efectos mecánicos. Mantener hitbox/colisión/legibilidad es
una regla de aceptación del futuro arte; este corte no añade arte ni verifica su representación visual.

Las reglas actuales derraman mochila al morir y, en Cala, también equipo vestido/pociones salvo arma
inicial. No existe hoy un requisito de nivel mínimo de personaje para equiparse. Esto no se cambia.
Conservar el riesgo normal para funcional y tratar apariencia como licencia separada permanente son
recomendaciones documentadas; pérdidas/licencias, custodia y economía aún deben concretarse antes del uso.

## Código y alcance

- `server/web3/equipmentContent.mjs` valida formatos exactos para `appearance` y `functional`. Reutiliza
  catálogo y saneado de `src/data/items.js` / `src/sim/items.js`, con rechazo de coerción, clamp o redondeo
  en la entrada. Rechaza UID local, flag starter, bases falsas, afijos inválidos y campos adicionales.
- Calcula SHA256 de la definición canónica validada; construye un request interno de registro W01 y
  comprueba que una definición corresponde a la clase/hash de un activo. Ninguno de estos métodos concede
  autorización de uso ni prueba que un objeto se generó legítimamente.
- Las definiciones devueltas están separadas de los objetos de entrada. Transferencia W01 conserva el hash
  del contenido; no cambia las estadísticas ni el dueño de inventarios de la partida.

El contrato no persiste bytes del contenido, licencias o arte: W01 guarda IDs/hashes. La futura
catalogación deberá conservar/versionar esos contenidos y acreditar su origen. `appearanceHash` se
valida como hash, sin descargar ni comprobar bytes externos. `rightsHash` conserva las reglas W01;
este módulo no genera términos de uso. El balance sigue en el catálogo general del juego.

## Verificación local

**41/41 pruebas**, cero fallos/canceladas/skipped/todo: 11 de este contrato (incluidos dos subtests),
25 de registro W01 y 5 del equipo existente.

```powershell
node --test tests/web3-equipment-content.test.mjs tests/web3-asset-registry.test.mjs tests/web3-asset-registry-sql.test.mjs tests/web3-asset-registry-process.test.mjs tests/web3-asset-registry-boundary.test.mjs tests/items.test.mjs
```

Se comparan definiciones generadas por `rollItem` y estadísticas reales para cada base/rareza y niveles
objetivo 1/7/15, respetando el mínimo de drop de cada base. Entradas falsas, normalización implícita,
arrays incompletos o con claves extra se rechazan;
orden de campos no cambia hash y alterar contenido impide usarlo con el activo original.
Ambas modalidades se registran y transfieren con W01 en memoria conservando contenido.

W01 también se verifica mediante Supabase SDK/PGlite local, recuperación entre tres procesos y
coexistencia con SQL001–010. No es prueba remota de Supabase ni de contención PostgreSQL multiconexión.
No se ejecutó toda la suite del checkout. Revisión independiente del contrato y verificación del principal.
Fuentes y hashes en el JSON de evidencia.

## Pendientes

Catalogación/procedencia/cantidad de copias, licencia jugable, identidad durable de instancia,
activación/custodia/transferencia del alcance M5, muerte/pickup/expiry y wallet/testnet siguen pendientes.
No se expone endpoint para mint ni se importan inventarios de jugadores. No se modifica sim/host/perfiles,
SQL010, protocolo, UI ni fuentes Unreal; inventario Unreal/FAB revisado, sin candidatos necesarios para
este contrato. No se aplicaron migraciones live ni se publicó/deployó.
