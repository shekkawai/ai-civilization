import { RULES } from "../sim/config";
import { idx, walkableTerrain } from "../sim/map";
import { findPath } from "../sim/path";
import type { CivId, Frame, Point, Tile, World } from "../sim/types";

/**
 * Where a worker is expected to walk, tile by tile.
 *
 * This is the engine's own breadth-first search, not a re-implementation — `findPath` reads
 * nothing from a `World` except `tiles`, so a minimal object carries it. Duplicating the search
 * here would let the drawn route drift away from the route the engine actually walks.
 *
 * The lens rule decides which world the search runs on, and it is not a detail:
 *
 * - **Truth** searches real terrain and every standing block. That is where the worker will
 *   really go.
 * - **A civilization lens** searches what that civilization has *seen* — remembered blocks, and
 *   never-seen ground treated as open. That is the route they expect to walk, and it is the only
 *   version that can be drawn without leaking the map. A route computed on real terrain would
 *   bend around a lake nobody has looked at, and the bend alone reveals the lake.
 *
 * So the two lenses can disagree about the same worker, and when they do, that gap is the page's
 * whole thesis in one line on the map.
 */
export function expectedRoute(
  tiles: Tile[],
  frame: Frame,
  worker: Frame["workers"][number],
  lens: CivId | "truth",
): Point[] {
  const destination = worker.destination;
  if (!destination) return [];
  const believed = believedWorld(tiles, frame, lens);
  return routeTo(believed, { x: worker.x, z: worker.z }, destination);
}

/**
 * The leg *after* the one being walked — the return half of the round trip.
 *
 * The map used to draw one line to one destination, which is only half of what a worker is doing.
 * Nothing in this world counts until it is physically inside a store, so a gatherer's job is not
 * "walk to the field", it is "walk to the field and carry it back", and the second half is where
 * the cost lives: at five tiles a worker spends about three turns in eight walking, at thirty
 * tiles more than three quarters. Drawing only the outbound leg hides exactly the number that
 * decides whether a distant source is worth working.
 *
 * Only the legs the engine will certainly walk are returned. A gatherer heading out returns to a
 * store and a gatherer heading back returns to its source; a remover hauls to a store and comes
 * back; a builder fetching stone carries it to the site. A builder already at its site may need
 * another load or may not, so nothing is drawn — a predicted leg that does not happen is worse
 * than no leg at all.
 */
export function onwardRoute(
  tiles: Tile[],
  frame: Frame,
  worker: Frame["workers"][number],
  lens: CivId | "truth",
  from: Point,
): Point[] {
  const believed = believedWorld(tiles, frame, lens);
  return onwardLeg(believed, frame, worker, from);
}

interface Believed {
  world: World;
  tiles: Tile[];
  blocked: Uint8Array;
}

function believedWorld(tiles: Tile[], frame: Frame, lens: CivId | "truth"): Believed {
  const believed: Tile[] =
    lens === "truth"
      ? tiles
      : tiles.map((tile, index) =>
          frame.fog[lens]?.[index] ? tile : ({ ...tile, terrain: "grass", node: undefined } as Tile),
        );

  const blocked = new Uint8Array(RULES.width * RULES.height);
  if (lens === "truth") {
    for (const building of frame.buildings) {
      building.cells.forEach((cell, index) => {
        if (building.blocks[index]) blocked[idx(cell.x, cell.z)] = 1;
      });
    }
  } else {
    for (const block of frame.observedBlocks[lens]) blocked[idx(block.x, block.z)] = 1;
  }

  return { world: { tiles: believed } as unknown as World, tiles: believed, blocked };
}

function routeTo(believed: Believed, from: Point, destination: Point): Point[] {
  // A worker walks *beside* its target, never onto it. When the destination tile itself is a
  // standing block the goal set becomes its walkable neighbours, or the route would read as
  // unreachable for every build, deposit and remove job on the map.
  const goals: Point[] = believed.blocked[idx(destination.x, destination.z)]
    ? neighbours(destination).filter(
        (point) =>
          !believed.blocked[idx(point.x, point.z)] && walkableTerrain(believed.tiles[idx(point.x, point.z)]),
      )
    : [destination];
  if (goals.length === 0) return [];
  return findPath(believed.world, believed.blocked, from, goals);
}

function sameCell(one: Point, other: Point) {
  return one.x === other.x && one.z === other.z;
}

function onwardLeg(
  believed: Believed,
  frame: Frame,
  worker: Frame["workers"][number],
  from: Point,
): Point[] {
  const destination = worker.destination;
  if (!destination) return [];
  const job = worker.job;

  if (job.kind === "gather") {
    return sameCell(destination, job.at)
      ? routeToStore(believed, frame, worker, from)
      : routeTo(believed, from, job.at);
  }

  if (job.kind === "remove" || job.kind === "build" || job.kind === "repair") {
    const site = frame.buildings.find((building) => building.id === job.buildingId)?.cells[0];
    if (!site) return [];
    if (!sameCell(destination, site)) return routeTo(believed, from, site);
    return job.kind === "remove" ? routeToStore(believed, frame, worker, from) : [];
  }

  return [];
}

/**
 * The walk to the store this worker would deliver to, chosen the way the engine chooses it: own,
 * finished, standing, with room, and nearest **by path**. Picking by straight line would draw a
 * return leg to a store on the far side of a ridge from the one actually walked to.
 */
function routeToStore(
  believed: Believed,
  frame: Frame,
  worker: Frame["workers"][number],
  from: Point,
): Point[] {
  const load = worker.carrying.food + worker.carrying.stone;
  const reachable = frame.buildings
    .filter(
      (building) =>
        building.owner === worker.owner &&
        building.complete &&
        (building.fn === "hall" || building.fn === "store") &&
        building.blocks.some((block) => block > 0) &&
        (building.storageCapacity ?? 0) - (building.stock.food + building.stock.stone) > 0,
    )
    .map((building) => ({
      building,
      route: building.cells[0] ? routeTo(believed, from, building.cells[0]) : [],
    }))
    .filter((candidate) => candidate.route.length > 0);
  const roomy = reachable.filter(
    ({ building }) =>
      (building.storageCapacity ?? 0) - (building.stock.food + building.stock.stone) >= load,
  );
  return (roomy.length > 0 ? roomy : reachable).sort(
    (left, right) => left.route.length - right.route.length || left.building.id.localeCompare(right.building.id),
  )[0]?.route ?? [];
}

function neighbours(point: Point): Point[] {
  return [
    { x: point.x + 1, z: point.z },
    { x: point.x - 1, z: point.z },
    { x: point.x, z: point.z + 1 },
    { x: point.x, z: point.z - 1 },
  ].filter((entry) => entry.x >= 0 && entry.z >= 0 && entry.x < RULES.width && entry.z < RULES.height);
}

/** Turns the walk will take at the fixed move rate, counting steps rather than straight-line distance. */
export function routeTurns(route: Point[]) {
  return Math.ceil(Math.max(0, route.length - 1) / RULES.workerMove);
}
