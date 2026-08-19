import { describe, expect, test } from "bun:test";
import { buildingFunctionNote, foreignWorkerObservation } from "../src/v3/knowledge";
import { RULES } from "../src/sim/config";
import type { Frame } from "../src/sim/types";

const stranger = {
  id: "south-w3",
  owner: "south",
  x: 47,
  z: 48,
  job: { kind: "gather", at: { x: 47, z: 48 } },
  carrying: { food: 7, stone: 4 },
} as Frame["workers"][number];

describe("v3 knowledge contract", () => {
  test("a visible stranger shows exactly the activity and load the private report reveals", () => {
    const text = foreignWorkerObservation(stranger, true, "en");
    expect(text).toContain("apparent activity is gathering");
    expect(text).toContain("7 food and 4 stone");
    expect(text).not.toContain(stranger.id);
  });

  test("a stranger outside sight leaks no live position, activity or load", () => {
    const text = foreignWorkerObservation(stranger, false, "en");
    expect(text).not.toContain("47");
    expect(text).not.toContain("gather");
    expect(text).not.toContain("7 food");
  });

  test("protocol 18 Store and Post blocks participate in settlement-wide capacity", () => {
    const store = buildingFunctionNote("store", 18, "en");
    const post = buildingFunctionNote("post", 18, "en");
    expect(store).toContain("settlement-wide capacity formula");
    expect(post).toContain("settlement-wide capacity formula");
    expect(store).not.toContain("building never gives you more mouths");
    expect(post).not.toContain("adds no storage or worker places");
  });

  test("older protocols keep their actual fixed or Store-supplied place rules", () => {
    expect(buildingFunctionNote("store", 14, "en")).toContain("fixed at 10");
    expect(buildingFunctionNote("store", 9, "en")).toContain(
      `every ${RULES.storeBlocksPerWorkerSlot} design cells add one worker place`,
    );
    expect(buildingFunctionNote("store", 3, "en")).toContain("adds two worker places");
  });
});
