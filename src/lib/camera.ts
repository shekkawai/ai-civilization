export const WORLD_SIZE = 96;

/** Camera centre in world-tile units, plus how many screen pixels one tile covers. */
export interface Camera {
  x: number;
  z: number;
  scale: number;
}

export const MAX_SCALE = 44;

export function fitScale(viewWidth: number, viewHeight: number) {
  if (viewWidth <= 0 || viewHeight <= 0) return 1;
  return Math.min(viewWidth, viewHeight) / WORLD_SIZE;
}

export function minScale(viewWidth: number, viewHeight: number) {
  return fitScale(viewWidth, viewHeight);
}

/**
 * Scale at which the world covers the whole viewport with no empty margin. Not the
 * opening view: on a wide stage it frames the empty middle of the map and hides both
 * civilizations, which is the opposite of what a spectator opens this page for.
 */
export function coverScale(viewWidth: number, viewHeight: number) {
  if (viewWidth <= 0 || viewHeight <= 0) return 1;
  return Math.max(viewWidth, viewHeight) / WORLD_SIZE;
}

/**
 * Keep the world filling the viewport: centre an axis whose full extent already fits,
 * otherwise stop the camera at the map edge so there is never dead space beside the map.
 */
export function clampCamera(camera: Camera, viewWidth: number, viewHeight: number): Camera {
  const scale = Math.max(minScale(viewWidth, viewHeight), Math.min(MAX_SCALE, camera.scale));
  const halfCellsX = viewWidth / scale / 2;
  const halfCellsZ = viewHeight / scale / 2;
  const x =
    halfCellsX * 2 >= WORLD_SIZE
      ? WORLD_SIZE / 2
      : Math.max(halfCellsX, Math.min(WORLD_SIZE - halfCellsX, camera.x));
  const z =
    halfCellsZ * 2 >= WORLD_SIZE
      ? WORLD_SIZE / 2
      : Math.max(halfCellsZ, Math.min(WORLD_SIZE - halfCellsZ, camera.z));
  return { x, z, scale };
}

export function worldToScreenX(camera: Camera, viewWidth: number, worldX: number) {
  return (worldX - camera.x) * camera.scale + viewWidth / 2;
}

export function worldToScreenZ(camera: Camera, viewHeight: number, worldZ: number) {
  return (worldZ - camera.z) * camera.scale + viewHeight / 2;
}

export function screenToWorld(
  camera: Camera,
  viewWidth: number,
  viewHeight: number,
  screenX: number,
  screenY: number,
) {
  return {
    x: (screenX - viewWidth / 2) / camera.scale + camera.x,
    z: (screenY - viewHeight / 2) / camera.scale + camera.z,
  };
}

/** Tile range covered by the viewport, padded by one so partial tiles still draw. */
export function visibleRange(camera: Camera, viewWidth: number, viewHeight: number) {
  const topLeft = screenToWorld(camera, viewWidth, viewHeight, 0, 0);
  const bottomRight = screenToWorld(camera, viewWidth, viewHeight, viewWidth, viewHeight);
  return {
    x0: Math.max(0, Math.floor(topLeft.x) - 1),
    z0: Math.max(0, Math.floor(topLeft.z) - 1),
    x1: Math.min(WORLD_SIZE - 1, Math.ceil(bottomRight.x) + 1),
    z1: Math.min(WORLD_SIZE - 1, Math.ceil(bottomRight.z) + 1),
  };
}

/** Zoom about a fixed screen point so the tile under the cursor stays under the cursor. */
export function zoomAt(
  camera: Camera,
  viewWidth: number,
  viewHeight: number,
  factor: number,
  screenX: number,
  screenY: number,
): Camera {
  const anchor = screenToWorld(camera, viewWidth, viewHeight, screenX, screenY);
  const scale = Math.max(
    minScale(viewWidth, viewHeight),
    Math.min(MAX_SCALE, camera.scale * factor),
  );
  const next = {
    x: anchor.x - (screenX - viewWidth / 2) / scale,
    z: anchor.z - (screenY - viewHeight / 2) / scale,
    scale,
  };
  return clampCamera(next, viewWidth, viewHeight);
}

export function approach(current: number, target: number, rate: number) {
  const next = current + (target - current) * rate;
  return Math.abs(target - next) < 0.0005 ? target : next;
}
