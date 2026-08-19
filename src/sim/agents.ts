import { RULES } from "./config";
import { CIVS, activeBlockAt, livingWorkers, standing, stores, totalStock } from "./engine";
import { checkDesign } from "./designs";
import { CENTRE, idx, inBounds } from "./map";
import type { Action, CivId, Decision, Design, Point, World } from "./types";

/**
 * Scripted stand-in agents. These are NOT language models — they exist so the rules
 * can be exercised end to end and the pacing measured before any model is connected.
 * They follow one fixed policy, so anything they do is a property of the rules,
 * not of a model's judgement.
 */

const LIBRARY: Record<CivId, Design[]> = {
  north: [
    { id: "north-store", name: "北岸糧倉", fn: "store", author: "north", rows: ["####", "#..#", "####"] },
    { id: "north-post", name: "北岸哨站", fn: "post", author: "north", rows: ["###", "###"] },
  ],
  south: [
    { id: "south-store", name: "南原倉屋", fn: "store", author: "south", rows: ["####", "#..#", "####"] },
    { id: "south-post", name: "南原望樓", fn: "post", author: "south", rows: ["##", "##", "##"] },
  ],
};

export function scriptedDecisions(world: World): Decision[] {
  return CIVS.map((civId) => decideFor(world, civId));
}

function decideFor(world: World, civId: CivId): Decision {
  const actions: Action[] = [];
  const civ = world.civs[civId];
  const workers = livingWorkers(world, civId);
  const stock = totalStock(world, civId);
  const notes: string[] = [];

  for (const design of LIBRARY[civId]) {
    if (!civ.designs[design.id] && checkDesign(design).ok) {
      actions.push({ type: "design", design });
    }
  }

  const busy = new Set<string>();
  for (const worker of workers) {
    if (worker.job.kind === "build" || worker.job.kind === "remove" || worker.job.kind === "repair") {
      busy.add(worker.id);
    }
  }
  const free = workers.filter((worker) => !busy.has(worker.id));

  const completed = Object.values(world.buildings).filter(
    (building) => building.owner === civId && building.completedTurn !== undefined,
  );
  const underway = Object.values(world.buildings).some(
    (building) => building.owner === civId && building.completedTurn === undefined,
  );
  const reserved = new Set<string>();

  if (!underway && free.length >= 2) {
    const design = completed.length < 2 ? LIBRARY[civId][0] : LIBRARY[civId][completed.length % 2];
    const designCost = checkDesign(design).cost;
    if (civ.designs[design.id] && stock.stone >= designCost) {
      const spot = placementSpot(world, civId, design);
      if (spot) {
        actions.push({ type: "build", designId: design.id, at: spot, workers: free.slice(0, 2).map((w) => w.id) });
        free.slice(0, 2).forEach((worker) => reserved.add(worker.id));
        notes.push(`興建${design.name}`);
      }
    }
  }

  const gatherers = free.filter((worker) => !reserved.has(worker.id));
  // Keep enough farmers for upkeep, but when stored stone is thin shift labour so structure upkeep and the next building remain possible.
  const wantFarmersBase = Math.max(2, Math.ceil(workers.length * 0.45));
  const stonePressure = stock.stone < Math.max(18, workers.length * 2);
  const wantFarmers = stonePressure
    ? Math.max(2, Math.min(wantFarmersBase, Math.floor(workers.length * 0.35)))
    : wantFarmersBase;
  const farmers = gatherers.slice(0, wantFarmers);
  const miners = gatherers.slice(wantFarmers);

  for (const worker of farmers) {
    const target = nearestNode(world, worker.at, "food");
    if (target) actions.push({ type: "gather", workers: [worker.id], at: target });
  }
  for (const worker of miners) {
    const target = nearestNode(world, worker.at, "stone");
    if (target) actions.push({ type: "gather", workers: [worker.id], at: target });
  }

  const journal =
    notes.length > 0
      ? `第 ${world.turn} 回合。${notes.join("、")}。糧食 ${Math.round(stock.food)}，石材 ${Math.round(stock.stone)}。`
      : `第 ${world.turn} 回合。糧食 ${Math.round(stock.food)}，石材 ${Math.round(stock.stone)}，${workers.length} 人在外。`;

  return { civ: civId, journal, actions };
}

function placementSpot(world: World, civId: CivId, design: Design): Point | undefined {
  const anchors = Object.values(world.buildings).filter(
    (building) =>
      building.owner === civId &&
      building.completedTurn !== undefined &&
      standing(building) > 0 &&
      ((world.protocolVersion ?? 3) < 13 || building.fn !== "post"),
  );
  if (anchors.length === 0) return undefined;

  const candidates: Point[] = [];
  for (const anchor of anchors) {
    for (let radius = 5; radius <= RULES.buildRadius - 1; radius += 2) {
      for (let angle = 0; angle < 12; angle += 1) {
        const theta = (angle / 12) * Math.PI * 2;
        candidates.push({
          x: Math.round(anchor.origin.x + Math.cos(theta) * radius),
          z: Math.round(anchor.origin.z + Math.sin(theta) * radius),
        });
      }
    }
  }
  // Prefer ground that lies towards the middle of the map: expansion has a direction.
  candidates.sort((a, b) => Math.abs(a.z - CENTRE.z) - Math.abs(b.z - CENTRE.z));
  return candidates.find((candidate) => fits(world, civId, design, candidate));
}

function fits(world: World, civId: CivId, design: Design, at: Point) {
  const cells: Point[] = [];
  design.rows.forEach((row, z) => {
    [...row].forEach((char, x) => {
      if (char === "#") cells.push({ x: at.x + x, z: at.z + z });
    });
  });
  if (cells.some((cell) => !inBounds(cell.x, cell.z))) return false;
  if (
    cells.some((cell) => {
      const terrain = world.tiles[idx(cell.x, cell.z)].terrain;
      return terrain === "water" || terrain === "ridge";
    })
  ) {
    return false;
  }
  const taken = new Set(
    Object.values(world.buildings).flatMap((building) => building.cells.map((cell) => `${cell.x},${cell.z}`)),
  );
  if (cells.some((cell) => taken.has(`${cell.x},${cell.z}`))) return false;
  const anchors = Object.values(world.buildings)
    .filter(
      (building) =>
        building.owner === civId &&
        building.completedTurn !== undefined &&
        standing(building) > 0 &&
        ((world.protocolVersion ?? 3) < 13 || building.fn !== "post"),
    )
    .flatMap((building) => building.cells);
  return cells.some((cell) =>
    anchors.some((anchor) => Math.hypot(cell.x - anchor.x, cell.z - anchor.z) <= RULES.buildRadius),
  );
}

function nearestNode(world: World, from: Point, kind: "food" | "stone"): Point | undefined {
  let best: Point | undefined;
  let bestDistance = Infinity;
  for (let z = 0; z < world.height; z += 1) {
    for (let x = 0; x < world.width; x += 1) {
      const node = world.tiles[idx(x, z)].node;
      if (!node || node.kind !== kind || node.amount <= 0 || activeBlockAt(world, x, z)) continue;
      const distance = Math.hypot(x - from.x, z - from.z);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = { x, z };
    }
  }
  return best;
}
