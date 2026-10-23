# Brief P4 + P5 — the tattoos on the client (MAREA NEGRA, repo /home/user/realms-of-trade-server)

You build the base; the lead dev reviews, polishes and commits. **Do NOT git commit or push.**
Read `PLAN-M4.7.md` §1, §2.3–§2.6 (Spanish) first: it is the spec, this brief is how to build it.
The sim side is done (P2 + P3, committed): slots, loadouts, the three tattoos and their events. The Ultra comic tier
is done too (P1: `src/ui/comic.js`, `comic.hit(...)`). Work in **two phases**: Phase A (P4: aim, input, VFX,
animation, HUD, sound) → stop and report. The lead reviews, then tells you to do Phase B (P5: the «Tatuajes» tab,
Doña Sepia, messages). Client only: do not change `src/sim` or `src/net` (tiny exceptions are named below).

## What the sim gives you (read `src/data/tattoos.js`, `src/sim/systems/skills.js` header, `git log -3 --stat`)
- Slots: `skQ / skE` (index into `SKILL_IDS`), `fmQ / fmE` (form 0 base, 1 A, 2 B), `rkQ / rkE` (rank 1–5),
  `elem`; plus the tattoo state columns P3 added (grep `PLAYER_FIELDS` in `src/sim/ecs.js`). `skillOf(ecs, e, slot)`
  gives the id; P3 has a helper that merges a form's overrides over the base numbers (grep `formed` / `skillNum`
  in skills.js / weapons.js): **use it for every range / radius / cooldown you draw** (forms change them).
- `castKind(id)` in tattoos.js: `dir` (lunge, wave, blast) · `self` (blink) · `ground` (tromba, leap) · `charge`
  (wheel). The pistols' R (rain) aims at a point too: treat it as `ground` with `SKILLS.rain` numbers.
- Events (public unless said): `cast` {e, seq, skill, …; leap adds x0, z0, x1, z1, air, h, form}, `tromba` {e, id,
  seq, x, z, tick (impact), r, form, n}, `trombaHit` {e, id, x, z, r, form, n}, `trombaEnd`, `slam` {e, seq, x, z, r,
  form}, `blink` (as today), `wheel` {e, id, seq, slot, x, z, dx, dz, v0, R, r, k, hang, tick, form}, `wheelBack` {e,
  id, x, z, tick}, `wheelCatch`, `wheelDrop`, `stun`; private (`to` = you): `loadout`, `form`, `learned`,
  `tattooRank`, `skillDenied` {why}. **Check the real shapes in skills.js / the P3 tests before you rely on them.**
- Your own pirate's events come from the client prediction too (feedback.js already handles `me` vs others).

## Phase A — P4

1. **Player state** (`src/client/gameClient.js`, the `out` object ~line 543): expose `skQ, skE, fmQ, fmE, rkQ, rkE,
   elem` and whatever charge / leap / empower columns P3 added (`chg`, `empT`, …). Read-only for the UI.
2. **The aim controller** (`src/client/aimcast.js`, new, pure logic, no DOM / three): it turns slot key edges into
   command bits and a preview. Input: per fixed tick `{down: {q, e, r}, up: {q, e, r}, held: {q, e, r}, cancel,
   kinds: {q, e, r}, mode: 'indicator' | 'quick'}`. Output: `{prs, held, preview}` where `preview` is null or
   `{slot, kind}`. Rules:
   - `dir` / `self`: press on key down (exactly what the game does today).
   - `ground`: mode `indicator` (default) → key down starts the preview, key up sends the press; `cancel` while
     previewing drops it and nothing is sent. Mode `quick` → press on key down.
   - `charge`: key down sends the press **and** the slot's held bit while the key stays down; key up drops the
     held bit (the sim throws). Preview `{slot, kind: 'charge'}` while held.
   - One preview at a time (a second slot down replaces the first; the first sends nothing).
   - `tests/aimcast.test.mjs` (node --test, like `tests/tiers.test.mjs`) covers every rule above.
3. **Input** (`src/core/input.js`): take KeyQ / KeyE / KeyR out of `PRESS_KEYS`; keep `slotDown / slotUp / slotHeld`
   edges for them (keyboard, gamepad RB = q, LB = e, Y = r, and a `touch` source). `cancel`: RMB pressed or ESC
   while a preview is up, or gamepad B (button 1, free today). **The RMB that cancels must not raise the guard**:
   swallow it until it is released. ESC must not open the pause menu while it cancels (check the Escape hotkey in
   main.js). `main.js` fixed loop: feed the controller, OR its `prs` / `held` into the command
   (`btn: input.held | aimBit | ctrl.held`), and on the tick a `ground` press goes out, `ax / az` = the preview point.
4. **The preview point** (main.js): mouse = cursor on the ground, clamped to `[min, range]` from you along the same
   line (the sim clamps too). Gamepad = you + right stick dir × (min + tilt × (range − min)); no stick → the
   auto-aim enemy's feet if within range, else 4 u ahead. Touch = the drag (below). For `leap`, snap the marker to
   the real landing point: import the sim's stand probe P3 added (grep `canStand`) and walk the line like the sim
   does, so the player sees the clamp before casting.
5. **Touch** (`src/ui/touch.js`): `touch.setSkills({q: {id, kind}, e: {...}, r: {...}})` from main.js. `ground`:
   dragging shows the marker, the drag length k (0..1) maps to `min + k × (range − min)`; a tap without drag →
   auto-aim point (as the gamepad); release sends the press. `charge`: pointerdown sends the press + held, drag
   aims, pointerup drops held. `dir` / `self`: as today. Update the `ta` branch in main.js (today `d = 1.5 + k × 7.5`)
   to use the slot's range for `ground` and keep today's mapping for `dir`.
6. **Indicators** (`src/render/vfx/indicators.js`, new; read `decals.js` first and reuse its ground-hugging approach):
   - range ring around you (dashed, ~35 % alpha, the slot colour) with the skill's range;
   - ground marker: translucent disk + crisp edge + an inner ring turning + a small cross, radius = the form's `r`
     (rain: its radius); `leap`: marker at the landing point + a dashed arc from you (parabola, height `h`);
   - charge: an arrow from you along the aim, length = lerp(range fast, range slow, k), width = r, and a ring
     around you filling with k (k from `castT / charge` of the predicted pirate); a flash + tick sound when k = 1;
   - only you see your preview. **The Tromba cast** (`tromba` event) shows its marker to everyone with a warning
     ring closing until `tick`: purple for you (`#a77bff`-ish, match the HUD's own colour), amber for other pirates.
   - Pooled meshes made once; nothing allocated per frame; hidden = no draw cost.
7. **VFX** (`src/render/vfx/skillfx.js`, new; read `weaponfx.js` and `effects.js` for materials, pooling and the
   toon / glow conventions; reuse `effects.splash / ripple / sparks / dashBurst`, `combatFx.ring`, `W.after`):
   - **Tromba** (every `trombaHit`, so Gemelas' second spout too): a waterspout ~0.6 s: a tapered cylinder with a
     spiral, UV-scrolling water shader (foam bands, translucent, glow in alpha like other glowing VFX), rising
     then collapsing; foam ring + droplets at the base; ground ripple. Ojo de tormenta: a swirling vortex disk on
     the ground until `trombaEnd` (or 2 s).
   - **Abordaje**: during the flight a trail (afterimages) and a ground shadow at the landing point that grows;
     `slam`: dust ring, shock ring (`r`), debris sparks, shake + `rig.punchIn` for you. Form B bigger and darker.
     Parpadeo: the existing blink smoke + a glow on your weapon while `empT > 0`.
   - **Timón**: a ship's wheel mesh (8 spokes, rim, hub; wood + brass; toon material) spinning flat, radius = `r`.
     Out: the analytic path from the `wheel` event (`s(t) = v0·t − v0²·t²/(4R)` from `tick`); hang at the apex if
     `hang`; back: from `wheelBack`, home toward the owner's rendered position, ramping to the return speed
     (visual approximation is fine). A trail ribbon (`streaks.js`). `wheelCatch`: flash + float «¡Atrapado!» +
     sound; `wheelDrop`: it falls flat and fades.
8. **Animation** (`src/render/characters.js`): `ACT.CHARGE` (arm cocked back holding the wheel, a small shake when
   full) and `ACT.LEAP` (crouch the first 15 %, stretch in the air, squash on landing). The root rises during
   LEAP by `h · 4u(1 − u)` with `u = actT / air` (render only; remote pirates: `air` / `h` from their `cast` event,
   kept per entity; fallback to the base numbers).
9. **HUD + icons** (`src/ui/hud.js`, `src/ui/touch.js`): SVG icons `tromba` (spout), `leap` (boots over an arc),
   `wheel` (ship's wheel), in the style of the existing `ICONS`. The Q / E slots follow the loadout (main.js
   ~850–860 still reads `weaponOf(...).q/.e`: switch it to the slot ids): icon, title (name · form · rank in
   roman, hint), a small rank badge (I–V) and a form letter (A / B) when not base, cooldown sweep over the form's
   cd × (1 − cdr). Also `ui/rewards.js:193` and any other `weaponOf(..).q/.e` reader on the client (grep).
10. **Sound** (`src/audio/sfx.js`, synthesized like the others): `trombaCall` (rising whoosh), `splash` (noise burst +
    low thump), `leap` (whoosh), `slam` (thud + debris), `wheelSpin` (short whirr), `wheelCatch` (bright click +
    chime), `chargeFull` (tick).
11. **Comic** (Ultra only; `comic.hit` gates itself): your Tromba hitting ≥ 1 enemy «¡CHOF!» (big + frame + lines
    when ≥ 3), your slam «¡PATAPÚM!» + lines, a full-charge Timón throw «¡ZUUUM!» + lines from you, the empowered
    Parpadeo crit «¡CRAC!» (already wired for crits: check it shows). In `feedback.js` next to the other skills.
12. **Setting** (`src/core/settings.js` + `src/ui/pause.js` Ajustes): `launch: 'indicator'` with a select «Lanzamiento
    de áreas: Con indicador (mantén y suelta) / Rápido (al pulsar)». If the pause menu lists controls, add: «Q / E:
    mantén para apuntar el área, suelta para lanzar · RMB o ESC cancela · Timón: mantén para cargar».

Phase A checks: `npm test` green (one run; if `net.test` hangs under load, run it alone). Screenshots with
`<scratchpad>/m46/look.mjs` (read it; add scenarios there): `ROOT=$PWD MN_LIBS=<scratchpad>/libs Q=high` and one
`Q=ultra`, `OUT=<scratchpad>/m47/p4`: (a) Tromba marker held with the range ring, (b) the waterspout on two
enemies, (c) Abordaje mid-air + its landing marker, (d) the Timón out and the charge arrow, (e) the HUD slots with a
tattoo, rank and form. Use the dev commands (`{type:'dev', op:'tattoos', rank: 5}`, `op:'loadout'`, `op:'tattoo'`)
through the debug hooks (`window.__mn`). ONE browser run at a time, timeout ≤ 6 min. Look with Read; iterate at most
twice. **Stop and report (≤ 20 lines).**

## Phase B — P5 (when the lead says go)

13. **Tab «Tatuajes»** (`src/ui/charpanel.js`, key **T** in main.js like I / C / L): `TABS` gains
    `['tattoo', 'Tatuajes', 'T']`. Content, read from the profile's `p.sk` and `src/data/tattoos.js`:
    - top: the weapon you carry and its Q / E as two big cards (icon, name, form, rank in roman, a tinta bar to the
      next rank, hint);
    - the repertoire: your weapon's arts («Arte del sable · Maestría N», locked in grey below it), the tattoos you
      learned (rank, tinta bar, the three forms as chips: base / A / B with their hints; locked chips say «Rango II»
      / «Rango IV»), and the ones you have not learned in grey with «Aprende con Doña Sepia»;
    - select a card → «Poner en Q» / «Poner en E» → `{type: 'loadout', slot, id}`; a form chip →
      `{type: 'form', id, form}`. Touch-friendly (tap to select, buttons ≥ 44 px), mouse hover shows the detail.
    - opened from Doña Sepia (`open('tattoo', { learn: true })`): unlearned cards show «Aprender · gratis» or
      «Aprender · 150 oro» → `{type: 'learn', id}`.
14. **Messages** (feedback.js or main.js where private events land): `skillDenied` → toast + a shake on the card +
    deny sound: combat «Fuera de combate para cambiar (3 s sin recibir daño)», lawless «En la Cala sin ley no se
    cambia de tatuaje», weapon «Ese arte es de otra arma», gold «Te falta oro», far «Acércate a Doña Sepia», rank
    «Esa forma pide más rango», unknown «No puedes hacer eso». `learned` → «Aprendiste <b>Tromba</b>» + the
    mastery sound; `tattooRank` → «<b>Tromba</b> sube a rango III» (+ «Forma nueva: Ojo de tormenta» at II / IV) +
    the HUD slot flash; `loadout` / `form` → the equip sound; the panel redraws from the new profile.
15. **Doña Sepia**:
    - a look of her own: **append** a new NPC look at the END of `LOOKS` in `src/render/charlooks.js` (indexes of the
      others must not move): an older tattooist, grey bun, dark shawl, ink-stained apron, tattooed forearms (dark
      lines in the skin paint), maybe round glasses. Set her `skin` in `src/sim/worldgen.js` to that index (the one
      allowed sim edit) and check nothing clamps NPC skins to 5–6.
    - her stall (`src/render/props.js`, render only): a small awning, a rack with 3 hanging hides painted with
      designs (anchor, skull, waves; procedural canvas or vertex colour), a table with ink pots and a stool, behind
      her (opposite her `facing`, 1.5–2.5 u), never on the path; it uses the toon / ink pipeline like other props.
    - dialog (`src/data/quests.js` `NPC_TALK.tattoo`: 3–4 short flavour lines, Spanish, pirate tone; `src/ui/dialog.js`):
      a «Tatuar» button for her (like the vendor's shop button; generalise it) → `charPanel.open('tattoo', { learn:
      true })`. Her name shows on the map if NPCs are listed there.
    - first time you come near her: a teach toast «<b>Doña Sepia</b> tatúa habilidades para tus huecos Q / E. El
      primero es gratis. (T: tus tatuajes)».

Phase B checks: `npm test` green; screenshots `OUT=<scratchpad>/m47/p5`: the tab (desktop 1280×720 and a phone
landscape size), her stall and look, the dialog. Report (≤ 20 lines).

## Style
Comments in English, dense and short like the code around (a header comment per new file); UI text in Spanish.
No new dependencies. Numbers in `src/data/*` (indicator colours and sizes may live at the top of indicators.js).
`<scratchpad>` = `/tmp/claude-0/-home-user-realms-of-trade-server/acc8dff3-9c04-52ef-947f-a64b420cb81d/scratchpad`.
