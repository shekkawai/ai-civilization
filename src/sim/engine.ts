import { engineEnglish } from "../lib/game-events";
import { MIN_BLOCKS, RULES, SIGHT, structureUpkeepDue, workerSight } from "./config";
import { STARTER_HALL, checkDesign, designCells, exposedIndexes } from "./designs";
import {
  CENTRE,
  HALL_ORIGIN,
  HOME_QUARRY,
  SPAWN,
  V28_SHARED_STONE_CELLS,
  V28_FOOD_MARKERS,
  createMap,
  hallOrigin,
  homeQuarryPoint,
  idx,
  inBounds,
  isProtocol17Variant,
  isProtocol18Variant,
  isProtocol19Variant,
  isProtocol20Variant,
  isProtocol21Variant,
  isUniqueOasisVariant,
  isWideSightVariant,
  mapVariant,
  spawnPoint,
} from "./map";
import { accessCells, blockedCells, findPath, passable } from "./path";
import type {
  Action,
  ActionResult,
  Building,
  Civ,
  CivId,
  Decision,
  Design,
  EventKind,
  Point,
  Stock,
  World,
  Worker,
} from "./types";

export const CIVS: CivId[] = ["north", "south"];
export type Decide = (world: World) => Decision[];

/**
 * `protocolOverride` exists because the protocol has always been derived from the map variant, and
 * protocol-gated interface changes do not alter older maps. A registered variant raises it the
 * usual way; the override remains for focused legacy tests only.
 */
export function createWorld(seed = 20260802, protocolOverride?: number): World {
  const tiles = createMap(seed);
  const variant = mapVariant(seed);
  const protocol15 = variant === "numpad-route";
  const protocol16 = isWideSightVariant(variant);
  const uniqueOasis = isUniqueOasisVariant(variant) || protocol15;
  const oasisCells = uniqueOasis
    ? tiles.flatMap((tile, index) =>
        tile.terrain === "oasis"
          ? [{ x: index % RULES.width, z: Math.floor(index / RULES.width) }]
          : [],
      )
    : [];
  const oasisNode = oasisCells.length > 0 ? tiles[idx(oasisCells[0].x, oasisCells[0].z)].node : undefined;
  const world: World = {
    protocolVersion:
      protocolOverride ??
      (isProtocol21Variant(variant)
        ? 21
        : isProtocol20Variant(variant)
        ? 20
        : isProtocol19Variant(variant)
        ? 19
        : isProtocol18Variant(variant)
          ? 18
        : isProtocol17Variant(variant)
          ? 17
          : protocol16
            ? 16
            : protocol15
              ? 15
              : uniqueOasis
                ? 14
                : 13),
    seed,
    turn: 0,
    width: RULES.width,
    height: RULES.height,
    tiles,
    ...(oasisNode
      ? {
          oasis: {
            id: "central-oasis",
            cells: oasisCells,
            amount: oasisNode.amount,
            cap: oasisNode.cap,
            regen: oasisNode.regen,
          },
        }
      : {}),
    ...(protocol15
      ? {
          sharedStone: {
            id: "central-shared-stone",
            cells: V28_SHARED_STONE_CELLS.map((cell) => ({ ...cell })),
            amount: 120,
            cap: 120,
            regen: 0,
          },
        }
      : {}),
    civs: {} as Record<CivId, Civ>,
    workers: {},
    buildings: {},
    piles: {},
    events: [],
    actionResults: [],
    nextEvent: 1,
    nextResult: 1,
    nextBuilding: { north: 1, south: 1 },
    nextWorker: { north: 1, south: 1 },
    nextPile: 1,
    messages: [],
    nextMessage: 1,
    tally: {
      north: { blocksLaid: 0, blocksTakenFromOthers: 0, blocksLost: 0 },
      south: { blocksLaid: 0, blocksTakenFromOthers: 0, blocksLost: 0 },
    },
  };
  syncSharedStoneTiles(world);

  for (const id of CIVS) {
    world.civs[id] = {
      id,
      label: id === "north" ? "北岸" : "南原",
      spawn: spawnPoint(seed, id),
      // The one system-authored design. Its name is printed to the model beside its own plans,
      // so from protocol 17 it is English like everything else the engine writes.
      designs: {
        [STARTER_HALL.id]: {
          ...structuredClone(STARTER_HALL),
          ...((world.protocolVersion ?? 3) >= 17 ? { name: "Starting Hall" } : {}),
        },
      },
      knowledge: new Uint8Array(tiles.length),
      lastSeen: new Int32Array(tiles.length).fill(-1),
      memory: Array.from({ length: tiles.length }, () => null),
      contacts: {},
      foreignSeen: { workers: {}, buildings: {}, nextWorker: 1, nextBuilding: 1 },
      notes: "",
      standingOrders: "",
      chronicle: [],
      journal: [],
      fullyFedTurns: RULES.famineRecoveryTurns,
    };
    foundSettlement(world, id);
  }

  refreshVision(world);
  log(world, undefined, "world", "世界建立。兩邊的地形、資源與距離完全相同。");
  return world;
}

function foundSettlement(world: World, civ: CivId) {
  const origin = hallOrigin(world.seed, civ);
  const cells = designCells(STARTER_HALL, origin);
  const hall: Building = {
    id: `${civ}-hall`,
    owner: civ,
    designId: STARTER_HALL.id,
    fn: "hall",
    origin,
    cells,
    access: accessCells(world, cells),
    total: cells.length,
    blocks: Array.from({ length: cells.length }, () => 1),
    placed: cells.length,
    removed: 0,
    delivered: 0,
    stock: { food: RULES.startFood, stone: RULES.startStone },
    createdTurn: 0,
    completedTurn: 0,
  };
  world.buildings[hall.id] = hall;

  let spots = orderedForCiv(world, civ, accessCells(world, cells));
  if ((world.protocolVersion ?? 3) >= 15) {
    const first =
      civ === "north"
        ? V28_FOOD_MARKERS[0]
        : { x: world.width - 1 - V28_FOOD_MARKERS[0].x, z: world.height - 1 - V28_FOOD_MARKERS[0].z };
    spots = [...spots].sort(
      (left, right) =>
        Math.hypot(left.x - first.x, left.z - first.z) - Math.hypot(right.x - first.x, right.z - first.z) ||
        left.z - right.z ||
        left.x - right.x,
    );
  }
  for (let index = 0; index < RULES.startWorkers; index += 1) {
    const id = `${civ}-w${world.nextWorker[civ]++}`;
    world.workers[id] = {
      id,
      owner: civ,
      at: { ...spots[index % spots.length] },
      carrying: { food: 0, stone: 0 },
      job: { kind: "idle" },
      alive: true,
    };
  }
}

export function prepareTurn(world: World) {
  if (world.preparedTurn !== undefined) throw new Error(`Turn ${world.preparedTurn} is already prepared.`);
  world.turn += 1;
  world.preparedTurn = world.turn;
  world.turnPreparation = { turn: world.turn, upkeep: upkeep(world) };
  regenerate(world);
  refreshVision(world);
  return world;
}

export function resolvePreparedTurn(world: World, decisions: Decision[]) {
  if (world.preparedTurn !== world.turn) throw new Error(`Turn ${world.turn} was not prepared.`);
  applyDecisions(world, decisions);
  moveWorkers(world);
  handleCarrying(world);
  gather(world);
  construct(world);
  resolveStructureWork(world);
  refreshAccess(world);
  naturalMigration(world);
  refreshVision(world);
  world.preparedTurn = undefined;
}

export function advance(world: World, decide: Decide) {
  const start = world.events.length;
  prepareTurn(world);
  resolvePreparedTurn(world, decide(world));
  return world.events.slice(start);
}

export function runTurns(world: World, count: number, decide: Decide) {
  for (let step = 0; step < count; step += 1) advance(world, decide);
  return world;
}

/* ---------------------------------------------------------------- upkeep */

function upkeep(world: World) {
  const facts = {} as NonNullable<World["turnPreparation"]>["upkeep"];
  for (const civ of CIVS) {
    const living = livingWorkers(world, civ);
    const foodDue = living.length * RULES.upkeep;
    let owed = foodDue;
    for (const store of stores(world, civ)) {
      const taken = Math.min(store.stock.food, owed);
      store.stock.food -= taken;
      owed -= taken;
      if (owed <= 0) break;
    }
    // Protocol 10 (v23): hunger is a pressure, not an execution. Up to protocol 9 a shortfall
    // of N killed N people in the same turn, so any overshoot became an instant wipe rather
    // than a decline a civilization could notice and answer. Paired with unconditional births
    // that is a ratchet into a cliff: population climbs to the worker-place ceiling, sits at
    // maximum upkeep, and the first bad turn ends the season. Measured across the v23 scan,
    // every strategy died under the old rule at every larder from 24 to 200. One death per
    // hungry turn keeps the same total pressure but lets a settlement fall back and recover.
    const toll = (world.protocolVersion ?? 3) >= 10 ? Math.min(owed, 1) : owed;
    if ((world.protocolVersion ?? 3) >= 11) {
      const previous = world.civs[civ].fullyFedTurns ?? RULES.famineRecoveryTurns;
      world.civs[civ].fullyFedTurns =
        owed > 0 ? 0 : Math.min(RULES.famineRecoveryTurns, previous + 1);
    }
    const victims = owed > 0 ? living.slice(-toll) : [];
    const structure = applyStructureUpkeep(world, civ);
    facts[civ] = {
      workersBefore: living.length,
      foodDue,
      foodPaid: foodDue - owed,
      starved: victims.length,
      structureStoneDue: structure.stoneDue,
      structureStonePaid: structure.stonePaid,
      structureBlocksLost: structure.blocksLost,
    };
    if (victims.length === 0) continue;
    for (const worker of victims) {
      worker.alive = false;
      if (carried(worker) <= 0) continue;
      const id = `pile-${world.nextPile++}`;
      world.piles[id] = {
        id,
        at: { ...worker.at },
        stock: { ...worker.carrying },
        turn: world.turn,
      };
      log(
        world,
        civ,
        "spill",
        `一名餓死工人攜帶的 ${worker.carrying.food} 糧食與 ${worker.carrying.stone} 石材掉在地上。`,
        worker.at,
      );
      worker.carrying = { food: 0, stone: 0 };
    }
    log(world, civ, "starve", `糧倉見底，${victims.length} 名工人餓死。`);
  }
  return facts;
}

/**
 * Standing completed structures need continuous stone. Each full batch of
 * `RULES.structureUpkeepBlocks` standing blocks costs 1 stored stone per turn. Unpaid
 * cost removes exposed owned blocks (no salvage), so a town that only mines once
 * and never tops up stone slowly loses capacity. Incomplete worksites are free.
 */
function applyStructureUpkeep(world: World, civ: CivId) {
  const owned = Object.values(world.buildings)
    .filter(
      (building) =>
        building.owner === civ &&
        building.completedTurn !== undefined &&
        standing(building) > 0,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const standingBlocks = owned.reduce((sum, building) => sum + standing(building), 0);
  const stoneDue = structureUpkeepDue(standingBlocks, world.protocolVersion ?? 3);
  let remaining = stoneDue;
  let stonePaid = 0;
  for (const store of stores(world, civ)) {
    if (remaining <= 0) break;
    const taken = Math.min(store.stock.stone, remaining);
    store.stock.stone -= taken;
    remaining -= taken;
    stonePaid += taken;
  }
  let blocksLost = 0;
  while (remaining > 0) {
    const candidates = owned
      .map((building) => ({ building, exposed: exposedIndexesFor(building) }))
      .filter((entry) => entry.exposed.length > 0);
    if (candidates.length === 0) break;
    // Deterministic: peel the building with the most standing blocks first, then id.
    candidates.sort((left, right) => {
      const byStanding = standing(right.building) - standing(left.building);
      if (byStanding !== 0) return byStanding;
      return left.building.id.localeCompare(right.building.id);
    });
    const target = candidates[0].building;
    const index = candidates[0].exposed[0];
    target.blocks[index] = 0;
    target.removed += 1;
    world.tally[civ].blocksLost += 1;
    remaining -= 1;
    blocksLost += 1;
    if (standing(target) <= 0) {
      const name = designName(world, target);
      const origin = { ...target.origin };
      collapse(world, target);
      log(world, civ, "upkeep", `${name} 因缺乏石材維護而倒塌。`, origin);
    }
  }
  if (stoneDue > 0) {
    log(
      world,
      civ,
      "upkeep",
      `已完成建築共 ${standingBlocks} 塊，本回合石材維護需要 ${stoneDue}；已支付 ${stonePaid}，失去 ${blocksLost} 塊。`,
    );
  }
  refreshAccess(world);
  return { stoneDue, stonePaid, blocksLost, standingBlocks };
}

function regenerate(world: World) {
  if (world.oasis) {
    world.oasis.amount = Math.min(world.oasis.cap, world.oasis.amount + world.oasis.regen);
    syncOasisTiles(world);
  }
  syncSharedStoneTiles(world);
  world.tiles.forEach((tile, index) => {
    if (!tile.node || tile.node.regen <= 0) return;
    if (tile.terrain === "oasis") return;
    const x = index % world.width;
    const z = Math.floor(index / world.width);
    if (activeBlockAt(world, x, z)) return;
    tile.node.amount = Math.min(tile.node.cap, tile.node.amount + tile.node.regen);
  });
}

/* ------------------------------------------------------------- decisions */

function applyDecisions(world: World, decisions: Decision[]) {
  const available: Record<CivId, Set<string>> = {
    north: new Set(Object.keys(world.civs.north.designs)),
    south: new Set(Object.keys(world.civs.south.designs)),
  };
  const seenCivs = new Set<CivId>();
  const assignedWorkers = new Set<string>();
  const messageCounts: Record<CivId, number> = { north: 0, south: 0 };
  const accepted: Array<{ civ: CivId; action: Action; actionIndex: number }> = [];

  for (const decision of decisions) {
    const civ = world.civs[decision.civ];
    if (!civ || seenCivs.has(decision.civ)) continue;
    seenCivs.add(decision.civ);
    if (decision.journal) {
      civ.journal.push({ turn: world.turn, text: decision.journal.slice(0, RULES.maxJournalChars) });
    }
    if (decision.standingOrders !== undefined) {
      civ.standingOrders = decision.standingOrders.slice(0, RULES.maxStandingOrdersChars);
    }
    if (world.turn % RULES.chronicleInterval === 0 && decision.chronicleLine) {
      civ.chronicle.push(decision.chronicleLine.slice(0, 500));
    }
    const actions = Array.isArray(decision.actions) ? decision.actions : [];
    actions.forEach((action, actionIndex) => {
      if (actionIndex >= RULES.maxActionsPerTurn) {
        result(world, decision.civ, actionIndex, action.type, "rejected", "action_limit", "這項指示超出本回合上限。", action);
        return;
      }
      const errors = validateAction(world, decision.civ, action, assignedWorkers, messageCounts);
      if (errors.length > 0) {
        const text = errors.join(" ");
        result(world, decision.civ, actionIndex, action.type, "rejected", "invalid_action", text, action);
        log(world, decision.civ, "failure", text, actionPoint(action));
        return;
      }
      if ("workers" in action) action.workers.forEach((workerId) => assignedWorkers.add(workerId));
      if (action.type === "message") messageCounts[decision.civ] += 1;
      accepted.push({ civ: decision.civ, action, actionIndex });
    });
  }

  for (const item of accepted) {
    if (item.action.type !== "design") continue;
    registerDesign(world, item.civ, item.action.design, item.actionIndex);
  }

  const builds: Array<{
    civ: CivId;
    action: Extract<Action, { type: "build" }>;
    actionIndex: number;
  }> = [];
  for (const item of accepted) {
    if (item.action.type === "design") continue;
    if (item.action.type === "build") builds.push({ civ: item.civ, action: item.action, actionIndex: item.actionIndex });
    else applyAction(world, item.civ, item.action, item.actionIndex);
  }
  resolveBuilds(world, builds, available);
}

function validateAction(
  world: World,
  civId: CivId,
  action: Action,
  assignedWorkers: Set<string>,
  messageCounts: Record<CivId, number>,
) {
  const errors: string[] = [];
  if ("workers" in action) {
    const workerIds = [...new Set(action.workers)];
    if (workerIds.length === 0) errors.push("這項指示沒有指定工人。");
    if (workerIds.length > RULES.maxWorkersPerAction) errors.push("這項指示包含太多工人。");
    for (const workerId of workerIds) {
      const worker = world.workers[workerId];
      if (!worker?.alive || worker.owner !== civId) errors.push(`關於 ${workerId} 的指示無法執行：那不是我們的人。`);
      else if (assignedWorkers.has(workerId)) errors.push(`${workerId} 本回合已收到另一項新指示。`);
    }
  }
  if (action.type === "gather") {
    if (!inBounds(action.at.x, action.at.z)) errors.push("採集位置不在世界範圍內。");
    else if (world.civs[civId].knowledge[idx(action.at.x, action.at.z)] === 0) errors.push("我們從未看過這個採集位置。");
    else if (!world.tiles[idx(action.at.x, action.at.z)].node) errors.push("這個位置沒有可採集的物資。");
  }
  if (action.type === "move" && !inBounds(action.to.x, action.to.z)) errors.push("目的地不在世界範圍內。");
  if (action.type === "remove" || action.type === "repair") {
    const building = world.buildings[action.buildingId];
    if (!building) errors.push("指定的建築不存在。");
    else if (action.type === "repair" && building.owner !== civId) errors.push("只能修補自己的建築。");
    else if (action.type === "repair" && repairableIndexes(building).length === 0) {
      errors.push("這座建築沒有已放下後又缺失的方塊；尚未建造的格不是修補目標。");
    }
    else if (building.owner !== civId && !knowsBuilding(world, civId, building.id)) {
      errors.push("我們從未看過這座建築。");
    }
  }
  if (action.type === "drop") {
    if ((world.protocolVersion ?? 3) < 17) errors.push("我們的人不懂得這樣做。");
    if (
      !Number.isInteger(action.food ?? 0) ||
      !Number.isInteger(action.stone ?? 0) ||
      (action.food ?? 0) < 0 ||
      (action.stone ?? 0) < 0
    ) {
      errors.push("放下的數量必須是非負整數。");
    }
  }
  if (action.type === "name" && !world.civs[civId].contacts[action.civ]) errors.push("我們未曾遇見這些人。");
  if (action.type === "message") {
    if (!world.civs[civId].contacts[action.civ]) errors.push("訊息無法送出：我們未曾遇見這些人。");
    if (messageCounts[civId] >= RULES.maxMessagesPerTurn) errors.push("本回合已經傳過一次話。");
  }
  return errors;
}

function registerDesign(world: World, civId: CivId, submitted: Design, actionIndex: number) {
  const civ = world.civs[civId];
  const design = structuredClone(submitted);
  design.author = civId;
  const check = checkDesign(design, world.protocolVersion ?? 3);
  if (!check.ok) {
    const text = `設計「${design.name}」未獲通過：${check.errors.join(" ")}`;
    log(world, civId, "failure", text);
    result(world, civId, actionIndex, "design", "rejected", "invalid_design", text);
    return;
  }
  if (!civ.designs[design.id] && Object.keys(civ.designs).length >= RULES.maxDesigns) {
    log(world, civId, "failure", "設計庫已滿。");
    result(world, civId, actionIndex, "design", "rejected", "design_limit", "設計庫已滿。");
    return;
  }
  civ.designs[design.id] = design;
  log(world, civId, "design", `完成設計「${design.name}」：${check.blocks} 個方塊，需要 ${check.cost} 石材。`);
  result(world, civId, actionIndex, "design", "completed", "design_saved", "設計已保存。", undefined, check.blocks);
}

function applyAction(
  world: World,
  civId: CivId,
  action: Exclude<Action, { type: "build" | "design" }>,
  actionIndex: number,
) {
  if (action.type === "note") {
    world.civs[civId].notes = action.text.slice(0, RULES.maxNotebookChars);
    result(world, civId, actionIndex, "note", "completed", "notebook_updated", "記事已更新。", action);
    return;
  }
  if (action.type === "name") {
    const contact = world.civs[civId].contacts[action.civ];
    if (contact) contact.name = action.name;
    result(world, civId, actionIndex, "name", "completed", "name_saved", "稱呼已記下。", action);
    return;
  }
  if (action.type === "message") {
    world.messages.push({
      id: world.nextMessage++,
      sentTurn: world.turn,
      deliverTurn: world.turn + 1,
      from: civId,
      to: action.civ,
      text: action.text.slice(0, 1200),
    });
    log(world, civId, "message", `向對方傳話：「${action.text.slice(0, 80)}」`);
    result(world, civId, actionIndex, "message", "completed", "message_queued", "訊息將在下一回合送達。", action);
    return;
  }

  /**
   * Protocol 17. The only way goods move between two civilizations, and it is deliberately not a
   * transfer: a worker sets its load down where it stands and walks away, and whoever stands there
   * next collects it. A gift and a theft are the same event to the engine, so nothing in the
   * action list names either. The point is that the promises the models were already making — v30
   * spent forty turns agreeing a barter — become something they can actually carry out.
   */
  if (action.type === "drop") {
    let dropped = 0;
    for (const workerId of [...new Set(action.workers)]) {
      const worker = world.workers[workerId]!;
      // Naming one resource means only that one. Naming neither means the whole load — so a
      // civilization handing over grain never accidentally sets its stone down beside it.
      const everything = action.food === undefined && action.stone === undefined;
      const wanted = {
        food: Math.min(worker.carrying.food, everything ? worker.carrying.food : (action.food ?? 0)),
        stone: Math.min(worker.carrying.stone, everything ? worker.carrying.stone : (action.stone ?? 0)),
      };
      if (wanted.food + wanted.stone <= 0) continue;
      worker.carrying.food -= wanted.food;
      worker.carrying.stone -= wanted.stone;
      // One pile per cell per dropper, so repeated drops in one place stay one heap to collect.
      const existing = Object.values(world.piles).find(
        (pile) => same(pile.at, worker.at) && pile.droppedBy === worker.id,
      );
      if (existing) {
        existing.stock.food += wanted.food;
        existing.stock.stone += wanted.stone;
        existing.turn = world.turn;
      } else {
        const id = `pile-${world.nextPile++}`;
        world.piles[id] = { id, at: { ...worker.at }, stock: wanted, turn: world.turn, droppedBy: worker.id };
      }
      dropped += 1;
      log(
        world,
        civId,
        "drop",
        `${worker.id} 在 (${worker.at.x},${worker.at.z}) 放下 ${wanted.food} 糧食與 ${wanted.stone} 石材，任何人都可以拾走。`,
        worker.at,
      );
    }
    result(
      world,
      civId,
      actionIndex,
      "drop",
      dropped > 0 ? "completed" : "completed",
      dropped > 0 ? "goods_dropped" : "nothing_to_drop",
      dropped > 0 ? "物資已放在地上。" : "指定工人沒有攜帶物資。",
      action,
      dropped,
    );
    return;
  }

  if (action.type === "deposit") {
    let assigned = 0;
    for (const workerId of [...new Set(action.workers)]) {
      const worker = world.workers[workerId]!;
      if (carried(worker) <= 0) continue;
      worker.job = { kind: "deposit" };
      assigned += 1;
    }
    result(
      world,
      civId,
      actionIndex,
      "deposit",
      assigned > 0 ? "accepted" : "completed",
      assigned > 0 ? "deposit_assigned" : "nothing_to_deposit",
      assigned > 0
        ? (world.protocolVersion ?? 3) >= 21
          ? "攜帶物資的工人會先按本地空位篩選可用存放處，再沿最短可達路徑返回。"
          : "攜帶物資的工人正返回最近的存放處。"
        : "指定工人沒有攜帶物資。",
      action,
      assigned,
    );
    return;
  }

  for (const workerId of [...new Set(action.workers)]) {
    const worker = world.workers[workerId]!;
    if (action.type === "gather") worker.job = { kind: "gather", at: { ...action.at } };
    if (action.type === "move") worker.job = { kind: "move", to: { ...action.to } };
    if (action.type === "repair") worker.job = { kind: "repair", buildingId: action.buildingId };
    if (action.type === "remove") worker.job = { kind: "remove", buildingId: action.buildingId };
  }
  result(world, civId, actionIndex, action.type, "accepted", "job_assigned", "工人已收到新指示。", action);
}

function resolveBuilds(
  world: World,
  requests: Array<{ civ: CivId; action: Extract<Action, { type: "build" }>; actionIndex: number }>,
  available: Record<CivId, Set<string>>,
) {
  const candidates = requests.map((request) => {
    const design = world.civs[request.civ].designs[request.action.designId];
    const existing = Object.values(world.buildings).find(
      (building) =>
        building.owner === request.civ &&
        building.designId === request.action.designId &&
        building.origin.x === request.action.at.x &&
        building.origin.z === request.action.at.z &&
        building.completedTurn === undefined &&
        standing(building) < building.total,
    );
    const postAtOrigin =
      (world.protocolVersion ?? 3) >= 13 && (world.protocolVersion ?? 3) < 14 && design?.fn === "store"
        ? Object.values(world.buildings).find(
            (building) =>
              building.owner === request.civ &&
              building.fn === "post" &&
              building.origin.x === request.action.at.x &&
              building.origin.z === request.action.at.z &&
              building.completedTurn !== undefined &&
              standing(building) > 0,
          )
        : undefined;
    const errors: string[] = [];
    if (!design || !available[request.civ].has(request.action.designId)) {
      errors.push("這個設計在本回合開始時還不存在。");
    }
    if (design?.fn === "hall" && !existing) {
      errors.push("起始聚居地的設計不能再次放置。");
    }
    const cells = design ? designCells(design, request.action.at) : [];
    const standingPostCells = postAtOrigin
      ? postAtOrigin.cells.filter((_cell, index) => postAtOrigin.blocks[index] === 1)
      : [];
    const upgrade =
      postAtOrigin &&
      standingPostCells.every((postCell) => cells.some((cell) => same(cell, postCell)))
        ? postAtOrigin
        : undefined;
    if (postAtOrigin && !upgrade) {
      errors.push("原址擴建倉庫時，倉庫設計必須覆蓋哨站所有仍然站立的方塊。");
    }
    if (design && !existing) {
      errors.push(
        ...placementErrors(world, request.civ, cells, {
          ignoreBuildingId: upgrade?.id,
          requireAnchor: !upgrade,
          workerIds: request.action.workers,
        }),
      );
    }
    return { ...request, design, existing, upgrade, cells, errors };
  });

  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      if (!candidates[left].existing && !candidates[right].existing && overlap(candidates[left].cells, candidates[right].cells)) {
        candidates[left].errors.push("同一塊地上同時開工。");
        candidates[right].errors.push("同一塊地上同時開工。");
      }
    }
  }

  for (const candidate of candidates) {
    if (!candidate.design || candidate.errors.length > 0) {
      const text = `建造沒有開始：${[...new Set(candidate.errors)].join(" ")} 沒有放下方塊，地面維持原狀。`;
      log(world, candidate.civ, "failure", text, candidate.action.at);
      result(world, candidate.civ, candidate.actionIndex, "build", "rejected", "build_conflict", text, candidate.action);
      continue;
    }
    if (candidate.existing) {
      for (const workerId of candidate.action.workers) {
        const worker = world.workers[workerId];
        if (!worker?.alive || worker.owner !== candidate.civ) continue;
        worker.job = { kind: "build", buildingId: candidate.existing.id };
      }
      log(world, candidate.civ, "build", `工人重新加入「${candidate.design.name}」的工地。`, candidate.action.at);
      result(
        world,
        candidate.civ,
        candidate.actionIndex,
        "build",
        "accepted",
        "worksite_resumed",
        "工人已加入現有工地。",
        candidate.action,
      );
      continue;
    }
    if (candidate.upgrade) {
      const building = candidate.upgrade;
      const standingKeys = new Set(
        building.cells
          .filter((_cell, index) => building.blocks[index] === 1)
          .map((cell) => `${cell.x},${cell.z}`),
      );
      const reused = candidate.cells.filter((cell) => standingKeys.has(`${cell.x},${cell.z}`));
      const additions = candidate.cells.filter((cell) => !standingKeys.has(`${cell.x},${cell.z}`));
      building.designId = candidate.design.id;
      building.fn = "store";
      building.cells = [...reused, ...additions];
      building.total = building.cells.length;
      building.blocks = [
        ...Array.from({ length: reused.length }, () => 1),
        ...Array.from({ length: additions.length }, () => 0),
      ];
      building.placed = reused.length;
      building.removed = 0;
      building.delivered = 0;
      building.completedTurn = undefined;
      building.access = accessCells(world, building.cells);
      for (const workerId of candidate.action.workers) {
        const worker = world.workers[workerId];
        if (!worker?.alive || worker.owner !== candidate.civ) continue;
        worker.job = { kind: "build", buildingId: building.id };
      }
      const stoneOwed = additions.length * RULES.blockCost;
      log(
        world,
        candidate.civ,
        "build",
        `哨站在原址擴建為「${candidate.design.name}」工地；保留 ${reused.length} 個方塊，尚需 ${stoneOwed} 石材。`,
        candidate.action.at,
      );
      result(
        world,
        candidate.civ,
        candidate.actionIndex,
        "build",
        "accepted",
        "post_upgrade_started",
        `哨站已成為未完成倉庫工地；保留 ${reused.length} 個方塊，尚需 ${stoneOwed} 石材。`,
        candidate.action,
        reused.length,
      );
      continue;
    }
    const building: Building = {
      id: `${candidate.civ}-b${world.nextBuilding[candidate.civ]++}`,
      owner: candidate.civ,
      designId: candidate.design.id,
      fn: candidate.design.fn,
      origin: { ...candidate.action.at },
      cells: candidate.cells,
      access: accessCells(world, candidate.cells),
      total: candidate.cells.length,
      blocks: Array.from({ length: candidate.cells.length }, () => 0),
      placed: 0,
      removed: 0,
      delivered: 0,
      stock: { food: 0, stone: 0 },
      createdTurn: world.turn,
    };
    world.buildings[building.id] = building;
    for (const workerId of candidate.action.workers) {
      const worker = world.workers[workerId];
      if (!worker?.alive || worker.owner !== candidate.civ) continue;
      worker.job = { kind: "build", buildingId: building.id };
    }
    log(
      world,
      candidate.civ,
      "build",
      `「${candidate.design.name}」動工。石材必須由工人一趟趟搬到工地。`,
      candidate.action.at,
    );
    result(world, candidate.civ, candidate.actionIndex, "build", "accepted", "worksite_created", "建造工作已開始。", candidate.action);
  }
}

function placementErrors(
  world: World,
  civId: CivId,
  cells: Point[],
  options: { ignoreBuildingId?: string; requireAnchor?: boolean; workerIds?: string[] } = {},
) {
  const errors: string[] = [];
  if (cells.some((cell) => !inBounds(cell.x, cell.z))) return ["這片地超出了我們所知的世界。"];
  if (cells.some((cell) => world.tiles[idx(cell.x, cell.z)].terrain === "water")) errors.push("地基壓在水上。");
  if (cells.some((cell) => world.tiles[idx(cell.x, cell.z)].terrain === "ridge")) errors.push("地基壓在山脊上。");
  if (cells.some((cell) => world.tiles[idx(cell.x, cell.z)].terrain === "oasis")) errors.push("地基壓在綠洲上；綠洲地面不能承托建築。");

  const taken = Object.values(world.buildings)
    .filter((building) => building.id !== options.ignoreBuildingId)
    .flatMap((building) => building.cells);
  if (overlap(cells, taken)) errors.push("這片地已有建築或工地。");

  if ((world.protocolVersion ?? 3) >= 14) {
    if (!cells.some((cell) => world.civs[civId].knowledge[idx(cell.x, cell.z)] === 2)) {
      errors.push("工地沒有任何目前看得見的設計格。");
    }
    const access = accessCells(world, cells);
    const blocked = blockedCells(world, civId);
    const workers = (options.workerIds ?? [])
      .map((workerId) => world.workers[workerId])
      .filter((worker): worker is Worker => Boolean(worker?.alive && worker.owner === civId));
    if (!workers.some((worker) => findPath(world, blocked, worker.at, access).length > 0)) {
      errors.push("指定工人找不到通往工地旁空地的路。");
    }
    return errors;
  }

  const anchors = Object.values(world.buildings)
    .filter(
      (building) =>
        building.owner === civId &&
        building.completedTurn !== undefined &&
        standing(building) > 0 &&
        ((world.protocolVersion ?? 3) < 13 || building.fn !== "post"),
    )
    .flatMap((building) => building.cells);
  const reachable = cells.some((cell) =>
    anchors.some((anchor) => Math.hypot(cell.x - anchor.x, cell.z - anchor.z) <= RULES.buildRadius),
  );
  if (options.requireAnchor !== false && !reachable) {
    errors.push(`這片地距離我們的聚居地或倉庫超過 ${RULES.buildRadius} 格。`);
  }
  return errors;
}

function overlap(left: Point[], right: Point[]) {
  const set = new Set(right.map((cell) => `${cell.x},${cell.z}`));
  return left.some((cell) => set.has(`${cell.x},${cell.z}`));
}

/**
 * A building's standing spots are a snapshot taken when it is placed, so a neighbour built
 * later can bury them. Recompute them whenever block occupancy has changed, or a store keeps
 * offering standing room that is now solid ground — which is how two arrivals were sealed
 * inside the northern hall in v12.
 */
export function refreshAccess(world: World) {
  for (const building of Object.values(world.buildings)) {
    building.access = accessCells(world, building.cells);
  }
}

/**
 * Protocol 10 (v23) makes population a clock rather than a reward. Up to protocol 9 a person
 * only joined when stores already held `migrationFoodCost + population × reserve`, which made
 * growth something a civilization bought with surplus — and, worse, something it could decline
 * by holding food in backpacks instead of stores. v14 and v21 both did exactly that and starved
 * anyway. From protocol 10 a person joins whenever there is a worker place and open ground, at
 * no cost: births come first and hunger follows, which is the pressure the season is testing.
 */
function migrationIsUnconditional(world: World) {
  const protocol = world.protocolVersion ?? 3;
  return protocol >= 10 && protocol < 16;
}

function naturalMigration(world: World) {
  if ((world.protocolVersion ?? 3) < 4 || world.turn % RULES.migrationInterval !== 0) return;
  const unconditional = migrationIsUnconditional(world);
  for (const civId of CIVS) {
    const population = livingWorkers(world, civId);
    const living = population.length;
    const capacity = workerSlots(world, civId);
    if (living <= 0) continue;
    if ((world.protocolVersion ?? 3) >= 15 && living > capacity) {
      const leaving = population[population.length - 1];
      leaving.alive = false;
      if (carried(leaving) > 0) {
        const id = `pile-${world.nextPile++}`;
        world.piles[id] = {
          id,
          at: { ...leaving.at },
          stock: { ...leaving.carrying },
          turn: world.turn,
        };
        leaving.carrying = { food: 0, stone: 0 };
      }
      log(
        world,
        civId,
        "departure",
        `已完成建築只能容納 ${capacity} 人；一名超出容量的居民離開，隨身物資留在原地。`,
        leaving.at,
      );
      continue;
    }
    if (living >= capacity) continue;
    if (
      (world.protocolVersion ?? 3) >= 11 &&
      (world.civs[civId].fullyFedTurns ?? RULES.famineRecoveryTurns) < RULES.famineRecoveryTurns
    ) {
      continue;
    }
    if (!unconditional) {
      const populationAfterJoining = living + 1;
      const foodRequired =
        RULES.migrationFoodCost + populationAfterJoining * RULES.migrationReserveTurns * RULES.upkeep;
      if (totalStock(world, civId).food < foodRequired) continue;
    }
    const home = stores(world, civId)[0];
    if (!home) continue;
    // Find the standing spot before spending anything: an arrival must never be placed on
    // solid ground, and never charged for a place that does not exist.
    const arrival = arrivalSpot(world, civId);
    if (!arrival) {
      log(
        world,
        civId,
        "migration",
        "聚居地四周沒有可以落腳的空地，沒有人加入。",
        home.origin,
      );
      continue;
    }
    if (!unconditional && !spend(world, civId, "food", RULES.migrationFoodCost)) continue;
    const id = `${civId}-w${world.nextWorker[civId]++}`;
    world.workers[id] = {
      id,
      owner: civId,
      at: { ...arrival },
      carrying: { food: 0, stone: 0 },
      job: { kind: "idle" },
      alive: true,
    };
    log(
      world,
      civId,
      "migration",
      unconditional
        ? "聚居地有空位，一名孩子長大成人加入勞動；他每回合開始要吃 1 糧食。"
        : `聚居地有足夠空間與糧食，一名成年人加入；使用了 ${RULES.migrationFoodCost} 糧食。`,
      home.origin,
    );
  }
}

/** Open ground beside any of a civilization's stores, checked against the world as it stands now. */
function arrivalSpot(world: World, civId: CivId) {
  const blocked = blockedCells(world, civId);
  const candidates = new Map<string, Point>();
  for (const store of stores(world, civId)) {
    for (const cell of store.access) candidates.set(`${cell.x},${cell.z}`, cell);
  }
  return orderedForCiv(world, civId, [...candidates.values()]).find((cell) =>
    passable(world, blocked, cell.x, cell.z),
  );
}

/* -------------------------------------------------------------- movement */

function moveWorkers(world: World) {
  const protocol = world.protocolVersion ?? 3;
  const workers = protocol >= 17
    ? seededWorkers(world, sortedWorkers(world), "movement")
    : sortedWorkers(world);
  for (const worker of workers) {
    const blocked = blockedCells(world, worker.owner);
    const originalJob = worker.job;
    const directTarget =
      originalJob.kind === "move"
        ? originalJob.to
        : originalJob.kind === "gather"
          ? originalJob.at
          : undefined;
    const blockingStructure = directTarget
      ? standingBuildingAt(world, directTarget.x, directTarget.z)
      : undefined;
    if (
      (world.protocolVersion ?? 3) >= 14 &&
      blockingStructure &&
      knowsBuilding(world, worker.owner, blockingStructure.id)
    ) {
      const relation = blockingStructure.owner === worker.owner ? "我們的建築" : "已看見的建築";
      failJob(
        world,
        worker,
        "blocked_by_structure",
        `${worker.id} 無法進入或在 (${directTarget!.x},${directTarget!.z}) 工作：${relation}完整佔用了該地格。`,
        blockingStructure.id,
      );
      continue;
    }
    if (directTarget && foreignWorkerOccupies(world, worker.owner, directTarget)) {
      failJob(world, worker, "blocked_by_person", `${worker.id} 無法前進：該地格已有人站立。`);
      continue;
    }
    const goals = goalsFor(world, worker);
    if (goals.length === 0) {
      if (
        carried(worker) > 0 &&
        stores(world, worker.owner).length > 0 &&
        stores(world, worker.owner).every((store) => storageFree(world, store) <= 0)
      ) {
        failJob(
          world,
          worker,
          "storage_full",
          `${worker.id} 無法卸下物資：所有存放處都已滿，背包內的物資仍由工人攜帶。`,
        );
        continue;
      }
      if (originalJob.kind !== "idle" && worker.job.kind !== "idle") {
        failJob(world, worker, "job_has_no_target", `${worker.id} 的工作無法繼續：目的已不存在或沒有可用位置。`);
      } else if (originalJob.kind !== "idle" && worker.job.kind === "idle") {
        log(world, worker.owner, "failure", `${worker.id} 的工作已停止：目標已不存在。`, worker.at);
      }
      continue;
    }
    if (protocol >= 17 && goals.every((goal) => foreignWorkerOccupies(world, worker.owner, goal))) {
      failJob(world, worker, "blocked_by_person", `${worker.id} 無法前進：該地格已有人站立。`);
      continue;
    }
    const path = findPath(world, blocked, worker.at, goals);
    if (path.length === 0) {
      failJob(world, worker, "unreachable", `${worker.id} 無法繼續工作：找不到通路。`);
      continue;
    }
    const steps = Math.min(RULES.workerMove, path.length - 1);
    if (steps > 0) worker.at = { ...path[steps] };
    if (worker.job.kind === "move" && same(worker.at, worker.job.to)) worker.job = { kind: "idle" };
  }
}

function foreignWorkerOccupies(world: World, civId: CivId, point: Point) {
  if ((world.protocolVersion ?? 3) < 17) return false;
  return Object.values(world.workers).some(
    (worker) => worker.alive && worker.owner !== civId && same(worker.at, point),
  );
}

function goalsFor(world: World, worker: Worker): Point[] {
  const job = worker.job;
  if (job.kind === "idle") return [];
  if (job.kind === "move") return [job.to];

  const load = carried(worker);
  if (job.kind === "deposit") {
    if (load <= 0) {
      worker.job = { kind: "idle" };
      return [worker.at];
    }
    return depositGoals(world, worker);
  }
  if (job.kind === "gather") {
    if (load >= RULES.carry) return depositGoals(world, worker);
    const node = world.tiles[idx(job.at.x, job.at.z)]?.node;
    if (!node || node.amount <= 0) return load > 0 ? depositGoals(world, worker) : [];
    if ((world.protocolVersion ?? 3) < 18 && load > 0 && worker.carrying[node.kind] === 0) {
      return depositGoals(world, worker);
    }
    return [job.at];
  }

  const building = world.buildings[job.buildingId];
  if (!building) {
    worker.job = { kind: "idle" };
    return [];
  }

  if (job.kind === "remove") {
    if (standing(building) === 0) {
      worker.job = { kind: "idle" };
      return load > 0 ? depositGoals(world, worker) : [];
    }
    // Keep working until the load is full — a raider does not walk home per block.
    if (load >= RULES.carry) return depositGoals(world, worker);
    return building.access;
  }

  const needed = stoneNeeded(building, job.kind === "repair");
  // Food picked up on an earlier job has to be dropped off before stone can be carried.
  if (worker.carrying.food > 0) return depositGoals(world, worker);
  if (worker.carrying.stone > 0) return building.access;
  const outstanding =
    (world.protocolVersion ?? 3) >= 21
      ? Math.max(0, needed - inTransit(world, building.id))
      : needed;
  if (outstanding > 0) {
    const goals = withdrawGoals(
      world,
      worker,
      (world.protocolVersion ?? 3) >= 21 ? Math.min(RULES.carry, outstanding) : undefined,
    );
    return goals.length > 0 ? goals : [worker.at];
  }
  if (needed > 0) return [worker.at];
  if (job.kind === "build" && standing(building) >= building.total) {
    worker.job = { kind: "idle" };
    return [worker.at];
  }
  return building.access;
}

/**
 * A store with one free space must not shadow an empty store further away.
 *
 * v15 lost eight turns to exactly that: north's nearest store sat at 90/100, `upkeep` drained
 * that same store first every turn and freed precisely the upkeep amount, and every carrier
 * walked to it, deposited that much and kept the rest. Net stored food was pinned to zero change
 * while the hall held 86 unused spaces and 29–45 food sat stranded in backpacks. Prefer stores
 * that can take the whole load; fall back to any open store so partial deposits still work when
 * the settlement is genuinely near capacity.
 */
function depositGoals(world: World, worker: Worker) {
  const open = stores(world, worker.owner).filter((store) => storageFree(world, store) > 0);
  const load = carried(worker);
  const reachable =
    (world.protocolVersion ?? 3) >= 21
      ? open.filter(
          (store) => findPath(world, blockedCells(world, worker.owner), worker.at, store.access).length > 0,
        )
      : open;
  const roomy = reachable.filter((store) => storageFree(world, store) >= load);
  return storeAccessGoals(roomy.length > 0 ? roomy : reachable);
}

function withdrawGoals(world: World, worker: Worker, requested?: number) {
  const stocked = stores(world, worker.owner).filter(
    (store) =>
      store.stock.stone > 0 &&
      (requested === undefined ||
        findPath(world, blockedCells(world, worker.owner), worker.at, store.access).length > 0),
  );
  const sufficient = requested === undefined ? [] : stocked.filter((store) => store.stock.stone >= requested);
  return storeAccessGoals(sufficient.length > 0 ? sufficient : stocked);
}

function storeAccessGoals(options: Building[]) {
  const goals = new Map<string, Point>();
  for (const store of options) {
    for (const cell of store.access) goals.set(`${cell.x},${cell.z}`, cell);
  }
  return [...goals.values()];
}

/** Deposits, withdrawals and picking up spilled goods all happen on arrival. */
function handleCarrying(world: World) {
  const workers = sortedWorkers(world);
  for (const worker of workers) {
    const job = worker.job;

    if (job.kind === "build" || job.kind === "repair") {
      const building = world.buildings[job.buildingId];
      if (!building) continue;
      if (worker.carrying.stone > 0 && adjacent(world, worker.at, building.access)) {
        const delivered = worker.carrying.stone;
        building.delivered += worker.carrying.stone;
        worker.carrying.stone = 0;
        jobResult(world, worker, "material_delivered", `${worker.id} 把 ${delivered} 石材送到工地。`, delivered, worker.at);
        continue;
      }
      if (worker.carrying.food > 0) {
        const deposited = depositIntoAdjacentStores(world, worker, "food");
        if (deposited > 0) {
        jobResult(world, worker, "deposited", `${worker.id} 存入 ${deposited} 糧食。`, deposited, worker.at);
        }
      }
      if (worker.carrying.food === 0 && worker.carrying.stone === 0) {
        const outstanding = stoneNeeded(building, job.kind === "repair") - inTransit(world, building.id);
        let left = Math.min(Math.max(0, outstanding), RULES.carry);
        let taken = 0;
        for (const store of adjacentStores(world, worker).filter((candidate) => candidate.stock.stone > 0)) {
          const amount = Math.min(left, store.stock.stone);
          store.stock.stone -= amount;
          worker.carrying.stone += amount;
          taken += amount;
          left -= amount;
          if (left <= 0) break;
        }
        if (taken > 0) {
          jobResult(world, worker, "material_withdrawn", `${worker.id} 取出 ${taken} 石材。`, taken, worker.at);
        }
      }
    }
  }

  for (const pile of Object.values(world.piles).sort((a, b) => a.id.localeCompare(b.id))) {
    if ((world.protocolVersion ?? 3) >= 21 && pile.droppedBy) {
      const dropper = world.workers[pile.droppedBy];
      if (!dropper?.alive || !same(dropper.at, pile.at)) pile.droppedBy = undefined;
    }
    const candidates = workers.filter(
      (worker) =>
        worker.job.kind !== "build" &&
        worker.job.kind !== "repair" &&
        same(worker.at, pile.at) &&
        carried(worker) < RULES.carry &&
        // The dropper is excluded while the pile remembers it, preventing an immediate automatic
        // pickup. Protocol 21 clears that memory after the dropper leaves the cell.
        pile.droppedBy !== worker.id,
    );
    for (const kind of ["food", "stone"] as const) {
      if (pile.stock[kind] <= 0) continue;
      const wants = candidates.map((worker) => ({ id: worker.id, want: RULES.carry - carried(worker) }));
      const allocations = fairAllocate(world, wants, pile.stock[kind], `pile:${pile.id}:${kind}`);
      for (const worker of candidates) {
        const amount = allocations.get(worker.id) ?? 0;
        if (amount <= 0) continue;
        pile.stock[kind] -= amount;
        worker.carrying[kind] += amount;
        jobResult(world, worker, "pile_collected", `${worker.id} 從地上拾起 ${amount} ${kind === "food" ? "糧食" : "石材"}。`, amount, pile.at);
      }
    }
    if (pile.stock.food + pile.stock.stone <= 0) delete world.piles[pile.id];
  }

  for (const worker of workers) {
    if (worker.job.kind === "build" || worker.job.kind === "repair") continue;
    if (carried(worker) > 0) {
      const depositedFood = depositIntoAdjacentStores(world, worker, "food");
      const depositedStone = depositIntoAdjacentStores(world, worker, "stone");
      const deposited = depositedFood + depositedStone;
      if (deposited <= 0) continue;
      jobResult(world, worker, "deposited", `${worker.id} 存入 ${deposited} 份物資。`, deposited, worker.at);
      if (worker.job.kind === "deposit" && carried(worker) === 0) worker.job = { kind: "idle" };
    }
  }
}

function gather(world: World) {
  const groups = new Map<string, { tileIndex: number; workers: Worker[] }>();
  for (const worker of sortedWorkers(world)) {
    if (worker.job.kind !== "gather" || !same(worker.at, worker.job.at)) continue;
    const tileIndex = idx(worker.at.x, worker.at.z);
    const pool = resourcePoolAt(world, tileIndex);
    const key = pool?.id ?? `tile:${tileIndex}`;
    const group = groups.get(key) ?? { tileIndex, workers: [] };
    group.workers.push(worker);
    groups.set(key, group);
  }

  for (const [sourceId, { tileIndex, workers }] of groups) {
    const node = world.tiles[tileIndex].node;
    const pool = resourcePoolAt(world, tileIndex);
    const available = pool?.amount ?? node?.amount ?? 0;
    if (!node || available <= 0) continue;
    const x = tileIndex % world.width;
    const z = Math.floor(tileIndex / world.width);
    if (activeBlockAt(world, x, z)) {
      for (const worker of workers) failJob(world, worker, "resource_covered", `${worker.id} 無法採集：資源位置被方塊覆蓋。`);
      continue;
    }
    const yields = node.kind === "food" ? RULES.gatherFood : RULES.gatherStone;
    const wants = workers.map((worker) => ({
      id: worker.id,
      want:
        (world.protocolVersion ?? 3) < 18 && carried(worker) > 0 && worker.carrying[node.kind] === 0
          ? 0
          : Math.min(yields, RULES.carry - carried(worker)),
    }));
    const allocations = fairAllocate(world, wants, available, `node:${sourceId}`);
    for (const worker of workers) {
      const amount = allocations.get(worker.id) ?? 0;
      if (amount <= 0) continue;
      if (pool) pool.amount -= amount;
      else node.amount -= amount;
      worker.carrying[node.kind] += amount;
      jobResult(world, worker, "gathered", `${worker.id} 採集了 ${amount} ${node.kind === "food" ? "糧食" : "石材"}。`, amount, worker.at);
    }
    if (pool === world.oasis) syncOasisTiles(world);
    if (pool === world.sharedStone) syncSharedStoneTiles(world);
  }
}

/* ---------------------------------------------------- build / repair / remove */

function construct(world: World) {
  for (const building of sortedBuildings(world)) {
    if (standing(building) >= building.total) continue;
    const builders = sortedWorkers(world).filter(
      (worker) =>
        worker.job.kind === "build" &&
        worker.job.buildingId === building.id &&
        adjacent(world, worker.at, building.access),
    );
    let laid = 0;
    for (let index = 0; index < builders.length; index += 1) {
      for (let step = 0; step < RULES.buildRate; step += 1) {
        if (standing(building) >= building.total || building.delivered < RULES.blockCost) break;
        const blockIndex = building.blocks.findIndex((present, candidate) => present === 0 && candidate >= building.placed);
        const nextIndex = blockIndex >= 0 ? blockIndex : building.blocks.findIndex((present) => present === 0);
        if (nextIndex < 0) break;
        const cell = building.cells[nextIndex];
        if (Object.values(world.workers).some((worker) => worker.alive && same(worker.at, cell))) {
          jobResult(
            world,
            builders[index],
            "block_waiting_for_clear_ground",
            `(${cell.x}, ${cell.z}) 有工人站立，這個方塊本回合沒有放下。`,
            0,
            cell,
          );
          break;
        }
        building.delivered -= RULES.blockCost;
        building.blocks[nextIndex] = 1;
        building.placed = Math.max(building.placed, nextIndex + 1);
        building.removed = building.blocks.slice(0, building.placed).filter((present) => present === 0).length;
        world.tally[building.owner].blocksLaid += 1;
        laid += 1;
      }
    }
    if (laid > 0 && builders[0]) {
      jobResult(world, builders[0], "blocks_built", `工地增加了 ${laid} 個方塊。`, laid, building.origin, building.id);
    }
    if (standing(building) >= building.total && building.completedTurn === undefined) {
      building.completedTurn = world.turn;
      for (const worker of builders) worker.job = { kind: "idle" };
      const name = world.civs[building.owner].designs[building.designId]?.name ?? building.id;
      log(world, building.owner, "complete", `「${name}」落成。`, building.origin);
    }
  }
}

function resolveStructureWork(world: World) {
  for (const building of sortedBuildings(world)) {
    const foreign = Object.values(world.workers).filter(
      (worker) =>
        worker.alive &&
        worker.owner !== building.owner &&
        worker.job.kind === "remove" &&
        worker.job.buildingId === building.id &&
        adjacent(world, worker.at, building.access),
    );
    const menders = adjacentWorkers(world, building, "repair", building.owner);

    for (const worker of foreign) {
      const job = worker.job as Extract<Worker["job"], { kind: "remove" }>;
      if (job.adjacentSince === undefined) {
        job.adjacentSince = world.turn;
        log(
          world,
          building.owner,
          "removal",
          `有不屬於我們的工人在拆解「${designName(world, building)}」的外圍。`,
          building.origin,
        );
      }
    }

    const ready = seededWorkers(world, foreign, `remove:${building.id}`).filter((worker) => {
      const job = worker.job as Extract<Worker["job"], { kind: "remove" }>;
      return world.turn - (job.adjacentSince ?? world.turn) >= RULES.prepareTurns;
    });

    const own = adjacentWorkers(world, building, "remove", building.owner);
    const cancelled = Math.min(menders.length, ready.length);
    const activeForeign = ready.slice(cancelled);
    const activeMenders = menders.slice(cancelled);

    let restored = 0;
    for (const worker of activeMenders) {
      for (let step = 0; step < RULES.repairRate; step += 1) {
        if (building.delivered < RULES.blockCost) break;
        const repairable = repairableIndexes(building);
        const index = repairable[0];
        if (index === undefined) break;
        const cell = building.cells[index];
        if (Object.values(world.workers).some((candidate) => candidate.alive && same(candidate.at, cell))) break;
        building.delivered -= RULES.blockCost;
        building.blocks[index] = 1;
        building.removed = Math.max(0, building.removed - 1);
        restored += 1;
      }
    }
    if (restored > 0) {
      log(world, building.owner, "repair", `修補了 ${restored} 個方塊。`, building.origin);
      if (activeMenders[0]) jobResult(world, activeMenders[0], "blocks_repaired", `修補了 ${restored} 個方塊。`, restored, building.origin, building.id);
    }

    const crews: Array<{ worker: Worker; rate: number }> = [];
    for (const worker of activeForeign) crews.push({ worker, rate: RULES.removeForeign });
    for (const worker of own) {
      crews.push({
        worker,
        rate: (world.protocolVersion ?? 3) === 15 ? RULES.protocol15RemoveOwn : RULES.removeOwn,
      });
    }
    if (crews.length === 0) continue;

    let taken = 0;
    for (const { worker, rate } of crews) {
      for (let step = 0; step < rate; step += 1) {
        if (standing(building) === 0) break;
        if (carried(worker) + RULES.salvage > RULES.carry) break;
        const exposed = exposedIndexesFor(building);
        const index = exposed[0];
        if (index === undefined) break;
        building.blocks[index] = 0;
        building.removed += 1;
        worker.carrying.stone += RULES.salvage;
        taken += 1;
        if (worker.owner !== building.owner) {
          world.tally[worker.owner].blocksTakenFromOthers += 1;
          world.tally[building.owner].blocksLost += 1;
        }
      }
    }
    if (taken > 0) {
      const raider = crews.find(({ worker }) => worker.owner !== building.owner);
      log(
        world,
        raider ? raider.worker.owner : building.owner,
        "removal",
        raider
          ? `從「${designName(world, building)}」取走 ${taken} 個方塊的石材。`
          : `拆解自己的「${designName(world, building)}」，回收 ${taken * RULES.salvage} 石材。`,
        building.origin,
      );
      const worker = crews[0]?.worker;
      if (worker) jobResult(world, worker, "blocks_removed", `移走了 ${taken} 個暴露方塊。`, taken, building.origin, building.id);
    }
    if (standing(building) === 0) collapse(world, building);
  }
}

function collapse(world: World, building: Building) {
  const looseStone = building.stock.stone + building.delivered;
  if (building.stock.food + looseStone > 0) {
    const id = `pile-${world.nextPile++}`;
    world.piles[id] = {
      id,
      at: { ...building.cells[0] },
      stock: { food: building.stock.food, stone: looseStone },
      turn: world.turn,
    };
    log(
      world,
      building.owner,
      "spill",
      `「${designName(world, building)}」倒下，${building.stock.food} 糧食與 ${looseStone} 石材散落一地，任何人都可以拾走。`,
      building.cells[0],
    );
    building.stock = { food: 0, stone: 0 };
    building.delivered = 0;
  } else {
    log(world, building.owner, "removal", `「${designName(world, building)}」已被完全拆走。`, building.origin);
  }
  for (const worker of Object.values(world.workers)) {
    const job = worker.job;
    if ((job.kind === "build" || job.kind === "repair" || job.kind === "remove") && job.buildingId === building.id) {
      worker.job = { kind: "idle" };
    }
  }
  delete world.buildings[building.id];
}

/* ---------------------------------------------------------------- vision */

function refreshVision(world: World) {
  for (const civId of CIVS) {
    const civ = world.civs[civId];
    for (let index = 0; index < civ.knowledge.length; index += 1) {
      if (civ.knowledge[index] === 2) civ.knowledge[index] = 1;
    }

    const eyes: Array<{ at: Point; range: number }> = [];
    for (const worker of livingWorkers(world, civId)) {
      eyes.push({ at: worker.at, range: workerSight(world.protocolVersion ?? 3) });
    }
    for (const building of Object.values(world.buildings)) {
      if (
        building.owner !== civId ||
        building.completedTurn === undefined ||
        standing(building) === 0
      ) {
        continue;
      }
      for (const at of buildingVisionPoints(building)) eyes.push({ at, range: SIGHT[building.fn] });
    }

    for (const eye of eyes) {
      for (let z = eye.at.z - eye.range; z <= eye.at.z + eye.range; z += 1) {
        for (let x = eye.at.x - eye.range; x <= eye.at.x + eye.range; x += 1) {
          if (!inBounds(x, z) || Math.hypot(x - eye.at.x, z - eye.at.z) > eye.range) continue;
          const index = idx(x, z);
          civ.knowledge[index] = 2;
          civ.lastSeen[index] = world.turn;
        }
      }
    }
    for (let index = 0; index < civ.knowledge.length; index += 1) {
      if (civ.knowledge[index] === 2) civ.memory[index] = observeTile(world, index);
    }
    assignForeignAliases(world, civId);
    detectContact(world, civId);
  }
}

function assignForeignAliases(world: World, civId: CivId) {
  const civ = world.civs[civId];
  const other: CivId = civId === "north" ? "south" : "north";
  const newWorkers = livingWorkers(world, other)
    .filter(
      (worker) =>
        civ.knowledge[idx(worker.at.x, worker.at.z)] === 2 && civ.foreignSeen.workers[worker.id] === undefined,
    )
    .sort((a, b) => a.at.z - b.at.z || a.at.x - b.at.x || a.id.localeCompare(b.id));
  for (const worker of newWorkers) {
    civ.foreignSeen.workers[worker.id] = civ.foreignSeen.nextWorker;
    civ.foreignSeen.nextWorker += 1;
  }
  const newBuildings = Object.values(world.buildings)
    .filter(
      (building) =>
        building.owner === other &&
        civ.foreignSeen.buildings[building.id] === undefined &&
        building.cells.some((cell, index) => building.blocks[index] === 1 && civ.knowledge[idx(cell.x, cell.z)] === 2),
    )
    .sort((a, b) => a.cells[0].z - b.cells[0].z || a.cells[0].x - b.cells[0].x || a.id.localeCompare(b.id));
  for (const building of newBuildings) {
    civ.foreignSeen.buildings[building.id] = civ.foreignSeen.nextBuilding;
    civ.foreignSeen.nextBuilding += 1;
  }
}

function detectContact(world: World, civId: CivId) {
  const civ = world.civs[civId];
  const other: CivId = civId === "north" ? "south" : "north";
  const sees =
    Object.values(world.workers).some(
      (worker) => worker.alive && worker.owner === other && civ.knowledge[idx(worker.at.x, worker.at.z)] === 2,
    ) ||
    Object.values(world.buildings).some(
      (building) =>
        building.owner === other &&
        building.cells.some((cell, index) => building.blocks[index] === 1 && civ.knowledge[idx(cell.x, cell.z)] === 2),
    );
  if (!sees) return;
  if (civ.contacts[other]) {
    civ.contacts[other]!.lastSeenTurn = world.turn;
    return;
  }
  civ.contacts[other] = { firstTurn: world.turn, lastSeenTurn: world.turn };
  log(world, civId, "contact", "斥候在遠處看見一些人，他們不是我們的人。");
}

/* --------------------------------------------------------------- helpers */

export function standing(building: Building) {
  return building.blocks.reduce((sum, present) => sum + (present === 1 ? 1 : 0), 0);
}

export function designName(world: World, building: Building) {
  return world.civs[building.owner].designs[building.designId]?.name ?? building.id;
}

export function stores(world: World, civId: CivId) {
  return Object.values(world.buildings)
    .filter(
      (building) =>
        building.owner === civId &&
        (building.fn === "hall" || building.fn === "store") &&
        building.completedTurn !== undefined &&
        standing(building) > 0,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function totalStock(world: World, civId: CivId): Stock {
  return stores(world, civId).reduce(
    (sum, store) => ({ food: sum.food + store.stock.food, stone: sum.stone + store.stock.stone }),
    { food: 0, stone: 0 },
  );
}

export function storageCapacity(world: World, building: Building) {
  if ((world.protocolVersion ?? 3) < 4) return Number.POSITIVE_INFINITY;
  if (building.completedTurn === undefined || standing(building) <= 0) return 0;
  if (building.fn === "hall") return RULES.hallStorageCapacity;
  if (building.fn === "store") return storeBlocksInUse(world, building) * RULES.storeStoragePerBlock;
  return 0;
}

/**
 * Protocol 10 (v23) charges a store's capacity to the blocks actually standing, not to the
 * design's cell count. Up to protocol 9 both capacity and worker places read `building.total`,
 * so a civilization could dismantle a finished store down to a single block, recover 2 stone
 * per block, drop under the structure-upkeep threshold, and lose nothing at all. v22 north did
 * exactly that at Turn 88: two blocks off a 10-cell store took standing 40 → 38, upkeep 1/turn
 * → 0, and left capacity 350 and 15 worker places untouched. That vented the entire stone
 * pressure the season was built to apply.
 */
function storeBlocksInUse(world: World, building: Building) {
  return (world.protocolVersion ?? 3) >= 10 ? standing(building) : building.total;
}

export function storageUsed(building: Building) {
  return building.stock.food + building.stock.stone;
}

export function storageFree(world: World, building: Building) {
  return Math.max(0, storageCapacity(world, building) - storageUsed(building));
}

export function totalStorageCapacity(world: World, civId: CivId) {
  if ((world.protocolVersion ?? 3) < 4) return 0;
  return stores(world, civId).reduce((sum, store) => sum + storageCapacity(world, store), 0);
}

export function livingWorkers(world: World, civId: CivId) {
  return Object.values(world.workers)
    .filter((worker) => worker.alive && worker.owner === civId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Protocol 10 (v23) decouples how many people a civilization has from how much it has built.
 *
 * Up to protocol 9 every worker place came from a store, which was harmless while growth was
 * gated on surplus food. Paired with unconditional births it becomes a trap: population always
 * fills the places, so each completed store instantly adds mouths and adds no food, and
 * expanding is strictly self-harm. The v23 scan measured it — the strategy that built forward
 * stores died before the one that never moved, at every home larder from 24 to 200.
 *
 * From protocol 10 the ceiling is a fixed natural one. Stores are for storage, and the only
 * question a settlement faces is whether it can feed the people it is going to have anyway.
 */
export function workerSlots(world: World, civId: CivId) {
  const completedStores = Object.values(world.buildings).filter(
    (building) =>
      building.owner === civId &&
      building.fn === "store" &&
      building.completedTurn !== undefined &&
      standing(building) > 0,
  );
  if ((world.protocolVersion ?? 3) < 4) return 6 + completedStores.length * 2;
  if ((world.protocolVersion ?? 3) >= 15) {
    const completedBlocks = Object.values(world.buildings)
      .filter(
        (building) =>
          building.owner === civId &&
          building.completedTurn !== undefined &&
          standing(building) > 0,
      )
      .reduce((sum, building) => sum + standing(building), 0);
    return Math.floor(completedBlocks / 3);
  }
  if ((world.protocolVersion ?? 3) >= 10) return RULES.naturalCeiling;
  return (
    RULES.slotsAtStart +
    completedStores.reduce(
      (sum, store) =>
        sum + Math.floor(storeBlocksInUse(world, store) / RULES.storeBlocksPerWorkerSlot),
      0,
    )
  );
}

export function quarryLeft(world: World, civId: CivId) {
  const centre = homeQuarryPoint(world.seed, civId);
  let left = 0;
  for (let dz = -4; dz <= 4; dz += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      if (!inBounds(centre.x + dx, centre.z + dz)) continue;
      const node = world.tiles[idx(centre.x + dx, centre.z + dz)].node;
      if (node?.kind === "stone") left += node.amount;
    }
  }
  return left;
}

export function exposedCount(building: Building) {
  return exposedIndexesFor(building).length;
}

function exposedIndexesFor(building: Building) {
  const removed = new Set<number>();
  building.blocks.forEach((present, index) => {
    if (present !== 1) removed.add(index);
  });
  return exposedIndexes(building.cells, removed);
}

function repairableIndexes(building: Building) {
  const present = new Set<string>();
  building.cells.forEach((cell, index) => {
    if (building.blocks[index] === 1) present.add(`${cell.x},${cell.z}`);
  });
  return building.cells
    .map((cell, index) => ({ cell, index }))
    .filter(
      ({ cell, index }) =>
        index < building.placed &&
        building.blocks[index] === 0 &&
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dz]) => present.has(`${cell.x + dx},${cell.z + dz}`)),
    )
    .map(({ index }) => index);
}

function stoneNeeded(building: Building, repairing: boolean) {
  const missing = repairing ? building.removed : building.total - standing(building);
  return Math.max(0, missing * RULES.blockCost - building.delivered);
}

function inTransit(world: World, buildingId: string) {
  return Object.values(world.workers).reduce((sum, worker) => {
    const job = worker.job;
    if ((job.kind === "build" || job.kind === "repair") && job.buildingId === buildingId) {
      return sum + worker.carrying.stone;
    }
    return sum;
  }, 0);
}

export function worksiteStoneStatus(world: World, building: Building) {
  const missingBlocks = Math.max(0, building.total - standing(building));
  const carriedStone = inTransit(world, building.id);
  return {
    missingBlocks,
    unplacedBlocks: Math.max(0, building.total - building.placed),
    removedBlocks: Math.max(0, building.removed),
    deliveredStone: building.delivered,
    carriedStone,
    readyBlocks: Math.min(missingBlocks, Math.floor(building.delivered / RULES.blockCost)),
    stoneStillOwed: Math.max(0, missingBlocks * RULES.blockCost - building.delivered - carriedStone),
  };
}

function adjacentWorkers(world: World, building: Building, kind: "repair" | "remove", owner: CivId) {
  return sortedWorkers(world).filter(
    (worker) =>
      worker.alive &&
      worker.owner === owner &&
      worker.job.kind === kind &&
      worker.job.buildingId === building.id &&
      adjacent(world, worker.at, building.access),
  );
}

function adjacent(_world: World, at: Point, access: Point[]) {
  return access.some((cell) => same(cell, at));
}

function spend(world: World, civId: CivId, kind: keyof Stock, amount: number) {
  const options = stores(world, civId);
  const available = options.reduce((sum, store) => sum + store.stock[kind], 0);
  if (available < amount) return false;
  let owed = amount;
  for (const store of options) {
    const taken = Math.min(store.stock[kind], owed);
    store.stock[kind] -= taken;
    owed -= taken;
    if (owed <= 0) break;
  }
  return true;
}

function putIntoStore(world: World, store: Building, source: Stock, kind: keyof Stock) {
  const amount = Math.min(source[kind], storageFree(world, store));
  if (amount <= 0) return 0;
  source[kind] -= amount;
  store.stock[kind] += amount;
  return amount;
}

function adjacentStores(world: World, worker: Worker) {
  return stores(world, worker.owner).filter((store) => adjacent(world, worker.at, store.access));
}

function depositIntoAdjacentStores(world: World, worker: Worker, kind: keyof Stock) {
  let deposited = 0;
  for (const store of adjacentStores(world, worker).filter((candidate) => storageFree(world, candidate) > 0)) {
    deposited += putIntoStore(world, store, worker.carrying, kind);
    if (worker.carrying[kind] <= 0) break;
  }
  return deposited;
}

function carried(worker: Worker) {
  return worker.carrying.food + worker.carrying.stone;
}

function sortedWorkers(world: World) {
  return Object.values(world.workers)
    .filter((worker) => worker.alive)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function sortedBuildings(world: World) {
  return Object.values(world.buildings).sort((a, b) => a.id.localeCompare(b.id));
}

function same(left: Point, right: Point) {
  return left.x === right.x && left.z === right.z;
}

function orderedForCiv(world: World, civId: CivId, points: Point[]) {
  const local = (point: Point) =>
    civId === "north"
      ? point
      : { x: world.width - 1 - point.x, z: world.height - 1 - point.z };
  return [...points].sort((left, right) => {
    const a = local(left);
    const b = local(right);
    return a.z - b.z || a.x - b.x;
  });
}

function buildingVisionPoints(building: Building) {
  const xs = building.cells.map((cell) => cell.x);
  const zs = building.cells.map((cell) => cell.z);
  const centreX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centreZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  const candidates = new Map<string, Point>();
  for (const x of [Math.floor(centreX), Math.ceil(centreX)]) {
    for (const z of [Math.floor(centreZ), Math.ceil(centreZ)]) candidates.set(`${x},${z}`, { x, z });
  }
  return [...candidates.values()];
}

export function activeBlockAt(world: World, x: number, z: number) {
  return Object.values(world.buildings).some((building) =>
    building.cells.some((cell, index) => building.blocks[index] === 1 && cell.x === x && cell.z === z),
  );
}

function standingBuildingAt(world: World, x: number, z: number) {
  return Object.values(world.buildings).find((building) =>
    building.cells.some((cell, index) => building.blocks[index] === 1 && cell.x === x && cell.z === z),
  );
}

function syncOasisTiles(world: World) {
  if (!world.oasis) return;
  for (const cell of world.oasis.cells) {
    const node = world.tiles[idx(cell.x, cell.z)]?.node;
    if (!node) continue;
    node.amount = world.oasis.amount;
    node.cap = world.oasis.cap;
    node.regen = world.oasis.regen;
  }
}

function syncSharedStoneTiles(world: World) {
  if (!world.sharedStone) return;
  for (const cell of world.sharedStone.cells) {
    const node = world.tiles[idx(cell.x, cell.z)]?.node;
    if (!node) continue;
    node.amount = world.sharedStone.amount;
    node.cap = world.sharedStone.cap;
    node.regen = world.sharedStone.regen;
  }
}

function resourcePoolAt(world: World, tileIndex: number) {
  const x = tileIndex % world.width;
  const z = Math.floor(tileIndex / world.width);
  if (world.oasis?.cells.some((cell) => cell.x === x && cell.z === z)) return world.oasis;
  if (world.sharedStone?.cells.some((cell) => cell.x === x && cell.z === z)) return world.sharedStone;
  return undefined;
}

function observeTile(world: World, tileIndex: number) {
  const x = tileIndex % world.width;
  const z = Math.floor(tileIndex / world.width);
  const tile = world.tiles[tileIndex];
  const building = Object.values(world.buildings).find((candidate) =>
    candidate.cells.some((cell, index) => candidate.blocks[index] === 1 && cell.x === x && cell.z === z),
  );
  const piles = Object.values(world.piles).filter((candidate) => candidate.at.x === x && candidate.at.z === z);
  const pile = piles.reduce<Stock | undefined>(
    (sum, candidate) => ({
      food: (sum?.food ?? 0) + candidate.stock.food,
      stone: (sum?.stone ?? 0) + candidate.stock.stone,
    }),
    undefined,
  );
  return {
    turn: world.turn,
    terrain: tile.terrain,
    node: tile.node
      ? { kind: tile.node.kind, amount: tile.node.amount, cap: tile.node.cap, regen: tile.node.regen, pool: tile.node.pool }
      : undefined,
    building: building
      ? {
          id: building.id,
          owner: building.owner,
        }
      : undefined,
    pile,
  };
}

function knowsBuilding(world: World, civId: CivId, buildingId: string) {
  const building = world.buildings[buildingId];
  if (building?.owner === civId) return true;
  return world.civs[civId].memory.some((observation) => observation?.building?.id === buildingId);
}

function actionPoint(action: Action): Point | undefined {
  if (action.type === "build" || action.type === "gather") return action.at;
  if (action.type === "move") return action.to;
  return undefined;
}

function result(
  world: World,
  civ: CivId,
  actionIndex: number,
  actionType: ActionResult["actionType"],
  status: ActionResult["status"],
  code: string,
  text: string,
  action?: Action,
  amount?: number,
) {
  const targetId =
    action && (action.type === "remove" || action.type === "repair")
      ? action.buildingId
      : action?.type === "build"
        ? action.designId
        : undefined;
  world.actionResults.push({
    id: world.nextResult++,
    turn: world.turn,
    civ,
    actionIndex,
    actionType,
    status,
    code,
    text: engineSentence(world, text),
    at: action ? actionPoint(action) : undefined,
    workerIds: action && "workers" in action ? [...new Set(action.workers)] : undefined,
    targetId,
    amount,
  });
}

function jobResult(
  world: World,
  worker: Worker,
  code: string,
  text: string,
  amount = 0,
  at: Point = worker.at,
  targetId?: string,
  status: ActionResult["status"] = "completed",
) {
  const job = worker.job;
  const resolvedTargetId =
    targetId ??
    (job.kind === "build" || job.kind === "repair" || job.kind === "remove" ? job.buildingId : undefined);
  world.actionResults.push({
    id: world.nextResult++,
    turn: world.turn,
    civ: worker.owner,
    actionIndex: -1,
    actionType: "job",
    status,
    code,
    text: engineSentence(world, text),
    at: { ...at },
    workerIds: [worker.id],
    targetId: resolvedTargetId,
    amount,
  });
}

function failJob(world: World, worker: Worker, code: string, text: string, explicitTargetId?: string) {
  const targetId =
    explicitTargetId ??
    (worker.job.kind === "build" || worker.job.kind === "repair" || worker.job.kind === "remove"
      ? worker.job.buildingId
      : undefined);
  worker.job = { kind: "idle" };
  log(world, worker.owner, "failure", text, worker.at);
  jobResult(world, worker, code, text, 0, worker.at, targetId, "failed");
}

function seededOrder(world: World, ids: string[], salt: string) {
  return [...ids].sort((left, right) => {
    const leftHash = stableHash(`${world.seed}:${world.turn}:${salt}:${left}`);
    const rightHash = stableHash(`${world.seed}:${world.turn}:${salt}:${right}`);
    return leftHash - rightHash || left.localeCompare(right);
  });
}

function seededWorkers(world: World, workers: Worker[], salt: string) {
  const byId = new Map(workers.map((worker) => [worker.id, worker]));
  return seededOrder(world, workers.map((worker) => worker.id), salt).map((id) => byId.get(id)!);
}

function fairAllocate(
  world: World,
  requests: Array<{ id: string; want: number }>,
  available: number,
  salt: string,
) {
  const allocation = new Map(requests.map((request) => [request.id, 0]));
  const wants = new Map(requests.map((request) => [request.id, Math.max(0, Math.floor(request.want))]));
  const order = seededOrder(world, requests.map((request) => request.id), salt);
  let remaining = Math.max(0, Math.floor(available));
  let progressed = true;
  while (remaining > 0 && progressed) {
    progressed = false;
    for (const id of order) {
      const given = allocation.get(id) ?? 0;
      if (given >= (wants.get(id) ?? 0)) continue;
      allocation.set(id, given + 1);
      remaining -= 1;
      progressed = true;
      if (remaining <= 0) break;
    }
  }
  return allocation;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * The one place the engine's own language is decided.
 *
 * Through protocol 16 a world stores Traditional Chinese, which is what every archived season
 * holds and what its stored per-turn hashes were computed from — so those seasons must keep
 * getting Chinese from this function, forever. From protocol 17 the same sentence is stored in
 * English, so a model's prompt is one language throughout and the site translates for readers
 * instead of the engine translating for models.
 */
function engineSentence(world: World, text: string): string {
  return (world.protocolVersion ?? 3) >= 17 ? engineEnglish(text) : text;
}

function log(world: World, civ: CivId | undefined, kind: EventKind, text: string, at?: Point) {
  world.events.push({ id: world.nextEvent++, turn: world.turn, civ, kind, text: engineSentence(world, text), at });
}

export { CENTRE, HALL_ORIGIN, HOME_QUARRY, MIN_BLOCKS, SPAWN };
