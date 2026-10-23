"""Check capture_profile.py against capture_color.py, and the profiled capture driver, without Unreal.

Run: python -B tools/unreal-niagara-probe/capture_profile_test.py   (prints OK, exit 0)

capture_color.py is parsed (ast), never executed: the cvar list, the render target formats and target gamma, the show
flags, the persistent view state, the warm-up loop, the post-process volume loop, the cvar loop, the raw HDR encoding
and the whole profile() body must equal the copies in capture_profile.py, so any drift fails here. The functions that
talk to the editor run once against small stand-ins of the unreal module; the raw packer is compared with the per-pixel
packing of capture_color.py:134-136 on edge values. The driver capture_reference_profiled.py is parsed: its pose
function keeps the row keys of capture_reference.py _capture_pose and adds hdr_raw.
"""
import ast
import importlib.util
import math
import os
import struct
import types

HERE = os.path.dirname(os.path.abspath(__file__))


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def parse(name):
    with open(os.path.join(HERE, name), 'r', encoding='utf-8') as stream:
        return ast.parse(stream.read())


def function(tree, name):
    found = [node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name == name]
    check(len(found) == 1, 'one function %s expected' % name)
    return found[0]


def calls(node, attribute):
    return [n for n in ast.walk(node) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == attribute]


def editor_property(node, key):
    rows = [call for call in calls(node, 'set_editor_property')
            if call.args and isinstance(call.args[0], ast.Constant) and call.args[0].value == key]
    check(len(rows) == 1, 'one set_editor_property(%r) expected' % key)
    return rows[0].args[1]


def body_without_docstring(node):
    body = node.body
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
        body = body[1:]
    return [ast.dump(statement) for statement in body]


spec = importlib.util.spec_from_file_location('capture_profile_under_test', os.path.join(HERE, 'capture_profile.py'))
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)
CC = parse('capture_color.py')
CP = parse('capture_profile.py')
CC_RUN = function(CC, 'run')

# Profile id.
check(P.PROFILE_ID == 'controlled-sdr/v1', 'profile id')

# cvars: capture_color.py:166-170, same keys, values and order.
settings = [n for n in ast.walk(CC_RUN) if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
            and n.targets[0].id == 'settings']
check(len(settings) == 1, 'capture_color.py run() has one settings dict')
cc_cvars = ast.literal_eval(settings[0].value)
check(list(cc_cvars.items()) == list(P.CVARS.items()), 'cvars differ from capture_color.py: %r' % (P.CVARS,))
check(len(P.CVARS) == 8 and P.CVARS['r.EyeAdaptation.PreExposureOverride'] == 1. and P.CVARS['r.LUT.TonemappingMethod'] == 0.,
      'cvar values')

# Render targets: capture_color.py:186-190 formats, clear colour and target gamma.
targets = calls(CC_RUN, 'create_render_target2d')
check([call.args[3].attr for call in targets] == [P.LDR_FORMAT, P.HDR_FORMAT], 'render target formats')
mine = calls(function(CP, 'create_targets'), 'create_render_target2d')
check([ast.dump(call.args[4]) for call in targets] == [ast.dump(call.args[4]) for call in mine], 'target clear colour')
check([ast.dump(a) for call in targets for a in call.args[5:]] == [ast.dump(a) for call in mine for a in call.args[5:]],
      'target flags')
check(ast.literal_eval(editor_property(CC_RUN, 'target_gamma')) == P.LDR_TARGET_GAMMA == 2.2, 'target gamma')

# Capture state: capture_color.py:195-202.
check(ast.literal_eval(editor_property(CC_RUN, 'always_persist_rendering_state')) is P.ALWAYS_PERSIST_RENDERING_STATE is True,
      'always_persist_rendering_state')
flags = editor_property(CC_RUN, 'show_flag_settings')
check(isinstance(flags, ast.ListComp) and ast.literal_eval(flags.generators[0].iter) == P.SHOW_FLAGS_OFF, 'show flags')
check('AntiAliasing' in P.SHOW_FLAGS_OFF, 'AntiAliasing off')
for name, value in (('capture_every_frame', False), ('capture_on_movement', False)):
    rows = [n for n in ast.walk(CC_RUN) if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Attribute)
            and n.targets[0].attr == name]
    check(len(rows) == 1 and ast.literal_eval(rows[0].value) is value, name)

# profile(): the whole body equals capture_color.py:67-102 (docstring aside).
check(body_without_docstring(function(CC, 'profile')) == body_without_docstring(function(CP, 'profile')),
      'profile() body differs from capture_color.py')
check([a.arg for a in function(CC, 'profile').args.args] == [a.arg for a in function(CP, 'profile').args.args], 'profile() args')
pilot = [call for call in ast.walk(CC_RUN) if isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
         and call.func.id == 'profile']
check(any(isinstance(c.args[1], ast.Constant) and c.args[1].value == P.EXPOSURE_BIAS == 0. for c in pilot), 'exposure bias 0')

# Warm-up captures: capture_color.py:120-124, count and loop body.
warm_cc = [n for n in ast.walk(function(CC, 'capture_pair')) if isinstance(n, ast.For) and isinstance(n.iter, ast.Call)
           and isinstance(n.iter.func, ast.Name) and n.iter.func.id == 'range']
warm_cp = [n for n in ast.walk(function(CP, 'warm_capture')) if isinstance(n, ast.For)]
check(len(warm_cc) == 1 and ast.literal_eval(warm_cc[0].iter.args[0]) == P.WARMUP_CAPTURES == 4, 'warm-up count')
check(len(warm_cp) == 1 and [ast.dump(s) for s in warm_cc[0].body] == [ast.dump(s) for s in warm_cp[0].body], 'warm-up body')

# Post-process volumes (capture_color.py:161-164) and cvar loop (:171-173): same statements.
def loops(node, call_name):
    return [ast.dump(n) for n in ast.walk(node) if isinstance(n, ast.For) and calls(n.iter, call_name)]
check(loops(CC_RUN, 'get_all_actors_of_class') == loops(function(CP, 'disable_postprocess_volumes'), 'get_all_actors_of_class'),
      'post-process volume loop')
check(len(loops(CC_RUN, 'items')) == 1 and loops(CC_RUN, 'items') == loops(function(CP, 'apply_cvars'), 'items'), 'cvar loop')
readback = lambda node: [ast.dump(n) for n in ast.walk(node) if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
                         and n.targets[0].id == 'cvars']
check(readback(CC_RUN) == readback(function(CP, 'apply_cvars')) and readback(CC_RUN), 'cvar read-back')

# Raw HDR: encoding text and the packer of capture_color.py:131-141.
encodings = [ast.literal_eval(v) for n in ast.walk(function(CC, 'capture_pair')) if isinstance(n, ast.Dict)
             for k, v in zip(n.keys, n.values) if isinstance(k, ast.Constant) and k.value == 'encoding']
check(encodings == [P.RAW_ENCODING], 'raw encoding text')
packs = calls(function(CC, 'capture_pair'), 'pack_into')
check(len(packs) == 1 and packs[0].args[0].value == '<4e' and [a.attr for a in packs[0].args[3:]] == ['r', 'g', 'b', 'a'],
      'capture_color.py packs <4e r, g, b, a')
Pixel = lambda r, g, b, a: types.SimpleNamespace(r=r, g=g, b=b, a=a)
values = [0., 1., -2., 65504., 6.1e-5, 5.96e-8, 0.333, 12.7, math.inf, 1e-9, 0.5, 2048.]
pixels = [Pixel(*values[i:i+4]) for i in range(0, 12, 4)] + [Pixel(1., 0., 0., 1.), Pixel(.18, .18, .18, 1.), Pixel(40., 8., .8, 1.)]
payload = bytearray(len(pixels)*8)
for i, pixel in enumerate(pixels):
    struct.pack_into('<4e', payload, i*8, pixel.r, pixel.g, pixel.b, pixel.a)
check(P.pack_rgba16f(pixels, 3, 2) == bytes(payload), 'packer bytes differ from capture_color.py')
try:
    P.pack_rgba16f(pixels, 4, 2)
    raise AssertionError('packer accepted a wrong size')
except RuntimeError:
    pass

# The editor-facing functions against stand-ins of the unreal module.
class Holder:
    def __init__(self, **values):
        self.__dict__['values'] = dict(values)
    def set_editor_property(self, name, value):
        self.values[name] = value
    def get_editor_property(self, name):
        return self.values[name]
    def __setattr__(self, name, value):
        self.values[name] = value
    def __getattr__(self, name):
        try:
            return self.__dict__['values'][name]
        except KeyError:
            raise AttributeError(name)

commands, made = [], []
fake = types.SimpleNamespace(
    AutoExposureMethod=types.SimpleNamespace(AEM_MANUAL='AEM_MANUAL'),
    Vector4=lambda x, y, z, w: types.SimpleNamespace(x=x, y=y, z=z, w=w),
    LinearColor=lambda *v: tuple(v),
    EngineShowFlagsSetting=lambda name, enabled: Holder(show_flag_name=name, enabled=enabled),
    TextureRenderTargetFormat=types.SimpleNamespace(RTF_RGBA8='RTF_RGBA8', RTF_RGBA16F='RTF_RGBA16F'),
    SystemLibrary=types.SimpleNamespace(execute_console_command=lambda world, text: commands.append(text),
                                        get_console_variable_float_value=lambda key: P.CVARS[key]),
    RenderingLibrary=types.SimpleNamespace(create_render_target2d=lambda world, x, y, fmt, clear, a, b:
                                           made.append(Holder(size_x=x, size_y=y, render_target_format=fmt)) or made[-1]),
    GameplayStatics=types.SimpleNamespace(get_all_actors_of_class=lambda world, cls: volumes),
    PostProcessVolume=object)
volumes = [Holder(get_path_name=lambda: '/Temp/Volume', enabled=True)]
P.unreal = fake
check(P.disable_postprocess_volumes('world') == [{'path': '/Temp/Volume', 'previous_enabled': True}]
      and volumes[0].enabled is False, 'post-process volumes disabled and recorded')
check(P.apply_cvars('world') == P.CVARS, 'cvar read-back returned')
check(commands == [key + ' ' + str(value) for key, value in P.CVARS.items()], 'console commands')
ldr, hdr = P.create_targets('world', 1024)
check(ldr.values == {'size_x': 1024, 'size_y': 1024, 'render_target_format': 'RTF_RGBA8', 'target_gamma': 2.2}, 'LDR target')
check(hdr.values == {'size_x': 1024, 'size_y': 1024, 'render_target_format': 'RTF_RGBA16F'}, 'HDR target has no gamma')
capture = Holder(post_process_settings=Holder(tonemapping_method='TM_DEFAULT'), post_process_blend_weight=0.)
P.configure_capture(capture)
check(capture.always_persist_rendering_state is True and capture.capture_every_frame is False, 'capture flags')
check([f.show_flag_name for f in capture.show_flag_settings] == list(P.SHOW_FLAGS_OFF)
      and not any(f.enabled for f in capture.show_flag_settings), 'show flags off')
record = P.profile(capture, P.EXPOSURE_BIAS)
pp = capture.post_process_settings.values
check(record['film_slope'] == .88 and record['film_toe'] == .55 and record['film_shoulder'] == .26
      and record['film_white_clip'] == .04 and record['blue_correction'] == .6 and record['white_temp'] == 6500., 'Filmic constants')
check(pp['auto_exposure_method'] == 'AEM_MANUAL' and pp['auto_exposure_apply_physical_camera_exposure'] is False
      and pp['bloom_intensity'] == 0. and pp['color_grading_lut'] is None, 'manual exposure, bloom 0, no LUT')
check(record['color_offset'] == [0.] * 4 and record['color_gain_highlights'] == [1.] * 4, 'neutral grading')
check(capture.post_process_blend_weight == 1., 'blend weight')
back = P.read_back(capture, ldr, hdr)
check(back['ldr_target']['target_gamma'] == 2.2 and back['always_persist_rendering_state'] is True, 'read-back')
check(back['hdr_target']['target_gamma'].get('error') is not None, 'a missing property is recorded, not raised')

# The driver: pose rows keep capture_reference.py's keys and add hdr_raw; the pose is swapped, not copied whole.
CR = parse('capture_reference.py')
DRIVER = parse('capture_reference_profiled.py')
def row_keys(node):
    returns = [n.value for n in ast.walk(node) if isinstance(n, ast.Return) and isinstance(n.value, ast.Dict)]
    check(len(returns) == 1, 'one row dict')
    return [k.value for k in returns[0].keys]
check(row_keys(function(DRIVER, '_profiled_pose')) == row_keys(function(CR, '_capture_pose'))[:2] + ['hdr_raw']
      + row_keys(function(CR, '_capture_pose'))[2:], 'pose row keys')
check([a.arg for a in function(DRIVER, '_profiled_pose').args.args] == [a.arg for a in function(CR, '_capture_pose').args.args],
      'pose arguments')
placement = lambda node: [ast.dump(s) for s in node.body if isinstance(s, ast.Assign)][:6]
check(placement(function(DRIVER, '_profiled_pose')) == placement(function(CR, '_capture_pose')), 'camera placement')
check(not [n for n in ast.walk(DRIVER) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
           and n.func.attr == 'advance_simulation'], 'the driver never steps the simulation itself')

print('OK')
