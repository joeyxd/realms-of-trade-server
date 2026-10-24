"""Build the checkpoint of the SubUV wrap reference pair (systems/ns-basichit-wrap.json: NS_BasicHit with the image steps
moved to 20-23, where the Flame's subImage runs from 33.3 to 38.3, past the 32 cells of its 8x4 grid).

python build_wrap_checkpoint.py --spec <systems/ns-basichit-wrap.json> --a <run dir> --b <run dir> --base <run dir> --out <checkpoint.json> [--root <repo>]

build_profiled_checkpoint.py runs as a library with its author-recorded facts set for this pair: the command (the wrap
spec), the wall times and the attempts that did not become final runs; the code hashes also pin this file. Everything
else is computed by that module, unchanged (reference-profiled-checkpoint.json pins its text and the checker's), and
check_profiled_checkpoint.py verifies the result with the checkpoint path as its argument.
"""
import sys

import build_profiled_checkpoint as builder

THIS_FILE = "tools/unreal-niagara-probe/build_wrap_checkpoint.py"
builder.COMMAND = builder.COMMAND.replace("/systems/ns-basichit.json'", "/systems/ns-basichit-wrap.json'")
assert builder.COMMAND.endswith("/systems/ns-basichit-wrap.json'")
# Author-recorded: Stopwatch wall time around the PowerShell command (seconds), and every attempt that did not become
# a final run.
builder.FINAL_WALL_SECONDS = {"basichit-reference10": 57.9, "basichit-reference11": 54.4}
builder.ATTEMPTS = (
    {"name": "basichit-reference07", "wallSeconds": 1405.2, "outcome": "failed",
     "note": ("Result={Fail} at the 540 s latent timeout with 24 of 241 particle states and no capture-report.json: the "
              "editor ran at 4 to 5 FPS from launch (FWaitForInteractiveFrameRate timed out at 600 s; 33.7 to 37.8 FPS "
              "in the earlier runs) while another session's headless Chrome on SwiftShader used about 7 cores; the "
              "editor itself used 0.19 cores and no I/O. The next launch, with the machine idle, hit 32.2 FPS after "
              "5 s. Left in .scratch/unreal as evidence; the name is not reused.")},
    {"name": "basichit-reference08", "wallSeconds": 61.7, "outcome": "complete, not final",
     "note": ("capture_code recorded the raw bytes of capture_reference_profiled.py and capture_profile.py with CRLF line "
              "endings (core.autocrlf checkout), so check_profiled_checkpoint.py rejects the profile section; their LF "
              "text is the pinned one. .gitattributes now keeps both files LF and the pair was captured again.")},
    {"name": "basichit-reference09", "wallSeconds": 64.4, "outcome": "complete, not final",
     "note": "repeat of basichit-reference08, same CRLF capture_code."},
)
builder.CODE_FILES = builder.CODE_FILES + (THIS_FILE,)

if __name__ == "__main__":
    sys.exit(builder.main(sys.argv[1:]))
