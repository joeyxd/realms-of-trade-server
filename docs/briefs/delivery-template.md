# Delivery brief — [DELIVERY-ID]

> Reusable worker brief. The delivery plan is authoritative for scope and order; fill every applicable field before assigning work. Product text and player-facing copy must be in Spanish. Code comments remain in English. This brief does not resolve pending design decisions or request permission already granted in the session.

## Reference and design status

- **Plan / slice:** [link and section in `PLAN-DELIVERY.md`]
- **Milestone references:** [relevant plan sections]
- **Approved direction this slice must preserve:** [specific accepted decisions]
- **Pending design that this slice must leave open:** [list; state any narrow prototype assumptions and keep them reversible]
- **Outcome / player-visible behavior:** [one bounded, observable result]

## Starting state and ownership

- **Base commit:** [full or short hash; do not assume the branch has no newer work]
- **Live working-tree state:** [record relevant dirty/untracked paths and their owners before editing]
- **Worker:** [name]
- **Concurrency:** root plus at most three Luna workers (four active slots total). Root owns architecture, shared-file integration, evidence review, and final acceptance.
- **Starting points to read:** [exact files and sections, including applicable `AGENTS.md`, handoff, plan, and relevant brief]
- **Files this worker may edit:**
  - `[exact/path/file]` — [exclusive ownership / expected change]
- **Explicit exclusions:** [paths, systems, tasks, external operations]
- **Coordination rule:** Assign exclusive file ownership. If two tasks need overlapping files, use separate worktrees when needed and integrate through the parent. Never reset, clean, overwrite, or delete another worker's dirty or untracked work. Do not edit outside the writable list without parent reassignment.

## Objective and bounded outputs

- **Objective:** [specific implementation or read-only deliverable]
- **Included tasks:**
  1. [concrete task and expected result]
  2. [concrete task and expected result]
- **Out of scope:** [adjacent work intentionally deferred]
- **Dependencies / gates:** [required prior slices, protocol or data dependencies, and what this slice unlocks]
- **Simulation / network contract, if relevant:** [authoritative owner, command/event/snapshot fields, validation, deterministic RNG/time rules, save or migration behavior]
- **Fallback / rollback:** [how to disable or revert the slice safely; procedural or previous behavior where relevant; preserve existing saves and unrelated work]

## Assets, exports, and tools

- **Asset candidate(s), if any:** [catalog record and intended in-game use; distinguish confirmed appearance from inference]
- **Exact export/import scope:** [format, destination, manifest key or asset hook; otherwise write “none”]
- **Availability checks:** Confirm required source paths, conversion/import tools, runtime dependencies, and destination hooks exist before relying on them. Report missing or unverified prerequisites; do not claim an export/import succeeded without evidence.
- **Fallback:** [existing procedural art or other reversible visual fallback]
- Read access to the three projects under `C:\Unreal` is already authorized; use only the assigned source scope and keep originals read-only. Any conversion works in a reserved copy/staging destination, with tools that do not write to the originals. The author handles licensing; do not start a licensing audit.

## Validation and acceptance evidence

- **Targeted tests:** [commands and the behavior they demonstrate; add or change only meaningful tests for this slice]
- **Visual QA, if applicable:** [scenario, viewport/device, expected visible result, capture location, and inspection method]
- **Integration checks:** [protocol/client-server compatibility, migration, reconnection, or other relevant checks]
- **Required regression:** Run one final regression pass for the assigned scope after integration. Avoid duplicate runs unless a change or failure justifies one.
- **Shared verification resources:** Use one browser/GPU visual verification run at a time. Coordinate before starting it. A software-rendered capture can show appearance but cannot establish real-device performance or a frame-rate claim.
- **Device claims:** Report only devices and conditions actually tested. Keep GPU, controller, phone, multiplayer, latency, and performance checks explicitly pending when they were not performed.
- **Acceptance evidence:** [test output, inspected capture paths, relevant diff/commit references, or read-only sources]

## Delivery report (20 lines maximum)

Include:

- Files changed and the concrete behavior/output delivered.
- Tests and visual/integration checks run, with results and evidence locations.
- Asset/export/import status, including unavailable tools or unverified steps.
- Limitations, open decisions, device/performance checks still pending, and follow-up dependencies.
- Any scope deviation or conflict found in the starting tree.

Do not commit, push, deploy, publish, or rewrite shared history. Return the work and evidence to the parent for integration. The parent performs one consolidated acceptance pass and decides whether the slice is complete.
