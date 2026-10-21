"""Capture one continuous Niagara system run at fixed simulation steps.

Run only in the isolated ST01c_Pilot editor project with -SystemSpec=<absolute
systems/*.json> (system, source SHA and the spec capture block) and
-CaptureRun=<fresh name>. Outputs are kept under .scratch/unreal/<run>/ and the
destination must be fresh.
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
# Spec the library mode (capture_color.py, capture_depth.py) takes its pilot constants from.
PILOT_SPEC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "systems", "ns-flame-single.json")
# The capture block of a spec holds exactly these keys; the set is fixed.
CAPTURE_KEYS = ("dt", "lastStep", "imageSteps", "linearStep", "imageSize", "cameras",
                "cameraTarget", "cameraDistance", "orthoWidth", "textures")
_LIVE_ACTORS = []


def _number(value, key, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) \
            or (positive and value <= 0):
        raise ValueError("spec %s must be a%s number" % (key, " positive" if positive else " finite"))
    return float(value)


def _integer(value, key, minimum):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError("spec %s must be an integer >= %d" % (key, minimum))
    return value


def load_capture_spec(path):
    """Read and validate a systems/*.json spec for the capture. Every problem raises
    ValueError naming the offending key (capture keys are named capture.<key>)."""
    with open(path, "r", encoding="utf-8") as stream:
        spec = json.load(stream)
    if not isinstance(spec, dict) or spec.get("schema") != "st01c-system-spec/v1":
        raise ValueError("spec schema must be st01c-system-spec/v1")
    package = spec.get("systemPackage")
    if not isinstance(package, str) or not package.startswith("/Game/"):
        raise ValueError("spec systemPackage must be a /Game package path")
    sha = spec.get("sourceSystemSha256")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha):
        raise ValueError("spec sourceSystemSha256 must be 64 lowercase hex characters")
    block = spec.get("capture")
    if not isinstance(block, dict):
        raise ValueError("spec capture must be an object with the keys: " + ", ".join(CAPTURE_KEYS))
    for key in block:
        if key not in CAPTURE_KEYS:
            raise ValueError("spec capture.%s is not a capture key" % key)
    for key in CAPTURE_KEYS:
        if key not in block:
            raise ValueError("spec capture.%s is required" % key)
    dt = _number(block["dt"], "capture.dt", True)
    last_step = _integer(block["lastStep"], "capture.lastStep", 1)
    image_steps = block["imageSteps"]
    if not isinstance(image_steps, list) or not image_steps:
        raise ValueError("spec capture.imageSteps must be a non-empty list of integers")
    image_steps = tuple(_integer(step, "capture.imageSteps", 1) for step in image_steps)
    if len(set(image_steps)) != len(image_steps) or max(image_steps) > last_step:
        raise ValueError("spec capture.imageSteps must be unique and not beyond capture.lastStep")
    linear_step = _integer(block["linearStep"], "capture.linearStep", 1)
    if linear_step not in image_steps:
        raise ValueError("spec capture.linearStep must be one of capture.imageSteps")
    size = _integer(block["imageSize"], "capture.imageSize", 16)
    cameras = block["cameras"]
    if not isinstance(cameras, list) or not cameras:
        raise ValueError("spec capture.cameras must be a non-empty list of {name, yaw, pitch}")
    rows = []
    for camera in cameras:
        if not isinstance(camera, dict) or sorted(camera) != ["name", "pitch", "yaw"]:
            raise ValueError("spec capture.cameras entries must be exactly {name, yaw, pitch}")
        if not isinstance(camera["name"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,24}", camera["name"]):
            raise ValueError("spec capture.cameras name must be 1-24 letters, digits, _ or -")
        rows.append((camera["name"], _number(camera["yaw"], "capture.cameras yaw"),
                     _number(camera["pitch"], "capture.cameras pitch")))
    if len(set(row[0] for row in rows)) != len(rows):
        raise ValueError("spec capture.cameras names must be unique")
    target = block["cameraTarget"]
    if not isinstance(target, list) or len(target) != 3:
        raise ValueError("spec capture.cameraTarget must be a list of 3 numbers")
    target = tuple(_number(v, "capture.cameraTarget") for v in target)
    distance = _number(block["cameraDistance"], "capture.cameraDistance", True)
    ortho = _number(block["orthoWidth"], "capture.orthoWidth", True)
    textures = block["textures"]
    if not isinstance(textures, list):
        raise ValueError("spec capture.textures must be a list of /Game package paths")
    for texture in textures:
        if not isinstance(texture, str) or not re.fullmatch(r"/Game/[A-Za-z0-9_/-]+/[A-Za-z0-9_-]+", texture):
            raise ValueError("spec capture.textures must be a list of /Game package paths")
    if len(set(t.rsplit("/", 1)[1] for t in textures)) != len(textures):
        raise ValueError("spec capture.textures must not repeat a texture name")
    return {"system_path": package, "source_sha256": sha, "dt": dt, "last_step": last_step,
            "image_steps": image_steps, "linear_step": linear_step, "size": size, "cameras": tuple(rows),
            "target": target, "distance": distance, "ortho_width": ortho, "textures": tuple(textures)}


def _command_line_value(name):
    """Value of -name=... from the command line; handles a whole-argument quote and spaces."""
    line = unreal.SystemLibrary.get_command_line()
    match = re.search(r'-' + name + '=', line, re.IGNORECASE)
    if not match:
        return None
    rest = line[match.end():]
    if match.start() > 0 and line[match.start() - 1] == '"':
        return rest.split('"', 1)[0]
    if rest.startswith('"'):
        return rest[1:].split('"', 1)[0]
    return rest.split()[0] if rest.split() else None


def _args():
    raw = unreal.SystemLibrary.get_command_line()
    options = {"spec": _command_line_value("SystemSpec")}
    run_id = re.search(r'-CaptureRun=([A-Za-z0-9_-]{1,40})(?:\s|$)', raw)
    if run_id:
        options["output"] = os.path.join(PROJECT_ROOT, '.scratch', 'unreal', run_id.group(1))
        return options
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


def _capture_pose(capture_component, label, yaw, pitch, rt, linear_rt, world, output, step, spec):
    yaw_r = math.radians(yaw)
    pitch_r = math.radians(pitch)
    target = spec["target"]
    distance = spec["distance"]
    offset = (distance * math.cos(pitch_r) * math.cos(yaw_r),
              distance * math.cos(pitch_r) * math.sin(yaw_r),
              distance * math.sin(pitch_r))
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
    if step == spec["linear_step"]:
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
            "step": step, "time_seconds": step * spec["dt"], "camera": label,
            "yaw_degrees": yaw, "pitch_degrees": pitch,
            "position_cm": list(origin), "target_cm": list(target),
            "rotation_degrees": {"pitch": capture_component.get_world_rotation().pitch,
                                 "yaw": capture_component.get_world_rotation().yaw,
                                 "roll": capture_component.get_world_rotation().roll},
            "sha256": _sha256(fullpath) if os.path.isfile(fullpath) else None}


def run():
    args = _args()
    # No default system: a missing spec stops here, before anything touches Unreal.
    spec_path = args.get("spec")
    if not spec_path:
        raise RuntimeError("Pass -SystemSpec=<absolute path of systems/*.json>; there is no default system")
    if not os.path.isabs(spec_path) or not os.path.isfile(spec_path):
        raise RuntimeError("-SystemSpec must be an absolute path of an existing spec file: " + spec_path)
    spec = load_capture_spec(spec_path)
    system_path = spec["system_path"]
    dt = spec["dt"]
    last_step = spec["last_step"]
    image_steps = spec["image_steps"]
    cameras = spec["cameras"]
    size = spec["size"]
    with open(spec_path, "r", encoding="utf-8") as stream:
        spec_text = stream.read()
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
    system = unreal.load_asset(system_path)
    if not system:
        raise RuntimeError("Could not load exact pilot system: " + system_path)
    if _copied_package_hash(system_path) != spec["source_sha256"]:
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
    if probe and hasattr(probe, "configure_system"):
        # The plugin gates ReadParticles and PrepareCapture on this system and its capture textures.
        result = probe.configure_system(system, spec_text)
        seed_status = {"available": True, "result": json.loads(result) if isinstance(result, str) else result}
        if isinstance(seed_status["result"], dict) and seed_status["result"].get("error"):
            raise RuntimeError("Deterministic seed setup failed: " + str(seed_status["result"]))
    component.set_asset(system)

    texture_rows = []
    for texture_path in spec["textures"]:
        texture_name = texture_path.rsplit("/", 1)[1]
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

    rt = unreal.RenderingLibrary.create_render_target2d(world, size, size, unreal.TextureRenderTargetFormat.RTF_RGBA8,
                                                       unreal.LinearColor(0.0, 0.0, 0.0, 1.0), False, False)
    linear_rt = unreal.RenderingLibrary.create_render_target2d(world, size, size, unreal.TextureRenderTargetFormat.RTF_RGBA16F,
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
    capture.ortho_width = spec["ortho_width"]
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
    counts = {"simulation_steps": 0, "image_frames_expected": len(image_steps) * len(cameras),
              "image_frames_written": 0, "particle_steps_expected": last_step + 1,
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
        particle_steps.append({"step": step, "time_seconds": step * dt,
                               "file": os.path.relpath(path, output).replace("\\", "/"),
                               "particle_count": sum(len(e.get("particles", [])) for e in data.get("emitters", []))})
        counts["particle_steps_written"] += 1

    try:
        read_particles(0)
        # The baseline is the first camera of the spec at step 0 (empty effect).
        baseline = yield from _capture_pose(capture, cameras[0][0], cameras[0][1], cameras[0][2],
                                            rt, linear_rt, world, output, 0, spec)
        for step in range(1, last_step + 1):
            component.set_paused(False)
            component.advance_simulation(1, dt)
            component.set_paused(True)
            counts["simulation_steps"] += 1
            read_particles(step)
            if step in image_steps:
                preparation = json.loads(probe.prepare_capture(component))
                if preparation.get('error'):
                    raise RuntimeError('Capture preparation failed: ' + str(preparation))
                for _ in range(3):
                    yield
                for label, yaw, pitch in cameras:
                    images.append((yield from _capture_pose(capture, label, yaw, pitch, rt, linear_rt, world, output, step, spec)))
                    counts["image_frames_written"] += 1
        missing = [row["file"] for row in images if not row["sha256"]]
        if missing:
            raise RuntimeError("RenderTarget export did not produce files: " + ", ".join(missing))
        report = {
            "status": "complete", "visual_acceptance": False, "project": unreal.Paths.get_project_file_path(),
            "capture_script_sha256": _sha256(__file__),
            "system_path": system_path, "source_sha256": spec["source_sha256"],
            "source_copy_package_sha256": _copied_package_hash(system_path),
            "system_spec": {"file": os.path.basename(spec_path), "sha256": _sha256(spec_path)},
            "capture_started_unix": started, "capture_finished_unix": time.time(),
            "settings": {"fixed_dt_seconds": dt, "steps": last_step, "duration_seconds": last_step * dt,
                         "image_steps": list(image_steps), "views": [x[0] for x in cameras],
                         "resolution": [size, size], "projection": "orthographic",
                         "orthographic_width_cm": spec["ortho_width"], "target_cm": list(spec["target"]),
                         "camera_distance_cm": spec["distance"], "capture_source": "FinalColorLDR",
                         "background": "black opaque", "show_only": "pilot Niagara actor",
                         "exposure": "manual 0 bias, physical camera exposure disabled; bloom 0"},
            "seed_configuration": seed_status, "counts": counts,
            "renderer_textures": texture_rows,
            "particle_probe_available": bool(probe and hasattr(probe, "read_particles")),
            "particle_samples": particle_steps, "images": images, "empty_baseline": baseline,
            "linear_reference": 'RGB SceneColor HDR before tone mapping at step%d; Radiance export discards alpha' % spec["linear_step"],
            "limitations": ["LDR tone-mapped output; alpha/transparency is not evidence.",
                            "Camera framing and manual exposure need visual review on the rendered pilot."]}
        with open(os.path.join(output, "capture-report.json"), "w", encoding="utf-8") as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
    finally:
        _cleanup_actors()


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


# Share bounded capture utilities without scheduling the original experiment.
if globals().get('ST01C_LIBRARY_ONLY', False):
    # Library users (capture_color.py, capture_depth.py) work on the pilot: read their constants
    # from its spec file. Nothing is taken from the command line here.
    _PILOT = load_capture_spec(PILOT_SPEC)
    SYSTEM_PATH = _PILOT["system_path"]
    SOURCE_SHA256 = _PILOT["source_sha256"]
    CAPTURES = _PILOT["cameras"]
else:
    AutomationScheduler.add_latent_command(capture_reference)
