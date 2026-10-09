# D09f-2b.39 — suelo de perlas en el host opcional

Fecha: 2026-10-09. Base de trabajo: `4cd3e56` (después de D09f-2b.38).

## Resultado buscado

Componer los coordinadores .36/.37 con el dueño del tick de GameHost: una perla proyectada se recoge
o retorna mediante diario/recibo antes de modificar/publicar el mundo. Restaurar suelo ordinario y
perlas juntos antes de admitir cuentas. Mantener el arranque ordinario apagado para esta opción.

## Ensamblaje de confianza

El caller mantiene simulación/transporte detenidos, carga y comprueba GroundClockSession y obtiene
un GroundDeadlineClock genuino del mismo mundo. La declaración `durable-ground-v1` sigue siendo
explícita; no certifica registros legacy ni detecta otra autoridad externa.

```js
host.mountPearlStaging({ scope: worldId, deadlineClock });
host.mountDeathStaging({ scope: worldId });
host.mountCombatDeaths();
host.mountDeathDrops();
host.mountPearlGround();
host.mountPearlStartup({ accountPolicy: 'accounts-only', deathDrops: true });
await host.prepare();
// Solo después: attach/listen/start y admisión.
```

El host pasa la misma instancia de reloj a leave, muerte, botín ordinario, recogida/retorno e hidratación.
Con ese reloj se rechaza `mapClock` independiente. `deathDrops:true` requiere el dueño ordinario y reloj;
mountPearlGround requiere ambos dueños de muerte/combate, diario, mundo, reloj y autoridad vacía.
Montaje duplicado, tardío, con argumentos/callbacks extra o getters de configuración se rechaza.
El API previo con mapClock y sin este montaje conserva su comportamiento.

## Regla del límite

- Escanear solo en el límite síncrono anterior al próximo tick, cada tres ticks, igual al suelo actual.
  Orden: terminar perla pendiente exclusivamente; después muerte/efectos, suelo ordinario y perlas.
- Cada escaneo elige como máximo una operación. Iteración estable de drops y perfiles; primer receptor
  vivo, cercano y de cuenta válida que tenga capacidad. Bolsa de ocho llena: aviso privado una vez por
  fuente/cuenta; se prueba el siguiente receptor. No añadir `full` mutable al source persistente.
- Antes de availableAt no se recoge; en returnAt todavía se recoge; después retorna. Validar proyección
  incluso si aún no vence. Origen, UID/generación, capacidad y perfil se vuelven a validar en staging.
- Una operación retiene tick/publicación/guardados/comandos/admisión hasta apply síncrono o fence.
  Retorno captura orden del suelo, eventos, RNG y allocator; ningún otro drainer se intercala mientras espera.
- La espera comprueba nuevamente baselines, también antes de recibir respuesta. Alterar tick, source,
  receptor, RNG, allocator, contenedores o identidad de operación cerca el host. No se elige otro destino.
- Cerrar invalida y espera storage, sin drain; recibo confirmado con apply pendiente exige reconstrucción.
  Startup recupera evidencia y proyecta la ubicación actual, sin repetir eventos históricos.
- LocalServer conserva el callback de cierre admitido durante todo el paso. Retirarlo/reemplazarlo desde
  una callback del mundo falla antes de publicar, invocando el dueño original con fallo.

El escáner ordinario reconoce que las perlas proyectadas tienen dueño propio. Identidad ordinaria en una
perla, metadata incompleta/getters o tipo incompatible siguen fallando. Perlas/objetos legacy sin marca
conservan su flujo anterior; no se adoptan ni adquieren durabilidad por este montaje.

## Reutilización comprobada

Consulta acotada de inventario y fuentes Unreal intactas:

| Candidato concreto | Verificación y decisión |
| --- | --- |
| `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Blueprints\BP_LootBox.uasset` | Existe, 53.960 B. Referencia de interacción/loot; Blueprint no ejecutable en Node. No implementa este contrato de pausa/recibo/recovery. |
| `C:\Unreal\survival project\SimpleMultiplayerSurvival\Content\Dreamrise_SMSK\Assets\Meshes\SM_StoragePart_03.uasset` | Existe, 24.248 B. Prop visual ya exportado en A02; no aporta autoridad de contenido ni persistencia. Sin nueva exportación/arte en este corte. |

Nombres/tamaños no acreditan comportamiento. Se reutilizan los coordinadores .36/.37, la barrera continua
de PearlStartup y el límite de DeathDropLifecycle; no se porta lógica Unreal.

## Aceptación y límites

Pruebas pertinentes de espera/publicación, selección/capacidad/plazos, metadata/deriva/cierre, recuperación
con SDK/SQL001–013 y regresión de los dueños existentes. [Entrega](../delivery/d09f-pearl-lifecycle-host.md).
Sin UI/assets nuevos: revisión visual no aplica. No cambiar SQL, .env, perfil, defaults ni protocolo.

Este montaje no decide edad offline/cadencia, checkpoint atómico con gameplay, continuidad de RNG tras
crash, certificación/backfill legacy o leases. No conecta creación de perlas desde loot/cofres ni comando
durable general al CLI. Salvamento/pesca/buceo y afinidad permanente siguen en sus planes.
Supabase real, proceso/DB reabiertos, reinicio publicado y WAN requieren aceptación posterior.
