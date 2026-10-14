"""Controlled Filmic SDR profile and source chart. Scratch process only, no saves."""
import json
import math
import os
import re
import runpy
import struct
import traceback
import unreal
from unreal_pythonautomationtest import AutomationScheduler
unreal.AutomationScheduler = AutomationScheduler
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
LIB = runpy.run_path(os.path.join(os.path.dirname(__file__), 'capture_reference.py'),
                     init_globals={'ST01C_LIBRARY_ONLY': True})
SHA = LIB['_sha256']
TARGET = (0., 0., 100.)


def output_dir():
    m = re.search(r'-ColorRun=([A-Za-z0-9_-]{1,40})(?:\s|$)', unreal.SystemLibrary.get_command_line())
    if not m:
        raise RuntimeError('Pass a fresh -ColorRun=name')
    return os.path.join(ROOT, '.scratch', 'unreal', m.group(1))


def colors():
    greys = [0., .0001, .0005, .001, .002, .005, .01, .02, .04, .08, .12, .18, .25, .5, 1., 2., 4., 8., 16., 32.]
    rows = [{'name': 'grey'+str(x), 'rgb': [x]*3} for x in greys]
    for name, c in [('red', (1, 0, 0)), ('green', (0, 1, 0)), ('blue', (0, 0, 1)),
                    ('cyan', (0, 1, 1)), ('magenta', (1, 0, 1)), ('yellow', (1, 1, 0))]:
        for scale in (.01, .1, 1., 10.):
            rows.append({'name': name+str(scale), 'rgb': [v*scale for v in c]})
    for name, c in [('flame', (40., 8., .8)), ('orange', (4., .4, .02)),
                    ('smoke', (.395833,)*3), ('teal', (.02, .8, .4))]:
        rows.append({'name': name, 'rgb': list(c)})
    return rows


def chart(world):
    material = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        'Chart', '/Game/ST01c_ColorTransient', unreal.Material, unreal.MaterialFactoryNew())
    material.set_editor_property('shading_model', unreal.MaterialShadingModel.MSM_UNLIT)
    material.set_editor_property('two_sided', True)
    expression = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionVectorParameter, 0, 0)
    expression.set_editor_property('parameter_name', 'PatchColor')
    unreal.MaterialEditingLibrary.connect_material_property(expression, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    unreal.MaterialEditingLibrary.recompile_material(material)
    actors, rows = [], colors()
    mesh = unreal.load_asset('/Engine/BasicShapes/Plane')
    for i, row in enumerate(rows):
        col, line = i % 8, i // 8
        actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(0., 175.-50.*col, 225.-50.*line),
            unreal.MathLibrary.make_rot_from_z(unreal.Vector(1., 0., 0.)))
        LIB['_LIVE_ACTORS'].append(actor)
        component = actor.get_component_by_class(unreal.StaticMeshComponent)
        component.set_mobility(unreal.ComponentMobility.MOVABLE)
        component.set_static_mesh(mesh)
        instance = component.create_dynamic_material_instance(0, material)
        instance.set_vector_parameter_value('PatchColor', unreal.LinearColor(*row['rgb'], 1.))
        component.set_cast_shadow(False)
        actor.set_actor_scale3d(unreal.Vector(.4, .4, 1.))
        actors.append(actor)
        row['sample_xy'] = [32+64*col, 96+64*line]
    return actors, rows


def profile(capture, bias):
    pp = capture.post_process_settings
    numbers = {'auto_exposure_bias': bias, 'bloom_intensity': 0., 'vignette_intensity': 0.,
        'film_grain_intensity': 0., 'scene_fringe_intensity': 0., 'color_grading_intensity': 0.,
        'white_temp': 6500., 'white_tint': 0., 'film_slope': .88, 'film_toe': .55,
        'film_shoulder': .26, 'film_black_clip': 0., 'film_white_clip': .04,
        'blue_correction': .6, 'expand_gamut': 1., 'tone_curve_amount': 1.,
        'local_exposure_highlight_contrast_scale': 1., 'local_exposure_shadow_contrast_scale': 1.,
        'local_exposure_detail_strength': 1.}
    record = {}
    for name, value in numbers.items():
        pp.set_editor_property('override_'+name, True)
        pp.set_editor_property(name, value)
        record[name] = pp.get_editor_property(name)
    pp.override_auto_exposure_method = True
    pp.auto_exposure_method = unreal.AutoExposureMethod.AEM_MANUAL
    pp.override_auto_exposure_apply_physical_camera_exposure = True
    pp.auto_exposure_apply_physical_camera_exposure = False
    pp.override_tonemapping_method = True
    record['tonemapping_method'] = str(pp.get_editor_property('tonemapping_method'))
    for group in ('', '_shadows', '_midtones', '_highlights'):
        for param in ('saturation', 'contrast', 'gamma', 'gain', 'offset'):
            name = 'color_'+param+group
            value = unreal.Vector4(*([0.]*4 if param == 'offset' else [1.]*4))
            pp.set_editor_property('override_'+name, True)
            pp.set_editor_property(name, value)
            record[name] = [value.x, value.y, value.z, value.w]
    pp.override_scene_color_tint = True
    pp.scene_color_tint = unreal.LinearColor(1., 1., 1., 1.)
    pp.override_color_grading_lut = True
    pp.color_grading_lut = None
    capture.post_process_settings = pp
    capture.post_process_blend_weight = 1.
    record.update({'auto_exposure_method': str(pp.auto_exposure_method), 'physical_camera_exposure': False,
                   'all_listed_overrides': True, 'scene_color_tint': [1., 1., 1.], 'external_grading_lut': None})
    return record


def capture_pair(capture, component, world, rt, hdr, output, name, view, yaw, pitch, actors, chart_rows):
    y, p = math.radians(yaw), math.radians(pitch)
    normal = (math.cos(p)*math.cos(y), math.cos(p)*math.sin(y), math.sin(p))
    origin = tuple(TARGET[i]+normal[i]*500. for i in range(3))
    capture.clear_show_only_components()
    for actor in actors:
        capture.show_only_actor_components(actor)
    capture.set_world_location(unreal.Vector(*origin), False, False)
    capture.set_world_rotation(LIB['_look_at'](origin, TARGET), False, False)
    samples = []
    files = {}
    for label, target, source in [('ldr', rt, unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR),
                                  ('hdr', hdr, unreal.SceneCaptureSource.SCS_SCENE_COLOR_HDR)]:
        capture.texture_target = target
        capture.capture_source = source
        for _ in range(4):
            capture.capture_scene()
            yield
            yield
            unreal.RenderingLibrary.read_render_target_raw(world, target, False)
        extension = '.png' if label == 'ldr' else '.hdr'
        filename = name+'_'+view+'_'+label+extension
        unreal.RenderingLibrary.export_render_target(world, target, output, filename)
        files[label] = {'file': filename, 'sha256': SHA(os.path.join(output, filename)),
                        'target': json.loads(unreal.ST01cRuntimeProbe.read_color_target(component, target))}
        if label == 'hdr':
            raw = unreal.RenderingLibrary.read_render_target_raw(world, target, False)
            if len(raw) != 512*512:
                raise RuntimeError('Unexpected float readback size')
            payload = bytearray(512*512*8)
            for i, pixel in enumerate(raw):
                struct.pack_into('<4e', payload, i*8, pixel.r, pixel.g, pixel.b, pixel.a)
            raw_name = name+'_'+view+'_hdr.rgba16f'
            with open(os.path.join(output, raw_name), 'wb') as f:
                f.write(payload)
            files['raw'] = {'file': raw_name, 'sha256': SHA(os.path.join(output, raw_name)),
                'encoding': 'little-endian RGBA float16; top row first', 'bytes': len(payload)}
        if chart_rows:
            for i, row in enumerate(chart_rows):
                sample = unreal.RenderingLibrary.read_render_target_raw_pixel(world, target, *row['sample_xy'], False)
                if label == 'ldr':
                    samples.append({'index': i, 'ldr_byte_rgb': [sample.r, sample.g, sample.b]})
                else:
                    samples[i]['hdr_float_rgb'] = [sample.r, sample.g, sample.b]
    return {'case': name, 'camera': view, 'position_cm': list(origin), 'target_cm': list(TARGET),
            'files': files, 'samples': samples}


def run():
    output = output_dir()
    if os.path.normcase(os.path.abspath(unreal.Paths.get_project_file_path())) != os.path.normcase(LIB['PROJECT_FILE']):
        raise RuntimeError('Scratch project required')
    if os.path.exists(output):
        raise RuntimeError('Fresh color run required')
    os.makedirs(output)
    world = unreal.EditorLevelLibrary.get_editor_world()
    disabled_volumes = []
    for volume in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.PostProcessVolume):
        disabled_volumes.append({'path': volume.get_path_name(), 'previous_enabled': volume.get_editor_property('enabled')})
        volume.set_editor_property('enabled', False)
    # Per-process controlled diagnostic profile. No project configs or sources saved.
    settings = {'r.EyeAdaptation.PreExposureOverride': 1., 'r.TonemapperGamma': 0.,
        'r.Tonemapper.Sharpen': 0., 'r.LUT.Size': 32., 'r.LUT.Shaper': 0.,
        'r.LUT.TonemappingMethod': 0., 'r.LUT.TonemappingSDRInvEOTF': 0.,
        # Source uses 1/(2^bits-1): make temporal dither sub-byte for exact repeats.
        'r.BackbufferQuantizationDitheringOverride': 32.}
    for key, value in settings.items():
        unreal.SystemLibrary.execute_console_command(world, key+' '+str(value))
    cvars = {key: unreal.SystemLibrary.get_console_variable_float_value(key) for key in settings}
    system = unreal.load_asset(LIB['SYSTEM_PATH'])
    if LIB['_copied_package_hash'](LIB['SYSTEM_PATH']) != LIB['SOURCE_SHA256']:
        raise RuntimeError('Source hash mismatch')
    probe = unreal.ST01cRuntimeProbe
    seed = json.loads(probe.configure_pilot(system))
    fx = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.NiagaraActor, unreal.Vector())
    LIB['_LIVE_ACTORS'].append(fx)
    component = fx.get_component_by_class(unreal.NiagaraComponent)
    component.set_editor_property('auto_activate', False)
    component.set_force_solo(True)
    component.set_asset(system)
    actors, chart_rows = chart(world)
    rt = unreal.RenderingLibrary.create_render_target2d(world, 512, 512, unreal.TextureRenderTargetFormat.RTF_RGBA8,
        unreal.LinearColor(0., 0., 0., 1.), False, False)
    rt.set_editor_property('target_gamma', 2.2)
    hdr = unreal.RenderingLibrary.create_render_target2d(world, 512, 512, unreal.TextureRenderTargetFormat.RTF_RGBA16F,
        unreal.LinearColor(0., 0., 0., 1.), False, False)
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.SceneCapture2D, unreal.Vector())
    LIB['_LIVE_ACTORS'].append(actor)
    capture = actor.get_component_by_class(unreal.SceneCaptureComponent2D)
    capture.primitive_render_mode = unreal.SceneCapturePrimitiveRenderMode.PRM_USE_SHOW_ONLY_LIST
    capture.capture_every_frame = False
    capture.capture_on_movement = False
    # Manual exposure needs a view-state buffer; one-shot captures otherwise stay at exposure1.
    capture.set_editor_property('always_persist_rendering_state', True)
    capture.projection_type = unreal.CameraProjectionMode.ORTHOGRAPHIC
    capture.ortho_width = 400.
    capture.set_editor_property('show_flag_settings', [unreal.EngineShowFlagsSetting(n, False) for n in
        ('Atmosphere', 'Fog', 'VolumetricFog', 'Cloud', 'DeferredAtmospherePass', 'SkyLighting', 'MotionBlur', 'Vignette', 'AntiAliasing')])
    profiles, images = [], []
    profile(capture, 0.)
    for _ in range(120):
        yield
    component.activate(True)
    component.set_paused(True)
    preparation = json.loads(probe.prepare_capture(component))
    if preparation.get('error'):
        raise RuntimeError(str(preparation))
    for _ in range(3):
        yield
    for _ in range(120):
        component.set_paused(False)
        component.advance_simulation(1, 1./60.)
        component.set_paused(True)
    with open(os.path.join(output, 'particles.json'), 'w', encoding='utf8') as f:
        f.write(probe.read_particles(component))
    with open(os.path.join(output, 'color-platform.json'), 'w', encoding='utf8') as f:
        f.write(probe.read_color_target(component, rt))
    for bias in (0, 1):
        profiles.append(profile(capture, float(bias)))
        images.append((yield from capture_pair(capture, component, world, rt, hdr, output, 'chartEV'+str(bias), 'front', 0., 0., actors, chart_rows)))
        for view, yaw, pitch in LIB['CAPTURES']:
            images.append((yield from capture_pair(capture, component, world, rt, hdr, output, 'pilotEV'+str(bias), view, yaw, pitch, [fx], None)))
    report = {'schema': 'st01c-color-reference/v1', 'status': 'complete', 'date': '2026-10-14',
        'source_sha256': LIB['SOURCE_SHA256'], 'script_sha256': SHA(__file__), 'seed': seed,
        'particles_sha256': SHA(os.path.join(output, 'particles.json')), 'chart': chart_rows,
        'profiles': profiles, 'cvars': cvars, 'disabled_postprocess_volumes': disabled_volumes,
        'settings': {'step': 120, 'dt': 1./60., 'resolution': [512, 512], 'projection': 'orthographic',
            'orthographic_width_cm': 400., 'ldr_target_gamma': 2.2, 'pre_exposure_override': 1.,
            'custom_projection': capture.get_editor_property('use_custom_projection_matrix')},
        'capture_state': {'always_persist_rendering_state': True, 'anti_aliasing': False,
            'raw_hdr_for_transfer': True, 'rgbe_hdr_for_diagnostics_only': True},
        'images': images, 'asset_saves': 0, 'gameplay_activation': False, 'visual_acceptance': False}
    with open(os.path.join(output, 'color-report.json'), 'w', encoding='utf8') as f:
        json.dump(report, f, indent=2)


@AutomationScheduler.add_latent_command
def capture_color():
    try:
        yield from run()
    except Exception:
        if os.path.isdir(output_dir()):
            with open(os.path.join(output_dir(), 'error.txt'), 'w') as f:
                f.write(traceback.format_exc())
        raise
    finally:
        LIB['_cleanup_actors']()
