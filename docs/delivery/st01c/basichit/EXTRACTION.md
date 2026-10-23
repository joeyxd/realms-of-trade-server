# NS_BasicHit: extracción nativa (T-1020-92)

Solo datos fuente de UE 5.8.0; no prueba semántica de simulación ni equivalencia visual.
Sistema `/Game/sA_Megapack_v1/sA_StylizedAttacksPack/FX/NiagaraSystems/NS_BasicHit`, SHA-256 de la fuente
`97a82bae…18cf` (identidad `niagara-97a82bae61b29237`). Especificación: `tools/unreal-niagara-probe/systems/ns-basichit.json`.
Cierre: 15 paquetes `/Game` (3 copiados, 12 ya presentes del piloto, [auditoría](source-copy-audit.json)) y 43
paquetes de motor/script, 58 en total. T3D y HLSL quedan en `.scratch/unreal`; el [manifiesto](source-export-manifest.json) los fija por hash.

## Qué hay
- Handles (3, en orden, [native-values.json](native-values.json)): `NE_Flame_Basic_001` (activo del sistema:
  `NS_BasicHit:NE_Flame_Basic_001`), `NE_Basic_Flash001` (asset `NE_Basic_Flash`; objeto `NE_Basic_Flash001_3`), `NE_SimpleBurst`.
  Los tres CPUSim, `localSpace` false, determinismo false (fixture en memoria 6371, 6372, 6373).
- Scripts compilados: 14 = 2 de sistema + 3 emisores x 4 (Emitter Spawn/Update vacíos, `NCS_Unknown`, como en el piloto).
- Renderers (todos sprite, uno por emisor): Flame `MI_Fireball`, sub-imagen 8x4, `FaceCameraPosition`; Flash `MI_Hit_1`, 1x1,
  `FaceCamera`; SimpleBurst `MI_Radial_2`, 1x1, `FaceCamera`. Todos `Unaligned`, sin mezcla de sub-imagen.
- Materiales ([material-defaults.json](material-defaults.json)): `MI_Fireball`, `MI_Flame_1` (padre `M_Smoke`, textura SUBUV
  `T_FireBall` y `T_FlameUV_1`), `MI_Hit_1` (padre `M_Ground_Crack`, textura `T_Hit_Circle`), `MI_Radial_2` (padre `M_Master_RadialBeam`,
  sin textura). Los tres padres: translúcido, sin sombreado, doble cara falso. `MI_Flame_1` solo aparece en system.t3d:2493
  y ningún renderer activo lo usa. Texturas del cierre: `T_FireBall`, `T_FlameUV_1`, `T_Ground_Crack`, `T_Hit_Circle`.

## Ejecuciones (carpetas en `.scratch/unreal`, consola `NOMBRE-console.log`)
- Piloto: `gen-pilot-source`, `gen-pilot-compiled`, `gen-pilot-native-values`, `gen-pilot-material-defaults2`.
- NS_BasicHit: `basichit-closure01`, `basichit-source`, `basichit-compiled`, `basichit-native-values`, `basichit-material-defaults2`.
- Comandos en orden. Los cinco de Unreal son la línea `commandline=` de cada consola, con los scripts de `.scratch/unreal` tal como corrieron;
  los de Python se reconstruyen desde sus argumentos y las rutas de salida (no quedó registro de la consola). El README del probe tiene los detalles.

```powershell
python tools/unreal-niagara-probe/closure_copy.py --spec tools/unreal-niagara-probe/systems/ns-basichit.json --apply
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -run=pythonscript '-script=C:/DEV/real of trade/st01c-native/.scratch/unreal/probe_closure.py' '-SystemSpec=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/systems/ns-basichit.json' -ProbeRun=basichit-closure01 -unattended -nop4 -nosplash -nosound -NullRHI
python tools/unreal-niagara-probe/closure_copy.py --spec tools/unreal-niagara-probe/systems/ns-basichit.json --extra .scratch/unreal/basichit-closure01.json --apply --audit docs/delivery/st01c/basichit/source-copy-audit.json
python tools/unreal-niagara-probe/check_copy_audit.py docs/delivery/st01c/basichit/source-copy-audit.json
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -run=pythonscript '-script=C:/DEV/real of trade/st01c-native/.scratch/unreal/probe_source.py' '-SystemSpec=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/systems/ns-basichit.json' -ProbeRun=basichit-source -unattended -nop4 -nosplash -nosound -NullRHI
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -run=pythonscript '-script=C:/DEV/real of trade/st01c-native/.scratch/unreal/probe_compiled.py' '-SystemSpec=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/systems/ns-basichit.json' -ProbeRun=basichit-compiled -unattended -nop4 -nosplash -nosound -NullRHI
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -run=ST01cProbe '-SystemSpec=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/systems/ns-basichit.json' -ProbeRun=basichit-native-values -unattended -nop4 -nosplash -nosound -NullRHI
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -run=pythonscript '-script=C:/DEV/real of trade/st01c-native/.scratch/unreal/probe_material_defaults.py' '-SystemSpec=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/systems/ns-basichit.json' -ProbeRun=basichit-material-defaults2 -unattended -nop4 -nosplash -nosound -NullRHI
python tools/unreal-niagara-probe/build_export_manifest.py --spec tools/unreal-niagara-probe/systems/ns-basichit.json --unreal-dir .scratch/unreal --source-run basichit-source --compiled-run basichit-compiled --native-values-run basichit-native-values --material-defaults-run basichit-material-defaults2 --closure-run basichit-closure01 --output docs/delivery/st01c/basichit/source-export-manifest.json
```

## Capacidades frente al laboratorio
El laboratorio solo simula el subconjunto de actualización del piloto, sin fuerzas (tools/niagara-native-lab/README.md:64,
update-simulation.js:70). Efectivo = llamadas del HLSL compilado (`EnterStatScope`); entre paréntesis, la cita.
- Ráfaga instantánea (`SpawnBurst_Instantaneous`) en los 3 emisores; el piloto genera por `SpawnRate` (01-SystemUpdateScript.hlsl, ámbitos
  `SpawnBurst_Instantaneous_NE_*_Func`). Cuenta 1, 1 y 250 (NE_SimpleBurst, native-values.json).
- `Drag` solo en SimpleBurst, en spawn y update (10-...hlsl:1901, 11-...hlsl:630): 0.75, rotacional 1; Flame y Flash no lo llaman.
- `GravityForce` (-980 en z) existe en NE_SimpleBurst (system.t3d:3973 habilitado y :4747 con `EnabledState=Disabled`), pero 11-ParticleUpdateScript.hlsl
  no lo invoca (ámbitos 1-5 sin gravedad): inactivo en el compilado. Sin confirmar cuál nodo gobierna.
- `AddVelocityFromPoint` (10-...hlsl:1867; origen 0, caída 100) y `CalculateSizeAndRotationalInertiaByMass` (10-...hlsl:1837): nuevos.
- `ScaleSpriteSize` (02-...hlsl y 06-...hlsl; en SimpleBurst como `SpriteSizeScale`, 10-...hlsl:1915): el piloto no lo usa.
- Ubicación: Flame con `SystemLocation` (02-...hlsl, ámbito `SystemLocation_Emitter_Func`; el piloto usa Sphere/Cylinder); Flash y SimpleBurst
  sin módulo de ubicación activo en el compilado, aunque `SphereLocation` existe en el T3D (system.t3d:4036 activo, :4812 deshabilitado).
- `SimulationPosition` (Functions/Localspace y DynamicInputs/Helpers) y `NormalizedAngleToDegrees` en SimpleBurst (system.t3d:3751, 4025, 3876): nuevos.
- Emisores adicionales: 3 en vez de 2; la ráfaga de 250 partículas multiplica la ocupación frente al piloto.
- Renderer: `FaceCameraPosition` (Flame) no estaba en el piloto (`FaceCamera`, `FaceCameraPlane`); sub-imagen 1x1 sin SubUV en Flash y SimpleBurst.
- Materiales: `M_Ground_Crack` (TextureSampleParameter2D "Texture", sin SubUV) y `M_Master_RadialBeam` (`MaterialFunctionCall` del motor
  `RadialGradientExponential`, escalar `Radius` 0.5, sin textura); `M_Smoke` es compartido con el piloto.
- Enums de motor adicionales en el cierre: `ENiagaraInactiveMode`, `ENiagaraSystemInactiveMode`, `ENiagaraTorusDistributionMode` (registrados en el informe compilado).
