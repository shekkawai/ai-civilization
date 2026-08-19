import { RULES } from "../sim/config";
import { homeCentre, readMap } from "../lib/strategy";
import type { CivId, Frame, Tile } from "../sim/types";

/**
 * The survival arithmetic behind `Vitals.tsx`, kept as a plain module so it can be tested without
 * rendering anything — the same split `route.ts` uses. Every figure here is division on the rules
 * in `config.ts`; nothing is a forecast, and none of it may ever reach a player.
 */

const HOME_RADIUS = RULES.buildRadius;

/**
 * `readMap` walks all 9,216 tiles. The terrain array never changes within a season, so the answer
 * is cached against it rather than recomputed twice per civ on every scrub of the playhead.
 */
const MAP_FACTS = new WeakMap<object, ReturnType<typeof readMap>>();
function mapFacts(tiles: Tile[]) {
  const cached = MAP_FACTS.get(tiles);
  if (cached) return cached;
  const facts = readMap(tiles);
  MAP_FACTS.set(tiles, facts);
  return facts;
}

export interface Vital {
  civ: CivId;
  stored: number;
  upkeep: number;
  turnsOfFood: number;
  inTransit: number;
  incoming: number;
  gatherers: { food: number; stone: number };
  /**
   * The same gatherers split by whether the order is actually producing anything this turn.
   * `walking` is on its way, `stalled` is standing on a source that has nothing left in it. The
   * three always sum to `gatherers.food + gatherers.stone`.
   */
  gatherState: { working: number; walking: number; stalled: number };
  homeFood: number;
  homeRegen: number;
  homeStone: number;
  /** Straight-line distance to the nearest stone outside the home quarry, when the map has one. */
  nextStone?: number;
  /**
   * Distance to the nearest food outside the home ring that regrows — the only destination that
   * answers a home with no income. Undefined when home already regrows enough to be beside the
   * point, or when the map has no renewing food outside the ring.
   */
  nextRenewFood?: number;
}

/**
 * `frame.nodes` is the true state of every resource tile. That is correct here: this panel is for
 * human viewers, who are told everything, and nothing under `src/research/` may import it.
 */
export function readVitals(frame: Frame, tiles: Tile[] | null, civ: CivId): Vital {
  const civFrame = frame.civs[civ];
  const upkeep = civFrame.workers * RULES.upkeep;
  const mine = frame.workers.filter((worker) => worker.owner === civ);

  const inTransit = mine.reduce((sum, worker) => sum + worker.carrying.food, 0);

  // What the standing orders should bring in next turn: every worker already standing on the tile
  // it was told to gather from, at that resource's fixed rate. A worker still walking adds nothing
  // next turn, which is exactly the distinction that makes a distant lumber camp underperform.
  //
  // The same walk also sorts the gatherers into working / walking / stalled. That third state is
  // the one worth having: at v13 Turn 100 the north bank had six people standing on tile (46, 5)
  // with nothing left in it, so "six on food" and "nothing arriving" were both true at once. A
  // panel that printed only the headcount would read as a civilization feeding itself.
  let incoming = 0;
  const gatherers = { food: 0, stone: 0 };
  const gatherState = { working: 0, walking: 0, stalled: 0 };
  for (const worker of mine) {
    const job = worker.job;
    if (job.kind !== "gather") continue;
    const kind = tiles?.[job.at.z * RULES.width + job.at.x]?.node?.kind ?? "food";
    gatherers[kind] += 1;
    const node = frame.nodes.find((entry) => entry.x === job.at.x && entry.z === job.at.z);
    if (worker.x !== job.at.x || worker.z !== job.at.z) {
      gatherState.walking += 1;
      continue;
    }
    if (!node || node.amount <= 0) {
      gatherState.stalled += 1;
      continue;
    }
    gatherState.working += 1;
    if (kind !== "food") continue;
    incoming += Math.min(RULES.gatherFood, node.amount);
  }

  // `frame.nodes` carries live amounts but not the kind or the regrowth rate; both of those are
  // fixed properties of the tile, so they come from the season's terrain. Read the amount from the
  // frame and everything else from the map, never the other way round — `tiles` holds each node's
  // *starting* amount and would report a quarry as full for the whole season.
  const home = homeCentre(frame, civ);
  let homeFood = 0;
  let homeRegen = 0;
  for (const node of frame.nodes) {
    if (node.amount <= 0) continue;
    if (Math.hypot(node.x - home.x, node.z - home.z) > HOME_RADIUS) continue;
    const source = tiles?.[node.z * RULES.width + node.x]?.node;
    if ((source?.kind ?? "food") !== "food") continue;
    homeFood += node.amount;
    homeRegen += source?.regen ?? 0;
  }

  // Home stone is the engine's own `quarryLeft`, not a second measurement. The home quarry is not
  // always inside the build radius — on `corridor-tight` it sits about sixteen tiles out — so a
  // radius sum of this would have read 0 and told the reader the stone was gone while forty of it
  // was still in the ground. One number, one home.
  const facts = tiles ? mapFacts(tiles).civs[civ] : undefined;

  return {
    civ,
    stored: civFrame.food,
    upkeep,
    turnsOfFood: upkeep > 0 ? civFrame.food / upkeep : Infinity,
    inTransit,
    incoming,
    gatherers,
    gatherState,
    homeFood,
    homeRegen,
    homeStone: civFrame.quarryLeft,
    nextStone: facts && Number.isFinite(facts.nextStone) ? Math.round(facts.nextStone) : undefined,
    // Only worth stating while home cannot feed them. Where home regrows more than it eats, the
    // distance to the next renewing field is trivia; where it regrows nothing, it is the deadline.
    nextRenewFood:
      facts && !facts.homeRenews && facts.nextRenewFood > 0 ? facts.nextRenewFood : undefined,
  };
}
