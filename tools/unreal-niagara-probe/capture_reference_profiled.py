"""Capture one continuous Niagara system run under the controlled SDR color profile "controlled-sdr/v1".

Same invocation, inputs and refusals as capture_reference.py: -SystemSpec=<absolute systems/*.json> (no default
system), a fresh -CaptureRun=<name> under .scratch/unreal, the isolated ST01c_Pilot project only. capture_reference.py
runs as a library (as capture_color.py:13-14 loads it): its run() loads the spec with load_capture_spec, refuses,
seeds, exports the textures, steps the simulation and reads the particles, unchanged. This driver only
- applies the profile of capture_profile.py (copied from capture_color.py) while run() waits its first editor frames,
  before the effect is activated: world post-process volumes off, cvars set and read back, an RGBA8 LDR target with
  target gamma 2.2 and an RGBA16F HDR target at the spec imageSize, persistent view state, show flags off
  (AntiAliasing included) and the profile() post-process settings at 0 EV;
- replaces run()'s per-pose capture (the global _capture_pose of capture_reference.py:178-226) so that every image
  step and camera writes an LDR PNG (FinalColorLDR, 4 warm-up captures) and a raw .rgba16f (SceneColor HDR, 4 warm-up
  captures, little-endian float16 RGBA, top row first), the step-0 baseline of the first camera included; the linear
  step also keeps capture_reference.py's Radiance .hdr as a diagnostic;
- completes capture-report.json with the profile id and read-back, the code hashes, the settings and every run file
  with its sha256.
Wrapper (outside git): .scratch/unreal/Content/Python/test_st01c_reference_profiled.py doing runpy.run_path on this file.
"""
import json
import math
import os
import runpy
import traceback

import unreal
from unreal_pythonautomationtest import AutomationScheduler
unreal.AutomationScheduler = AutomationScheduler

HERE = os.path.dirname(os.path.abspath(__file__))
LIBRARY_FILE = os.path.join(HERE, 'capture_reference.py')
PROFILE_FILE = os.path.join(HERE, 'capture_profile.py')
# runpy returns a copy of the library globals; its functions resolve names in the live module dict (run.__globals__),
# which is where the per-pose capture is replaced.
LIB = runpy.run_path(LIBRARY_FILE, init_globals={'ST01C_LIBRARY_ONLY': True})
CR = LIB['run'].__globals__
PROFILE = runpy.run_path(PROFILE_FILE)
ROOT = CR['PROJECT_ROOT']
WRAPPER_FILE = os.path.join(ROOT, '.scratch', 'unreal', 'Content', 'Python', 'test_st01c_reference_profiled.py')
STATE = {}


def _rel(path):
    return os.path.relpath(path, ROOT).replace('\\', '/')


def _profiled_pose(capture_component, label, yaw, pitch, rt, linear_rt, world, output, step, spec):
    """Stands in for capture_reference.py _capture_pose (:178-226) inside run(); same arguments and row keys. rt and
    linear_rt (run()'s RGBA8 target without target gamma and its RGBA16F target) are not used."""
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
    # LDR: FinalColorLDR into the gamma-2.2 RGBA8 target after the warm-up captures (capture_color.py:116-127).
    capture_component.texture_target = ldr
    capture_component.capture_source = unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR
    yield from PROFILE['warm_capture'](capture_component, world, ldr)
    # capture_reference.py:196-201, the blank-frame gate (same message); the warm-up replaces its three retries.
    pixels = unreal.RenderingLibrary.read_render_target(world, ldr, False)
    visible_pixels = sum(1 for p in pixels if max(p.r, p.g, p.b) > 16)
    if step > 0 and visible_pixels < 100:
        raise RuntimeError('Blank reference capture at step %d / %s' % (step, label))
    filename = "t%04d_%s.png" % (step, label)
    unreal.RenderingLibrary.export_render_target(world, ldr, frames, filename)
    # HDR: SceneColor HDR into the RGBA16F target, raw readback packed as capture_color.py:131-141.
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
        # capture_reference.py:212-215: the Radiance export of the linear step, a diagnostic beside the raw file.
        linear_name = 't%04d_%s_linear.hdr' % (step, label)
        unreal.RenderingLibrary.export_render_target(world, hdr, frames, linear_name)
        linear = {'file': 'frames/' + linear_name, 'sha256': CR['_sha256'](os.path.join(frames, linear_name))}
    capture_component.texture_target = ldr
    capture_component.capture_source = unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR
    fullpath = os.path.join(frames, filename)
    rotation = capture_component.get_world_rotation()
    # capture_reference.py:218-226 row keys, plus the raw HDR.
    return {"file": "frames/" + filename, "linear": linear,
            "hdr_raw": {"file": "frames/" + raw_name, "sha256": CR['_sha256'](os.path.join(frames, raw_name)),
                        "encoding": PROFILE['RAW_ENCODING'], "bytes": len(payload), "width": size, "height": size},
            "visible_pixels_gt16": visible_pixels, "capture_attempts": PROFILE['WARMUP_CAPTURES'],
            "step": step, "time_seconds": step * spec["dt"], "camera": label,
            "yaw_degrees": yaw, "pitch_degrees": pitch,
            "position_cm": list(origin), "target_cm": list(target),
            "rotation_degrees": {"pitch": rotation.pitch, "yaw": rotation.yaw, "roll": rotation.roll},
            "sha256": CR['_sha256'](fullpath) if os.path.isfile(fullpath) else None}


def _apply_profile():
    """Runs at run()'s first editor frame: the spec is validated, the output is fresh, the Niagara actor and the scene
    capture exist, and the effect is not active yet. Order as capture_color.py:160-204."""
    spec = CR['load_capture_spec'](CR['_args']()['spec'])
    world = unreal.EditorLevelLibrary.get_editor_world()
    captures = [actor for actor in CR['_LIVE_ACTORS'] if actor.get_component_by_class(unreal.SceneCaptureComponent2D)]
    if len(captures) != 1:
        raise RuntimeError('Expected the one SceneCapture2D of capture_reference.py run(), found %d' % len(captures))
    capture = captures[0].get_component_by_class(unreal.SceneCaptureComponent2D)
    volumes = PROFILE['disable_postprocess_volumes'](world)
    cvars = PROFILE['apply_cvars'](world)
    ldr, hdr = PROFILE['create_targets'](world, spec['size'])
    PROFILE['configure_capture'](capture)
    post_process = PROFILE['profile'](capture, PROFILE['EXPOSURE_BIAS'])
    STATE.update(ldr=ldr, hdr=hdr)
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
    path = os.path.join(output, 'capture-report.json')
    with open(path, 'r', encoding='utf-8') as stream:
        report = json.load(stream)
    if report.get('status') != 'complete':
        raise RuntimeError('capture_reference.py run() did not complete its report')
    for row in [report['empty_baseline']] + report['images']:
        if not row.get('hdr_raw') or not os.path.isfile(os.path.join(output, row['hdr_raw']['file'])):
            raise RuntimeError('Missing raw HDR for ' + row['file'])
    sha = CR['_sha256']
    code = [{'role': 'driver', 'file': _rel(os.path.abspath(__file__)), 'sha256': sha(os.path.abspath(__file__))},
            {'role': 'profile', 'file': _rel(PROFILE_FILE), 'sha256': sha(PROFILE_FILE)},
            {'role': 'library', 'file': _rel(LIBRARY_FILE), 'sha256': sha(LIBRARY_FILE)},
            {'role': 'wrapper', 'file': _rel(WRAPPER_FILE), 'sha256': sha(WRAPPER_FILE) if os.path.isfile(WRAPPER_FILE) else None}]
    report['capture_profile'] = profile
    report['capture_code'] = code
    report['settings'].update({
        'color_profile': PROFILE['PROFILE_ID'],
        'ldr_target': '%s, target_gamma %s' % (PROFILE['LDR_FORMAT'], PROFILE['LDR_TARGET_GAMMA']),
        'hdr_capture': 'SceneColorHDR into %s; raw %s; every image step and the step-0 baseline' % (
            PROFILE['HDR_FORMAT'], PROFILE['RAW_ENCODING']),
        'warmup_captures_per_target': PROFILE['WARMUP_CAPTURES'],
        'exposure': ('controlled-sdr/v1: manual at 0 EV, physical camera exposure off, PreExposureOverride 1; bloom, '
                     'vignette, grain and fringe 0; Filmic constants and neutral grading of capture_color.py, no LUT')})
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


def capture_reference_profiled():
    # Freshness is read before run(): its refusal of a used name must not leave an error file in that folder.
    output = os.path.abspath(CR['_args']()['output'])
    fresh = not os.path.exists(output) or not os.listdir(output)
    CR['_capture_pose'] = _profiled_pose
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


# The plugin ends a latent run after 300 s by default (PythonAutomationTest.cpp:19); 16 poses with 8 warm-up captures
# and 1024x1024 readbacks each need more. 540 s keeps the editor exiting by itself before a 600 s caller timeout.
LATENT_TIMEOUT_SECONDS = 540.
AutomationScheduler.set_latent_command_timeout(LATENT_TIMEOUT_SECONDS)
AutomationScheduler.add_latent_command(capture_reference_profiled)
