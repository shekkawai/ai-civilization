import { RULES } from "./config";
import { idx, inBounds, walkableTerrain } from "./map";
import type { CivId, Point, World } from "./types";

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function blockedCells(world: World, civId?: CivId) {
  const blocked = new Uint8Array(RULES.width * RULES.height);
  for (const building of Object.values(world.buildings)) {
    building.cells.forEach((cell, index) => {
      if (building.blocks[index] === 1) blocked[idx(cell.x, cell.z)] = 1;
    });
  }
  if ((world.protocolVersion ?? 3) >= 17 && civId) {
    for (const worker of Object.values(world.workers)) {
      if (worker.alive && worker.owner !== civId) blocked[idx(worker.at.x, worker.at.z)] = 1;
    }
  }
  return blocked;
}

export function passable(world: World, blocked: Uint8Array, x: number, z: number) {
  if (!inBounds(x, z)) return false;
  if (blocked[idx(x, z)]) return false;
  return walkableTerrain(world.tiles[idx(x, z)]);
}

/** Breadth-first path to the nearest of several goals. Returns [] when unreachable. */
export function findPath(world: World, blocked: Uint8Array, from: Point, goals: Point[]): Point[] {
  if (goals.length === 0) return [];
  const goalSet = new Set(goals.map((goal) => idx(goal.x, goal.z)));
  const start = idx(from.x, from.z);
  if (goalSet.has(start)) return [from];

  const previous = new Int32Array(RULES.width * RULES.height).fill(-1);
  const seen = new Uint8Array(RULES.width * RULES.height);
  const queue = [start];
  seen[start] = 1;
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const cx = current % RULES.width;
    const cz = Math.floor(current / RULES.width);
    for (const [dx, dz] of STEPS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!inBounds(nx, nz)) continue;
      const next = idx(nx, nz);
      if (seen[next]) continue;
      if (!passable(world, blocked, nx, nz)) continue;
      seen[next] = 1;
      previous[next] = current;
      if (goalSet.has(next)) return trace(previous, start, next);
      queue.push(next);
    }
  }
  return [];
}

function trace(previous: Int32Array, start: number, end: number): Point[] {
  const path: Point[] = [];
  let cursor = end;
  while (cursor !== -1) {
    path.push({ x: cursor % RULES.width, z: Math.floor(cursor / RULES.width) });
    if (cursor === start) break;
    cursor = previous[cursor];
  }
  return path.reverse();
}

/**
 * Where a worker can stand to work on a footprint: walkable tiles that touch it AND
 * connect to the space outside it. A ring-shaped building has an enclosed courtyard;
 * without this filter a worker could be handed a standing spot it can never reach.
 *
 * Every other building's standing blocks count as wall here too. A neighbour can both
 * occupy a touching tile outright and close off a pocket that this footprint alone
 * would leave open, and either one yields a standing spot nobody can ever occupy.
 */
export function accessCells(world: World, cells: Point[]): Point[] {
  const blocked = blockedCells(world);
  const touching = touchingCells(world, cells, blocked);
  if (touching.length === 0) return [];
  const wall = new Set(cells.map((cell) => `${cell.x},${cell.z}`));
  const xs = cells.map((cell) => cell.x);
  const zs = cells.map((cell) => cell.z);
  const minX = Math.min(...xs) - 1;
  const maxX = Math.max(...xs) + 1;
  const minZ = Math.min(...zs) - 1;
  const maxZ = Math.max(...zs) + 1;

  const key = (x: number, z: number) => `${x},${z}`;
  const open = (x: number, z: number) =>
    x >= minX &&
    x <= maxX &&
    z >= minZ &&
    z <= maxZ &&
    !wall.has(key(x, z)) &&
    inBounds(x, z) &&
    !blocked[idx(x, z)];

  const queue: Point[] = [];
  const seen = new Set<string>();
  for (let x = minX; x <= maxX; x += 1) {
    for (const z of [minZ, maxZ]) {
      if (open(x, z) && !seen.has(key(x, z))) {
        seen.add(key(x, z));
        queue.push({ x, z });
      }
    }
  }
  for (let z = minZ; z <= maxZ; z += 1) {
    for (const x of [minX, maxX]) {
      if (open(x, z) && !seen.has(key(x, z))) {
        seen.add(key(x, z));
        queue.push({ x, z });
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const cell = queue[head++];
    for (const [dx, dz] of STEPS) {
      const x = cell.x + dx;
      const z = cell.z + dz;
      if (!open(x, z) || seen.has(key(x, z))) continue;
      seen.add(key(x, z));
      queue.push({ x, z });
    }
  }
  return touching.filter((cell) => seen.has(key(cell.x, cell.z)));
}

/** The standable tiles orthogonally touching a footprint: walkable terrain, no other building on them. */
export function touchingCells(world: World, cells: Point[], blocked = blockedCells(world)): Point[] {
  const own = new Set(cells.map((cell) => `${cell.x},${cell.z}`));
  const result = new Map<string, Point>();
  for (const cell of cells) {
    for (const [dx, dz] of STEPS) {
      const x = cell.x + dx;
      const z = cell.z + dz;
      const key = `${x},${z}`;
      if (own.has(key) || !inBounds(x, z)) continue;
      if (!walkableTerrain(world.tiles[idx(x, z)])) continue;
      if (blocked[idx(x, z)]) continue;
      result.set(key, { x, z });
    }
  }
  return [...result.values()];
}
