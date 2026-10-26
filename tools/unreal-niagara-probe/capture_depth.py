"""Controlled DepthFade reference. Transient geometry/materials; no asset saves."""
import json
import math
import os
import re
import runpy
import traceback
import unreal
from unreal_pythonautomationtest import AutomationScheduler
unreal.AutomationScheduler = AutomationScheduler

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
LIB = runpy.run_path(os.path.join(os.path.dirname(__file__), 'capture_reference.py'),
                     init_globals={'ST01C_LIBRARY_ONLY': True})
TARGET = (0., 0., 100.)
VIEWS = (('front', 0., 0.), ('oblique', 45., 20.), ('side', 90., 0.))
SHA = LIB['_sha256']


def output_dir():
    match = re.search(r'-DepthRun=([A-Za-z0-9_-]{1,40})(?:\s|$)', unreal.SystemLibrary.get_command_line())
    if not match:
        raise RuntimeError('Pass a fresh -DepthRun=name')
    return os.path.join(ROOT, '.scratch', 'unreal', match.group(1))


def material(name, translucent):
    # New objects live only in this process's scratch project; never save packages.
    m = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        name, '/Game/ST01c_DepthTransient', unreal.Material, unreal.MaterialFactoryNew())
    m.set_editor_property('shading_model', unreal.MaterialShadingModel.MSM_UNLIT)
    m.set_editor_property('two_sided', True)
    m.set_editor_property('blend_mode', unreal.BlendMode.BLEND_TRANSLUCENT if translucent else unreal.BlendMode.BLEND_OPAQUE)
    color = unreal.MaterialEditingLibrary.create_material_expression(m, unreal.MaterialExpressionConstant3Vector, 0, 0)
    color.set_editor_property('constant', unreal.LinearColor(1., 1., 1., 1.) if translucent else unreal.LinearColor(0., 0., 0., 1.))
    unreal.MaterialEditingLibrary.connect_material_property(color, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    if translucent:
        fade = unreal.MaterialEditingLibrary.create_material_expression(m, unreal.MaterialExpressionDepthFade, 0, 100)
        fade.set_editor_property('fade_distance_default', 100.)
        fade.set_editor_property('opacity_default', 1.)
        unreal.MaterialEditingLibrary.connect_material_property(fade, '', unreal.MaterialProperty.MP_OPACITY)
    unreal.MaterialEditingLibrary.recompile_material(m)
    return m


def plane(mat, size_cm):
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector())
    LIB['_LIVE_ACTORS'].append(actor)
    component = actor.get_component_by_class(unreal.StaticMeshComponent)
    component.set_mobility(unreal.ComponentMobility.MOVABLE)
    component.set_static_mesh(unreal.load_asset('/Engine/BasicShapes/Plane'))
    component.set_material(0, mat)
    component.set_cast_shadow(False)
    actor.set_actor_scale3d(unreal.Vector(size_cm / 100., size_cm / 100., 1.))
    return actor


def pose(actor, position, normal):
    rotation = unreal.MathLibrary.make_rot_from_z(unreal.Vector(*normal))
    actor.set_actor_location_and_rotation(unreal.Vector(*position), rotation, False, False)


def capture_case(capture, rt, world, output, name, camera_name, gap, normal, origin, actors):
    capture.clear_show_only_components()
    for actor in actors:
        capture.show_only_actor_components(actor)
    capture.set_world_location(unreal.Vector(*origin), False, False)
    capture.set_world_rotation(LIB['_look_at'](origin, TARGET), False, False)
    world.send_all_end_of_frame_updates() if hasattr(world, 'send_all_end_of_frame_updates') else None
    for _ in range(4):
        capture.capture_scene()
        yield
        yield
        # Readback fences render work before the next scene/camera is changed.
        unreal.RenderingLibrary.read_render_target_raw(world, rt, False)
    filename = name + '_' + camera_name + '.hdr'
    unreal.RenderingLibrary.export_render_target(world, rt, output, filename)
    path = os.path.join(output, filename)
    if not os.path.isfile(path):
        raise RuntimeError('Missing depth HDR: ' + filename)
    return {'case': name, 'camera': camera_name, 'gap_cm': gap, 'normal_ue': list(normal),
            'position_cm': list(origin), 'target_cm': list(TARGET), 'file': filename,
            'sha256': SHA(path)}


def run():
    output = output_dir()
    if os.path.normcase(os.path.abspath(unreal.Paths.get_project_file_path())) != os.path.normcase(LIB['PROJECT_FILE']):
        raise RuntimeError('Scratch project required')
    if os.path.exists(output):
        raise RuntimeError('Fresh depth run required')
    os.makedirs(output)
    world = unreal.EditorLevelLibrary.get_editor_world()
    system = unreal.load_asset(LIB['SYSTEM_PATH'])
    if LIB['_copied_package_hash'](LIB['SYSTEM_PATH']) != LIB['SOURCE_SHA256']:
        raise RuntimeError('Pilot hash mismatch')
    probe = unreal.ST01cRuntimeProbe
    seed = json.loads(probe.configure_pilot(system))
    if seed.get('error'):
        raise RuntimeError(str(seed))
    fx = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.NiagaraActor, unreal.Vector())
    LIB['_LIVE_ACTORS'].append(fx)
    component = fx.get_component_by_class(unreal.NiagaraComponent)
    component.set_editor_property('auto_activate', False)
    component.set_force_solo(True)
    component.set_asset(system)
    black = material('Black', False)
    white = material('CalibrationDepthFade', True)
    surface = plane(black, 1200.)
    quad = plane(white, 100.)
    rt = unreal.RenderingLibrary.create_render_target2d(world, 512, 512,
        unreal.TextureRenderTargetFormat.RTF_RGBA16F, unreal.LinearColor(0., 0., 0., 1.), False, False)
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.SceneCapture2D, unreal.Vector())
    LIB['_LIVE_ACTORS'].append(actor)
    capture = actor.get_component_by_class(unreal.SceneCaptureComponent2D)
    capture.texture_target = rt
    capture.capture_source = unreal.SceneCaptureSource.SCS_SCENE_COLOR_HDR
    capture.primitive_render_mode = unreal.SceneCapturePrimitiveRenderMode.PRM_USE_SHOW_ONLY_LIST
    capture.capture_every_frame = False
    capture.capture_on_movement = False
    capture.projection_type = unreal.CameraProjectionMode.ORTHOGRAPHIC
    capture.ortho_width = 400.
    capture.set_editor_property('show_flag_settings', [unreal.EngineShowFlagsSetting(n, False) for n in
        ('Atmosphere', 'Fog', 'VolumetricFog', 'Cloud', 'DeferredAtmospherePass', 'SkyLighting', 'MotionBlur', 'Vignette')])
    for _ in range(120):
        yield
    component.activate(True)
    component.set_paused(True)
    preparation = json.loads(probe.prepare_capture(component))
    if preparation.get('error'):
        raise RuntimeError(str(preparation))
    # Match the accepted reference's activation/proxy initialization microtick.
    for _ in range(3):
        yield
    for step in range(120):
        component.set_paused(False)
        component.advance_simulation(1, 1. / 60.)
        component.set_paused(True)
    preparation = json.loads(probe.prepare_capture(component))
    if preparation.get('error'):
        raise RuntimeError(str(preparation))
    particles = json.loads(probe.read_particles(component))
    with open(os.path.join(output, 'particles.json'), 'w', encoding='utf8') as f:
        json.dump(particles, f, separators=(',', ':'))
    rows = []
    for label, yaw, pitch in VIEWS:
        y, p = math.radians(yaw), math.radians(pitch)
        normal = (math.cos(p) * math.cos(y), math.cos(p) * math.sin(y), math.sin(p))
        origin = tuple(TARGET[i] + normal[i] * 500. for i in range(3))
        rows.append((yield from capture_case(capture, rt, world, output, 'none', label, None, normal, origin, [fx])))
        for gap in (-25, 0, 50, 150):
            pose(surface, tuple(TARGET[i] - normal[i] * gap for i in range(3)), normal)
            rows.append((yield from capture_case(capture, rt, world, output, 'wall' + str(gap), label, gap, normal, origin, [surface, fx])))
        if label == 'oblique':
            pose(surface, (0., 0., 0.), (0., 0., 1.))
            rows.append((yield from capture_case(capture, rt, world, output, 'floor', label, None, (0., 0., 1.), origin, [surface, fx])))
    normal, origin = (1., 0., 0.), (500., 0., 100.)
    pose(quad, TARGET, normal)
    for gap in (-25, 0, 25, 50, 100, 150):
        pose(surface, (-gap, 0., 100.), normal)
        rows.append((yield from capture_case(capture, rt, world, output, 'calibration' + str(gap), 'front', gap, normal, origin, [surface, quad])))
    report = {'schema': 'st01c-depth-reference/v1', 'status': 'complete', 'date': '2026-10-14',
        'script_sha256': SHA(__file__), 'source_sha256': LIB['SOURCE_SHA256'], 'seed_configuration': seed,
        'particles_sha256': SHA(os.path.join(output, 'particles.json')),
        'settings': {'step': 120, 'dt': 1. / 60., 'resolution': [512, 512], 'orthographic_width_cm': 400.,
            'surface_size_cm': 1200., 'calibration_size_cm': 100., 'depth_fade_cm': 100.,
            'background': 'opaque black unlit surface and clear', 'capture': 'SceneColorHDR; RGBE export discards alpha',
            'custom_projection': capture.get_editor_property('use_custom_projection_matrix')},
        'images': rows, 'asset_saves': 0, 'gameplay_activation': False, 'visual_acceptance': False}
    with open(os.path.join(output, 'depth-report.json'), 'w', encoding='utf8') as f:
        json.dump(report, f, indent=2)


@AutomationScheduler.add_latent_command
def capture_depth():
    try:
        yield from run()
    except Exception:
        if os.path.isdir(output_dir()):
            with open(os.path.join(output_dir(), 'error.txt'), 'w') as f:
                f.write(traceback.format_exc())
        raise
    finally:
        LIB['_cleanup_actors']()
