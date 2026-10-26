# GM05b bounded regression

Date: 2026-10-11 (America/Mexico_City)
Node.js: v24.14.0

The bounded suite completed with no failures. Test execution was sequential (`--test-concurrency=1`) to keep integration workloads isolated.

| Run | Command scope | Test cases | Pass | Fail | TAP duration |
|---|---|---:|---:|---:|---:|
| Main GM and terrain regression | all `tests/gm-*.test.mjs`, cartography, ground terrain, sand terrain | 255 | 255 | 0 | 341324.3612 ms |
| Ground-host authority | host authority, process, and SQL tests | 12 | 12 | 0 | 44234.1048 ms |
| Total | 52 test files | 267 | 267 | 0 | 385558.466 ms |

The exact file manifest is in `files.txt`; raw TAP is in `bounded.tap` and `ground-authority.tap`.

After the mobile menu entry was moved into the existing actions row, its five admission tests passed again (`node --test tests/gm-editor-entry.test.mjs`); see `menu-entry.txt`. These overlap the main suite and are not added to its unique count.

Browser and pinned production image acceptance are recorded separately in the GM05b delivery report.
