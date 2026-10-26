"""Controlled SDR color profile "controlled-sdr/v1" as importable functions.

Every value and function body is copied from capture_color.py (the pilot color lab, docs/delivery/st01c/COLOR-LAB.md);
each one names its source line range. Nothing here is tuned: capture_profile_test.py parses capture_color.py and fails
when a copied constant or the profile() body drifts from it. capture_color.py itself is not changed and does not import
this module. Importable without Unreal (the unit tests run in plain Python); the functions that touch the editor need
the editor's `unreal` module.
"""
import itertools
import struct

try:
    import unreal
except ImportError:  # plain Python (capture_profile_test.py): only the constants and the packer are usable
    unreal = None

PROFILE_ID = "controlled-sdr/v1"

# capture_color.py:166-170. Per-process console variables; no project config is saved.
CVARS = {'r.EyeAdaptation.PreExposureOverride': 1., 'r.TonemapperGamma': 0.,
    'r.Tonemapper.Sharpen': 0., 'r.LUT.Size': 32., 'r.LUT.Shaper': 0.,
    'r.LUT.TonemappingMethod': 0., 'r.LUT.TonemappingSDRInvEOTF': 0.,
    # Source uses 1/(2^bits-1): make temporal dither sub-byte for exact repeats.
    'r.BackbufferQuantizationDitheringOverride': 32.}

# capture_color.py:186-190. LDR target RGBA8 with an explicit display gamma (without it GetDisplayGamma() is 1 and the
# tonemapper's InverseGamma changes, COLOR-LAB.md:49-55); HDR target RGBA16F. Both cleared to opaque black.
LDR_FORMAT = 'RTF_RGBA8'
LDR_TARGET_GAMMA = 2.2
HDR_FORMAT = 'RTF_RGBA16F'

# capture_color.py:201-202. Show flags switched off on the scene capture (AntiAliasing included: scene captures
# otherwise run FXAA).
SHOW_FLAGS_OFF = ('Atmosphere', 'Fog', 'VolumetricFog', 'Cloud', 'DeferredAtmospherePass', 'SkyLighting', 'MotionBlur',
                  'Vignette', 'AntiAliasing')

# capture_color.py:198. Manual exposure needs a view-state buffer; one-shot captures otherwise stay at exposure 1.
ALWAYS_PERSIST_RENDERING_STATE = True

# capture_color.py:120. Captures per target before the export; each is fenced by a raw readback.
WARMUP_CAPTURES = 4

# capture_color.py:204 (and :222-223 for the pilot at 0 EV): the exposure bias the profile is applied with.
EXPOSURE_BIAS = 0.

# capture_color.py:138-141. Raw HDR container.
RAW_ENCODING = 'little-endian RGBA float16; top row first'


def apply_cvars(world):
    """capture_color.py:171-173: set every cvar by console command, then read each one back."""
    settings = CVARS
    for key, value in settings.items():
        unreal.SystemLibrary.execute_console_command(world, key+' '+str(value))
    cvars = {key: unreal.SystemLibrary.get_console_variable_float_value(key) for key in settings}
    return cvars


def disable_postprocess_volumes(world):
    """capture_color.py:161-164: disable every world post-process volume; returns the previous states."""
    disabled_volumes = []
    for volume in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.PostProcessVolume):
        disabled_volumes.append({'path': volume.get_path_name(), 'previous_enabled': volume.get_editor_property('enabled')})
        volume.set_editor_property('enabled', False)
    return disabled_volumes


def create_targets(world, size):
    """capture_color.py:186-190 with the spec size instead of 512: (LDR RGBA8 gamma 2.2, HDR RGBA16F)."""
    rt = unreal.RenderingLibrary.create_render_target2d(world, size, size, getattr(unreal.TextureRenderTargetFormat, LDR_FORMAT),
        unreal.LinearColor(0., 0., 0., 1.), False, False)
    rt.set_editor_property('target_gamma', LDR_TARGET_GAMMA)
    hdr = unreal.RenderingLibrary.create_render_target2d(world, size, size, getattr(unreal.TextureRenderTargetFormat, HDR_FORMAT),
        unreal.LinearColor(0., 0., 0., 1.), False, False)
    return rt, hdr


def configure_capture(capture):
    """capture_color.py:195-202: one-shot capture, persistent view state, the show flags off."""
    capture.capture_every_frame = False
    capture.capture_on_movement = False
    capture.set_editor_property('always_persist_rendering_state', ALWAYS_PERSIST_RENDERING_STATE)
    capture.set_editor_property('show_flag_settings', [unreal.EngineShowFlagsSetting(n, False) for n in SHOW_FLAGS_OFF])


def profile(capture, bias):
    """capture_color.py:67-102, body unchanged (capture_profile_test.py compares the two syntax trees)."""
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


def warm_capture(capture, world, target):
    """capture_color.py:120-124: WARMUP_CAPTURES captures into the current target, each fenced by a raw readback.
    A generator for the automation scheduler (two editor frames per capture)."""
    for _ in range(WARMUP_CAPTURES):
        capture.capture_scene()
        yield
        yield
        unreal.RenderingLibrary.read_render_target_raw(world, target, False)


def pack_rgba16f(raw, width, height):
    """capture_color.py:131-141 with the size as arguments: the RGBA16F readback (objects with r, g, b, a; top row
    first) as little-endian float16 RGBA bytes. Packed one row at a time instead of one pixel at a time (same bytes)."""
    if len(raw) != width*height:
        raise RuntimeError('Unexpected float readback size')
    rows = []
    row_format = '<%de' % (4*width)
    pixels = iter(raw)
    for _ in range(height):
        line = list(itertools.islice(pixels, width))
        rows.append(struct.pack(row_format, *[v for pixel in line for v in (pixel.r, pixel.g, pixel.b, pixel.a)]))
    return b''.join(rows)


def read_back(capture, ldr, hdr):
    """The profile state as Unreal reports it after it was applied (targets, capture flags). A property the editor
    does not expose is recorded as {'error': ...} instead of failing the capture."""
    def read(read_value):
        try:
            return read_value()
        except Exception as error:  # recorded, never raised: the read-back is evidence, not a gate
            return {'error': str(error)}

    def target(rt):
        return {'size': read(lambda: [rt.get_editor_property('size_x'), rt.get_editor_property('size_y')]),
                'render_target_format': read(lambda: str(rt.get_editor_property('render_target_format'))),
                'target_gamma': read(lambda: rt.get_editor_property('target_gamma'))}
    flags = read(lambda: [{'name': str(f.get_editor_property('show_flag_name')), 'enabled': f.get_editor_property('enabled')}
                          for f in capture.get_editor_property('show_flag_settings')])
    return {'ldr_target': target(ldr), 'hdr_target': target(hdr),
            'always_persist_rendering_state': read(lambda: capture.get_editor_property('always_persist_rendering_state')),
            'show_flag_settings': flags,
            'post_process_blend_weight': read(lambda: capture.get_editor_property('post_process_blend_weight'))}
