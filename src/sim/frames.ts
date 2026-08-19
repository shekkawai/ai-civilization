import {
  CIVS,
  livingWorkers,
  quarryLeft,
  standing,
  storageFree,
  storageCapacity,
  stores,
  totalStorageCapacity,
  totalStock,
  workerSlots,
} from "./engine";
import { RULES } from "./config";
import { idx } from "./map";
import { blockedCells, findPath } from "./path";
import type { Building, CivFrame, CivId, Frame, World } from "./types";

/**
 * Chebyshev distance between the two sides' nearest living workers. Undefined when either side has
 * none, so a dead civilization reads as "no gap to measure" rather than a misleading zero.
 */
function nearestWorkerGap(world: World) {
  const north = livingWorkers(world, "north");
  const south = livingWorkers(world, "south");
  if (north.length === 0 || south.length === 0) return undefined;
  let best = Infinity;
  for (const one of north) {
    for (const other of south) {
      const distance = Math.max(Math.abs(one.at.x - other.at.x), Math.abs(one.at.z - other.at.z));
      if (distance < best) best = distance;
    }
  }
  return best;
}

export function captureFrame(world: World, events = eventsForTurn(world)): Frame {
  const civs = {} as Record<CivId, CivFrame>;
  const gap = nearestWorkerGap(world);
  const fog = {} as Record<CivId, Uint8Array>;
  const lastSeen = {} as Record<CivId, number[]>;
  const journal = {} as Record<CivId, string>;
  const observedNodes = {} as Frame["observedNodes"];
  const observedBlocks = {} as Frame["observedBlocks"];
  const observedBuildings = {} as Frame["observedBuildings"];
  const observedPiles = {} as Frame["observedPiles"];

  for (const civId of CIVS) {
    const stock = totalStock(world, civId);
    const workers = livingWorkers(world, civId);
    const buildings = Object.values(world.buildings).filter(
      (building) => building.owner === civId && standing(building) > 0,
    );
    civs[civId] = {
      food: Math.round(stock.food),
      stone: Math.round(stock.stone),
      workers: workers.length,
      buildings: buildings.length,
      carried: workers.reduce((sum, worker) => sum + worker.carrying.food + worker.carrying.stone, 0),
      blocksPlaced: buildings.reduce((sum, building) => sum + standing(building), 0),
      blocksTaken: world.tally[civId].blocksTakenFromOthers,
      quarryLeft: quarryLeft(world, civId),
      contact: Boolean(world.civs[civId].contacts[civId === "north" ? "south" : "north"]),
      storageUsed: stock.food + stock.stone,
      storageCapacity: totalStorageCapacity(world, civId),
      nextMigrationTurn: (Math.floor(world.turn / RULES.migrationInterval) + 1) * RULES.migrationInterval,
      ...((world.protocolVersion ?? 3) < 10 || (world.protocolVersion ?? 3) >= 16
        ? {
            migrationFoodRequired:
              RULES.migrationFoodCost +
              (workers.length + 1) * RULES.migrationReserveTurns * RULES.upkeep,
          }
        : {}),
      seenTiles: world.civs[civId].knowledge.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0),
      nearestGap: gap,
    };
    fog[civId] = Uint8Array.from(world.civs[civId].knowledge);
    lastSeen[civId] = Array.from(world.civs[civId].lastSeen);
    const observations = collectObservations(world, civId);
    observedNodes[civId] = observations.nodes;
    observedBlocks[civId] = observations.blocks;
    observedBuildings[civId] = observations.buildings;
    observedPiles[civId] = observations.piles;
    const entries = world.civs[civId].journal;
    journal[civId] = entries.length > 0 ? entries[entries.length - 1].text : "";
  }

  return {
    turn: world.turn,
    civs,
    workers: Object.values(world.workers)
      .filter((worker) => worker.alive)
      .map((worker) => ({
        id: worker.id,
        owner: worker.owner,
        x: worker.at.x,
        z: worker.at.z,
        job: structuredClone(worker.job),
        carrying: { ...worker.carrying },
        destination: workerDestination(world, worker),
      })),
    buildings: Object.values(world.buildings).map((building) => ({
      id: building.id,
      owner: building.owner,
      fn: building.fn,
      designId: building.designId,
      name: world.civs[building.owner].designs[building.designId]?.name ?? building.id,
      cells: building.cells,
      blocks: [...building.blocks],
      placed: building.placed,
      total: building.total,
      removed: building.removed,
      stock: { food: Math.round(building.stock.food), stone: Math.round(building.stock.stone) },
      storageCapacity: Number.isFinite(storageCapacity(world, building)) ? storageCapacity(world, building) : undefined,
      // One field carries the number the Inspector should explain. From protocol 15 it is the
      // civilization-wide capacity derived from every completed standing block, not a Hall bonus.
      workerPlaces:
        building.fn === "hall"
          ? (world.protocolVersion ?? 3) >= 15
            ? workerSlots(world, building.owner)
            : (world.protocolVersion ?? 3) >= 10
            ? RULES.naturalCeiling
            : (world.protocolVersion ?? 3) >= 4
              ? RULES.slotsAtStart
              : 6
          : building.fn === "store" && (world.protocolVersion ?? 3) < 10
            ? (world.protocolVersion ?? 3) >= 4
              ? Math.floor(building.total / RULES.storeBlocksPerWorkerSlot)
              : 2
            : 0,
      complete: building.completedTurn !== undefined,
    })),
    piles: collectGroundGoods(world),
    nodes: collectNodes(world),
    observedNodes,
    observedBlocks,
    observedBuildings,
    observedPiles,
    fog,
    lastSeen,
    events,
    journal,
  };
}

function workerDestination(world: World, worker: World["workers"][string]) {
  const job = worker.job;
  if (job.kind === "move") return { ...job.to, label: "移動目的地" };
  if (job.kind === "gather") {
    const load = worker.carrying.food + worker.carrying.stone;
    const node = world.tiles[idx(job.at.x, job.at.z)]?.node;
    const returning =
      load >= RULES.carry ||
      ((world.protocolVersion ?? 3) < 18 && load > 0 && node !== undefined && worker.carrying[node.kind] === 0) ||
      !node ||
      node.amount <= 0;
    if (!returning) return { ...job.at, label: node.kind === "food" ? "糧食採集點" : "石材採集點" };
  }
  if (job.kind === "deposit" || job.kind === "gather") {
    const target = nearestDepositStore(world, worker);
    return target ? { ...target.origin, label: target.fn === "hall" ? "主基地" : "有空位的倉庫" } : undefined;
  }
  if (job.kind === "build" || job.kind === "repair") {
    const building = world.buildings[job.buildingId];
    if (!building) return undefined;
    if (worker.carrying.food > 0) {
      const target = nearestDepositStore(world, worker);
      return target ? { ...target.origin, label: "先卸下背包糧食" } : undefined;
    }
    if (worker.carrying.stone > 0) return { ...building.origin, label: job.kind === "build" ? "建築工地" : "修補目標" };
    const missingBlocks = job.kind === "repair" ? building.removed : building.total - standing(building);
    const needed = Math.max(0, missingBlocks * RULES.blockCost - building.delivered);
    const committed = Object.values(world.workers).reduce((sum, candidate) => {
      const candidateJob = candidate.job;
      return (candidateJob.kind === "build" || candidateJob.kind === "repair") &&
        candidateJob.buildingId === building.id
        ? sum + candidate.carrying.stone
        : sum;
    }, 0);
    const outstanding = (world.protocolVersion ?? 3) >= 21 ? Math.max(0, needed - committed) : needed;
    if (outstanding > 0) {
      const wanted = Math.min(RULES.carry, outstanding);
      const stocked = stores(world, worker.owner).filter((store) => store.stock.stone > 0);
      const sufficient =
        (world.protocolVersion ?? 3) >= 21 ? stocked.filter((store) => store.stock.stone >= wanted) : [];
      const candidates = sufficient.length > 0 ? sufficient : stocked;
      const ids = new Set(candidates.map((store) => store.id));
      const source = nearestReachableStore(world, worker, (store) => ids.has(store.id));
      if (source) return { ...source.origin, label: "取石材的存放處" };
    }
    if (needed > 0 && (world.protocolVersion ?? 3) >= 21) {
      return { ...worker.at, label: "等候運送中的石材" };
    }
    return { ...building.origin, label: job.kind === "build" ? "建築工地" : "修補目標" };
  }
  if (job.kind === "remove") {
    const building = world.buildings[job.buildingId];
    if (worker.carrying.food + worker.carrying.stone >= RULES.carry) {
      const target = nearestDepositStore(world, worker);
      return target ? { ...target.origin, label: "運送回收物回倉" } : undefined;
    }
    return building ? { ...building.origin, label: "拆解目標" } : undefined;
  }
  return undefined;
}

function nearestDepositStore(world: World, worker: World["workers"][string]) {
  const load = worker.carrying.food + worker.carrying.stone;
  const open = stores(world, worker.owner).filter((store) => storageFree(world, store) > 0);
  const openIds = new Set(open.map((store) => store.id));
  if ((world.protocolVersion ?? 3) < 21) {
    return nearestReachableStore(world, worker, (store) => openIds.has(store.id));
  }
  const roomy = open.filter((store) => storageFree(world, store) >= load);
  const roomyIds = new Set(roomy.map((store) => store.id));
  return (
    nearestReachableStore(world, worker, (store) => roomyIds.has(store.id)) ??
    nearestReachableStore(world, worker, (store) => openIds.has(store.id))
  );
}

function nearestReachableStore(
  world: World,
  worker: World["workers"][string],
  eligible: (store: Building) => boolean,
) {
  const blocked = blockedCells(world, worker.owner);
  return stores(world, worker.owner)
    .filter(eligible)
    .map((store) => ({ store, path: findPath(world, blocked, worker.at, store.access) }))
    .filter((candidate) => candidate.path.length > 0)
    .sort((left, right) => left.path.length - right.path.length || left.store.id.localeCompare(right.store.id))[0]?.store;
}

function collectObservations(world: World, civId: CivId) {
  const nodes: Frame["observedNodes"][CivId] = [];
  const blocks: Frame["observedBlocks"][CivId] = [];
  const piles: Frame["observedPiles"][CivId] = [];
  const buildingMap = new Map<string, Frame["observedBuildings"][CivId][number]>();
  world.civs[civId].memory.forEach((observation, index) => {
    if (!observation || world.civs[civId].knowledge[index] === 0) return;
    const x = index % world.width;
    const z = Math.floor(index / world.width);
    if (observation.node) nodes.push({ x, z, amount: observation.node.amount, turn: observation.turn });
    if (observation.pile) piles.push({ id: `ground-${x}-${z}`, x, z, stock: { ...observation.pile }, turn: observation.turn });
    if (!observation.building) return;
    blocks.push({ x, z, id: observation.building.id, owner: observation.building.owner, turn: observation.turn });
    const known = buildingMap.get(observation.building.id);
    if (!known) {
      buildingMap.set(observation.building.id, {
        id: observation.building.id,
        owner: observation.building.owner,
        oldestObservationTurn: observation.turn,
        newestObservationTurn: observation.turn,
        visibleCells: world.civs[civId].knowledge[index] === 2 ? 1 : 0,
        rememberedCells: world.civs[civId].knowledge[index] === 1 ? 1 : 0,
        cells: [{ x, z }],
      });
    } else {
      known.oldestObservationTurn = Math.min(known.oldestObservationTurn, observation.turn);
      known.newestObservationTurn = Math.max(known.newestObservationTurn, observation.turn);
      if (world.civs[civId].knowledge[index] === 2) known.visibleCells += 1;
      else known.rememberedCells += 1;
      known.cells.push({ x, z });
    }
  });
  return { nodes, blocks, buildings: [...buildingMap.values()], piles };
}

function collectGroundGoods(world: World): Frame["piles"] {
  const byTile = new Map<string, Frame["piles"][number]>();
  for (const pile of Object.values(world.piles)) {
    const key = `${pile.at.x},${pile.at.z}`;
    const known = byTile.get(key);
    if (!known) {
      byTile.set(key, {
        id: `ground-${pile.at.x}-${pile.at.z}`,
        x: pile.at.x,
        z: pile.at.z,
        stock: { ...pile.stock },
        turn: pile.turn,
      });
      continue;
    }
    known.stock.food += pile.stock.food;
    known.stock.stone += pile.stock.stone;
    known.turn = Math.max(known.turn, pile.turn);
  }
  return [...byTile.values()];
}

function collectNodes(world: World) {
  const nodes: Frame["nodes"] = [];
  for (let z = 0; z < world.height; z += 1) {
    for (let x = 0; x < world.width; x += 1) {
      const node = world.tiles[idx(x, z)].node;
      if (node) nodes.push({ x, z, amount: node.amount });
    }
  }
  return nodes;
}

function eventsForTurn(world: World) {
  return world.events.filter((event) => event.turn === world.turn);
}
