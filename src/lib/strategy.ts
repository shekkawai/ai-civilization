import { RULES } from "@/sim/config";
import { STARTER_HALL } from "@/sim/designs";
import { HALL_ORIGIN, HOME_QUARRY, V28_HALL_ORIGIN, V28_ROUTE_QUARRY, idx } from "@/sim/map";
import type { CivFrame, CivId, Frame, Tile } from "@/sim/types";

export interface SeriesPoint {
  turn: number;
  civs: Record<CivId, CivFrame>;
}

function storageUsed(civ: CivFrame) {
  return civ.storageUsed ?? civ.food + civ.stone;
}

/**
 * What a well-played civilization would be doing on *this* map, and how far each
 * side actually is from it.
 *
 * A spectator can already read six quantities and their trends. None of that says
 * whether a number is good, because "good" is not a property of the number — it is
 * a property of the map. The same 9 people is a comfortable settlement on the
 * classic map and a ceiling on `scarce`. So everything here is derived from two
 * sources only: the rules in `config.ts` and the terrain the seed produced. No
 * hand-written expectations, and nothing about what a model was thinking.
 *
 * Boundary, and it is the same one the trajectory readings carry: this is written
 * for human viewers. None of it may ever reach a player's prompt — the agents get
 * the private report and nothing else.
 */

/** A civilization's endowment at the start, measured from the generated terrain. */
export interface HomeFacts {
  /** Food tiles inside the starting build radius. */
  fields: number;
  /** Food those tiles regrow per turn once picked clean — the long-run income. */
  regen: number;
  /** People that income feeds, since every person eats `upkeep` per turn. */
  foodCeiling: number;
  /**
   * Food those tiles hold when full — the endowment rather than the income.
   *
   * On every map up to v23 this was a footnote, because home food regrew and the income was the
   * whole story. `corridor-oasis` sets every home field to regen 0, at which point `foodCeiling`
   * is honestly 0 and completely useless: it reads as a broken figure over three fields holding
   * 270 food between them. What a reader needs there is capital and how long it lasts, so the
   * capital has to be measured.
   */
  larder: number;
  /** Whether home food has any income at all. False makes `foodCeiling` a meaningless 0. */
  homeRenews: boolean;
  /** Stone in the home quarry, by the engine's own 9×9 definition. */
  stone: number;
  /** Blocks that stone buys. */
  blocks: number;
  /** People those blocks could house, if every block went into stores. */
  stoneCeiling: number;
  /** Straight-line distance from the spawn to the nearest food outside the ring. */
  nextFood: number;
  /**
   * The same, restricted to food that actually regrows.
   *
   * These are the same number on every map before v24 and they are 10 tiles apart on
   * `corridor-oasis`: the nearest food outside the home ring is a 30-food marker that never comes
   * back, and the nearest cell that could feed a settlement indefinitely is a third of the map
   * away. Quoting only `nextFood` sends a reader — and the page's own copy did — to the wrong place.
   * 0 when the map has no renewing food outside the ring at all.
   */
  nextRenewFood: number;
  /** Straight-line distance from the spawn to the nearest stone outside the quarry. */
  nextStone: number;
}

export interface MapFacts {
  civs: Record<CivId, HomeFacts>;
  /** True when both sides measure identically, which the 180° rotation guarantees. */
  symmetric: boolean;
  /** Whichever ceiling arrives first is the constraint the map is actually testing. */
  binding: "food" | "stone" | "both";
  /** The lower of the two ceilings — the population home alone can hold. */
  homeCeiling: number;
}

const HOME_RADIUS = RULES.buildRadius;
/** `quarryLeft` in the engine sums a 9×9 box around the home quarry; match it. */
const QUARRY_BOX = 4;

/**
 * Measure from the centre of the starting hall, not from `SPAWN`.
 *
 * The two hall footprints are exact 180° mirrors, but `SPAWN` is `origin + 3` on a
 * six-cell footprint — half a tile past the true centre — so the two spawns are a
 * diagonal tile apart rather than mirror images. Measuring a symmetric map from
 * them produces slightly different endowments for the two sides, which would read
 * on this panel as the map favouring somebody.
 */
export const HOME_CENTRE: Record<CivId, { x: number; z: number }> = {
  north: hallCentre(HALL_ORIGIN.north),
  south: hallCentre(HALL_ORIGIN.south),
};

function hallCentre(origin: { x: number; z: number }) {
  const width = STARTER_HALL.rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  return {
    x: origin.x + (width - 1) / 2,
    z: origin.z + (STARTER_HALL.rows.length - 1) / 2,
  };
}

export function homeCentre(frame: Frame, civ: CivId) {
  const hall = frame.buildings?.find((building) => building.owner === civ && building.fn === "hall");
  if (!hall?.cells.length) return HOME_CENTRE[civ];
  const xs = hall.cells.map((cell) => cell.x);
  const zs = hall.cells.map((cell) => cell.z);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    z: (Math.min(...zs) + Math.max(...zs)) / 2,
  };
}

function mapHome(tiles: Tile[], civ: CivId) {
  const v28 = tiles.some((tile) => tile.node?.pool === "shared-stone");
  return {
    centre: hallCentre(v28 ? V28_HALL_ORIGIN[civ] : HALL_ORIGIN[civ]),
    quarry: v28 ? V28_ROUTE_QUARRY[civ] : HOME_QUARRY[civ],
    v28,
  };
}

function distance(from: { x: number; z: number }, x: number, z: number) {
  return Math.hypot(x - from.x, z - from.z);
}

function homeFacts(tiles: Tile[], civ: CivId): HomeFacts {
  const context = mapHome(tiles, civ);
  const home = context.centre;
  const quarry = context.quarry;
  let fields = 0;
  let regen = 0;
  let larder = 0;
  let stone = 0;
  let nextFood = Infinity;
  let nextRenewFood = Infinity;
  let nextStone = Infinity;

  for (let z = 0; z < RULES.height; z += 1) {
    for (let x = 0; x < RULES.width; x += 1) {
      const node = tiles[idx(x, z)].node;
      if (!node) continue;
      const inQuarry = Math.abs(x - quarry.x) <= QUARRY_BOX && Math.abs(z - quarry.z) <= QUARRY_BOX;
      const away = distance(home, x, z);
      if (node.kind === "food") {
        if (away <= HOME_RADIUS) {
          fields += 1;
          regen += node.regen;
          larder += node.cap;
        } else {
          nextFood = Math.min(nextFood, away);
          if (node.regen > 0) nextRenewFood = Math.min(nextRenewFood, away);
        }
        continue;
      }
      if (inQuarry) stone += node.cap;
      else nextStone = Math.min(nextStone, away);
    }
  }

  const blocks = Math.floor(stone / RULES.blockCost);
  return {
    fields,
    regen,
    foodCeiling: Math.floor(regen / RULES.upkeep),
    larder,
    homeRenews: regen > 0,
    stone,
    blocks,
    stoneCeiling: context.v28
      ? Math.floor((STARTER_HALL.rows.flat().filter((cell) => cell === "#").length + blocks) / 3)
      : RULES.slotsAtStart + Math.floor(blocks / RULES.storeBlocksPerWorkerSlot),
    nextFood: Number.isFinite(nextFood) ? Math.round(nextFood) : 0,
    nextRenewFood: Number.isFinite(nextRenewFood) ? Math.round(nextRenewFood) : 0,
    nextStone: Number.isFinite(nextStone) ? Math.round(nextStone) : 0,
  };
}

/**
 * Pure function of the generated terrain, so it is the same on every turn of a
 * season. `tiles` carries each node's `cap` (its original endowment); current
 * amounts live on the frame and are deliberately not used here — this describes
 * the hand the map dealt, not what is left of it.
 */
export function readMap(tiles: Tile[]): MapFacts {
  const north = homeFacts(tiles, "north");
  const south = homeFacts(tiles, "south");
  const symmetric =
    north.foodCeiling === south.foodCeiling &&
    north.stoneCeiling === south.stoneCeiling &&
    north.nextStone === south.nextStone;
  const gap = north.foodCeiling - north.stoneCeiling;
  return {
    civs: { north, south },
    symmetric,
    binding: Math.abs(gap) <= 2 ? "both" : gap > 0 ? "stone" : "food",
    homeCeiling: Math.min(north.foodCeiling, north.stoneCeiling),
  };
}

/* ------------------------------------------------------------------ per civ */

export type WatchState = "ok" | "watch" | "risk";
export type WatchKey = "ceiling" | "reach" | "invest" | "transit";

export interface WatchPoint {
  key: WatchKey;
  state: WatchState;
  /** The measured fact, already formatted. */
  value: string;
  /** Which of the several readings under this heading applies right now. */
  detail: string;
}

export interface Reach {
  /** Straight-line distance from home of the furthest living worker, this turn. */
  furthest: number;
  /** Of those, how many are outside the starting build radius. */
  outside: number;
  /** Whether anyone is gathering beyond the home ring — exploration with a purpose. */
  gatheringOutside: boolean;
}

/** Where a civilization's people actually are, on the turn being viewed. */
export function reachOf(frame: Frame, civ: CivId): Reach {
  const home = homeCentre(frame, civ);
  let furthest = 0;
  let outside = 0;
  let gatheringOutside = false;
  for (const worker of frame.workers) {
    if (worker.owner !== civ) continue;
    const away = distance(home, worker.x, worker.z);
    furthest = Math.max(furthest, away);
    if (away > HOME_RADIUS) {
      outside += 1;
      if (worker.job.kind === "gather") gatheringOutside = true;
    }
  }
  return { furthest: Math.round(furthest), outside, gatheringOutside };
}

/**
 * Blocks laid over the recent window — the only evidence that stone became
 * capacity. The span is returned with it because "no blocks in 10 turns" is a
 * finding and "no blocks in 2 turns" is a season that just started; the copy has
 * to be able to say which.
 */
function recentBuilding(series: SeriesPoint[], civ: CivId, window = 10) {
  const points = series.slice(-window);
  if (points.length < 2) return { laid: 0, span: 0 };
  return {
    laid: points[points.length - 1].civs[civ].blocksPlaced - points[0].civs[civ].blocksPlaced,
    span: points[points.length - 1].turn - points[0].turn,
  };
}

export interface Assessment {
  points: WatchPoint[];
  reach: Reach;
}

/**
 * Four questions the six metrics cannot answer, each measured against the map.
 *
 * They are deliberately not restatements of the metric readings: a metric says
 * what a quantity is doing, these say whether the civilization is positioned for
 * the constraint this particular seed imposes.
 */
export function assess(
  civ: CivId,
  frame: Frame,
  series: SeriesPoint[],
  facts: MapFacts,
  slots: number,
  format: (key: WatchKey, state: string, values: Record<string, string | number>) => string,
): Assessment {
  const civFrame = frame.civs[civ];
  const home = facts.civs[civ];
  const reach = reachOf(frame, civ);
  const points: WatchPoint[] = [];

  /* A civilization with nobody left is not "well within its ceiling" and has not
     "kept everyone close to home" — it has ended. Reading the four checks
     literally at zero population produces four reassuring green lines over a
     dead settlement, which is how v15's south side would have looked. */
  if (civFrame.workers <= 0) {
    return {
      reach,
      points: (["ceiling", "reach", "invest", "transit"] as WatchKey[]).map((key) => ({
        key,
        state: "risk" as WatchState,
        value: "—",
        detail: format(key, "gone", {}),
      })),
    };
  }

  /* 1. How much room is left before the map itself stops the settlement growing. */
  const ceiling = Math.min(home.foodCeiling, home.stoneCeiling);
  const room = ceiling - civFrame.workers;
  points.push({
    key: "ceiling",
    state: room <= 0 ? "risk" : room <= 2 ? "watch" : "ok",
    value: format("ceiling", "value", { pop: civFrame.workers, ceiling }),
    detail: format("ceiling", room <= 0 ? "at" : room <= 2 ? "near" : "room", {
      pop: civFrame.workers,
      ceiling,
      room,
      slots,
    }),
  });

  /* 2. Whether anyone has gone past the ring the settlement started inside. */
  points.push({
    key: "reach",
    state: reach.gatheringOutside ? "ok" : reach.outside > 0 ? "watch" : "risk",
    value: format("reach", "value", { furthest: reach.furthest }),
    detail: format(
      "reach",
      reach.gatheringOutside ? "working" : reach.outside > 0 ? "walking" : "home",
      {
        furthest: reach.furthest,
        outside: reach.outside,
        radius: HOME_RADIUS,
        nextStone: home.nextStone,
        nextFood: home.nextFood,
      },
    ),
  });

  /* 3. Whether stone is being turned into capacity, or only stockpiled. */
  const { laid, span } = recentBuilding(series, civ);
  const spare = slots - civFrame.workers;
  points.push({
    key: "invest",
    state: laid > 0 ? "ok" : spare > 0 ? "watch" : "risk",
    value: format("invest", "value", { laid }),
    detail: format("invest", laid > 0 ? "building" : spare > 0 ? "idle" : "stuck", {
      laid,
      span,
      slots,
      spare,
      stone: civFrame.stone,
      blocks: Math.floor(civFrame.stone / RULES.blockCost),
    }),
  });

  /* 4. Goods physically stuck in backpacks. `carried` is food and stone together,
        so it is compared against everything in storage rather than against food
        alone. Nothing in a backpack feeds anybody: upkeep is paid out of stores,
        before anyone moves. This is the failure that ended v14 and the deadlock
        that froze v15. */
  const carried = civFrame.carried;
  const stored = storageUsed(civFrame);
  const share = carried + stored > 0 ? carried / (carried + stored) : 0;
  points.push({
    key: "transit",
    state: carried === 0 ? "ok" : share >= 0.5 ? "risk" : share >= 0.25 ? "watch" : "ok",
    value: format("transit", "value", { carried }),
    detail: format("transit", carried === 0 ? "clear" : share >= 0.5 ? "stranded" : "moving", {
      carried,
      stored,
      pct: Math.round(share * 100),
      upkeep: civFrame.workers * RULES.upkeep,
    }),
  });

  return { points, reach };
}

/** Turns of upkeep the stored food covers at the current population. */
export function foodRunway(civ: CivFrame) {
  const burn = civ.workers * RULES.upkeep;
  if (burn <= 0) return 0;
  return Math.floor(civ.food / burn);
}
