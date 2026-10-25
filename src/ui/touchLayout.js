// Touch HUD layout (PT03), DOM-free so node tests can sweep it over many stages. touch.js reads the real stage size,
// the user's size setting and the safe-area insets, asks for the layout and writes it to CSS custom properties.
//
// Frame: stage CSS px, origin at the stage's top-left, x right, y down (the stage is already rotated on a phone held
// upright, see stage.js). Every slot is { x, y, d }: centre and diameter.
// Arrangement for a right thumb: ATK in the bottom-right corner, the combat buttons (DASH, JUMP, PARRY, Q, E, R) in a
// ring around it, the secondary ones (G, POTION, ACT, WATER) up the right and left edges of the cluster. The cluster
// never leaves the right 35 % of the stage and the joystick keeps the bottom-left: the middle stays free.

// Button diameters in tb units (tb = 1 is the old "medium"); the same values as the CSS `--d` of each button.
export const SLOT_D = { atk: 92, dash: 70, parry: 62, q: 58, e: 58, r: 54, g: 54, potion: 48, act: 64, jump: 62, water: 54 };
export const JOY_D = 104;

// Centre of each slot from ATK's centre in tb units (x left < 0, y up < 0). `jump` is a reserved slot: PT06 puts the
// jump button there. `water` is the freshwater button that main.js adds to the cluster (it is not a combat control).
// Spacing rules the ring keeps (tests/touch-layout.test.mjs): centre distance >= r1 + r2 + 4, DASH and JUMP adjacent,
// every combat button within 190 of ATK. The occasional buttons sit low so the top-right HUD never reaches them: G is
// the outermost of the left column (up to x -189 tb, the cluster's width budget) and POTION sits above it, low enough to
// clear the account row on a 844 x 390 stage (that row ends at y 138; PT03 rework 2 moved POTION from [-113, -186] and G
// from [-162, -122]), ACT is the bottom row's left end (it shares DASH's row: its bottom edge is ATK's, its top stays under
// the middle zone, see keepOuts below).
const ARC = {
  atk: [0, 0], dash: [-86, 8], jump: [-60, -62], parry: [6, -84],
  q: [-126, -52], e: [-100, -121], r: [-41, -139],
  water: [20, -149], potion: [-137, -165], g: [-162, -115], act: [-157, 14],
};
export const SLOTS = Object.keys(ARC);

export const EDGE_GAP = 12;   // ATK's gap to the safe box (corner hug; the tests accept up to 24)
export const MARGIN = 8;      // every control keeps this much inside the safe box
const JOY_GAP = 28;           // the resting joystick's gap to the left and bottom edges of the safe box
// Every slot stays below this share of the height: the top-right HUD panels on a compact landscape stage (hud.css
// `max-height: 480px`; the minimap and the account row are keep-outs of their own below), the quest tracker down the
// right side on a taller one. 0.56 h mirrors a fresh character's tracker (it ends near 0.54 h at 1024 x 768) and is NOT
// a bound: the tracker grows with its quests up to max-height 100cqh - 140px - 204px (styles/minimap.css, the
// `--tracker-map-top` / `--tracker-lantern-space` rule), so a long list can still reach the cluster. A follow-up ticket
// makes the tracker reserve the cluster's column instead of this layout guessing its height.
const topKeep = (h) => (h > 480 ? 0.56 : 0.2);
const STEP = 0.001, FIT_FLOOR = 0.78, HARD_FLOOR = 0.4;

// Auto factor from both stage sides: 0.93 at 844 x 390 (what a small phone had), growing with the stage area to 1.35 and
// shrinking slowly below it (667 x 375 keeps 0.83).
const REF_AREA = 844 * 390, AUTO_BASE = 0.93, AUTO_UP = 2, AUTO_DOWN = 0.8, AUTO_MIN = 0.78, AUTO_MAX = 1.35;

// tb before any fit: the user's setting (0.85 / 1 / 1.18) times the auto factor. Non-decreasing in w and h.
export function touchScale(w, h, user = 1) {
  const s = Math.sqrt(Math.max(1, w) * Math.max(1, h) / REF_AREA);
  return user * Math.min(AUTO_MAX, Math.max(AUTO_MIN, AUTO_BASE + (s >= 1 ? AUTO_UP : AUTO_DOWN) * (s - 1))); // gentle below the reference
}

// The part of the stage nothing may cover (full stage coordinates: x 35-65 %, y 20-80 %), and the joystick half (left 50 %,
// below 30 %).
export const centralZone = (w, h) => ({ x0: 0.35 * w, y0: 0.2 * h, x1: 0.65 * w, y1: 0.8 * h });
export const joyZone = (w, h) => ({ x0: 0, y0: 0.3 * h, x1: 0.5 * w, y1: h });

// Boxes of other HUD parts that no slot may touch (stage px, same frame as the slots). Each mirrors a CSS rule: change
// them together (tests/touch-layout.test.mjs sweeps every one over the stage grid, tools/qa-touch-layout.mjs checks the
// real DOM with every button and the lantern forced visible). The lantern needs no box since R1b: on touch it sits beside
// the Chat in the left column (styles/hud.css `body.touch:not(.is-naval) .personal-lantern`), far from the cluster.
// MINIMAP: styles/minimap.css `.world-minimap.is-touch` (84 px round, top 12 + safe-t, right 18 + safe-r) and its place
// label under it (`.minimap-caption`, 10 px below the map, one 9-10 px line, 16 px wider on each side).
export const MINIMAP_LEFT = 122, MINIMAP_BOTTOM = 120;
// TOPROW: styles/hud.css `@container stage (min-width: 721px) and (max-width: 900px) and (max-height: 480px)`: the
// account row (chip, icon buttons, companions) sits on the top border at 8 + safe-t, 44 px high, right-aligned to
// 110 px + safe-r from the right edge (beside the minimap); its left end never passes the player column (18 + 226 px).
export const TOPROW_TOP = 8, TOPROW_BOTTOM = 52, TOPROW_RIGHT = 110, TOPROW_LEFT = 244;
export function keepOuts(w, h, safe = {}) {
  const l = safe.l || 0, r = safe.r || 0, t = safe.t || 0;
  const list = [{ name: 'minimap', x0: w - r - MINIMAP_LEFT, y0: 0, x1: w - r, y1: t + MINIMAP_BOTTOM }];
  if (h <= 480 && w >= 721 && w <= 900) list.push({ name: 'toprow', x0: l + TOPROW_LEFT, y0: t + TOPROW_TOP, x1: w - r - TOPROW_RIGHT, y1: t + TOPROW_BOTTOM });
  return list;
}

const hitsRect = (c, z) => {
  const nx = Math.max(z.x0, Math.min(c.x, z.x1)), ny = Math.max(z.y0, Math.min(c.y, z.y1));
  return Math.hypot(c.x - nx, c.y - ny) < c.d / 2;
};

function place(w, h, s, tb) {
  const atk = { x: w - s.r - EDGE_GAP - SLOT_D.atk / 2 * tb, y: h - s.b - EDGE_GAP - SLOT_D.atk / 2 * tb };
  const buttons = {};
  for (const k of SLOTS) buttons[k] = { x: atk.x + ARC[k][0] * tb, y: atk.y + ARC[k][1] * tb, d: SLOT_D[k] * tb };
  const jd = JOY_D * tb;
  return { tb, joy: { x: s.l + JOY_GAP + jd / 2, y: h - s.b - JOY_GAP - jd / 2, d: jd }, buttons };
}

// Rule 1 (strict = false) and the layout's own rules (strict): every circle inside the safe box with MARGIN to spare,
// the middle, the joystick half and the keep-outs free, every button under the top HUD.
function fits(L, w, h, s, strict) {
  const box = { x0: s.l + MARGIN, y0: s.t + MARGIN, x1: w - s.r - MARGIN, y1: h - s.b - MARGIN };
  const circles = [['joy', L.joy], ...Object.entries(L.buttons)];
  for (const [k, c] of circles) {
    const r = c.d / 2;
    if (c.x - r < box.x0 || c.x + r > box.x1 || c.y - r < box.y0 || c.y + r > box.y1) return false;
  }
  if (!strict) return true;
  const mid = centralZone(w, h), joy = joyZone(w, h), outs = keepOuts(w, h, s);
  for (const c of Object.values(L.buttons)) {
    if (hitsRect(c, mid) || hitsRect(c, joy) || outs.some((z) => hitsRect(c, z))) return false;
    if (c.y - c.d / 2 < topKeep(h) * h) return false;
  }
  return true;
}

// The layout for a stage of w x h with the safe-area insets `safe` ({ l, r, t, b }) and the user's size setting.
// tb is touchScale(), reduced in 0.001 steps while the arrangement does not fit: first until the strict rules hold (not
// below 0.78, or the scale itself if that is lower), then, on a tiny stage, until it at least stays inside the box.
// Positions are in tb units from ATK, so the spacing rules hold at every tb; only the edges and the zones can bite.
export function touchLayout({ w, h, safe = {}, user = 1 }) {
  const s = { l: safe.l || 0, r: safe.r || 0, t: safe.t || 0, b: safe.b || 0 };
  const target = touchScale(w, h, user), round = (v) => Math.round(v * 1000) / 1000;
  let tb = round(target), L = place(w, h, s, tb);
  const keep = Math.min(tb, FIT_FLOOR);
  while (!fits(L, w, h, s, true) && tb - STEP >= keep - 1e-9) { tb = round(tb - STEP); L = place(w, h, s, tb); }
  while (!fits(L, w, h, s, false) && tb - STEP >= HARD_FLOOR) { tb = round(tb - STEP); L = place(w, h, s, tb); }
  const quick = {};
  for (const [n, floor] of [[4, 32], [8, 28]]) {
    let d = Math.max(floor, 44 * tb);
    for (;;) {
      const y = h - s.b - MARGIN - d / 2;
      let left = s.l + MARGIN + d / 2, right = w - s.r - MARGIN - d / 2;
      // At this row height, reserve the exact circle clearance rather than their bounding boxes.
      for (const [name, c] of [['joy', L.joy], ...Object.entries(L.buttons)]) {
        const r = (d + c.d) / 2 + 4, dy = Math.abs(y - c.y);
        if (dy >= r) continue;
        const dx = Math.sqrt(r * r - dy * dy);
        if (name === 'joy') left = Math.max(left, c.x + dx);
        else right = Math.min(right, c.x - dx);
      }
      if ((right - left >= n * (d + 2) && y - d / 2 >= 0.8 * h) || d === floor) {
        Object.assign(quick, { ['d' + n]: d, ['gap' + n]: 2, ['x' + n]: (left + right) / 2, ['y' + n]: y });
        break;
      }
      d = Math.max(floor, d - 0.05);
    }
  }
  return { ...L, target, fitted: tb < round(target), quick };
}
