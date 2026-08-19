import { describe, expect, test } from "bun:test";
import { createMap } from "../src/sim/map";
import { RULES } from "../src/sim/config";
import { readMap, reachOf } from "../src/lib/strategy";
import type { Frame } from "../src/sim/types";

/**
 * The playbook tells a viewer what a map allows before it tells them what a side
 * did with it, so these numbers carry the whole reading. If the binding constraint
 * were computed wrongly, every strategic verdict on the page would be confidently
 * backwards — hence a test per registered variant rather than a spot check.
 */
describe("map ceilings", () => {
  test("both sides are dealt exactly the same hand on every variant", () => {
    for (const seed of [20260802, 20260805, 20260806, 20260807, 20260808]) {
      const facts = readMap(createMap(seed));
      expect(facts.symmetric).toBe(true);
      expect(facts.civs.north.foodCeiling).toBe(facts.civs.south.foodCeiling);
      expect(facts.civs.north.stone).toBe(facts.civs.south.stone);
    }
  });

  test("gradient makes the two home ceilings coincide — which is why v15 could sit still", () => {
    const facts = readMap(createMap(20260805));
    expect(facts.civs.north.foodCeiling).toBe(18);
    expect(facts.binding).toBe("both");
  });

  test("scarce moves the stone ceiling below the food ceiling", () => {
    const facts = readMap(createMap(20260806));
    const home = facts.civs.north;
    expect(home.foodCeiling).toBe(18);
    expect(home.stoneCeiling).toBeLessThan(home.foodCeiling);
    expect(facts.binding).toBe("stone");
    expect(facts.homeCeiling).toBe(home.stoneCeiling);
    // The point of the variant: the answer to the stone shortage is far from home.
    expect(home.nextStone).toBeGreaterThan(RULES.buildRadius * 2);
  });

  test("corridor leaves home food as the binding ceiling once v22 raised the population cap", () => {
    const facts = readMap(createMap(20260807));
    const home = facts.civs.north;
    expect(home.foodCeiling).toBe(9);
    expect(home.stone).toBeGreaterThanOrEqual(35);
    expect(home.stone).toBeLessThanOrEqual(55);
    // Was "both" while `slotsAtStart` was 8: home stone had to buy stores before the
    // settlement could grow, so the stone and food ceilings arrived together and a
    // settlement could rest on both at once. v22 raised the starting worker places to
    // 11 precisely to separate them, so home food is now the ceiling that binds first.
    expect(facts.binding).toBe("food");
    expect(home.nextFood).toBeLessThan(RULES.buildRadius * 2);
    expect(home.nextStone).toBeLessThan(RULES.buildRadius * 2);
  });

  test("corridor-tight makes home food the tighter ceiling while keeping the followable chain", () => {
    const facts = readMap(createMap(20260808));
    const home = facts.civs.north;
    expect(home.foodCeiling).toBe(6);
    expect(home.stone).toBeGreaterThanOrEqual(30);
    expect(home.stone).toBeLessThanOrEqual(50);
    expect(facts.binding).toBe("food");
    expect(home.nextFood).toBeLessThan(RULES.buildRadius * 2);
    expect(home.nextStone).toBeLessThan(RULES.buildRadius * 2);
  });


  test("corridor-tight lowers the home food ceiling below corridor while keeping the same route", () => {
    const corridor = readMap(createMap(20260807));
    const tight = readMap(createMap(20260808));
    const home = tight.civs.north;
    expect(home.foodCeiling).toBe(6);
    expect(home.foodCeiling).toBeLessThan(corridor.civs.north.foodCeiling);
    expect(home.stone).toBeGreaterThanOrEqual(30);
    expect(home.stone).toBeLessThanOrEqual(50);
    expect(home.nextFood).toBeLessThan(RULES.buildRadius * 2);
    expect(home.nextStone).toBeLessThan(RULES.buildRadius * 2);
  });

  test("the classic map's home ring feeds an order of magnitude more people", () => {
    const facts = readMap(createMap(20260802));
    expect(facts.civs.north.foodCeiling).toBeGreaterThan(100);
  });
});

describe("reach", () => {
  const frame = (workers: Frame["workers"]) => ({ workers }) as Frame;

  test("counts only the selected civilization, and only outside the home radius", () => {
    const reach = reachOf(
      frame([
        { id: "north-w1", owner: "north", x: 48, z: 12, job: { kind: "idle" }, carrying: { food: 0, stone: 0 } },
        { id: "north-w2", owner: "north", x: 48, z: 40, job: { kind: "gather", at: { x: 48, z: 40 } }, carrying: { food: 0, stone: 0 } },
        { id: "south-w1", owner: "south", x: 10, z: 10, job: { kind: "idle" }, carrying: { food: 0, stone: 0 } },
      ]),
      "north",
    );
    expect(reach.outside).toBe(1);
    // Measured from the hall's centre (47.5, 11.5), not from the spawn cell.
    expect(reach.furthest).toBe(29);
    expect(reach.gatheringOutside).toBe(true);
  });

  test("a civilization that never left home reports nobody outside", () => {
    const reach = reachOf(
      frame([
        { id: "north-w1", owner: "north", x: 45, z: 14, job: { kind: "gather", at: { x: 45, z: 14 } }, carrying: { food: 0, stone: 0 } },
      ]),
      "north",
    );
    expect(reach.outside).toBe(0);
    expect(reach.gatheringOutside).toBe(false);
  });
});
