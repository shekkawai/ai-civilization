import { describe, expect, test } from "bun:test";
import { RULES } from "../src/sim/config";
import { HOME_QUARRY, createMap } from "../src/sim/map";
import { HOME_CENTRE } from "../src/lib/strategy";
import type { CivId, Frame, Tile } from "../src/sim/types";
import { readVitals } from "../src/v3/survival";

/**
 * The survival panel is arithmetic on the rules, and its whole value is that a reader can trust it
 * without checking. Two of these numbers are easy to get subtly wrong in a way that reads as a
 * finding rather than a bug.
 */

const TILES = createMap(20260808);

function frame(civ: CivId, over: Partial<Frame["civs"][CivId]>, workers: Frame["workers"]): Frame {
  const blank = {
    food: 0,
    stone: 0,
    workers: 0,
    buildings: 0,
    carried: 0,
    blocksPlaced: 0,
    blocksTaken: 0,
    quarryLeft: 0,
    contact: false,
  };
  return {
    turn: 10,
    civs: { north: { ...blank }, south: { ...blank }, [civ]: { ...blank, ...over } } as Frame["civs"],
    workers,
    buildings: [],
    piles: [],
    nodes: TILES.flatMap((tile, index) =>
      tile.node
        ? [{ x: index % RULES.width, z: Math.floor(index / RULES.width), amount: tile.node.amount }]
        : [],
    ),
    observedNodes: { north: [], south: [] },
    observedBlocks: { north: [], south: [] },
    observedBuildings: { north: [], south: [] },
    observedPiles: { north: [], south: [] },
    fog: { north: new Uint8Array(0), south: new Uint8Array(0) },
    lastSeen: { north: new Int32Array(0), south: new Int32Array(0) },
    events: [],
    journal: { north: "", south: "" },
  } as unknown as Frame;
}

const gatherer = (id: string, at: { x: number; z: number }, where: { x: number; z: number }, food = 0) =>
  ({
    id,
    owner: "north",
    x: where.x,
    z: where.z,
    job: { kind: "gather", at },
    carrying: { food, stone: 0 },
    destination: { ...at, label: "" },
  }) as unknown as Frame["workers"][number];

describe("vitals", () => {
  test("home stone comes from the engine's quarryLeft, not a radius sum", () => {
    // On corridor-tight the home quarry sits outside the build radius. Summing stone nodes within
    // `buildRadius` of the hall would report 0 while the quarry still holds its whole endowment,
    // and the panel would tell a reader the pressure had already arrived.
    const quarry = HOME_QUARRY.north;
    const home = HOME_CENTRE.north;
    expect(Math.hypot(quarry.x - home.x, quarry.z - home.z)).toBeGreaterThan(RULES.buildRadius);

    const vital = readVitals(frame("north", { workers: 4, food: 40, quarryLeft: 44 }, []), TILES, "north");
    expect(vital.homeStone).toBe(44);
  });

  test("only a worker standing on its tile counts toward next turn's food", () => {
    const field = TILES.reduce<{ x: number; z: number } | null>((found, tile, index) => {
      if (found) return found;
      if (tile.node?.kind !== "food") return found;
      const x = index % RULES.width;
      const z = Math.floor(index / RULES.width);
      return Math.hypot(x - HOME_CENTRE.north.x, z - HOME_CENTRE.north.z) <= RULES.buildRadius
        ? { x, z }
        : found;
    }, null);
    expect(field).not.toBeNull();

    const arrived = gatherer("north-w1", field!, field!);
    const walking = gatherer("north-w2", field!, { x: field!.x + 5, z: field!.z });
    const vital = readVitals(
      frame("north", { workers: 2, food: 30, quarryLeft: 10 }, [arrived, walking]),
      TILES,
      "north",
    );

    // Both are on a gather order, so both are counted as hands on food…
    expect(vital.gatherers.food).toBe(2);
    // …but only the one already standing there can deliver a harvest next turn.
    expect(vital.incoming).toBe(RULES.gatherFood);
    expect(vital.gatherState).toEqual({ working: 1, walking: 1, stalled: 0 });
  });

  test("a worker standing on an emptied source reads as stalled, not as working", () => {
    // v13 Turn 100: six of north's twelve people held a gather order on tile (46, 5), which had
    // been mined out. Headcount said six were on food; nothing was arriving. If `stalled` ever
    // folds back into `working`, the panel reports a starving civilization as a fed one.
    const field = { x: HOME_CENTRE.north.x, z: HOME_CENTRE.north.z };
    const world = frame("north", { workers: 6, food: 60, quarryLeft: 10 }, [
      gatherer("north-w1", field, field),
    ]);
    world.nodes = [{ x: field.x, z: field.z, amount: 0 }] as Frame["nodes"];

    const vital = readVitals(world, TILES, "north");
    expect(vital.gatherers.food).toBe(1);
    expect(vital.gatherState).toEqual({ working: 0, walking: 0, stalled: 1 });
    expect(vital.incoming).toBe(0);
  });

  test("carried food is reported separately and never counted as stored", () => {
    const field = { x: HOME_CENTRE.north.x, z: HOME_CENTRE.north.z };
    const laden = gatherer("north-w1", field, { x: field.x + 9, z: field.z }, 18);
    const vital = readVitals(frame("north", { workers: 3, food: 12, quarryLeft: 5 }, [laden]), TILES, "north");
    expect(vital.stored).toBe(12);
    expect(vital.inTransit).toBe(18);
    expect(vital.upkeep).toBe(3 * RULES.upkeep);
    expect(vital.turnsOfFood).toBeCloseTo(12 / 3);
  });
});
