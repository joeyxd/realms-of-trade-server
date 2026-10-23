import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { LAYER } from '../render/pipeline.js';

/** Keep gizmo materials intact while the world runs its normal/depth pass. */
export function createEditorTransformControls(camera, canvas) {
  const controls = new TransformControls(camera, canvas);
  controls.traverse((object) => object.layers.set(LAYER.NO_OUTLINE));
  // Three uses this raycaster for both the handles and the hidden drag plane.
  controls.getRaycaster().layers.enable(LAYER.NO_OUTLINE);
  return controls;
}
