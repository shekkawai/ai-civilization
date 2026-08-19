import { describe, expect, test } from "bun:test";
import { RULES } from "../src/sim/config";
import { idx } from "../src/sim/map";
import type { CivId, Frame, Tile } from "../src/sim/types";
import { expectedRoute, onwardRoute, routeTurns } from "../src/v3/route";
import { isStalled } from "../src/v3/worker";

/**
 * The drawn route is the only thing on the page computed from terrain rather than read from the
 * ledger, which makes it the only thing on the page that can leak the map.
 *
 * A civilization lens must search the world that civilization has *seen*. If it searched real
 * terrain, a route that bends around an unseen lake would draw the lake — the reader would learn
 * something the observer does not know, on the one surface whose entire purpose is the difference
 * between those two things.
 */

function openMap(): Tile[] {
  return Array.from({ length: RULES.width * RULES.height }, () => ({ terrain: "grass" }) as Tile);
}

function frameWith(tiles: Tile[], fogNorth: Uint8Array, worker: Frame["workers"][number]): Frame {
  return {
    turn: 10,
    civs: {} as Frame["civs"],
    workers: [worker],
    buildings: [],
    piles: [],
    nodes: [],
    observedNodes: { north: [], south: [] },
    observedBlocks: { north: [], south: [] },
    observedBuildings: { north: [], south: [] },
    observedPiles: { north: [], south: [] },
    fog: { north: fogNorth, south: new Uint8Array(RULES.width * RULES.height) },
    lastSeen: {
      north: new Int32Array(RULES.width * RULES.height),
      south: new Int32Array(RULES.width * RULES.height),
    },
    events: [],
    journal: { north: "", south: "" },
  } as unknown as Frame;
}

const walker = (owner: CivId = "north"): Frame["workers"][number] =>
  ({
    id: "north-w1",
    owner,
    x: 10,
    z: 10,
    job: { kind: "move", to: { x: 10, z: 20 } },
    carrying: { food: 0, stone: 0 },
    destination: { x: 10, z: 20, label: "" },
  }) as unknown as Frame["workers"][number];

describe("expected route", () => {
  test("truth walks around water that a civilization has never seen", () => {
    const tiles = openMap();
    for (let x = 6; x <= 14; x += 1) tiles[idx(x, 15)] = { terrain: "water" } as Tile;
    const fog = new Uint8Array(RULES.width * RULES.height); // nothing seen
    const frame = frameWith(tiles, fog, walker());

    const truth = expectedRoute(tiles, frame, frame.workers[0], "truth");
    const belief = expectedRoute(tiles, frame, frame.workers[0], "north");

    // Truth has to detour past the barrier; the straight walk is 10 steps.
    expect(truth.length - 1).toBeGreaterThan(10);
    expect(truth.some((step) => step.x < 6 || step.x > 14)).toBe(true);

    // Belief knows nothing of it and walks straight down the column, so the drawn line cannot
    // betray a single tile of the barrier.
    expect(belief.length - 1).toBe(10);
    expect(belief.every((step) => step.x === 10)).toBe(true);
  });

  test("a civilization that has seen the barrier routes around it", () => {
    const tiles = openMap();
    for (let x = 6; x <= 14; x += 1) tiles[idx(x, 15)] = { terrain: "water" } as Tile;
    const fog = new Uint8Array(RULES.width * RULES.height);
    for (let x = 0; x < RULES.width; x += 1) for (let z = 0; z < RULES.height; z += 1) fog[idx(x, z)] = 1;
    const frame = frameWith(tiles, fog, walker());

    const belief = expectedRoute(tiles, frame, frame.workers[0], "north");
    expect(belief.length - 1).toBeGreaterThan(10);
    expect(belief.some((step) => step.x < 6 || step.x > 14)).toBe(true);
  });

  test("turns are counted along the path, not as the crow flies", () => {
    const tiles = openMap();
    const fog = new Uint8Array(RULES.width * RULES.height).fill(2);
    const frame = frameWith(tiles, fog, walker());
    const route = expectedRoute(tiles, frame, frame.workers[0], "north");
    expect(routeTurns(route)).toBe(Math.ceil(10 / RULES.workerMove));
  });

  test("a route to a solid destination ends beside it, never on it", () => {
    const tiles = openMap();
    const fog = new Uint8Array(RULES.width * RULES.height).fill(2);
    const frame = frameWith(tiles, fog, walker());
    // Every build, deposit and remove job points at a structure origin, which is a standing block.
    // Searching for the block itself returns nothing, and the panel would read "unreachable" for
    // the most common job on the map.
    frame.buildings = [
      {
        id: "north-b1",
        owner: "north",
        cells: [{ x: 10, z: 20 }],
        blocks: [1],
      },
    ] as unknown as Frame["buildings"];

    const route = expectedRoute(tiles, frame, frame.workers[0], "truth");
    expect(route.length).toBeGreaterThan(0);
    const last = route[route.length - 1];
    expect(last.x === 10 && last.z === 20).toBe(false);
    expect(Math.abs(last.x - 10) + Math.abs(last.z - 20)).toBe(1);
  });
});

function storeAt(
  id: string,
  x: number,
  z: number,
  capacity: number,
  used: number,
): Frame["buildings"][number] {
  return {
    id,
    owner: "north",
    fn: "store",
    designId: "plan-1",
    name: id,
    cells: [{ x, z }],
    blocks: [1],
    placed: 1,
    total: 1,
    removed: 0,
    stock: { food: used, stone: 0 },
    storageCapacity: capacity,
    complete: true,
  } as unknown as Frame["buildings"][number];
}

const gatherer = (at: { x: number; z: number }, to: { x: number; z: number }) =>
  ({
    id: "north-w1",
    owner: "north",
    x: at.x,
    z: at.z,
    job: { kind: "gather", at: to },
    carrying: { food: 0, stone: 0 },
    destination: { ...to, label: "" },
  }) as unknown as Frame["workers"][number];

describe("the return leg", () => {
  test("a gatherer's onward leg ends at a store that has room, not the nearest one", () => {
    const tiles = openMap();
    const fog = new Uint8Array(RULES.width * RULES.height).fill(2);
    const frame = frameWith(tiles, fog, gatherer({ x: 10, z: 10 }, { x: 10, z: 20 }));
    // A full store four tiles away and an open one six further on. The engine skips the full one,
    // so a drawn leg that stops at it would be a picture of a delivery that cannot happen.
    frame.buildings = [storeAt("north-b1", 14, 20, 10, 10), storeAt("north-b2", 10, 26, 100, 0)];

    const route = expectedRoute(tiles, frame, frame.workers[0], "truth");
    const onward = onwardRoute(tiles, frame, frame.workers[0], "truth", route[route.length - 1]);
    const end = onward[onward.length - 1];
    expect(onward.length).toBeGreaterThan(1);
    expect(Math.abs(end.x - 10) + Math.abs(end.z - 26)).toBe(1);
  });

  test("a partial near store does not shadow a farther store that fits the whole load", () => {
    const tiles = openMap();
    const fog = new Uint8Array(RULES.width * RULES.height).fill(2);
    const worker = gatherer({ x: 10, z: 10 }, { x: 10, z: 20 });
    worker.carrying = { food: RULES.carry, stone: 0 };
    const frame = frameWith(tiles, fog, worker);
    frame.buildings = [storeAt("north-b1", 14, 20, 10, 5), storeAt("north-b2", 10, 26, 100, 0)];

    const route = expectedRoute(tiles, frame, worker, "truth");
    const onward = onwardRoute(tiles, frame, worker, "truth", route[route.length - 1]);
    const end = onward[onward.length - 1];
    expect(Math.abs(end.x - 10) + Math.abs(end.z - 26)).toBe(1);
  });

  test("the onward leg obeys the lens, so it cannot leak unseen ground either", () => {
    const tiles = openMap();
    for (let x = 6; x <= 14; x += 1) tiles[idx(x, 15)] = { terrain: "water" } as Tile;
    const fog = new Uint8Array(RULES.width * RULES.height); // north has seen nothing
    const frame = frameWith(tiles, fog, gatherer({ x: 10, z: 10 }, { x: 10, z: 12 }));
    frame.buildings = [storeAt("north-b1", 10, 20, 100, 0)];

    const start = { x: 10, z: 12 };
    const truth = onwardRoute(tiles, frame, frame.workers[0], "truth", start);
    const belief = onwardRoute(tiles, frame, frame.workers[0], "north", start);

    expect(truth.some((step) => step.x < 6 || step.x > 14)).toBe(true);
    expect(belief.every((step) => step.x === 10)).toBe(true);
  });

  test("a builder already at its site is drawn no onward leg", () => {
    const tiles = openMap();
    const fog = new Uint8Array(RULES.width * RULES.height).fill(2);
    const worker = {
      id: "north-w1",
      owner: "north",
      x: 10,
      z: 19,
      job: { kind: "build", buildingId: "north-b1" },
      carrying: { food: 0, stone: 3 },
      destination: { x: 10, z: 20, label: "" },
    } as unknown as Frame["workers"][number];
    const frame = frameWith(tiles, fog, worker);
    frame.buildings = [storeAt("north-b1", 10, 20, 100, 0), storeAt("north-b2", 10, 30, 100, 0)];

    // Whether they need a second load of stone is not knowable from the frame, so nothing is drawn.
    // A predicted leg that does not happen is worse than no leg at all.
    expect(onwardRoute(tiles, frame, worker, "truth", { x: 10, z: 19 })).toEqual([]);
  });
});

describe("a person who will produce nothing this turn", () => {
  test("idle counts, and so does an order the engine can route nowhere", () => {
    const idle = { job: { kind: "idle" }, destination: undefined } as unknown as Frame["workers"][number];
    const stranded = {
      job: { kind: "deposit" },
      destination: undefined,
    } as unknown as Frame["workers"][number];
    const working = {
      job: { kind: "gather", at: { x: 1, z: 1 } },
      destination: { x: 1, z: 1, label: "" },
    } as unknown as Frame["workers"][number];

    expect(isStalled(idle)).toBe(true);
    expect(isStalled(stranded)).toBe(true);
    expect(isStalled(working)).toBe(false);
  });
});
