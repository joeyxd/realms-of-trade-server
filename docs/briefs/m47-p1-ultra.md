# Brief P1 — Ultra comic tier (MAREA NEGRA)

You build the base; the lead dev reviews, polishes and merges. You work in a **git worktree** (your cwd).
When done: `git add -A && git commit -m "WIP M4.7 P1 ultra"` on your worktree branch. **Never push.**
Read `PLAN-M4.7.md` §0, §2.1 (Spanish). Client only: do not touch `src/sim`, `src/net`, `src/data/weapons.js`.
Another assistant is changing the sim in parallel; stay out of it.

## 1. GPU detection: `src/render/gpu.js` (new) + `tests/gpu.test.mjs`
- `export function classifyGpu(name, mobile)` returns `'weak' | 'mid' | 'strong'` (pure, regexes on the lowercased
  name):
  - weak: swiftshader, llvmpipe, softpipe, software, "basic render", mali-4, mali-t, adreno [2-5]\d\d, powervr,
    "intel(r) hd graphics", "intel hd", "gma".
  - strong: geforce, rtx, gtx, quadro, nvidia, "radeon rx", "radeon pro", "intel arc", "apple m\d", "apple gpu"
    when `!mobile`, adreno (73\d|74\d|75\d|8\d\d).
  - else mid. Order: weak checks first.
- `export function gpuInfo(renderer)`: `gl = renderer.getContext()`, `ext = gl.getExtension('WEBGL_debug_renderer_info')`,
  name = `gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)` (try/catch → ''); clean ANGLE wrappers
  (`ANGLE (Vendor, NAME Direct3D11 vs_5_0…)` → `NAME`). Returns `{ name, tier }`.
- Test with ~12 real strings (swiftshader ANGLE string, "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0
  ps_5_0, D3D11)", "Apple M2", "Apple GPU" mobile / desktop, "Adreno (TM) 740", "Adreno (TM) 610", "Mali-G78",
  "Intel(R) UHD Graphics 620" → mid, "Intel(R) HD Graphics 4000" → weak, "AMD Radeon RX 6700 XT", "Intel(R) Arc(TM) A770").
  Tests run with `node --test` (look at `tests/tiers.test.mjs` for the style and how it imports).

## 2. Tier `ultra` (`src/render/quality.js`, `src/main.js`, `src/ui/pause.js`, `src/core/settings.js`)
- `TIERS = ['low', 'medium', 'high', 'ultra']`. `tierConfig('ultra')` = the high config + `name: 'ultra', ink: 2,
  comic: 1, outlineMul: 1.3`. The other tiers get `comic: 0, outlineMul: 1` explicitly.
- `Quality(apply, mode, isMobile, gpuTier)`: AUTO start = mobile → medium; gpuTier strong → ultra; else high. The
  step-down at < 45 fps already walks `TIERS` down (ultra → high). Update `tests/tiers.test.mjs` if it lists tiers.
- `main.js`: compute `gpuInfo(scene.renderer)` once at boot (grep where `new Quality(` is built), pass the tier,
  keep it in `st.gpu` for the settings. `?q=ultra` must work (grep `params.get('q')`).
- Pause → Ajustes: in `set-quality` add `<option value="ultra">Ultra · cómic dramático</option>` after Alto; under the
  row a small muted line `GPU: <name> · potente | media | básica` (escape the name; '—' when empty).
  Setting `comicFx: true` (defaults in settings.js) with a checkbox «Efectos de cómic (impactos, onomatopeyas)»
  next to the other visual toggles; it only acts on Ultra.
- `scene.applyQuality(cfg)` (grep `U.mnInk.value`): mnInk = `cfg.ink` (0/1/2); pass `cfg.comic`, `cfg.outlineMul` to the
  pipeline.

## 3. Shaders (`src/render/toon.js`, `src/render/inkGlsl.js`)
`mnInk` now means 0 low / 1 medium-high / 2 ultra. **Everything that multiplies by mnInk today must use
`min(mnInk, 1.0)`** (comicPost `mnM`, `mnDetailFade()` in inkGlsl.js) or detail doubles. Define in GLSL_COMMON:
`float mnUltra() { return clamp(mnInk - 1.0, 0.0, 1.0); }` (or an inline expression).
- **Bands** (`mnBand`, the `getGradientIrradiance` override that normalises with `(tb - 0.36) / 0.64`, the
  `MN_SOFT_BAND` character path): deep `mix(0.36, 0.20, U)`, mid `mix(0.70, 0.62, U)`; characters deep
  `mix(0.36, 0.26, U)`. One `mnDeep()` / `mnMid()` helper so the normalisation uses the same value. Tint:
  `tintN` → `pow(tintN, vec3(mix(1.0, 1.4, U)))` (more saturated shade on ultra).
- **Hatching** (comicPost) on ultra: period 0.40 → 0.30 (`MN_HATCH_PERIOD` becomes an expression or two consts
  mixed by U), stroke widths × 1.35, crossing set from `smoothstep(0.55, 0.9, mnDark2)` instead of (0.8, 1.0),
  ink `col * 0.42` → `col * mix(0.42, 0.30, U)`, ink amount 0.7 → 0.85, distance fade 45→80 → 60→100.
- **Halftone dots** (ultra only, inside comicPost): world-space Ben-Day dots on the same plane coords (`mnP`),
  rotated 45°, cell 0.22 u: `hp = mat2(0.7071, -0.7071, 0.7071, 0.7071) * mnP / 0.22`, `c = fract(hp) - 0.5`,
  radius `0.5 * sqrt(tone) * 0.92`, tone = `smoothstep(0.05, 0.45, mnDark) * (1.0 - 0.5 * smoothstep(0.6, 0.9, mnDark))`
  (dots in the light → shade transition, thinning where the hatching takes over). AA with `fwidth(hp.x)` —
  **take that derivative before the branch** like `mnF1`. Fade with screen size like `mnPx` (dots under ~4 px go).
  Colour: `mix(col, col * 0.55 * tintN-ish, dot * 0.6 * mnM)`. Same masks as the hatching (glow, hatchMask,
  grass less). Widen the early-out on ultra: `mnDark > mix(0.25, 0.05, U)`.
- Characters rim (grep `mnRimStr` in characters.js, 1.1): × `mix(1.0, 1.4, U)` in the shader (no JS change
  per tier needed) and keep `rimB` as is.

## 4. Outlines and final pass (`src/render/pipeline.js`)
- Composite: `uThick` × `q.outlineMul` (where `uThick` is computed from the height), uniform `uCreaseW` (0.5 →
  0.7 on ultra) replacing the `W_CREASE` const, world fade `uFadeNear/Far` 90/210 → 140/320 on ultra.
- Final pass uniforms `uComic` (0/1), `uImpact` (0..1), `uImpactPos` (vec2 uv), `uImpactCol` (vec3), `uLines`
  (0..1), `uLinesPos` (vec2 uv), `uSeed` (float). When `uComic > 0.5`:
  - `uContrast + 0.08`, `uSat + 0.08`;
  - vignette toward ink `vec3(0.07, 0.04, 0.14)` instead of black (`col = mix(col, ink, vig)`, same shape);
  - paper grain: `col *= 1.0 - 0.025 * (hash(floor(gl_FragCoord.xy / 2.0)) - 0.5)` (static, screen space);
  - **impact frame**: `L = dot(sqrt(col), lw)`; two-tone print: `L > 0.45 ? paper (0.98, 0.95, 0.86) : mix(ink,
    uImpactCol * 0.4, 0.25)`; `col = mix(col, print, uImpact * 0.9)`;
  - **speed lines**: from `uLinesPos` (aspect-corrected: `uTexel.y / uTexel.x`), angle sectors (~56 around), a
    hash per sector (+ uSeed) keeps ~30 % of them, each a thin wedge tapering inward, only beyond r ≈ 0.16–0.3
    (random per line), ink at `uLines * 0.6`. Cheap: no loops, no texture reads.
  - All of it costs nothing when `uComic` is 0 (one branch on a uniform).
- Pipeline API: `pipeline.impact(uvx, uvy, color, { lines = 1 })` sets `uImpact = 1` for 2 rendered frames (then 0)
  and `uLines = 1` decaying to 0 in 0.3 s (decay in the existing per-frame update), new `uSeed` each call; ignored
  unless comic is on. At most one impact frame every 0.4 s (lines can retrigger).

## 5. Comic FX module: `src/ui/comic.js` (new)
- `comic.configure({ pipeline, camera, worldUI, settings, isOn: () => tier is ultra && settings.comicFx !== false })`.
- `comic.hit(x, y, z, { color = 0xffffff, word, big = false, frame = false, lines = false })`: projects the world
  point to uv for the pipeline; `frame` → impact frame (only if `!settings.reducedMotion`), `lines` → speed lines
  (half strength with reducedMotion), `word` → onomatopoeia.
- Onomatopoeia: `worldUI.float(...)` with class `ono` (or a sibling method if float does not fit): big display font
  (`var(--font-display)`), 900, uppercase, fill yellow `#ffd23d` (red-orange `#ff6a3d` for big), 4–5 px ink stroke
  (`-webkit-text-stroke` + `paint-order: stroke fill`, plus an ink drop shadow), random rotation ±8°, pop
  `scale(0.4) → 1.15 → 1` in 120 ms, hold ~350 ms, fade 200 ms, rise a little. `big` adds a jagged starburst
  (inline SVG polygon, 14 points, white with ink border) behind the word. Throttle: ≤ 1 per 0.25 s, ≤ 3 alive.
  CSS in `styles/hud.css` near the damage numbers (grep `.dmg`). Size with `--ui-scale` if that variable exists.
- Wire triggers in `src/ui/feedback.js` (only for **your** actions, plus boss events): heavy 3rd sword hit «¡ZAS!»,
  crit «¡CRAC!» (find the crit flag on damage events), perfect guard «¡CLANG!» + frame + lines, EXCELENTE reflect
  «¡PING!» + lines, riposte Tormenta «¡FUAAA!» big + frame + lines, lead rain «¡RA-TA-TA!», boss phase change /
  boss or elite killed «¡KABUM!» big + frame + lines. Read the existing cases to find the right events and fields.
  Later steps will call `comic.hit` for the new skills.

## Budget / perf
Ultra only. Measure with the perf script (swiftshader, comparative only, ONE run at a time, ≤ 7 min each):
`ROOT=$PWD Q=high` then `Q=ultra`, `VW=960 VH=540 SCEN=perf,perfC MN_LIBS=<scratchpad>/libs
OUT=<scratchpad>/m47/perf-<q> node <scratchpad>/m46/perf.mjs`. Target: ultra ≤ 25 % slower than high.
`<scratchpad>` = `/tmp/claude-0/-home-user-realms-of-trade-server/acc8dff3-9c04-52ef-947f-a64b420cb81d/scratchpad`.

## Checks
- `npm test` green (one run; if the net latency test fails once under load, re-run it alone).
- Screenshots (swiftshader, slow; ONE run at a time, timeout ≤ 6 min): `<scratchpad>/m46/look.mjs` with
  `ROOT=$PWD MN_LIBS=<scratchpad>/libs SCEN=spawn,village,fight,caldera`: once `Q=high OUT=<scratchpad>/m47/p1-high`,
  once `Q=ultra OUT=<scratchpad>/m47/p1-ultra`, once `Q=ultra TOD=night OUT=<scratchpad>/m47/p1-night`. Look with
  Read and compare. Ultra must read as a dramatic printed comic (deep tinted blacks, dots in the transitions, bold
  ink) and never as noise or moiré; characters must stay readable. Force one impact frame + a word for a shot
  (`window.__mn` exposes things in debug: add `__mn.comic = comic` if needed) → `p1-ultra/07-impact.png`.
  Iterate at most twice.
- Comments in English (dense, short, like the code around), UI text in Spanish.

## Report (≤ 20 lines, no code dumps)
Files changed, values you ended with, perf numbers (high vs ultra, village / Caldera), test result, screenshot
paths, anything you could not do, the commit hash on your worktree branch.
