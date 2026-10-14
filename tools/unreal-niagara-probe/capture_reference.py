"""Capture one continuous NS_Flame_Single run at fixed simulation steps.

Run only in the isolated ST01c_Pilot editor project. Outputs are kept under
.scratch/unreal/reference-capture/<run-id>/ and the destination must be fresh.
"""
import hashlib
import json
import math
import os
import re
import struct
import time
import traceback

import unreal
from unreal_pythonautomationtest import AutomationScheduler
unreal.AutomationScheduler = AutomationScheduler


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PROJECT_FILE = os.path.join(PROJECT_ROOT, ".scratch", "unreal", "ST01c_Pilot.uproject")
SYSTEM_PATH = "/Game/sA_Megapack_v1/sA_StylizedAttacksPack/FX/NiagaraSystems/NS_Flame_Single"
SOURCE_SHA256 = "985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165"
DT = 1.0 / 60.0
LAST_STEP = 240
IMAGE_STEPS = (30, 60, 120, 180, 240)
WIDTH = HEIGHT = 512
CAPTURES = (
    ("front", 0.0, 0.0),
    ("oblique", 45.0, 20.0),
    ("side", 90.0, 0.0),
)
CAMERA_TARGET = (0.0, 0.0, 100.0)
CAMERA_DISTANCE = 500.0
ORTHO_WIDTH = 400.0
_LIVE_ACTORS = []


def _args():
    raw = unreal.SystemLibrary.get_command_line()
    options = {}
    run_id = re.search(r'-CaptureRun=([A-Za-z0-9_-]{1,40})(?:\s|$)', raw)
    if run_id:
        return {"output": os.path.join(PROJECT_ROOT, '.scratch', 'unreal', run_id.group(1))}
    match = re.search(r'-CaptureOutput=(?:"([^"]+)"|([^\s]+))', raw)
    if match:
        options["output"] = match.group(1) or match.group(2)
    if "output" not in options:
        raise RuntimeError("Pass -CaptureOutput=<fresh absolute output directory>")
    return options


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _copied_package_hash(asset_path):
    package = asset_path.split(".", 1)[0]
    if not package.startswith("/Game/"):
        return None
    relative = package[len("/Game/"):].split("/")
    filename = os.path.join(PROJECT_ROOT, ".scratch", "unreal", "Content", *relative) + ".uasset"
    return _sha256(filename) if os.path.isfile(filename) else None


def _look_at(origin, target):
    return unreal.MathLibrary.find_look_at_rotation(unreal.Vector(*origin), unreal.Vector(*target))


def _cleanup_actors():
    global _LIVE_ACTORS
    for actor in reversed(_LIVE_ACTORS):
        try:
            component = actor.get_component_by_class(unreal.NiagaraComponent)
            if component:
                component.set_paused(True)
                component.deactivate()
        except Exception:
            pass
        try:
            unreal.EditorLevelLibrary.destroy_actor(actor)
        except Exception:
            pass
    _LIVE_ACTORS = []


def _capture_pose(capture_component, label, yaw, pitch, rt, linear_rt, world, output, step):
    yaw_r = math.radians(yaw)
    pitch_r = math.radians(pitch)
    target = CAMERA_TARGET
    offset = (CAMERA_DISTANCE * math.cos(pitch_r) * math.cos(yaw_r),
              CAMERA_DISTANCE * math.cos(pitch_r) * math.sin(yaw_r),
              CAMERA_DISTANCE * math.sin(pitch_r))
    origin = tuple(target[i] + offset[i] for i in range(3))
    capture_component.set_world_location(unreal.Vector(*origin), False, False)
    capture_component.set_world_rotation(_look_at(origin, target), False, False)
    # A queued capture can still miss the first frame of a freshly created proxy.
    # Readback fences the GPU; retry the SAME paused state, never the simulation.
    visible_pixels = 0
    for attempt in range(3):
        capture_component.capture_scene()
        yield
        yield
        pixels = unreal.RenderingLibrary.read_render_target(world, rt, False)
        visible_pixels = sum(1 for p in pixels if max(p.r, p.g, p.b) > 16)
        if step == 0 or visible_pixels >= 100:
            break
    if step > 0 and visible_pixels < 100:
        raise RuntimeError('Blank reference capture at step %d / %s' % (step, label))
    filename = "t%04d_%s.png" % (step, label)
    fullpath = os.path.join(output, "frames", filename)
    unreal.RenderingLibrary.export_render_target(world, rt, os.path.dirname(fullpath), filename)
    linear = None
    if step == 120:
        capture_component.texture_target = linear_rt
        capture_component.capture_source = unreal.SceneCaptureSource.SCS_SCENE_COLOR_HDR
        capture_component.capture_scene()
        yield
        yield
        linear_name = 't%04d_%s_linear.hdr' % (step, label)
        linear_path = os.path.join(output, 'frames', linear_name)
        unreal.RenderingLibrary.export_render_target(world, linear_rt, os.path.dirname(linear_path), linear_name)
        linear = { 'file': 'frames/' + linear_name, 'sha256': _sha256(linear_path) }
        capture_component.texture_target = rt
        capture_component.capture_source = unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR
    return {"file": os.path.relpath(fullpath, output).replace("\\", "/"), "linear": linear,
            "visible_pixels_gt16": visible_pixels, "capture_attempts": attempt + 1,
            "step": step, "time_seconds": step * DT, "camera": label,
            "yaw_degrees": yaw, "pitch_degrees": pitch,
            "position_cm": list(origin), "target_cm": list(target),
            "rotation_degrees": {"pitch": capture_component.get_world_rotation().pitch,
                                 "yaw": capture_component.get_world_rotation().yaw,
                                 "roll": capture_component.get_world_rotation().roll},
            "sha256": _sha256(fullpath) if os.path.isfile(fullpath) else None}


def run():
    args = _args()
    output = os.path.abspath(args["output"])
    if os.path.normcase(os.path.abspath(PROJECT_FILE)) != os.path.normcase(os.path.abspath(unreal.Paths.get_project_file_path())):
        raise RuntimeError("Refusing to capture outside the isolated ST01c_Pilot project")
    if not output.startswith(os.path.join(PROJECT_ROOT, ".scratch", "unreal") + os.sep):
        raise RuntimeError("Capture output must stay under this project's .scratch/unreal folder")
    if os.path.exists(output):
        if os.listdir(output):
            raise RuntimeError("Capture output is not fresh: " + output)
    else:
        os.makedirs(output)
    os.makedirs(os.path.join(output, "frames"))
    os.makedirs(os.path.join(output, "particles"))

    started = time.time()
    world = unreal.EditorLevelLibrary.get_editor_world()
    system = unreal.load_asset(SYSTEM_PATH)
    if not system:
        raise RuntimeError("Could not load exact pilot system: " + SYSTEM_PATH)
    if _copied_package_hash(SYSTEM_PATH) != SOURCE_SHA256:
        raise RuntimeError('Pilot package hash mismatch')

    # Actor is created once and remains active for the entire timeline.
    fx_actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.NiagaraActor, unreal.Vector(0.0, 0.0, 0.0), unreal.Rotator(0.0, 0.0, 0.0))
    if not fx_actor:
        raise RuntimeError("Could not spawn Niagara actor")
    _LIVE_ACTORS.append(fx_actor)
    component = fx_actor.get_component_by_class(unreal.NiagaraComponent)
    if not component:
        raise RuntimeError("Niagara actor has no NiagaraComponent")
    component.set_editor_property("auto_activate", False)
    component.set_rendering_enabled(True)
    component.set_force_solo(True)
    seed_status = {"available": False, "result": None}
    probe = getattr(unreal, "ST01cRuntimeProbe", None)
    if probe and hasattr(probe, "configure_pilot"):
        result = probe.configure_pilot(system)
        seed_status = {"available": True, "result": json.loads(result) if isinstance(result, str) else result}
        if isinstance(seed_status["result"], dict) and seed_status["result"].get("error"):
            raise RuntimeError("Deterministic seed setup failed: " + str(seed_status["result"]))
    component.set_asset(system)

    texture_rows = []
    texture_root = "/Game/sA_Megapack_v1/sA_StylizedAttacksPack/Materials/Textures/"
    for texture_name in ("T_FlameUV_2", "T_Smoke_1"):
        texture_path = texture_root + texture_name
        texture = unreal.load_asset(texture_path)
        if not texture:
            raise RuntimeError("Missing renderer texture: " + texture_path)
        export_path = os.path.join(output, "textures", texture_name + ".png")
        os.makedirs(os.path.dirname(export_path), exist_ok=True)
        task = unreal.AssetExportTask()
        task.object = texture
        task.filename = export_path
        task.exporter = unreal.TextureExporterPNG()
        task.automated = True
        task.prompt = False
        task.replace_identical = True
        if not unreal.Exporter.run_asset_export_task(task) or not os.path.isfile(export_path):
            raise RuntimeError("TextureExporterPNG failed for " + texture_path)
        with open(export_path, 'rb') as stream:
            dimensions = struct.unpack('>II', stream.read(24)[16:24])
        texture_rows.append({"asset": texture_path, "file": os.path.relpath(export_path, output).replace("\\", "/"),
                             "width": dimensions[0], "height": dimensions[1],
                             "srgb": texture.get_editor_property("srgb"),
                             "source_copy_package_sha256": _copied_package_hash(texture_path),
                             "sha256": _sha256(export_path)})

    rt = unreal.RenderingLibrary.create_render_target2d(world, WIDTH, HEIGHT, unreal.TextureRenderTargetFormat.RTF_RGBA8,
                                                       unreal.LinearColor(0.0, 0.0, 0.0, 1.0), False, False)
    linear_rt = unreal.RenderingLibrary.create_render_target2d(world, WIDTH, HEIGHT, unreal.TextureRenderTargetFormat.RTF_RGBA16F,
                                                       unreal.LinearColor(0.0, 0.0, 0.0, 1.0), False, False)
    capture_actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.SceneCapture2D, unreal.Vector(0.0, 0.0, 0.0), unreal.Rotator(0.0, 0.0, 0.0))
    if not capture_actor:
        raise RuntimeError("Could not spawn SceneCapture2D")
    _LIVE_ACTORS.append(capture_actor)
    capture = capture_actor.get_component_by_class(unreal.SceneCaptureComponent2D)
    capture.texture_target = rt
    capture.capture_source = unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR
    capture.primitive_render_mode = unreal.SceneCapturePrimitiveRenderMode.PRM_USE_SHOW_ONLY_LIST
    capture.show_only_actor_components(fx_actor)
    capture.capture_every_frame = False
    capture.capture_on_movement = False
    capture.set_editor_property('show_flag_settings', [unreal.EngineShowFlagsSetting(name, False) for name in
        ('Atmosphere', 'Fog', 'VolumetricFog', 'Cloud', 'DeferredAtmospherePass', 'SkyLighting', 'MotionBlur', 'Vignette')])
    capture.ortho_width = ORTHO_WIDTH
    capture.projection_type = unreal.CameraProjectionMode.ORTHOGRAPHIC
    capture.post_process_blend_weight = 1.0
    pp = capture.post_process_settings
    pp.override_auto_exposure_method = True
    pp.auto_exposure_method = unreal.AutoExposureMethod.AEM_MANUAL
    pp.override_auto_exposure_bias = True
    pp.auto_exposure_bias = 0.0
    pp.override_auto_exposure_apply_physical_camera_exposure = True
    pp.auto_exposure_apply_physical_camera_exposure = False
    pp.override_bloom_intensity = True
    pp.bloom_intensity = 0.0
    pp.override_vignette_intensity = True
    pp.vignette_intensity = 0.0
    capture.post_process_settings = pp

    # ManualAdvance is deterministic only when pause is lifted for the call and
    # restored immediately before any editor tick can occur.
    # Let shader/render resources initialize before the single activation.
    for _ in range(120):
        yield
    component.activate(True)
    component.set_paused(True)
    preparation = json.loads(probe.prepare_capture(component))
    if preparation.get('error'):
        raise RuntimeError('Capture preparation failed: ' + str(preparation))
    for _ in range(3):
        yield
    images = []
    particle_steps = []
    counts = {"simulation_steps": 0, "image_frames_expected": len(IMAGE_STEPS) * len(CAPTURES),
              "image_frames_written": 0, "particle_steps_expected": LAST_STEP + 1,
              "particle_steps_written": 0}

    def read_particles(step):
        if not probe or not hasattr(probe, "read_particles"):
            return
        payload = probe.read_particles(component)
        if isinstance(payload, str):
            data = json.loads(payload)
        else:
            data = payload
        if isinstance(data, dict) and data.get("error"):
            raise RuntimeError("Particle readback failed at step %d: %s" % (step, data))
        path = os.path.join(output, "particles", "step_%04d.json" % step)
        with open(path, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, separators=(",", ":"))
        particle_steps.append({"step": step, "time_seconds": step * DT,
                               "file": os.path.relpath(path, output).replace("\\", "/"),
                               "particle_count": sum(len(e.get("particles", [])) for e in data.get("emitters", []))})
        counts["particle_steps_written"] += 1

    try:
        read_particles(0)
        baseline = yield from _capture_pose(capture, 'front', 0, 0, rt, linear_rt, world, output, 0)
        for step in range(1, LAST_STEP + 1):
            component.set_paused(False)
            component.advance_simulation(1, DT)
            component.set_paused(True)
            counts["simulation_steps"] += 1
            read_particles(step)
            if step in IMAGE_STEPS:
                preparation = json.loads(probe.prepare_capture(component))
                if preparation.get('error'):
                    raise RuntimeError('Capture preparation failed: ' + str(preparation))
                for _ in range(3):
                    yield
                for label, yaw, pitch in CAPTURES:
                    images.append((yield from _capture_pose(capture, label, yaw, pitch, rt, linear_rt, world, output, step)))
                    counts["image_frames_written"] += 1
        missing = [row["file"] for row in images if not row["sha256"]]
        if missing:
            raise RuntimeError("RenderTarget export did not produce files: " + ", ".join(missing))
        report = {
            "status": "complete", "visual_acceptance": False, "project": unreal.Paths.get_project_file_path(),
            "capture_script_sha256": _sha256(__file__),
            "system_path": SYSTEM_PATH, "source_sha256": SOURCE_SHA256,
            "source_copy_package_sha256": _copied_package_hash(SYSTEM_PATH),
            "capture_started_unix": started, "capture_finished_unix": time.time(),
            "settings": {"fixed_dt_seconds": DT, "steps": LAST_STEP, "duration_seconds": LAST_STEP * DT,
                         "image_steps": list(IMAGE_STEPS), "views": [x[0] for x in CAPTURES],
                         "resolution": [WIDTH, HEIGHT], "projection": "orthographic",
                         "orthographic_width_cm": ORTHO_WIDTH, "target_cm": list(CAMERA_TARGET),
                         "camera_distance_cm": CAMERA_DISTANCE, "capture_source": "FinalColorLDR",
                         "background": "black opaque", "show_only": "pilot Niagara actor",
                         "exposure": "manual 0 bias, physical camera exposure disabled; bloom 0"},
            "seed_configuration": seed_status, "counts": counts,
            "renderer_textures": texture_rows,
            "particle_probe_available": bool(probe and hasattr(probe, "read_particles")),
            "particle_samples": particle_steps, "images": images, "empty_baseline": baseline,
            "linear_reference": 'RGB SceneColor HDR before tone mapping at step120; Radiance export discards alpha',
            "limitations": ["LDR tone-mapped output; alpha/transparency is not evidence.",
                            "Camera framing and manual exposure need visual review on the rendered pilot."]}
        with open(os.path.join(output, "capture-report.json"), "w", encoding="utf-8") as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
    finally:
        _cleanup_actors()


@AutomationScheduler.add_latent_command
def capture_reference():
    try:
        yield from run()
    except Exception:
        _cleanup_actors()
        try:
            output = _args().get("output")
            if output and os.path.isdir(output):
                with open(os.path.join(output, "capture-error.txt"), "w", encoding="utf-8") as stream:
                    stream.write(traceback.format_exc())
        except Exception:
            pass
        raise
