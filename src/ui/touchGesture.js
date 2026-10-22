// Touch gesture helpers (DOM-free, so node tests drive them without a browser).
//
// holdAim: the state machine of a held fire button that can also be dragged like a stick (the pistols' ATK and
// guard/second gun). A tap presses the bit and holds it while the finger is down; the auto-aim picks the direction
// and input.touchAim stays untouched. Dragging past DRAG_FAR px switches the gesture to aimed for good: input.touchAim
// carries the drag direction while the finger is down (main.js aims at it and skips the auto-aim), the held bit stays
// set so the sim keeps firing at its own cooldown, and releasing only clears the held bit and the aim (no extra shot).
// Several pointers: the gesture that last set input.touchAim owns it, and releasing clears it only if it still does.
export const DRAG_FAR = 22; // px a finger must travel before the gesture is a drag (the same threshold Q / E / R use)

// input: { touchHeld, touchAim, press(bit) } (the Input instance). Returns { down, move, up, active }.
export function holdAim(input, bit) {
  let id = null, far = false, mine = null;
  const clear = () => {
    if (mine && input.touchAim === mine) input.touchAim = null;
    mine = null; far = false;
  };
  return {
    get active() { return id !== null; },
    get aimed() { return far; },
    down(pointerId) {
      if (id !== null) clear(); // a second finger on the same button replaces the first, like a plain hold did
      id = pointerId; far = false; mine = null;
      input.press(bit); input.touchHeld |= bit;
    },
    // dx, dy: the finger's travel since it landed, in stage px (y down). Returns the vector to draw the aim line
    // with ({dx, dy}) while the finger is beyond DRAG_FAR, else null (inside it the last direction is kept).
    move(pointerId, dx, dy) {
      if (pointerId !== id) return null;
      const l = Math.hypot(dx, dy);
      if (l <= DRAG_FAR) return null;
      far = true;
      mine = mine || { x: 0, y: 0, k: 0, release: false };
      mine.x = dx / l; mine.y = -dy / l; mine.k = Math.min(1, l / 150); mine.release = false;
      input.touchAim = mine; // the pointer that last set it owns it
      return { dx, dy };
    },
    // Returns true when this pointer ended the gesture (so the caller hides the aim line).
    up(pointerId) {
      if (pointerId !== id) return false;
      id = null;
      input.touchHeld &= ~bit;
      clear();
      return true;
    },
  };
}
