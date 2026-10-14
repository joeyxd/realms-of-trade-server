# ST01c: isolated source and runtime probes

## Controlled Filmic SDR color

`ReadColorTarget` requires a paused scoped pilot and a 512² target. It reads actual
gamma, pixel format, inherited output format/gamut and preferred SDR LUT bit depth
from RHI capability; it samples no LUT pixels. Copy/rebuild the plugin as below.
`capture_color.py` creates a transient 48-patch emissive chart and captures the chart
and pilot at 0/+1 EV. Explicit gamma2.2, persistent view state, neutral grading,
bloom/AA off, log LUT32 and sub-byte dither; no source assets/configs saved.

Create local wrapper `Content/Python/test_st01c_color.py`:

```python
import runpy
runpy.run_path('C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/capture_color.py')
```

```powershell
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -d3d11 -RenderOffscreen -unattended -nop4 -nosplash -nosound '-ExecCmds=Automation RunTests Editor.Python.ST01c_Pilot.test_st01c_color' '-TestExit=Automation Test Queue Empty' -ColorRun=color09
```

Fresh run only. Accepted references `color07`/`color08` retain PNG, RGBE diagnostic,
raw float16 little-endian RGBA and central readback/profile metadata. Compare decoded
PNG pixels (lossless encoder streams can differ) and raw HDR separately. Platform
query from `color05/color-platform.json` is a pure metadata input to the source preset.
See [acceptance and limits](../../docs/delivery/st01c/COLOR-LAB.md).

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

## Controlled runtime reference (2026-10-13)

`ST01cRuntimeProbe` is a separate editor helper: it runs the exact CPU pilot in the
scratch project, records particle attributes and changes determinism/seeds **in memory
only** (6371/6372). It never saves an asset. `PrepareCapture` waits for asset compilation,
forces residency of the two exact atlas textures, rebuilds the scene proxy and flushes
pending render work. Without this preparation, early captures had missing render data
or low-resolution streaming mips despite valid CPU particles.

Copy the updated plugin into the isolated project and rebuild using the command above.
Enable `PythonAutomationTest` as well as the existing plugins. Create the following
local wrapper at `.scratch/unreal/Content/Python/test_st01c_reference.py`:

```python
import runpy
runpy.run_path('C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/capture_reference.py')
```

Run with a **fresh** bounded name (the checked evidence uses `reference11` and
`reference12`). The output stays under `.scratch/unreal`; don't use NullRHI here:

```powershell
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -d3d11 -RenderOffscreen -unattended -nop4 -nosplash -nosound '-ExecCmds=Automation RunTests Editor.Python.ST01c_Pilot.test_st01c_reference' '-TestExit=Automation Test Queue Empty' -CaptureRun=reference13
```

The scheduler advances a single activation by 240 ticks at 1/60 s, pausing before any
editor yield/readback/camera work. It writes 241 CPU states, an empty baseline, 15 LDR
PNGs (five times × three cameras), three pre-tone-map SceneColor HDR files at 2 s and
two atlas exports. Camera width is 400 cm, image size 512². The HDR export discards
alpha; neither the LDR output nor the HDR files establish transparent-background parity.
FinalColorLDR uses manual exposure, bloom 0 and disabled scene atmosphere/fog/cloud.

`status:complete` means file generation succeeded, not visual acceptance. Verify the
baseline, visible effect, source hashes and repeatability; compare with the
[private Three.js lab](../niagara-native-lab/README.md). Engine launch success alone
is insufficient (automation failures can still exit with status 0).

## Effective compiled CPU pilot

`ReadCompiledPilot` exposes the effective system and particle CPU HLSL after the
in-memory fixture compilation. Emitter graphs are compiled into system scripts;
their standalone translations can be empty and are recorded as such. It also reads
the Win64 VectorVM reciprocal estimates for rates 3/10, without sampling particles.
The helper requires the scratch project, exact pilot and CPU handle order; it never
saves assets. Rebuild/copy the plugin as above, then use a fresh run:

```powershell
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -run=pythonscript '-script=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/probe_compiled.py' -CompiledRun=compiled03 -unattended -nop4 -nosplash -nosound -NullRHI
```

The accepted source preset uses the reviewed `compiled02` report/text hashes. CPU
comparison data stays separate from these compiler inputs. The original pilot has
determinism disabled; the exported fixture uses seeds 6371/6372 only for comparison.
# Referencia de profundidad

`capture_depth.py` usa utilidades de `capture_reference.py` con
`ST01C_LIBRARY_ONLY=True`, sin programar la captura anterior. Crea materiales y
planos transitorios en el proyecto privado; no guarda paquetes. Es el mismo
piloto CPU a 2 s: tres cámaras y superficies conocidas (16 casos), más quad blanco
para seis separaciones (22 HDR). Mantener una sola ejecución UE/GPU a la vez.

Crear wrapper local `Content/Python/test_st01c_depth.py`:

```python
import runpy
runpy.run_path('C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/capture_depth.py')
```

```powershell
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -d3d11 -RenderOffscreen -unattended -nop4 -nosplash -nosound '-ExecCmds=Automation RunTests Editor.Python.ST01c_Pilot.test_st01c_depth' '-TestExit=Automation Test Queue Empty' -DepthRun=depth04
```

Usar nombre fresco; `depth02`/`depth03` son evidencia aceptada. Ver
[entrega y límites](../../docs/delivery/st01c/DEPTH-LAB.md); el código de salida
de UE no sustituye la validación del reporte y de los píxeles.
