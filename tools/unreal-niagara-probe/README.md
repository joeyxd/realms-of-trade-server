# ST01c: read-only source probe

This is an offline editor tool for the exact MyProject `NS_Flame_Single` pilot, not a
Niagara renderer or an automatic Three.js converter. UE 5.8.0 and an installed C++
toolchain are required for the commandlet. The Python probes use editor scripting.

Use a fresh isolated project at `.scratch/unreal/ST01c_Pilot.uproject`. Copy the
SHA-verified pilot system, its two emitter assets and material dependencies from
MyProject into that project's Content folder, preserving package paths. Keep
`C:\Unreal` read-only. The recorded copy audit covers 51 files and 28,498,295 bytes;
engine plugin dependencies are loaded from the installed engine.

Copy `ST01cProbe/` into the isolated project's `Plugins/` folder and the two Python
scripts beside its `.uproject`. Enable Niagara, PythonScriptPlugin,
EditorScriptingUtilities and ST01cProbe in the isolated project. Build:

```powershell
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Build/BatchFiles/Build.bat' UnrealEditor Win64 Development '-Project=C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -WaitMutex
```

Run each probe with forward slashes in command-line paths. The source probe exports
T3D into a fresh `probe01/`; the material probe requires a fresh output JSON:

```powershell
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -run=pythonscript '-script=C:/DEV/real of trade/st01c-native/.scratch/unreal/probe_source.py' -unattended -nop4 -nosplash -nosound -NullRHI
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -run=pythonscript '-script=C:/DEV/real of trade/st01c-native/.scratch/unreal/probe_material_defaults.py' -unattended -nop4 -nosplash -nosound -NullRHI
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -run=ST01cProbe '-Output=C:/DEV/real of trade/st01c-native/.scratch/unreal/native-values.json' -unattended -nop4 -nosplash -nosound -NullRHI
python tools/inspect-niagara-text.py .scratch/unreal/probe01/system.t3d --output .scratch/system-inspection.json
```

The C++ commandlet accepts only `ST01c_Pilot` inside a `.scratch/` folder and a fresh
output file inside that project. It validates the exact system path and two handle
names/order. The declared source SHA is checked externally against the original
and copy; the commandlet itself does not claim to hash the asset. It does not save
assets, launch a simulation, request rendering or translate shaders.

Effective versions and renderer arrays come from loaded Niagara data. Rapid-iteration
values are decoded using the live type definition and exact storage size, including
static bool and quaternion types; unsupported types remain opaque. Registered type
indices are process-local diagnostics. Names repeat across script usages, so 100
records in the pilot are 80 unique names, not 100 distinct controls.

Text inspection preserves declarations, definitions, owner paths, raw properties,
pins and links. It does not merge inheritance, execute graphs or infer stack order
from arrays. Limits: 32 MiB input, 4 MiB line, depth 64, 10,000 object records, fresh
output. The line cap accepts the pilot's 2.1 MiB embedded texture-source records.
Declaration and definition records must not be counted as distinct active objects.

See [the extraction delivery](../../docs/delivery/st01c/DELIVERY.md) for measured
results and what remains before a visual port can be accepted.
