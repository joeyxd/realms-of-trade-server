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

Every probe takes a system spec and a fresh run name, nothing is hardcoded to one system:
`-SystemSpec=<absolute path of systems/*.json>` and `-ProbeRun=<name>` (letters, digits, `_`, `-`;
`-run=` is Unreal's own switch, hence the different name). No spec, no run. The spec
(`systems/ns-flame-single.json` for the pilot, `systems/ns-basichit.json` for NS_BasicHit) holds the system
package, pack root, source SHA, emitter handles in order (or `null` to record every handle), emitter assets,
fixture seed base (6371 + handle index), expected script count (or `null`), the enums to record,
the material instances, their base materials and the expression classes with the fields to read.
Run names map to `<project>/<name>/` for the source and compiled probes and to
`<project>/<name>.json` for the material, closure and native-values probes; all refuse an existing run.
Use forward slashes in command-line paths. Console logs go beside the run (`<name>-console.log`):

```powershell
$ue = 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe'
$proj = 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject'
$spec = 'C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/systems/ns-flame-single.json'
& $ue $proj -run=pythonscript '-script=C:/DEV/real of trade/st01c-native/.scratch/unreal/probe_source.py' "-SystemSpec=$spec" -ProbeRun=probe06 -unattended -nop4 -nosplash -nosound -NullRHI
& $ue $proj -run=pythonscript '-script=C:/DEV/real of trade/st01c-native/.scratch/unreal/probe_material_defaults.py' "-SystemSpec=$spec" -ProbeRun=material-defaults02 -unattended -nop4 -nosplash -nosound -NullRHI
& $ue $proj -run=ST01cProbe "-SystemSpec=$spec" -ProbeRun=native-values04 -unattended -nop4 -nosplash -nosound -NullRHI
python tools/inspect-niagara-text.py .scratch/unreal/probe06/system.t3d --output .scratch/system-inspection.json
```

The probe scripts derive their root from the project directory, so they also run straight from
`tools/unreal-niagara-probe/`; the copies beside the `.uproject` are optional.

### Second system (NS_BasicHit)

A new system needs only a new spec, the copy of its package closure and the same four probes:

1. `python tools/unreal-niagara-probe/closure_copy.py --spec <spec> --apply` copies the seeds (system, direct
   `/Game` dependencies and textures from `docs/research/unreal-assets/st01b/myproject-dependencies.json`)
   from `C:/Unreal/MyProject/Content`, never writing there. An existing copy must hash equal or it stops.
2. `probe_closure.py` (same Python invocation as above) reads the hard-reference closure from the AssetRegistry
   and lists packages still missing; repeat with `closure_copy.py --extra <closure json>` until none are missing, then add
   `--audit docs/delivery/st01c/<name>/source-copy-audit.json`.
3. `check_copy_audit.py <audit>` re-hashes originals and copies and exits non-zero on any mismatch.
4. Run the source, compiled and material probes and the commandlet, then `build_export_manifest.py` pins the run.
   `compare_t3d.py <run A> <run B>` compares two source runs with the per-load ChangeId GUIDs masked: Unreal
   assigns fresh ones on every load, so two T3D exports are never byte-identical.

The C++ commandlet accepts only `ST01c_Pilot` inside a `.scratch/` folder and a fresh
output file inside that project. It validates the exact system path from the spec, and the
emitter handle names and order when the spec lists them. The declared source SHA is checked externally against the original
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

### Engine assets (render sources)

`probe_engine_assets.py` exports engine assets (for example material functions) to T3D and reads texture fields, in the
isolated project, without saving anything. Arguments: `-AssetQuery=<absolute query json>` (schema `st01c-asset-query/v1`,
strict keys `schema`, `exportT3D`, `textures`, `textureFields`; example `queries/basichit-render.json`) and `-ProbeRun=<name>`.
It writes the fresh folder `<project>/<name>/` with one `<AssetName>.t3d` per `exportT3D` entry and `textures.json`; it refuses an
existing folder. Results and formulas: [render sources](../../docs/delivery/st01c/basichit/RENDER-SOURCES.md).

```powershell
$q = 'C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/queries/basichit-render.json'
& $ue $proj -run=pythonscript '-script=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/probe_engine_assets.py' "-AssetQuery=$q" -ProbeRun=engine-assets01 -unattended -nop4 -nosplash -nosound -NullRHI
python tools/unreal-niagara-probe/compare_t3d.py .scratch/unreal/engine-assets01 .scratch/unreal/engine-assets02
```

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
`reference12`) and the system spec (`-SystemSpec=<absolute systems/*.json>`, as the probes take it;
no spec, no run: there is no default system). The output stays under `.scratch/unreal`; don't use NullRHI here:

```powershell
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -d3d11 -RenderOffscreen -unattended -nop4 -nosplash -nosound '-ExecCmds=Automation RunTests Editor.Python.ST01c_Pilot.test_st01c_reference' '-TestExit=Automation Test Queue Empty' -CaptureRun=reference13 '-SystemSpec=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/systems/ns-flame-single.json'
```

The system, its source SHA and the whole capture window come from the spec. Its `capture` block holds exactly:
`dt`, `lastStep` (states 0..lastStep), `imageSteps` (steps with PNG frames), `linearStep` (one of imageSteps; the
HDR export), `imageSize` (square), `cameras` (`{name, yaw, pitch}`, the first one also takes the step 0 baseline),
`cameraTarget` `[x, y, z]`, `cameraDistance`, `orthoWidth` and `textures` (full `/Game` package paths exported to
`textures/<name>.png` and forced resident). Python validates the block and names a missing or mistyped key; the
plugin reads only `textures`, and `ConfigureSystem` records that list and the system path, which
`ReadParticles`, `PrepareCapture` and `ReadColorTarget` then accept (any other asset is refused).
`capture_depth.py`/`capture_color.py` keep importing `capture_reference.py` as a library and read their pilot
constants from `systems/ns-flame-single.json`.

Compare two runs of one system (particles and HDR byte for byte, PNG by decoded pixels, textures by sha256,
report settings, seed_configuration and counts; exit 0 only when equal) and check the spec loader without Unreal:

```powershell
python tools/unreal-niagara-probe/compare_reference_runs.py --spec tools/unreal-niagara-probe/systems/ns-flame-single.json --a .scratch/unreal/reference11 --b .scratch/unreal/reference-gen01 [--png-max N] [--json <out>]
python tools/unreal-niagara-probe/capture_spec_test.py
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

### NS_BasicHit reference capture

The by-spec capture works for a second system with its own spec (`systems/ns-basichit.json`, fixture seeds 6371/6372/6373).
Window: dt 1/60, 240 steps, three cameras, 1024², image steps 2, 6, 12, 18, 24, linear step 12. Never run two Unreal instances at once. Same command as above, other spec and fresh run names:

```powershell
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -d3d11 -RenderOffscreen -unattended -nop4 -nosplash -nosound '-ExecCmds=Automation RunTests Editor.Python.ST01c_Pilot.test_st01c_reference' '-TestExit=Automation Test Queue Empty' -CaptureRun=basichit-reference03 '-SystemSpec=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/systems/ns-basichit.json'
```

The capture raises when an image step after 0 renders fewer than 100 visible pixels (`capture-error.txt` names the step):
remove that step and every later one from `capture.imageSteps` and repeat with a fresh name (for NS_BasicHit step 30 is blank, so the
final spec ends at 24). The final pair is `basichit-reference03` and `basichit-reference04`, run one after the other. Framing comes from the
particles, not from the eye:

```powershell
python tools/unreal-niagara-probe/frame_from_particles.py --spec tools/unreal-niagara-probe/systems/ns-basichit.json --run .scratch/unreal/basichit-reference03 [--json <out>]
python tools/unreal-niagara-probe/build_reference_checkpoint.py --spec tools/unreal-niagara-probe/systems/ns-basichit.json --a .scratch/unreal/basichit-reference03 --b .scratch/unreal/basichit-reference04 --out docs/delivery/st01c/basichit/reference-checkpoint.json
python tools/unreal-niagara-probe/render_reference_md.py --checkpoint docs/delivery/st01c/basichit/reference-checkpoint.json --out docs/delivery/st01c/basichit/REFERENCE.md
python tools/unreal-niagara-probe/check_reference_checkpoint.py docs/delivery/st01c/basichit/reference-checkpoint.json --root .
```

`frame_from_particles.py` takes the box of all particle positions grown by half the largest sprite size and tests it against every
camera (orthographic, 90% of the half width); exit 0 when it fits, otherwise it prints the recommended `cameraTarget`, `orthoWidth`
and `cameraDistance`. `build_reference_checkpoint.py` writes the audit (compare numbers, framing, burst facts, file and texture
hashes, code hashes); `render_reference_md.py` writes the Spanish `REFERENCE.md` from that checkpoint (the committed document equals its
regeneration); `check_reference_checkpoint.py` re-hashes all of it and exits 0 only when everything matches. Read
[the BasicHit reference](../../docs/delivery/st01c/basichit/REFERENCE.md) for the numbers and what is not accepted.

### NS_BasicHit reference under the controlled color profile

`capture_reference_profiled.py` recaptures a system under the controlled SDR profile of the pilot color lab
(`controlled-sdr/v1`, see `capture_color.py` and [COLOR-LAB](../../docs/delivery/st01c/COLOR-LAB.md)) with a raw RGBA16F HDR beside
every LDR image. It runs `capture_reference.py` as a library: its `run()` loads the spec, refuses, seeds, exports the textures,
steps the simulation and reads the particles unchanged; the driver only replaces its per-pose capture (`_capture_pose`). The
profile lives in `capture_profile.py`, copied from `capture_color.py` with the source line range on every piece
(`capture_color.py` itself is unchanged and does not import it). While `run()` waits its first editor frames, before the effect
is activated, the driver disables world post-process volumes, sets and reads back the cvars of `capture_color.py:166-173`, creates
an RGBA8 LDR target with target gamma 2.2 and an RGBA16F HDR target at the spec `imageSize`, keeps a persistent view state,
turns the show flags off (AntiAliasing included) and applies `profile()` at 0 EV. Every image step and camera, and the step-0
baseline, writes `frames/tNNNN_<camera>.png` (FinalColorLDR) and `frames/tNNNN_<camera>_hdr.rgba16f` (SceneColor HDR,
little-endian float16 RGBA, top row first, 8 bytes per pixel), each after 4 warm-up captures; the linear step keeps the Radiance
`tNNNN_<camera>_linear.hdr` as a diagnostic (shared exponent: not for the transfer). `capture-report.json` gains
`capture_profile` (id, cvar read-back, targets, flags, post-process values), `capture_code` (hashes of the driver, the profile,
the library and the wrapper) and `files` (every run file with its sha256). Same arguments and refusals as
`capture_reference.py`; the driver raises the plugin's latent timeout from 300 to 540 s (one run takes about 100 s of wall time,
40 to 74 s of it inside the test).

Create the local wrapper `.scratch/unreal/Content/Python/test_st01c_reference_profiled.py`:

```python
import runpy
runpy.run_path('C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/capture_reference_profiled.py')
```

```powershell
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -d3d11 -RenderOffscreen -unattended -nop4 -nosplash -nosound '-ExecCmds=Automation RunTests Editor.Python.ST01c_Pilot.test_st01c_reference_profiled' '-TestExit=Automation Test Queue Empty' -CaptureRun=basichit-reference07 '-SystemSpec=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/systems/ns-basichit.json'
```

The final pair is `basichit-reference05` and `basichit-reference06` (fresh names only; one Unreal instance at a time). Then:

```powershell
python -B tools/unreal-niagara-probe/capture_profile_test.py
python -B tools/unreal-niagara-probe/compare_reference_runs.py --spec tools/unreal-niagara-probe/systems/ns-basichit.json --a .scratch/unreal/basichit-reference05 --b .scratch/unreal/basichit-reference06
python -B tools/unreal-niagara-probe/build_profiled_checkpoint.py --spec tools/unreal-niagara-probe/systems/ns-basichit.json --a .scratch/unreal/basichit-reference05 --b .scratch/unreal/basichit-reference06 --base .scratch/unreal/basichit-reference03 --out docs/delivery/st01c/basichit/reference-profiled-checkpoint.json
python -B tools/unreal-niagara-probe/check_profiled_checkpoint.py
node tools/niagara-native-lab/transfer-basichit.mjs --run basichit-reference05
```

`capture_profile_test.py` parses `capture_color.py` and fails when a copied value, the warm-up loop or the `profile()` body
drifts. `check_profiled_checkpoint.py` (default checkpoint `docs/delivery/st01c/basichit/reference-profiled-checkpoint.json`)
re-hashes both runs, recomputes the pair identity (decoded PNG pixels, raw HDR bytes, Radiance bytes, particle states, textures,
report keys) and the particle equality with `basichit-reference03`, and checks the profile read-back, the code hashes (text with
LF line endings) and the plugin binary. `transfer-basichit.mjs` measures the transfer precondition offline: the exact
`film-color.js` Filmic on the Unreal HDR against the Unreal LDR, with the metric of `compare-basichit.py`. Results and limits:
[the profiled BasicHit reference](../../docs/delivery/st01c/basichit/REFERENCE-PROFILED.md).

## Effective compiled CPU pilot

`ReadCompiledPilot` exposes the effective system and particle CPU HLSL after the
in-memory fixture compilation. Emitter graphs are compiled into system scripts;
their standalone translations can be empty and are recorded as such. It also reads
the Win64 VectorVM reciprocal estimates for rates 3/10, without sampling particles.
The helper requires the scratch project, exact pilot and CPU handle order; it never
saves assets. Rebuild/copy the plugin as above, then use a fresh run:

```powershell
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' 'C:/DEV/real of trade/st01c-native/.scratch/unreal/ST01c_Pilot.uproject' -run=pythonscript '-script=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/probe_compiled.py' '-SystemSpec=C:/DEV/real of trade/st01c-native/tools/unreal-niagara-probe/systems/ns-flame-single.json' -ProbeRun=compiled03 -unattended -nop4 -nosplash -nosound -NullRHI
```

The plugin functions are `ConfigureSystem`/`ReadCompiledSystem` (scope from the spec text); the older
`ConfigurePilot`/`ReadCompiledPilot` keep the pilot scope for `capture_color.py` and `capture_depth.py`. With the pilot spec the compiled
`report.json` is byte-identical to `compiled02` and the native-values file to `native-values02/03`; the
T3D exports and the material defaults are not byte-stable (see `compare_t3d.py`; the original material probe
printed an object representation with a memory address).

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
