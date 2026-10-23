"""Check the capture block loader of capture_reference.py without Unreal.

Run: python -B tools/unreal-niagara-probe/capture_spec_test.py   (prints OK, exit 0)

capture_reference.py is loaded the way capture_depth.py loads it (library mode); only the
two Unreal modules it imports are replaced by empty stand-ins.
"""
import copy
import json
import os
import runpy
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
SYSTEMS = os.path.join(HERE, "systems")
TEXTURES = "/Game/sA_Megapack_v1/sA_StylizedAttacksPack/Materials/Textures/"

stub = types.ModuleType("unreal")
scheduler = types.ModuleType("unreal_pythonautomationtest")
scheduler.AutomationScheduler = type("AutomationScheduler", (), {})
sys.modules["unreal"] = stub
sys.modules["unreal_pythonautomationtest"] = scheduler
LIB = runpy.run_path(os.path.join(HERE, "capture_reference.py"), init_globals={"ST01C_LIBRARY_ONLY": True})
load = LIB["load_capture_spec"]


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def expect_error(spec, key, label):
    """Write the spec to a temp file, load it and require a ValueError that names the key."""
    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "spec.json")
        with open(path, "w", encoding="utf-8") as stream:
            json.dump(spec, stream)
        try:
            load(path)
        except ValueError as error:
            check(key in str(error), "%s: message does not name %s: %s" % (label, key, error))
            return
        raise AssertionError("%s: no error raised" % label)


pilot = load(os.path.join(SYSTEMS, "ns-flame-single.json"))
check(pilot["system_path"] == "/Game/sA_Megapack_v1/sA_StylizedAttacksPack/FX/NiagaraSystems/NS_Flame_Single", "pilot system")
check(pilot["source_sha256"] == "985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165", "pilot sha")
check(pilot["dt"] == 1.0 / 60.0, "pilot dt is exactly 1/60")
check(pilot["last_step"] == 240, "pilot lastStep")
check(pilot["image_steps"] == (30, 60, 120, 180, 240), "pilot imageSteps")
check(pilot["linear_step"] == 120, "pilot linearStep")
check(pilot["size"] == 512, "pilot imageSize")
check(pilot["cameras"] == (("front", 0.0, 0.0), ("oblique", 45.0, 20.0), ("side", 90.0, 0.0)), "pilot cameras")
check(pilot["target"] == (0.0, 0.0, 100.0), "pilot cameraTarget")
check(pilot["distance"] == 500.0, "pilot cameraDistance")
check(pilot["ortho_width"] == 400.0, "pilot orthoWidth")
check(pilot["textures"] == (TEXTURES + "T_FlameUV_2", TEXTURES + "T_Smoke_1"), "pilot textures")

hit = load(os.path.join(SYSTEMS, "ns-basichit.json"))
check(hit["dt"] == pilot["dt"] and hit["last_step"] == 240, "basichit window is the pilot window")
check(hit["image_steps"] == (2, 6, 12, 18, 24) and hit["linear_step"] == 12, "basichit steps")
check(hit["cameras"] == pilot["cameras"] and hit["target"] == (20.0, 0.0, -10.0), "basichit cameras")
check(hit["distance"] == 800.0 and hit["ortho_width"] == 850.0 and hit["size"] == 1024, "basichit framing")
check(hit["textures"] == tuple(TEXTURES + n for n in ("T_FireBall", "T_FlameUV_1", "T_Ground_Crack", "T_Hit_Circle")), "basichit textures")

# The names the library users import keep existing, taken from the pilot spec.
check(LIB["SYSTEM_PATH"] == pilot["system_path"] and LIB["SOURCE_SHA256"] == pilot["source_sha256"], "library constants")
check(LIB["CAPTURES"] == pilot["cameras"], "library CAPTURES")
for name in ("PROJECT_FILE", "_sha256", "_look_at", "_copied_package_hash", "_cleanup_actors", "_LIVE_ACTORS"):
    check(name in LIB, "library name missing: " + name)

with open(os.path.join(SYSTEMS, "ns-flame-single.json"), "r", encoding="utf-8") as stream:
    base = json.load(stream)

# Every capture key is required, and the message names it.
for key in list(base["capture"]):
    broken = copy.deepcopy(base)
    del broken["capture"][key]
    expect_error(broken, "capture." + key, "missing " + key)
no_block = copy.deepcopy(base)
del no_block["capture"]
expect_error(no_block, "capture", "missing capture block")

# Wrong types, one per key.
wrong = {
    "dt": "fast", "lastStep": 240.5, "imageSteps": 30, "linearStep": "120", "imageSize": True,
    "cameras": {"name": "front"}, "cameraTarget": [0, 0], "cameraDistance": "500", "orthoWidth": [400],
    "textures": "T_Smoke_1",
}
check(sorted(wrong) == sorted(base["capture"]), "wrong-type table covers the capture keys")
for key, value in wrong.items():
    broken = copy.deepcopy(base)
    broken["capture"][key] = value
    expect_error(broken, "capture." + key, "wrong type " + key)
extra = copy.deepcopy(base)
extra["capture"]["fps"] = 60
expect_error(extra, "capture.fps", "unknown key")
bad_linear = copy.deepcopy(base)
bad_linear["capture"]["linearStep"] = 7
expect_error(bad_linear, "capture.linearStep", "linearStep outside imageSteps")

print("OK")
