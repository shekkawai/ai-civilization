import { describe, expect, test } from "bun:test";
import { createWorld, prepareTurn } from "../src/sim/engine";
import { PROTOCOL16_WORKER_SIGHT, RULES, SIGHT, WORKER_SIGHT, workerSight } from "../src/sim/config";
import {
  CORRIDOR_FOOD_MARKERS,
  CENTRE_STONE_TOTAL,
  CORRIDOR_HOME_FIELDS,
  CORRIDOR_MARKER_STONE,
  CORRIDOR_STONE_MARKERS,
  GRADIENT_BELT_FROM_Z,
  GRADIENT_HOME_FIELDS,
  GRADIENT_STEPPING_FIELDS,
  HOME_QUARRY,
  HOME_QUARRY_TOTAL,
  OASIS_HOME_FOOD,
  OASIS_INNER_MARKER_FOOD,
  OASIS_RENEWABLE_FOOD,
  OASIS_RENEWABLE_REGEN,
  SHARED_OASIS_FOOD,
  SHARED_OASIS_FOOD_AMOUNT,
  SHARED_OASIS_FOOD_REGEN,
  SHARED_OASIS_ROUTE_FOOD,
  SPAWN,
  VISIBLE_OASIS_FOOD_MARKERS,
  VISIBLE_OASIS_HOME_FOOD,
  VISIBLE_OASIS_ROUTE_FOOD,
  UNIQUE_OASIS_CAP,
  UNIQUE_OASIS_CELLS,
  UNIQUE_OASIS_REGEN,
  V34_OASIS_CAP,
  V34_OASIS_REGEN,
  V28_FOOD_AMOUNTS,
  V28_FOOD_MARKERS,
  V28_HALL_ORIGIN,
  V28_OASIS_CAP,
  V28_OASIS_REGEN,
  V28_ROUTE_QUARRY,
  V28_ROUTE_STONE,
  V28_SHARED_STONE_CAP,
  V28_SHARED_STONE_CELLS,
  idx,
  mapVariant,
} from "../src/sim/map";
import { worldHash } from "../src/research/codec";

/**
 * Every archived season regenerates its world from `map_seed` alone
 * (`verifyReplay`, turn-stats backfill). A layout change must therefore be a
 * new registered seed, never an edit to what an existing seed produces. These
 * hashes were captured before the gradient variant landed; if either changes,
 * replay verification of every pre-gradient season silently breaks.
 */
describe("map variants", () => {
  test("classic seeds produce byte-identical worlds after the gradient variant landed", () => {
    expect(mapVariant(20260802)).toBe("classic");
    // Rebaselined deliberately for protocol 13 (v26). Classic terrain and resource placement
    // remain untouched — `corridor-visible-oasis` is a new registered seed. The hash moved because
    // a new world records protocol 13 and the current global building/storage rules. Verify
    // archived seasons at their season tags instead of current HEAD.
    // Treat any *further* movement in these hashes as a bug.
    expect(worldHash(createWorld(20260802))).toBe(
      "dae18498fa2af230514c29772e11564d254e08748d603a768b3fa03298893c61",
    );
    expect(worldHash(createWorld(1))).toBe(
      "66f15cb9b35d2302f6a3363b694992fb5849fd9d3c7897382d177797798a96ee",
    );
  });

  test("gradient map is 180°-symmetric", () => {
    const world = createWorld(20260805);
    const { width, height } = RULES;
    for (let z = 0; z < height; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const here = world.tiles[idx(x, z)];
        const mirror = world.tiles[idx(width - 1 - x, height - 1 - z)];
        expect(mirror.terrain).toBe(here.terrain);
        expect(mirror.node?.kind ?? "none").toBe(here.node?.kind ?? "none");
        expect(mirror.node?.amount ?? -1).toBe(here.node?.amount ?? -1);
      }
    }
  });

  test("gradient starves the home ring and concentrates farmland in the central band", () => {
    const world = createWorld(20260805);
    const { width, height } = RULES;
    const fields = (filter: (x: number, z: number) => boolean) => {
      let count = 0;
      for (let z = 0; z < height; z += 1) {
        for (let x = 0; x < width; x += 1) {
          if (world.tiles[idx(x, z)].node?.kind === "food" && filter(x, z)) count += 1;
        }
      }
      return count;
    };
    const nearNorth = (x: number, z: number) => Math.hypot(x - SPAWN.north.x, z - SPAWN.north.z) <= 15;
    const nearSouth = (x: number, z: number) => Math.hypot(x - SPAWN.south.x, z - SPAWN.south.z) <= 15;
    const centralBand = (_x: number, z: number) => Math.abs(z - height / 2) <= height / 2 - GRADIENT_BELT_FROM_Z + 1;

    // 6 fields × 3 regen = 18 food/turn long-run — below the upkeep of a grown
    // settlement, so staying home stops being an equilibrium. The classic map
    // held ~95 fields here, which sustained ~285 people and froze season v13.
    expect(fields(nearNorth)).toBe(GRADIENT_HOME_FIELDS.length);
    expect(fields(nearSouth)).toBeGreaterThanOrEqual(GRADIENT_HOME_FIELDS.length - 1);
    expect(fields(nearSouth)).toBeLessThanOrEqual(GRADIENT_HOME_FIELDS.length + 1);
    expect(fields(centralBand)).toBeGreaterThanOrEqual(80);

    for (const point of [...GRADIENT_HOME_FIELDS, ...GRADIENT_STEPPING_FIELDS]) {
      expect(world.tiles[idx(point.x, point.z)].node?.kind).toBe("food");
    }
  });

  test("gradient keeps the stone layout: a small home quarry and the large central quarries", () => {
    const world = createWorld(20260805);
    const { width, height } = RULES;
    let homeStone = 0;
    let centreStone = 0;
    for (let z = 0; z < height; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const tile = world.tiles[idx(x, z)];
        if (tile.node?.kind !== "stone") continue;
        if (Math.hypot(x - SPAWN.north.x, z - SPAWN.north.z) < 26) homeStone += tile.node.amount;
        if (Math.abs(z - height / 2) <= 14) centreStone += tile.node.amount;
      }
    }
    // Per-tile amounts are rounded (150 ÷ tile-count), so the total can sit a
    // few units under the configured quarry size — same behaviour as classic.
    expect(homeStone).toBeGreaterThanOrEqual(RULES.homeQuarry - 10);
    expect(homeStone).toBeLessThanOrEqual(RULES.homeQuarry + 10);
    expect(centreStone).toBeGreaterThanOrEqual(2000);
  });

  test("scarce keeps gradient's layout and only shrinks the home quarry", () => {
    const gradient = createWorld(20260805);
    const scarce = createWorld(20260806);
    expect(mapVariant(20260806)).toBe("scarce");

    const { width, height } = RULES;
    let homeStone = 0;
    let centreStone = 0;
    let beltFields = 0;
    for (let z = 0; z < height; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const tile = scarce.tiles[idx(x, z)];
        // 180° symmetry is the property the whole comparison rests on.
        const mirror = scarce.tiles[idx(width - 1 - x, height - 1 - z)];
        expect(mirror.terrain).toBe(tile.terrain);
        expect(mirror.node?.amount ?? -1).toBe(tile.node?.amount ?? -1);
        if (tile.node?.kind === "food" && Math.abs(z - height / 2) <= height / 2 - GRADIENT_BELT_FROM_Z + 1) {
          beltFields += 1;
        }
        if (tile.node?.kind !== "stone") continue;
        if (Math.hypot(x - SPAWN.north.x, z - SPAWN.north.z) < 26) homeStone += tile.node.amount;
        if (Math.abs(z - height / 2) <= 14) centreStone += tile.node.amount;
      }
    }

    // The home ring is placed from fixed constants, not the RNG, so it is identical to gradient's
    // and the food ceiling that v15 measured carries over unchanged to v16.
    for (const point of GRADIENT_HOME_FIELDS) {
      expect(scarce.tiles[idx(point.x, point.z)].node?.amount ?? -1).toBe(
        gradient.tiles[idx(point.x, point.z)].node?.amount ?? -2,
      );
    }
    expect(beltFields).toBeGreaterThanOrEqual(80);
    expect(centreStone).toBeGreaterThanOrEqual(2000);

    // v15 measured that 150 home stone buys ~16 worker places while the home ring's 18 food/turn
    // sustains ~18 people, so neither ceiling ever bit first. 60 makes stone the binding one.
    expect(homeStone).toBeGreaterThanOrEqual(HOME_QUARRY_TOTAL.scarce - 10);
    expect(homeStone).toBeLessThanOrEqual(HOME_QUARRY_TOTAL.scarce + 10);
    expect(homeStone).toBeLessThan(RULES.homeQuarry - 40);
  });

  test("corridor replaces random lateral search with a symmetric visible resource chain", () => {
    const world = createWorld(20260807);
    expect(mapVariant(20260807)).toBe("corridor");

    const { width, height } = RULES;
    let northHomeFields = 0;
    let southHomeFields = 0;
    let centralFields = 0;
    let northHomeStone = 0;
    for (let z = 0; z < height; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const tile = world.tiles[idx(x, z)];
        const mirror = world.tiles[idx(width - 1 - x, height - 1 - z)];
        expect(mirror.terrain).toBe(tile.terrain);
        expect(mirror.node?.kind ?? "none").toBe(tile.node?.kind ?? "none");
        expect(mirror.node?.amount ?? -1).toBe(tile.node?.amount ?? -1);
        if (tile.node?.kind === "food") {
          if (Math.hypot(x - 47.5, z - 11.5) <= RULES.buildRadius) northHomeFields += 1;
          if (Math.hypot(x - 47.5, z - 83.5) <= RULES.buildRadius) southHomeFields += 1;
          if (Math.abs(z - height / 2) <= 14) centralFields += 1;
        }
        if (
          tile.node?.kind === "stone" &&
          Math.abs(x - HOME_QUARRY.north.x) <= 4 &&
          Math.abs(z - HOME_QUARRY.north.z) <= 4
        ) {
          northHomeStone += tile.node.amount;
        }
      }
    }

    expect(northHomeFields).toBe(CORRIDOR_HOME_FIELDS.length);
    expect(southHomeFields).toBe(CORRIDOR_HOME_FIELDS.length);
    expect(centralFields).toBeGreaterThanOrEqual(50);
    expect(northHomeStone).toBeGreaterThanOrEqual(HOME_QUARRY_TOTAL.corridor - 10);
    expect(northHomeStone).toBeLessThanOrEqual(HOME_QUARRY_TOTAL.corridor + 10);

    for (const z of [33, 34]) {
      for (let x = 0; x < width; x += 1) {
        if (x >= 43 && x <= 52) expect(world.tiles[idx(x, z)].terrain).not.toBe("ridge");
        else expect(world.tiles[idx(x, z)].terrain).toBe("ridge");
      }
    }

    for (const point of CORRIDOR_FOOD_MARKERS) {
      expect(world.tiles[idx(point.x, point.z)].node?.kind).toBe("food");
    }
    for (const point of CORRIDOR_STONE_MARKERS) {
      expect(world.tiles[idx(point.x, point.z)].node).toEqual({
        kind: "stone",
        amount: CORRIDOR_MARKER_STONE,
        cap: CORRIDOR_MARKER_STONE,
        regen: 0,
      });
    }

    const homeQuarryCells: Array<{ x: number; z: number }> = [];
    for (let z = HOME_QUARRY.north.z - 4; z <= HOME_QUARRY.north.z + 4; z += 1) {
      for (let x = HOME_QUARRY.north.x - 4; x <= HOME_QUARRY.north.x + 4; x += 1) {
        if (world.tiles[idx(x, z)].node?.kind === "stone") homeQuarryCells.push({ x, z });
      }
    }
    const links = [homeQuarryCells, ...CORRIDOR_STONE_MARKERS.slice(0, -1).map((point) => [point])];
    for (let i = 0; i < CORRIDOR_STONE_MARKERS.length; i += 1) {
      const next = CORRIDOR_STONE_MARKERS[i];
      const gap = Math.min(...links[i].map((point) => Math.hypot(point.x - next.x, point.z - next.z)));
      expect(gap).toBeLessThanOrEqual(WORKER_SIGHT);
    }
  });

  test("corridor-tight keeps the corridor geometry but lowers home-field regen", () => {
    const corridor = createWorld(20260807);
    const tight = createWorld(20260808);
    expect(mapVariant(20260808)).toBe("corridor-tight");

    const { width, height } = RULES;
    let northHomeFields = 0;
    let northHomeStone = 0;
    for (let z = 0; z < height; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const tile = tight.tiles[idx(x, z)];
        const mirror = tight.tiles[idx(width - 1 - x, height - 1 - z)];
        expect(mirror.terrain).toBe(tile.terrain);
        expect(mirror.node?.kind ?? "none").toBe(tile.node?.kind ?? "none");
        expect(mirror.node?.amount ?? -1).toBe(tile.node?.amount ?? -1);
        expect(mirror.node?.regen ?? -1).toBe(tile.node?.regen ?? -1);
        if (tile.node?.kind === "food" && Math.hypot(x - 47.5, z - 11.5) <= RULES.buildRadius) {
          northHomeFields += 1;
          expect(tile.node.regen).toBe(2);
        }
        if (
          tile.node?.kind === "stone" &&
          Math.abs(x - HOME_QUARRY.north.x) <= 4 &&
          Math.abs(z - HOME_QUARRY.north.z) <= 4
        ) {
          northHomeStone += tile.node.amount;
        }
      }
    }

    expect(northHomeFields).toBe(CORRIDOR_HOME_FIELDS.length);
    expect(northHomeStone).toBeGreaterThanOrEqual(HOME_QUARRY_TOTAL["corridor-tight"] - 10);
    expect(northHomeStone).toBeLessThanOrEqual(HOME_QUARRY_TOTAL["corridor-tight"] + 10);

    for (const point of CORRIDOR_FOOD_MARKERS) {
      // corridor markers sit outside the home radius and keep the ordinary regen
      expect(tight.tiles[idx(point.x, point.z)].node).toEqual({
        kind: "food",
        amount: 120,
        cap: 120,
        regen: 3,
      });
    }
    for (const point of CORRIDOR_HOME_FIELDS) {
      expect(tight.tiles[idx(point.x, point.z)].node?.regen).toBe(2);
      expect(corridor.tiles[idx(point.x, point.z)].node?.regen).toBe(3);
    }
  });

  test("corridor-oasis makes every ridge-interior food source finite and central income scarce", () => {
    const world = createWorld(20260810);
    expect(mapVariant(20260810)).toBe("corridor-oasis");

    let foodNodes = 0;
    let renewableNodes = 0;
    let totalRegen = 0;
    for (let z = 0; z < world.height; z += 1) {
      for (let x = 0; x < world.width; x += 1) {
        const tile = world.tiles[idx(x, z)];
        const mirror = world.tiles[idx(world.width - 1 - x, world.height - 1 - z)];
        expect(mirror.terrain).toBe(tile.terrain);
        expect(mirror.node?.kind ?? "none").toBe(tile.node?.kind ?? "none");
        expect(mirror.node?.amount ?? -1).toBe(tile.node?.amount ?? -1);
        expect(mirror.node?.regen ?? -1).toBe(tile.node?.regen ?? -1);
        if (tile.node?.kind !== "food") continue;
        foodNodes += 1;
        totalRegen += tile.node.regen;
        if (tile.node.regen > 0) renewableNodes += 1;
        if (z <= 34 || z >= 61) expect(tile.node.regen).toBe(0);
      }
    }

    expect(foodNodes).toBe(CORRIDOR_HOME_FIELDS.length * 2 + CORRIDOR_FOOD_MARKERS.length * 2);
    expect(renewableNodes).toBe(4);
    expect(totalRegen).toBe(16);

    for (const point of CORRIDOR_HOME_FIELDS) {
      expect(world.tiles[idx(point.x, point.z)].node).toEqual({
        kind: "food",
        amount: OASIS_HOME_FOOD,
        cap: OASIS_HOME_FOOD,
        regen: 0,
      });
    }
    CORRIDOR_FOOD_MARKERS.forEach((point, index) => {
      const finite = index < 2;
      expect(world.tiles[idx(point.x, point.z)].node).toEqual({
        kind: "food",
        amount: finite ? OASIS_INNER_MARKER_FOOD : OASIS_RENEWABLE_FOOD,
        cap: finite ? OASIS_INNER_MARKER_FOOD : OASIS_RENEWABLE_FOOD,
        regen: finite ? 0 : OASIS_RENEWABLE_REGEN,
      });
    });
    expect(
      CORRIDOR_HOME_FIELDS.reduce(
        (sum, point) => sum + (world.tiles[idx(point.x, point.z)].node?.amount ?? 0),
        0,
      ) +
        CORRIDOR_FOOD_MARKERS.slice(0, 2).reduce(
          (sum, point) => sum + (world.tiles[idx(point.x, point.z)].node?.amount ?? 0),
          0,
        ),
    ).toBe(330);
  });

  test("corridor-shared-oasis puts all renewable food inside one mutually visible cluster", () => {
    const world = createWorld(20260811);
    expect(mapVariant(20260811)).toBe("corridor-shared-oasis");

    const renewable: Array<{ x: number; z: number }> = [];
    let foodNodes = 0;
    let totalRegen = 0;
    for (let z = 0; z < world.height; z += 1) {
      for (let x = 0; x < world.width; x += 1) {
        const tile = world.tiles[idx(x, z)];
        const mirror = world.tiles[idx(world.width - 1 - x, world.height - 1 - z)];
        expect(mirror.terrain).toBe(tile.terrain);
        expect(mirror.node?.kind ?? "none").toBe(tile.node?.kind ?? "none");
        expect(mirror.node?.amount ?? -1).toBe(tile.node?.amount ?? -1);
        expect(mirror.node?.regen ?? -1).toBe(tile.node?.regen ?? -1);
        if (tile.node?.kind !== "food") continue;
        foodNodes += 1;
        totalRegen += tile.node.regen;
        if (tile.node.regen > 0) renewable.push({ x, z });
      }
    }

    expect(foodNodes).toBe(
      CORRIDOR_HOME_FIELDS.length * 2 +
        CORRIDOR_FOOD_MARKERS.length * 2 +
        SHARED_OASIS_FOOD.length * 2,
    );
    expect(renewable).toHaveLength(4);
    expect(totalRegen).toBe(16);
    for (const left of renewable) {
      for (const right of renewable) {
        expect(Math.hypot(left.x - right.x, left.z - right.z)).toBeLessThanOrEqual(WORKER_SIGHT);
      }
      expect(world.tiles[idx(left.x, left.z)].node).toEqual({
        kind: "food",
        amount: SHARED_OASIS_FOOD_AMOUNT,
        cap: SHARED_OASIS_FOOD_AMOUNT,
        regen: SHARED_OASIS_FOOD_REGEN,
      });
    }

    for (const point of [...CORRIDOR_HOME_FIELDS, ...CORRIDOR_FOOD_MARKERS]) {
      const mirror = { x: world.width - 1 - point.x, z: world.height - 1 - point.z };
      expect(world.tiles[idx(point.x, point.z)].node?.regen).toBe(0);
      expect(world.tiles[idx(mirror.x, mirror.z)].node?.regen).toBe(0);
    }
    for (const point of CORRIDOR_FOOD_MARKERS) {
      expect(world.tiles[idx(point.x, point.z)].node?.amount).toBe(SHARED_OASIS_ROUTE_FOOD);
    }
  });

  test("corridor-visible-oasis is a complete observed abundance chain into the shared oasis", () => {
    const world = createWorld(20260812);
    expect(mapVariant(20260812)).toBe("corridor-visible-oasis");

    let foodNodes = 0;
    let totalRegen = 0;
    const renewable: Array<{ x: number; z: number }> = [];
    for (let z = 0; z < world.height; z += 1) {
      for (let x = 0; x < world.width; x += 1) {
        const tile = world.tiles[idx(x, z)];
        const mirror = world.tiles[idx(world.width - 1 - x, world.height - 1 - z)];
        expect(mirror.terrain).toBe(tile.terrain);
        expect(mirror.node?.kind ?? "none").toBe(tile.node?.kind ?? "none");
        expect(mirror.node?.amount ?? -1).toBe(tile.node?.amount ?? -1);
        expect(mirror.node?.regen ?? -1).toBe(tile.node?.regen ?? -1);
        if (tile.node?.kind !== "food") continue;
        foodNodes += 1;
        totalRegen += tile.node.regen;
        if (tile.node.regen > 0) renewable.push({ x, z });
      }
    }
    expect(foodNodes).toBe(
      CORRIDOR_HOME_FIELDS.length * 2 +
        VISIBLE_OASIS_FOOD_MARKERS.length * 2 +
        SHARED_OASIS_FOOD.length * 2,
    );
    expect(renewable).toHaveLength(4);
    expect(totalRegen).toBe(16);

    for (const point of CORRIDOR_HOME_FIELDS) {
      expect(world.tiles[idx(point.x, point.z)].node).toEqual({
        kind: "food",
        amount: VISIBLE_OASIS_HOME_FOOD,
        cap: VISIBLE_OASIS_HOME_FOOD,
        regen: 0,
      });
    }
    VISIBLE_OASIS_FOOD_MARKERS.forEach((point, index) => {
      const amount = VISIBLE_OASIS_ROUTE_FOOD[index];
      expect(world.tiles[idx(point.x, point.z)].node).toEqual({ kind: "food", amount, cap: amount, regen: 0 });
      if (index > 0) {
        const previous = VISIBLE_OASIS_FOOD_MARKERS[index - 1];
        expect(Math.hypot(point.x - previous.x, point.z - previous.z)).toBeLessThanOrEqual(WORKER_SIGHT);
        expect(amount).toBeGreaterThan(VISIBLE_OASIS_ROUTE_FOOD[index - 1]);
      }
    });

    const first = VISIBLE_OASIS_FOOD_MARKERS[0];
    expect(world.civs.north.knowledge[idx(first.x, first.z)]).toBe(2);
    const mirroredFirst = { x: world.width - 1 - first.x, z: world.height - 1 - first.z };
    expect(world.civs.south.knowledge[idx(mirroredFirst.x, mirroredFirst.z)]).toBe(2);
    expect(VISIBLE_OASIS_ROUTE_FOOD[0]).toBeGreaterThan(VISIBLE_OASIS_HOME_FOOD);

    const last = VISIBLE_OASIS_FOOD_MARKERS.at(-1)!;
    expect(
      Math.min(...renewable.map((point) => Math.hypot(point.x - last.x, point.z - last.z))),
    ).toBeLessThanOrEqual(WORKER_SIGHT);
    expect(
      CORRIDOR_HOME_FIELDS.length * VISIBLE_OASIS_HOME_FOOD +
        VISIBLE_OASIS_ROUTE_FOOD.reduce((sum, amount) => sum + amount, 0),
    ).toBe(CORRIDOR_HOME_FIELDS.length * OASIS_HOME_FOOD + CORRIDOR_FOOD_MARKERS.length * SHARED_OASIS_ROUTE_FOOD);
  });

  test("corridor-unique-oasis separates finite Foodland from one shared renewable pool", () => {
    const world = createWorld(20260813);
    expect(mapVariant(20260813)).toBe("corridor-unique-oasis");
    expect(world.protocolVersion).toBe(14);
    expect(world.oasis).toEqual({
      id: "central-oasis",
      cells: UNIQUE_OASIS_CELLS,
      amount: UNIQUE_OASIS_CAP,
      cap: UNIQUE_OASIS_CAP,
      regen: UNIQUE_OASIS_REGEN,
    });

    const ordinaryFood = world.tiles.filter((tile) => tile.terrain === "field" && tile.node?.kind === "food");
    expect(ordinaryFood.length).toBe(CORRIDOR_HOME_FIELDS.length * 2 + VISIBLE_OASIS_FOOD_MARKERS.length * 2);
    expect(ordinaryFood.every((tile) => tile.node?.regen === 0)).toBe(true);

    const oasisTiles = world.tiles.filter((tile) => tile.terrain === "oasis");
    expect(oasisTiles).toHaveLength(4);
    expect(
      oasisTiles.every(
        (tile) =>
          tile.node?.kind === "food" &&
          tile.node.amount === UNIQUE_OASIS_CAP &&
          tile.node.cap === UNIQUE_OASIS_CAP &&
          tile.node.regen === UNIQUE_OASIS_REGEN,
      ),
    ).toBe(true);

    for (let z = 0; z < world.height; z += 1) {
      for (let x = 0; x < world.width; x += 1) {
        const tile = world.tiles[idx(x, z)];
        const mirror = world.tiles[idx(world.width - 1 - x, world.height - 1 - z)];
        expect(mirror.terrain).toBe(tile.terrain);
        expect(mirror.node?.amount ?? -1).toBe(tile.node?.amount ?? -1);
        expect(mirror.node?.regen ?? -1).toBe(tile.node?.regen ?? -1);
      }
    }

    const last = VISIBLE_OASIS_FOOD_MARKERS.at(-1)!;
    expect(Math.min(...UNIQUE_OASIS_CELLS.map((point) => Math.hypot(point.x - last.x, point.z - last.z)))).toBeLessThanOrEqual(
      WORKER_SIGHT,
    );
  });

  test("v28 follows the symmetric keypad 7→4→5→6→3 route without prompt metadata", () => {
    const world = createWorld(20260814);
    expect(mapVariant(20260814)).toBe("numpad-route");
    expect(world.protocolVersion).toBe(15);
    expect(world.buildings["north-hall"].origin).toEqual(V28_HALL_ORIGIN.north);
    expect(world.buildings["south-hall"].origin).toEqual(V28_HALL_ORIGIN.south);

    for (let z = 0; z < world.height; z += 1) {
      for (let x = 0; x < world.width; x += 1) {
        const here = world.tiles[idx(x, z)];
        const there = world.tiles[idx(world.width - 1 - x, world.height - 1 - z)];
        expect(there.terrain).toBe(here.terrain);
        expect(there.node?.kind ?? "none").toBe(here.node?.kind ?? "none");
        expect(there.node?.amount ?? -1).toBe(here.node?.amount ?? -1);
        expect(there.node?.pool ?? "none").toBe(here.node?.pool ?? "none");
      }
    }

    expect(V28_FOOD_AMOUNTS.reduce((sum, amount) => sum + amount, 0)).toBe(95);
    V28_FOOD_MARKERS.forEach((point, index) => {
      expect(world.tiles[idx(point.x, point.z)].node).toMatchObject({
        kind: "food",
        amount: V28_FOOD_AMOUNTS[index],
        cap: V28_FOOD_AMOUNTS[index],
        regen: 0,
      });
      if (index > 0) {
        const previous = V28_FOOD_MARKERS[index - 1];
        expect(Math.hypot(point.x - previous.x, point.z - previous.z)).toBeLessThanOrEqual(WORKER_SIGHT);
      }
    });
    const hallCentre = { x: V28_HALL_ORIGIN.north.x + 2.5, z: V28_HALL_ORIGIN.north.z + 2.5 };
    expect(Math.hypot(V28_FOOD_MARKERS[0].x - hallCentre.x, V28_FOOD_MARKERS[0].z - hallCentre.z)).toBeLessThanOrEqual(SIGHT.hall);
    expect(RULES.startFood + V28_FOOD_AMOUNTS.reduce((sum, amount) => sum + amount, 0)).toBe(200);

    expect(world.oasis).toMatchObject({ cap: V28_OASIS_CAP, regen: V28_OASIS_REGEN });
    expect(world.sharedStone).toMatchObject({
      cap: V28_SHARED_STONE_CAP,
      amount: V28_SHARED_STONE_CAP,
      regen: 0,
    });
    expect(world.sharedStone?.cells).toEqual(V28_SHARED_STONE_CELLS);
    for (const point of V28_SHARED_STONE_CELLS) {
      expect(world.tiles[idx(point.x, point.z)].node).toMatchObject({
        kind: "stone",
        amount: V28_SHARED_STONE_CAP,
        pool: "shared-stone",
      });
    }
    for (const civ of ["north", "south"] as const) {
      expect(world.tiles[idx(V28_ROUTE_QUARRY[civ].x, V28_ROUTE_QUARRY[civ].z)].node).toMatchObject({
        kind: "stone",
        amount: V28_ROUTE_STONE,
        regen: 0,
      });
    }
  });

  test("v29 restores v27 terrain exactly and widens only worker observation", () => {
    const v27 = createWorld(20260813);
    const v29 = createWorld(20260815);
    expect(mapVariant(20260815)).toBe("corridor-unique-oasis-wide-sight");
    expect(v29.protocolVersion).toBe(16);
    expect(v29.tiles).toEqual(v27.tiles);
    expect(v29.buildings["north-hall"].origin).toEqual(v27.buildings["north-hall"].origin);
    expect(v29.buildings["south-hall"].origin).toEqual(v27.buildings["south-hall"].origin);
    expect(v29.oasis!).toEqual(v27.oasis!);
    expect(workerSight(v27.protocolVersion)).toBe(WORKER_SIGHT);
    expect(workerSight(v29.protocolVersion)).toBe(PROTOCOL16_WORKER_SIGHT);
    v27.workers["north-w1"].at = { x: 48, z: 28 };
    v29.workers["north-w1"].at = { x: 48, z: 28 };
    prepareTurn(v27);
    prepareTurn(v29);
    expect(v29.civs.north.knowledge.reduce((sum, value) => sum + Number(value > 0), 0)).toBeGreaterThan(
      v27.civs.north.knowledge.reduce((sum, value) => sum + Number(value > 0), 0),
    );
  });

  test("v30 changes only the home quarry reserve, never the terrain", () => {
    const v29 = createWorld(20260815);
    const v30 = createWorld(20260816);
    expect(mapVariant(20260816)).toBe("corridor-wide-sight-stone");
    expect(v30.protocolVersion).toBe(16);
    expect(v30.oasis!).toEqual(v29.oasis!);
    expect(v30.buildings["north-hall"].origin).toEqual(v29.buildings["north-hall"].origin);
    expect(v30.buildings["south-hall"].origin).toEqual(v29.buildings["south-hall"].origin);

    const terrain = (world: typeof v29) => world.tiles.map((tile) => tile.terrain);
    expect(terrain(v30)).toEqual(terrain(v29));

    const food = (world: typeof v29) =>
      world.tiles.reduce((sum, tile) => sum + (tile.node?.kind === "food" ? tile.node.amount : 0), 0);
    expect(food(v30)).toBe(food(v29));

    const changed = v29.tiles.flatMap((tile, index) =>
      JSON.stringify(tile.node ?? null) === JSON.stringify(v30.tiles[index].node ?? null)
        ? []
        : [{ at: { x: index % v29.width, z: Math.floor(index / v29.width) }, before: tile.node!, after: v30.tiles[index].node! }],
    );
    const quarry = { north: HOME_QUARRY.north, south: HOME_QUARRY.south };
    for (const cell of changed) {
      expect(cell.before.kind).toBe("stone");
      expect(cell.after).toEqual({ kind: "stone", amount: 8, cap: 8, regen: 0 });
      expect(cell.before.amount).toBe(4);
      const near = Object.values(quarry).some(
        (origin) => Math.abs(cell.at.x - origin.x) <= 3 && Math.abs(cell.at.z - origin.z) <= 3,
      );
      expect(near).toBe(true);
    }
    expect(changed.length).toBe(22);

    const stone = (world: typeof v29) =>
      world.tiles.reduce((sum, tile) => sum + (tile.node?.kind === "stone" ? tile.node.amount : 0), 0);
    expect(stone(v30) - stone(v29)).toBe(88);
    expect(HOME_QUARRY_TOTAL["corridor-wide-sight-stone"]).toBe(90);
  });

  test("v32 changes no terrain or resource from v31", () => {
    const v31 = createWorld(20260817);
    const v32 = createWorld(20260818);
    expect(mapVariant(20260818)).toBe("corridor-wide-sight-mixed-carry");
    expect(v32.protocolVersion).toBe(18);
    expect(v32.tiles).toEqual(v31.tiles);
    expect(v32.oasis!).toEqual(v31.oasis!);
  });

  test("v33 changes no terrain or resource from v32", () => {
    const v32 = createWorld(20260818);
    const v33 = createWorld(20260819);
    expect(mapVariant(20260819)).toBe("corridor-wide-sight-contact-gated");
    expect(v33.protocolVersion).toBe(19);
    expect(v33.tiles).toEqual(v32.tiles);
    expect(v33.oasis!).toEqual(v32.oasis!);
  });

  test("v34 keeps v33 terrain and finite route while tightening the shared middle", () => {
    const v33 = createWorld(20260819);
    const v34 = createWorld(20260820);
    expect(mapVariant(20260820)).toBe("corridor-wide-sight-tight-economy");
    expect(v34.protocolVersion).toBe(20);
    expect(v34.tiles.map((tile) => tile.terrain)).toEqual(v33.tiles.map((tile) => tile.terrain));
    expect(v34.buildings["north-hall"].origin).toEqual(v33.buildings["north-hall"].origin);
    expect(v34.buildings["south-hall"].origin).toEqual(v33.buildings["south-hall"].origin);
    expect(v34.oasis).toMatchObject({ amount: V34_OASIS_CAP, cap: V34_OASIS_CAP, regen: V34_OASIS_REGEN });

    const nonOasisFood = (world: typeof v33) =>
      world.tiles
        .filter((tile) => tile.terrain !== "oasis")
        .reduce((sum, tile) => sum + (tile.node?.kind === "food" ? tile.node.amount : 0), 0);
    const stone = (world: typeof v33) =>
      world.tiles.reduce((sum, tile) => sum + (tile.node?.kind === "stone" ? tile.node.amount : 0), 0);
    expect(nonOasisFood(v34)).toBe(nonOasisFood(v33));
    expect(stone(v33) - stone(v34)).toBe(600);
  });

  test("v35 changes no terrain, resources or economy from v34", () => {
    const v34 = createWorld(20260820);
    const v35 = createWorld(20260821);
    expect(mapVariant(20260821)).toBe("corridor-wide-sight-logistics-corrected");
    expect(v35.protocolVersion).toBe(21);
    expect(v35.tiles).toEqual(v34.tiles);
    expect(v35.oasis!).toEqual(v34.oasis!);
    expect(v35.buildings).toEqual(v34.buildings);
    expect(HOME_QUARRY_TOTAL["corridor-wide-sight-logistics-corrected"]).toBe(
      HOME_QUARRY_TOTAL["corridor-wide-sight-tight-economy"],
    );
    expect(CENTRE_STONE_TOTAL["corridor-wide-sight-logistics-corrected"]).toBe(
      CENTRE_STONE_TOTAL["corridor-wide-sight-tight-economy"],
    );
  });

});
