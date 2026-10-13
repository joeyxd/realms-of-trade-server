# Item model browser QA

Reproduce from `gm-editor-first` with `node tools/qa-item-models.mjs` (Playwright is resolved from the sibling server scratch install). The script launches a local Chrome browser and an isolated in-memory game host; it does not connect to the public game server or write authoritative game state.

`browser-evidence.json` records desktop 1280×720 and mobile landscape 844×390 results. Screenshots include boot/join, the imported-item lineup, torch lit/unlit, wood atlas material, new goods, and all 12 item models. Temporary scene groups, camera rig override, camera pose, and UI opacity are restored after capture.
