"""Capture NS_BasicHit with opaque black planes under it, under the controlled color profile "controlled-sdr/v1".

Same invocation, inputs and refusals as capture_reference_profiled.py, plus -SurfaceSpec=<absolute path of a
st01c-surface-spec/v1 file> (refused when missing; surface_spec.py loads it strictly against the system spec). The steps of
capture_reference_profiled.py hold: capture_reference.py runs as a library, the profile of capture_profile.py is applied
while run() waits its first editor frames, and the per-pose capture CR['_capture_pose'] is replaced. This driver changes
only the poses. Per image step and camera of the system spec it writes, in the order of surface_spec.step_poses,
- the control (no plane in the scene), file names and bytes as capture_reference_profiled.py writes them;
- one pose per wall of that camera (a plane facing the camera at an offset from the camera target), then its floors: the
  one black plane actor is moved to the pose and joins the effect in the capture's show-only list. Every pose writes the
  LDR PNG (FinalColorLDR) and the raw .rgba16f (SceneColor HDR) as the control does, and the Radiance .hdr at the linear
  step. Surface poses record visible_pixels_gt16 and never raise on a blank frame (a wall in front can hide everything);
- at the spec depthStep, a SceneDepth capture into an RGBA32F target, written as frames/t%04d_<label>_depth.f32 (float32 R,
  top row first; KismetRenderingLibrary.cpp ReadRenderTargetHelper reads PF_FloatRGBA and PF_A32B32G32R32F only).
The control rows stay in capture-report.json images (run() counts them); the surface rows go in surface_images, each with
its "surface" geometry and depth file, beside the surface spec path and sha256. The plane has no collision and is parked
far below the level between image steps, so the simulation does not see it.
Wrapper (outside git): .scratch/unreal/Content/Python/test_st01c_depth_profiled.py doing runpy.run_path on this file.
"""
import json
import math
import os
import runpy
import struct
import traceback

import unreal
from unreal_pythonautomationtest import AutomationScheduler
unreal.AutomationScheduler = AutomationScheduler

HERE = os.path.dirname(os.path.abspath(__file__))
LIBRARY_FILE = os.path.join(HERE, 'capture_reference.py')
PROFILE_FILE = os.path.join(HERE, 'capture_profile.py')
SURFACE_FILE = os.path.join(HERE, 'surface_spec.py')
# As capture_reference_profiled.py:32-36.
LIB = runpy.run_path(LIBRARY_FILE, init_globals={'ST01C_LIBRARY_ONLY': True})
CR = LIB['run'].__globals__
PROFILE = runpy.run_path(PROFILE_FILE)
SURFACE = runpy.run_path(SURFACE_FILE)
ROOT = CR['PROJECT_ROOT']
WRAPPER_FILE = os.path.join(ROOT, '.scratch', 'unreal', 'Content', 'Python', 'test_st01c_depth_profiled.py')
PLANE_MESH = '/Engine/BasicShapes/Plane'
PARKED = unreal.Vector(0., 0., -100000.)
STATE = {}


def _rel(path):
    return os.path.relpath(path, ROOT).replace('\\', '/')


def _load_surface():
    """-SurfaceSpec is required. Returns (surface spec, raw system capture block, surface spec path). Called before
    run() so a refusal leaves no output folder."""
    path = CR['_command_line_value']('SurfaceSpec')
    if not path:
        raise RuntimeError('Pass -SurfaceSpec=<absolute path of a st01c-surface-spec/v1 file>; there are no default surfaces')
    if not os.path.isabs(path) or not os.path.isfile(path):
        raise RuntimeError('-SurfaceSpec must be an absolute path of an existing surface spec file: ' + path)
    with open(CR['_args']()['spec'], 'r', encoding='utf-8') as stream:
        capture = json.load(stream)['capture']
    return SURFACE['load_surface_spec'](path, capture), capture, path


def _black_material():
    """capture_depth.py:27-43 material(name, False) with a fixed name: opaque, unlit, two-sided, emissive black. New objects
    live only in this process's scratch project; no package is saved."""
    material = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        'ST01c_SurfaceBlack', '/Game/ST01c_DepthTransient', unreal.Material, unreal.MaterialFactoryNew())
    material.set_editor_property('shading_model', unreal.MaterialShadingModel.MSM_UNLIT)
    material.set_editor_property('two_sided', True)
    material.set_editor_property('blend_mode', unreal.BlendMode.BLEND_OPAQUE)
    color = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionConstant3Vector, 0, 0)
    color.set_editor_property('constant', unreal.LinearColor(0., 0., 0., 1.))
    unreal.MaterialEditingLibrary.connect_material_property(color, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    unreal.MaterialEditingLibrary.recompile_material(material)
    return material


def _plane_actor(material, size_cm):
    """capture_depth.py:46-55 plane(mat, size_cm), plus no collision, parked until a pose moves it."""
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.StaticMeshActor, PARKED)
    CR['_LIVE_ACTORS'].append(actor)
    component = actor.get_component_by_class(unreal.StaticMeshComponent)
    component.set_mobility(unreal.ComponentMobility.MOVABLE)
    component.set_static_mesh(unreal.load_asset(PLANE_MESH))
    component.set_material(0, material)
    component.set_cast_shadow(False)
    component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    actor.set_actor_scale3d(unreal.Vector(size_cm / 100., size_cm / 100., 1.))
    return actor


def _place(actor, point, normal):
    """capture_depth.py:58-60 pose(): the plane (100 x 100 cm, normal +Z) centered on point with its normal on normal."""
    rotation = unreal.MathLibrary.make_rot_from_z(unreal.Vector(*[float(v) for v in normal]))
    actor.set_actor_location_and_rotation(unreal.Vector(*[float(v) for v in point]), rotation, False, False)


def _show_only(capture_component, with_plane):
    """The capture renders the effect, and the plane when with_plane. The list is rebuilt only when that changes, so the
    controls keep the list run() set (run() starts with the effect alone)."""
    if STATE['with_plane'] != with_plane:
        capture_component.clear_show_only_components()
        capture_component.show_only_actor_components(STATE['fx'])
        if with_plane:
            capture_component.show_only_actor_components(STATE['plane'])
        STATE['with_plane'] = with_plane


def _capture_one(capture_component, label, yaw, pitch, world, output, step, spec, gate, depth_file):
    """capture_reference_profiled.py _profiled_pose (:46-101) for one camera pose, with the gate optional and an optional
    SceneDepth capture (depth_file: its name, or None) after the HDR."""
    # capture_reference.py:179-188, camera placement unchanged.
    yaw_r = math.radians(yaw)
    pitch_r = math.radians(pitch)
    target = spec["target"]
    distance = spec["distance"]
    offset = (distance * math.cos(pitch_r) * math.cos(yaw_r),
              distance * math.cos(pitch_r) * math.sin(yaw_r),
              distance * math.sin(pitch_r))
    origin = tuple(target[i] + offset[i] for i in range(3))
    capture_component.set_world_location(unreal.Vector(*origin), False, False)
    capture_component.set_world_rotation(CR['_look_at'](origin, target), False, False)
    ldr, hdr, size = STATE['ldr'], STATE['hdr'], spec['size']
    frames = os.path.join(output, 'frames')
    capture_component.texture_target = ldr
    capture_component.capture_source = unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR
    yield from PROFILE['warm_capture'](capture_component, world, ldr)
    pixels = unreal.RenderingLibrary.read_render_target(world, ldr, False)
    visible_pixels = sum(1 for p in pixels if max(p.r, p.g, p.b) > 16)
    if gate and step > 0 and visible_pixels < 100:
        raise RuntimeError('Blank reference capture at step %d / %s' % (step, label))
    filename = "t%04d_%s.png" % (step, label)
    unreal.RenderingLibrary.export_render_target(world, ldr, frames, filename)
    capture_component.texture_target = hdr
    capture_component.capture_source = unreal.SceneCaptureSource.SCS_SCENE_COLOR_HDR
    yield from PROFILE['warm_capture'](capture_component, world, hdr)
    raw = unreal.RenderingLibrary.read_render_target_raw(world, hdr, False)
    payload = PROFILE['pack_rgba16f'](raw, size, size)
    raw_name = 't%04d_%s_hdr.rgba16f' % (step, label)
    with open(os.path.join(frames, raw_name), 'wb') as stream:
        stream.write(payload)
    linear = None
    if step == spec["linear_step"]:
        linear_name = 't%04d_%s_linear.hdr' % (step, label)
        unreal.RenderingLibrary.export_render_target(world, hdr, frames, linear_name)
        linear = {'file': 'frames/' + linear_name, 'sha256': CR['_sha256'](os.path.join(frames, linear_name))}
    depth = None
    if depth_file:
        # SceneDepth into the RGBA32F target, R channel as float32, top row first.
        depth_rt = STATE['depth']
        capture_component.texture_target = depth_rt
        capture_component.capture_source = unreal.SceneCaptureSource.SCS_SCENE_DEPTH
        yield from PROFILE['warm_capture'](capture_component, world, depth_rt)
        samples = unreal.RenderingLibrary.read_render_target_raw(world, depth_rt, False)
        if len(samples) != size * size:
            raise RuntimeError('Unexpected depth readback size %d at %s' % (len(samples), depth_file))
        values = [sample.r for sample in samples]
        with open(os.path.join(frames, depth_file), 'wb') as stream:
            stream.write(struct.pack('<%df' % len(values), *values))
        depth = {'file': 'frames/' + depth_file, 'sha256': CR['_sha256'](os.path.join(frames, depth_file)),
                 'encoding': SURFACE['DEPTH_ENCODING'], 'bytes': 4 * len(values), 'width': size, 'height': size,
                 'center_depth_cm': SURFACE['center_depth'](values, size)}
    capture_component.texture_target = ldr
    capture_component.capture_source = unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR
    fullpath = os.path.join(frames, filename)
    rotation = capture_component.get_world_rotation()
    return {"file": "frames/" + filename, "linear": linear,
            "hdr_raw": {"file": "frames/" + raw_name, "sha256": CR['_sha256'](os.path.join(frames, raw_name)),
                        "encoding": PROFILE['RAW_ENCODING'], "bytes": len(payload), "width": size, "height": size},
            "depth": depth,
            "visible_pixels_gt16": visible_pixels, "capture_attempts": PROFILE['WARMUP_CAPTURES'],
            "step": step, "time_seconds": step * spec["dt"], "camera": label,
            "yaw_degrees": yaw, "pitch_degrees": pitch,
            "position_cm": list(origin), "target_cm": list(target),
            "rotation_degrees": {"pitch": rotation.pitch, "yaw": rotation.yaw, "roll": rotation.roll},
            "sha256": CR['_sha256'](fullpath) if os.path.isfile(fullpath) else None}


def _depth_pose(capture_component, label, yaw, pitch, rt, linear_rt, world, output, step, spec):
    """Stands in for capture_reference.py _capture_pose inside run(); same arguments, returns the control row. At an image
    step the surface poses of this camera follow the control; their rows go to STATE['surface_rows']. rt and linear_rt are
    not used."""
    plane = STATE['plane']
    _show_only(capture_component, False)
    control = yield from _capture_one(capture_component, label, yaw, pitch, world, output, step, spec, True, None)
    if step not in spec['image_steps']:
        return control
    surface = STATE['surface']
    for pose in SURFACE['surface_poses'](surface, STATE['capture']):
        if pose['camera'] != label:
            continue
        _place(plane, pose['pointCm'], pose['normal'])
        _show_only(capture_component, True)
        depth_file = None
        if step == surface['depthStep']:
            depth_file = 't%04d_%s_depth.%s' % (step, pose['label'], SURFACE['DEPTH_EXTENSION'])
        row = yield from _capture_one(capture_component, pose['label'], yaw, pitch, world, output, step, spec, False, depth_file)
        row['view'] = label
        row['surface'] = SURFACE['surface_record'](pose)
        STATE['surface_rows'].append(row)
    plane.set_actor_location(PARKED, False, False)
    return control


def _apply_profile():
    """capture_reference_profiled.py _apply_profile (:104-127), plus the plane and the depth target created here, before the
    effect is activated and before run() waits its frames (the material compiles meanwhile)."""
    spec = CR['load_capture_spec'](CR['_args']()['spec'])
    world = unreal.EditorLevelLibrary.get_editor_world()
    captures = [actor for actor in CR['_LIVE_ACTORS'] if actor.get_component_by_class(unreal.SceneCaptureComponent2D)]
    if len(captures) != 1:
        raise RuntimeError('Expected the one SceneCapture2D of capture_reference.py run(), found %d' % len(captures))
    effects = [actor for actor in CR['_LIVE_ACTORS'] if actor.get_component_by_class(unreal.NiagaraComponent)]
    if len(effects) != 1:
        raise RuntimeError('Expected the one Niagara actor of capture_reference.py run(), found %d' % len(effects))
    capture = captures[0].get_component_by_class(unreal.SceneCaptureComponent2D)
    volumes = PROFILE['disable_postprocess_volumes'](world)
    cvars = PROFILE['apply_cvars'](world)
    ldr, hdr = PROFILE['create_targets'](world, spec['size'])
    depth = unreal.RenderingLibrary.create_render_target2d(world, spec['size'], spec['size'],
        unreal.TextureRenderTargetFormat.RTF_RGBA32F, unreal.LinearColor(0., 0., 0., 1.), False, False)
    PROFILE['configure_capture'](capture)
    post_process = PROFILE['profile'](capture, PROFILE['EXPOSURE_BIAS'])
    plane = _plane_actor(_black_material(), STATE['surface']['sizeCm'])
    STATE.update(ldr=ldr, hdr=hdr, depth=depth, fx=effects[0], plane=plane, with_plane=False, surface_rows=[])
    return {'id': PROFILE['PROFILE_ID'], 'source': 'tools/unreal-niagara-probe/capture_color.py through capture_profile.py',
            'exposure_bias': PROFILE['EXPOSURE_BIAS'], 'cvars_requested': PROFILE['CVARS'], 'cvars_readback': cvars,
            'disabled_postprocess_volumes': volumes, 'post_process': post_process,
            'requested': {'ldr_target': {'format': PROFILE['LDR_FORMAT'], 'target_gamma': PROFILE['LDR_TARGET_GAMMA']},
                          'hdr_target': {'format': PROFILE['HDR_FORMAT']},
                          'always_persist_rendering_state': PROFILE['ALWAYS_PERSIST_RENDERING_STATE'],
                          'show_flags_off': list(PROFILE['SHOW_FLAGS_OFF']),
                          'warmup_captures_per_target': PROFILE['WARMUP_CAPTURES']},
            'readback': PROFILE['read_back'](capture, ldr, hdr)}


def _finish_report(profile, output):
    """capture_reference_profiled.py _finish_report (:130-168), plus the surface rows, the surface spec and its code."""
    path = os.path.join(output, 'capture-report.json')
    with open(path, 'r', encoding='utf-8') as stream:
        report = json.load(stream)
    if report.get('status') != 'complete':
        raise RuntimeError('capture_reference.py run() did not complete its report')
    surface_rows = STATE['surface_rows']
    expected = len(SURFACE['surface_poses'](STATE['surface'], STATE['capture'])) * len(report['settings']['image_steps'])
    if len(surface_rows) != expected:
        raise RuntimeError('Expected %d surface poses, captured %d' % (expected, len(surface_rows)))
    for row in [report['empty_baseline']] + report['images'] + surface_rows:
        if not row.get('hdr_raw') or not os.path.isfile(os.path.join(output, row['hdr_raw']['file'])):
            raise RuntimeError('Missing raw HDR for ' + row['file'])
    sha = CR['_sha256']
    code = [{'role': 'driver', 'file': _rel(os.path.abspath(__file__)), 'sha256': sha(os.path.abspath(__file__))},
            {'role': 'surface', 'file': _rel(SURFACE_FILE), 'sha256': sha(SURFACE_FILE)},
            {'role': 'profile', 'file': _rel(PROFILE_FILE), 'sha256': sha(PROFILE_FILE)},
            {'role': 'library', 'file': _rel(LIBRARY_FILE), 'sha256': sha(LIBRARY_FILE)},
            {'role': 'wrapper', 'file': _rel(WRAPPER_FILE), 'sha256': sha(WRAPPER_FILE) if os.path.isfile(WRAPPER_FILE) else None}]
    report['capture_profile'] = profile
    report['capture_code'] = code
    report['surface_spec'] = {'file': _rel(STATE['surface_path']), 'sha256': sha(STATE['surface_path'])}
    report['surface_images'] = surface_rows
    report['settings'].update({
        'color_profile': PROFILE['PROFILE_ID'],
        'ldr_target': '%s, target_gamma %s' % (PROFILE['LDR_FORMAT'], PROFILE['LDR_TARGET_GAMMA']),
        'hdr_capture': 'SceneColorHDR into %s; raw %s; every image step and the step-0 baseline' % (
            PROFILE['HDR_FORMAT'], PROFILE['RAW_ENCODING']),
        'warmup_captures_per_target': PROFILE['WARMUP_CAPTURES'],
        'exposure': ('controlled-sdr/v1: manual at 0 EV, physical camera exposure off, PreExposureOverride 1; bloom, '
                     'vignette, grain and fringe 0; Filmic constants and neutral grading of capture_color.py, no LUT'),
        'surfaces': 'one opaque black unlit two-sided plane actor, %s cm, in the show-only list of the surface poses only' % (
            STATE['surface']['sizeCm']),
        'depth_capture': 'SceneDepth into RTF_RGBA32F at step %d; %s' % (STATE['surface']['depthStep'], SURFACE['DEPTH_ENCODING'])})
    report['linear_reference'] = ('Raw RGBA16F SceneColor HDR before tone mapping at every image step and the baseline '
                                  '(frames/*_hdr.rgba16f, alpha kept); the Radiance .hdr of the linear step is a '
                                  'diagnostic only (shared exponent, alpha discarded)')
    report['limitations'] = ['LDR tone-mapped output under controlled-sdr/v1; alpha/transparency is not evidence.',
                             'The profile is the pilot color lab profile, not a game look: bloom and grading are off.']
    files = []
    for folder, _, names in os.walk(output):
        for name in names:
            full = os.path.join(folder, name)
            relative = os.path.relpath(full, output).replace('\\', '/')
            if relative != 'capture-report.json':
                files.append({'file': relative, 'sha256': sha(full), 'bytes': os.path.getsize(full)})
    report['files'] = sorted(files, key=lambda row: row['file'])
    with open(path, 'w', encoding='utf-8') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, default=str)


def capture_depth_profiled():
    # The surface spec is read and refused before run(): a refusal must not leave an output folder, and freshness is read
    # before run() as capture_reference_profiled.py does.
    surface, capture, surface_path = _load_surface()
    STATE.update(surface=surface, capture=capture, surface_path=surface_path)
    output = os.path.abspath(CR['_args']()['output'])
    fresh = not os.path.exists(output) or not os.listdir(output)
    CR['_capture_pose'] = _depth_pose
    run = CR['run']()
    profile = None
    try:
        for _ in run:
            if profile is None:
                profile = _apply_profile()
            yield
        if profile is None:
            raise RuntimeError('capture_reference.py run() ended without an editor frame')
        _finish_report(profile, output)
    except Exception:
        run.close()
        CR['_cleanup_actors']()
        # capture_reference.py:437-446: the traceback stays beside the run (only in a folder this run created).
        if fresh and os.path.isdir(output):
            try:
                with open(os.path.join(output, 'capture-error.txt'), 'w', encoding='utf-8') as stream:
                    stream.write(traceback.format_exc())
            except Exception:
                pass
        raise


# The plugin ends a latent run after 300 s by default (PythonAutomationTest.cpp:19); 33 poses with 8 to 12 warm-up
# captures and 1024x1024 readbacks each need more. 540 s keeps the editor exiting by itself before a 600 s caller timeout.
LATENT_TIMEOUT_SECONDS = 540.
AutomationScheduler.set_latent_command_timeout(LATENT_TIMEOUT_SECONDS)
AutomationScheduler.add_latent_command(capture_depth_profiled)
