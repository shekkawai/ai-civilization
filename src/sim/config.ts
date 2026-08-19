import type { BuildingFunction } from "./types";

export const RULES = {
  width: 96,
  height: 96,
  hoursPerTurn: 3,

  workerMove: 4,
  carry: 30,
  upkeep: 1,
  /**
   * v22: 8 → 14. Every home ceiling used to arrive at the same height, so a settlement
   * could rest on all of them at once and nothing pushed it outward. Measured at v21
   * Turn 35: north had 10 worker places against 9 food/turn of home regrowth, south 12
   * against 12. Raising the population ceiling above the home food ceiling makes food
   * income the binding constraint, and home food income is hard-capped by the fixed
   * number of home fields.
   *
   * 14 was tried first and killed both scripted civilizations inside 56 turns on the
   * abundant classic map. The scripted policy is chaotically sensitive here (10 kills
   * north, 11 does not), so treat `test/engine.test.ts` "meet within the first week"
   * as a smoke test that the rules do not cause immediate collapse, never as a tuning
   * oracle. 11 is the mildest raise above the old 8 that keeps both scripted sides
   * alive and still reaches contact.
   */
  slotsAtStart: 11,
  migrationInterval: 2,
  /**
   * Protocol 10: the fixed population ceiling. Because births are unconditional, this is not
   * a cap a civilization may reach — it is the population it *will* have. It therefore has to
   * be set against what the land can actually feed, and it deliberately no longer moves when
   * a store is built. Swept in `scan-v23.ts`.
   */
  naturalCeiling: 10,
  /**
   * Protocol 10: the most people a single hungry turn may kill. Up to protocol 9 a shortfall
   * of N killed N at once, so one bad turn ended a season outright rather than starting a
   * decline anyone could answer. Set to 0 to restore the old all-at-once rule.
   */
  starvationToll: 1,
  /** Protocol 11: births resume only after this many fully fed turns following famine. */
  famineRecoveryTurns: 5,
  migrationFoodCost: 15,
  /**
   * v22: 5 → 3. The joining threshold is `migrationFoodCost + population × this × upkeep`,
   * so 5 made each new person raise the bar by 5 and the population self-limited long
   * before food ran short. At 3 the population keeps climbing into the food ceiling.
   */
  migrationReserveTurns: 3,
  hallStorageCapacity: 200,
  storeStoragePerBlock: 10,
  storeBlocksPerWorkerSlot: 5,
  postSlots: 0,

  gatherFood: 5,
  gatherStone: 3,

  blockCost: 3,
  salvage: 2,
  buildRate: 4,
  repairRate: 2,
  removeOwn: 2,
  protocol15RemoveOwn: 1,
  removeForeign: 1,
  prepareTurns: 1,

  buildRadius: 12,
  maxFootprint: 10,
  maxBlocks: 100,
  maxDesigns: 12,
  maxActionsPerTurn: 24,
  maxWorkersPerAction: 24,
  maxMessagesPerTurn: 1,
  maxJournalChars: 1200,
  maxNotebookChars: 12_000,
  maxStandingOrdersChars: 2400,
  recentTurns: 5,
  chronicleInterval: 5,

  startFood: 105,
  startStone: 30,
  startWorkers: 6,
  homeQuarry: 150,

  /** Standing blocks at or below this total are free of structure stone upkeep. */
  structureUpkeepFreeBlocks: 30,
  protocol15StructureUpkeepFreeBlocks: 20,
  /** Completed owned structures above the free allowance cost 1 stored stone per this many blocks each turn. */
  structureUpkeepBlocks: 10,
} as const;

/** Protocol 15 tested a tighter, ceil-based upkeep curve; protocol 20 restores that curve. */
export function usesTightStructureUpkeep(protocolVersion = 3) {
  return protocolVersion === 15 || protocolVersion >= 20;
}

export function structureUpkeepFreeBlocks(protocolVersion = 3) {
  return usesTightStructureUpkeep(protocolVersion)
    ? RULES.protocol15StructureUpkeepFreeBlocks
    : RULES.structureUpkeepFreeBlocks;
}

export function structureUpkeepDue(standingBlocks: number, protocolVersion = 3) {
  const billable = Math.max(0, standingBlocks - structureUpkeepFreeBlocks(protocolVersion));
  return usesTightStructureUpkeep(protocolVersion)
    ? Math.ceil(billable / RULES.structureUpkeepBlocks)
    : Math.floor(billable / RULES.structureUpkeepBlocks);
}

export const MIN_BLOCKS: Record<BuildingFunction, number> = {
  hall: 20,
  store: 6,
  post: 1,
};

/** Protocol 13 makes a post a cheap observation point rather than a logistics relay. */
export function minimumBlocks(fn: BuildingFunction, protocolVersion = 15) {
  if (fn === "post" && protocolVersion < 13) return 3;
  return MIN_BLOCKS[fn];
}

export const SIGHT: Record<BuildingFunction, number> = {
  hall: 12,
  store: 5,
  post: 12,
};

/** Worker sight used by every archived protocol through v28. */
export const WORKER_SIGHT = 6;
/** Protocol 16 widens local observation without revealing any unseen destination or boundary. */
export const PROTOCOL16_WORKER_SIGHT = 8;

export function workerSight(protocolVersion = 15) {
  return protocolVersion >= 16 ? PROTOCOL16_WORKER_SIGHT : WORKER_SIGHT;
}

export const FUNCTION_LABEL: Record<BuildingFunction, string> = {
  hall: "聚居地",
  store: "倉庫",
  post: "哨站",
};

/** The same three labels for a protocol-17 world, whose engine text is English throughout. */
export const FUNCTION_LABEL_EN: Record<BuildingFunction, string> = {
  hall: "hall",
  store: "store",
  post: "post",
};

export function functionLabel(fn: BuildingFunction, protocolVersion = 3) {
  return protocolVersion >= 17 ? FUNCTION_LABEL_EN[fn] : FUNCTION_LABEL[fn];
}

export const FUNCTION_NOTE: Record<BuildingFunction, string> = {
  hall: `糧食與石材共用 ${RULES.hallStorageCapacity} 格容量，視野 12 格。每方只有一座。人口位置由已完成建築仍然站立的總方塊數計算。`,
  store: `糧食與石材共用空間；每個仍然站立的方塊增加 ${RULES.storeStoragePerBlock} 格容量（拆一塊即刻少一塊），不提供人口位置，視野 5 格。`,
  post: `純觀察用途：持續提供 ${SIGHT.post} 格視野，沒有儲存或人口位置，也不能作為新工地的建築錨點。`,
};

export const CIV_LABEL: Record<"north" | "south", string> = {
  north: "北岸",
  south: "南原",
};
