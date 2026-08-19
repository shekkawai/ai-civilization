import { RULES } from "./config";
import type { CivId, Point, Tile } from "./types";

/**
 * The starting hall is a 6 × 6 footprint. Its origin is mirrored exactly under the
 * 180° rotation used for the map, so both civilizations occupy identical ground.
 */
export const HALL_ORIGIN: Record<CivId, Point> = {
  north: { x: 45, z: 9 },
  south: { x: RULES.width - 45 - 6, z: RULES.height - 9 - 6 },
};

/** Protocol 15 places the two halls in keypad zones 7 and 3. */
export const V28_HALL_ORIGIN: Record<CivId, Point> = {
  north: { x: 13, z: 9 },
  south: { x: RULES.width - 13 - 6, z: RULES.height - 9 - 6 },
};

export const SPAWN: Record<CivId, Point> = {
  north: { x: HALL_ORIGIN.north.x + 3, z: HALL_ORIGIN.north.z + 3 },
  south: { x: HALL_ORIGIN.south.x + 3, z: HALL_ORIGIN.south.z + 3 },
};

export const HOME_QUARRY: Record<CivId, Point> = {
  north: { x: 40, z: 22 },
  south: { x: 55, z: 73 },
};

export const V28_ROUTE_QUARRY: Record<CivId, Point> = {
  north: { x: 18, z: 40 },
  south: { x: RULES.width - 1 - 18, z: RULES.height - 1 - 40 },
};

export const CENTRE = { x: 48, z: 48 };

/**
 * Map layout variant is a pure function of the seed. `verifyReplay` and every
 * backfill path regenerate a season's world from `map_seed` alone, so a new
 * layout must never change what an already-archived seed produces — register a
 * new seed here instead of editing the classic branch.
 *
 * `gradient` (v14, Shek's call 2026-08-05): v13 measured that the classic map's
 * ~95 home-ring fields per side sustain ~285 people, so neither model ever had
 * an economic reason to leave home — the season froze at a 68-tile gap for 30+
 * turns. Gradient keeps only 6 fields in each home ring (~18 food/turn long-run,
 * near the upkeep of a grown settlement), a thin trail of stepping-stone fields
 * toward the ridge passes, and concentrates farmland in the same central band
 * that already holds the big quarries. Both economies are pulled to the middle,
 * so contact is driven by food pressure rather than curiosity.
 *
 * `scarce` (v16, Shek's call 2026-08-06): gradient's generation rules with a
 * smaller home quarry. v15 measured that the two home ceilings coincide — 150
 * home stone buys ~49 blocks ≈ 16 worker places, and the home ring's 18 food/turn
 * sustains ~18 people — so neither ceiling ever bites first and a settlement can
 * sit at a comfortable equilibrium inside 12 tiles. Cutting the home quarry to 60
 * makes the stone ceiling (12 worker places) arrive well before the food ceiling,
 * while the next stone stays at radius ~32.
 *
 * A variant is keyed by seed, so `scarce` needs its own seed and therefore re-rolls
 * the RNG-placed terrain (water blobs, central-belt field scatter). The home ring,
 * stepping stones, ridges and quarry positions come from fixed constants and are
 * unchanged, so the food ceiling v15 measured carries over. v16 is a controlled
 * comparison on that ceiling, not a byte-identical world.
 *
 * `corridor` (v20, Shek's call 2026-08-07): v19 proved that merely disclosing how
 * observation works still permits long, arbitrary searches. The home ring has only
 * three fields (9 food/turn), and small food/stone markers form a visible chain through
 * the central pass. Each stone marker is within worker sight of the previous one. The
 * chain supplies enough material to continue moving but not enough to replace the large
 * central quarries. This aims to create central pressure around turns 20–30 through the
 * terrain itself, without a prompt telling either model where to go.
 *
 * `corridor-tight` (v21, Shek's call 2026-08-07): v20 already forced the route into one
 * central corridor, but home food at 3 regen and stored stone with no continuous sink still
 * allowed a town to sit near home. Tight keeps the same corridor geometry and marker chain,
 * lowers home-field regen to 2, keeps home quarry at ~40 stone, and pairs with the engine's
 * structure stone upkeep so unfinished local equilibrium is no longer free. Large stone and
 * extra food remain only along the corridor / core.
 *
 * `corridor-survive` (v23, Shek's call 2026-08-08): v22 measured that geometry was never the
 * obstacle. North's hall sits 42 tiles from the centre and a worker covers 4 per turn, so
 * contact is physically available from about turn 9 — yet v22 took 83 turns, because home held
 * a standing larder nobody had to leave. Each home field carried 120 stored food on top of its
 * regrowth: roughly 90 turns of slack for a grown settlement. Survive keeps the tight corridor
 * geometry byte-for-byte and changes three things:
 *
 * 1. Home-field regrowth drops 2 → 1, so the three home fields yield 3 food/turn against a
 *    starting population of 6. Home is in deficit from the first turn. The 120-food standing
 *    larder is deliberately kept: it is the capital that pays for relocating, and the first
 *    v23 spike proved that cutting it does not force a move, it makes moving unaffordable.
 * 2. The corridor food markers regrow on a rising gradient outward (4 → 10), so each step
 *    toward the middle is measurably better than the last. This is the only navigation aid
 *    either side receives, and it is terrain, not wording. Sized so that home alone yields
 *    3 food/turn against a ceiling of 10 — a forced deficit — while home plus the two
 *    own-side links yields 13, a comfortable surplus for a settlement that builds one
 *    forward store. Deficit at home, slack after moving: that is the whole design.
 * 3. The central band supplies roughly one settlement rather than two — belt scatter 12% → 5%
 *    and core stone 2400 → 800 — so arriving first denies the other side rather than sharing.
 *
 * `corridor-oasis` (v24, Shek's call 2026-08-08): v23 proved that nominal regeneration is
 * not the same as an unavoidable survival path. Every food source inside either ridge is now
 * finite. Renewable food begins beyond the ridge and totals 16 per turn across the whole map,
 * enough for one ten-person settlement but not two. Births pause after famine until five fully
 * fed turns have passed, preventing an endless birth/death replacement loop.
 *
 * `corridor-shared-oasis` (v25, Shek's call 2026-08-08): v24 reached the middle but its four
 * renewable cells were spread along two approach routes, so both settlements could work food
 * without necessarily seeing the same building. The same 16 food/turn is now concentrated in
 * one compact, rotationally symmetric cluster whose four cells fit inside one worker's sight.
 * Every home and route field remains finite. One full settlement can live on the shared oasis;
 * two cannot, making the consequence of another settlement's physical presence observable
 * without naming competition or prescribing any response.
 *
 * `corridor-visible-oasis` (v26, Shek's call 2026-08-09): v25's first route field
 * began outside worker sight and every route field held the same amount, so the terrain did
 * not actually present a continuous reason to keep following it. v26 keeps the same total
 * finite food per side but redistributes it from three 40-food home cells into five visible
 * route cells holding 50/60/70/80/90. The first is visible from the hall and each following
 * cell is within one worker's sight of the previous one. The compact 16-food/turn oasis is
 * unchanged. Direction is therefore discoverable from observed abundance, not prompt wording.
 *
 * `corridor-unique-oasis` (v27, Shek's call 2026-08-09): every ordinary Foodland cell is
 * finite. The centre is a distinct 2×2 Oasis terrain whose four accessible cells share one
 * 16-food pool and one +16/turn renewal, rather than looking like four independent farms.
 * Oasis ground cannot hold a building. Forward worksites no longer need a building chain;
 * they require current observation and a physical worker route instead.
 *
 * `numpad-route` (v28, Shek's call 2026-08-10): the settlements occupy keypad zones 7 and 3.
 * The only finite trail follows 7→4→5→6→3, so each side must make one meaningful turn before
 * reaching the same centre rather than following a straight vertical corridor. Fourteen visible
 * links per side hold a non-decreasing 95 food in total, one side-route stone cell holds 12, the Oasis
 * renews 12 food per turn, and four central stone cells expose one shared 120-stone pool.
 *
 * `corridor-unique-oasis-wide-sight` (v29, Shek's call 2026-08-10): restores v27's exact terrain,
 * food and stone geometry while protocol 16 widens worker sight from 6 to 8. The extra two cells
 * reveal more only where a worker physically travels; no destination, direction or world boundary
 * is added to the report. The wider observation radius reduces blind turns without omniscience.
 *
 * `corridor-wide-sight-stone` (v30, Shek's call 2026-08-10): identical to
 * `corridor-unique-oasis-wide-sight` in terrain, food, Oasis and protocol, and it changes exactly
 * one number — the shared home quarry holds 90 stone instead of 40. v29 measured why: south
 * exhausted its home quarry, then paid structure upkeep it could not fund and watched its own hall
 * lose an exposed block every turn while owing 12 stone it had no spare worker to mine. A stone
 * reserve that cannot cover a settlement's own first structures makes building self-punishing
 * before either side can weigh travelling for more. Central stone is unchanged, so the long-run
 * scarcity that pushes both sides outward is untouched.
 *
 * `corridor-wide-sight-drop` (v31): the same world as `corridor-wide-sight-stone` in every
 * respect — terrain, food, Oasis, stone, sight — carrying protocol 17 instead of 16. The protocol
 * travels with the variant rather than with a caller-supplied argument, because six code paths
 * rebuild a season's world from its seed alone and a forgotten override would silently produce a
 * different world on replay. Protocol 17 changes the engine's language (English), adds `drop`,
 * and gives foreign workers physical occupation. v30 measured why `drop` is needed: its two
 * civilizations negotiated a barter for forty turns that no action could carry out.
 *
 * `corridor-wide-sight-mixed-carry` (v32): v31's world byte-for-byte, carrying protocol 18.
 * A partially filled backpack may continue at another food or stone source instead of being
 * forced home merely because the resource kind changed. The worker still returns when the
 * combined load reaches capacity, and every deposit remains physical.
 *
 * `corridor-wide-sight-contact-gated` (v33): v32's world and mechanics byte-for-byte, carrying
 * protocol 19. Before first sight of a person or standing structure not belonging to the
 * settlement, the private interface contains no foreign-observation headings, correspondence
 * shapes, or ownership rules that imply anybody else exists. Those facts and actions unlock on
 * the first report after contact.
 *
 * `corridor-wide-sight-tight-economy` (v34): v33's terrain, finite food route, home quarry and
 * interface are retained. The compact Oasis falls from 16 to 12 food per turn, central stone falls
 * from 800 to 200, and completed structures return to the 20-free-block ceil upkeep curve. This
 * keeps stone relevant after the first Store and makes the shared middle unable to feed two
 * healthy settlements without a deficit.
 *
 * `corridor-wide-sight-logistics-corrected` (v35): v34's world and economy byte-for-byte,
 * carrying protocol 21. The interface now exposes the already-existing `drop` action correctly,
 * storage route previews use the engine's whole-load-first selection, and builders avoid a short
 * but insufficient stone pickup or an unnecessary pickup already covered by stone in transit.
 */
export type MapVariant =
  | "classic"
  | "gradient"
  | "scarce"
  | "corridor"
  | "corridor-tight"
  | "corridor-survive"
  | "corridor-oasis"
  | "corridor-shared-oasis"
  | "corridor-visible-oasis"
  | "corridor-unique-oasis"
  | "numpad-route"
  | "corridor-unique-oasis-wide-sight"
  | "corridor-wide-sight-stone"
  | "corridor-wide-sight-drop"
  | "corridor-wide-sight-mixed-carry"
  | "corridor-wide-sight-contact-gated"
  | "corridor-wide-sight-tight-economy"
  | "corridor-wide-sight-logistics-corrected";

export const SEED_VARIANTS: Record<number, MapVariant> = {
  20260805: "gradient",
  20260806: "scarce",
  20260807: "corridor",
  20260808: "corridor-tight",
  20260809: "corridor-survive",
  20260810: "corridor-oasis",
  20260811: "corridor-shared-oasis",
  20260812: "corridor-visible-oasis",
  20260813: "corridor-unique-oasis",
  20260814: "numpad-route",
  20260815: "corridor-unique-oasis-wide-sight",
  20260816: "corridor-wide-sight-stone",
  20260817: "corridor-wide-sight-drop",
  20260818: "corridor-wide-sight-mixed-carry",
  20260819: "corridor-wide-sight-contact-gated",
  20260820: "corridor-wide-sight-tight-economy",
  20260821: "corridor-wide-sight-logistics-corrected",
};

/** v29 and v30 share v27's terrain generation; only their resource totals differ. */
export function isWideSightVariant(variant: MapVariant) {
  return (
    variant === "corridor-unique-oasis-wide-sight" ||
    variant === "corridor-wide-sight-stone" ||
    variant === "corridor-wide-sight-drop" ||
    variant === "corridor-wide-sight-mixed-carry" ||
    variant === "corridor-wide-sight-contact-gated" ||
    variant === "corridor-wide-sight-tight-economy" ||
    variant === "corridor-wide-sight-logistics-corrected"
  );
}

/** Protocol 17+: English engine text, `drop` and physical occupation. */
export function isProtocol17Variant(variant: MapVariant) {
  return (
    variant === "corridor-wide-sight-drop" ||
    variant === "corridor-wide-sight-mixed-carry" ||
    variant === "corridor-wide-sight-contact-gated" ||
    variant === "corridor-wide-sight-tight-economy" ||
    variant === "corridor-wide-sight-logistics-corrected"
  );
}

/** Protocol 18: protocol 17 plus mixed-resource gathering in one backpack. */
export function isProtocol18Variant(variant: MapVariant) {
  return (
    variant === "corridor-wide-sight-mixed-carry" ||
    variant === "corridor-wide-sight-contact-gated" ||
    variant === "corridor-wide-sight-tight-economy" ||
    variant === "corridor-wide-sight-logistics-corrected"
  );
}

/** Protocol 19: protocol 18 plus a contact-gated private interface. */
export function isProtocol19Variant(variant: MapVariant) {
  return (
    variant === "corridor-wide-sight-contact-gated" ||
    variant === "corridor-wide-sight-tight-economy" ||
    variant === "corridor-wide-sight-logistics-corrected"
  );
}

/** Protocol 20: protocol 19 plus the v34 economy calibration. */
export function isProtocol20Variant(variant: MapVariant) {
  return variant === "corridor-wide-sight-tight-economy" || variant === "corridor-wide-sight-logistics-corrected";
}

/** Protocol 21: protocol 20 plus corrected logistics interface and routing. */
export function isProtocol21Variant(variant: MapVariant) {
  return variant === "corridor-wide-sight-logistics-corrected";
}

export function isUniqueOasisVariant(variant: MapVariant) {
  return variant === "corridor-unique-oasis" || isWideSightVariant(variant);
}

/** Every corridor-family variant shares one pass, one marker chain and one core. */
export function isCorridorVariant(variant: MapVariant) {
  return (
    variant === "corridor" ||
    variant === "corridor-tight" ||
    variant === "corridor-survive" ||
    variant === "corridor-oasis" ||
    variant === "corridor-shared-oasis" ||
    variant === "corridor-visible-oasis" ||
    variant === "corridor-unique-oasis" ||
    variant === "numpad-route" ||
    isWideSightVariant(variant)
  );
}

export function hallOrigin(seed: number, civ: CivId) {
  return { ...(mapVariant(seed) === "numpad-route" ? V28_HALL_ORIGIN[civ] : HALL_ORIGIN[civ]) };
}

export function spawnPoint(seed: number, civ: CivId) {
  const origin = hallOrigin(seed, civ);
  return { x: origin.x + 3, z: origin.z + 3 };
}

export function homeQuarryPoint(seed: number, civ: CivId) {
  return { ...(mapVariant(seed) === "numpad-route" ? V28_ROUTE_QUARRY[civ] : HOME_QUARRY[civ]) };
}

/** Total stone shared across a civilization's home quarry tiles, per variant. */
export const HOME_QUARRY_TOTAL: Record<MapVariant, number> = {
  classic: RULES.homeQuarry,
  gradient: RULES.homeQuarry,
  scarce: 60,
  corridor: 45,
  "corridor-tight": 40,
  "corridor-survive": 40,
  "corridor-oasis": 40,
  "corridor-shared-oasis": 40,
  "corridor-visible-oasis": 40,
  "corridor-unique-oasis": 40,
  "numpad-route": 0,
  "corridor-unique-oasis-wide-sight": 40,
  "corridor-wide-sight-stone": 90,
  "corridor-wide-sight-drop": 90,
  "corridor-wide-sight-mixed-carry": 90,
  "corridor-wide-sight-contact-gated": 90,
  "corridor-wide-sight-tight-economy": 90,
  "corridor-wide-sight-logistics-corrected": 90,
};

/** Stone shared across the central core tiles, per variant. */
export const CENTRE_STONE_TOTAL: Record<MapVariant, number> = {
  classic: 2400,
  gradient: 2400,
  scarce: 2400,
  corridor: 2400,
  "corridor-tight": 2400,
  "corridor-survive": 800,
  "corridor-oasis": 800,
  "corridor-shared-oasis": 800,
  "corridor-visible-oasis": 800,
  "corridor-unique-oasis": 800,
  "numpad-route": 120,
  "corridor-unique-oasis-wide-sight": 800,
  "corridor-wide-sight-stone": 800,
  "corridor-wide-sight-drop": 800,
  "corridor-wide-sight-mixed-carry": 800,
  "corridor-wide-sight-contact-gated": 800,
  "corridor-wide-sight-tight-economy": 200,
  "corridor-wide-sight-logistics-corrected": 200,
};

/**
 * Long-run food income per home field, per variant. This is the number `corridor-survive`
 * moves, and the standing larder is deliberately left alone.
 *
 * The first v23 spike cut the larder instead (120 → 24) and it was measurably wrong: every
 * strategy died, and the strategy that tried to relocate died *before* the one that sat still.
 * Relocating means paying three workers to build a forward store for several turns with no
 * food coming in, and the larder is exactly the capital that pays for those turns. Cutting it
 * did not force a move, it made moving unaffordable. Cutting income instead makes home fail
 * while leaving the fare to leave.
 */
export const HOME_FIELD_REGEN: Record<MapVariant, number> = {
  classic: 3,
  gradient: 3,
  scarce: 3,
  corridor: 3,
  "corridor-tight": 2,
  "corridor-survive": 1,
  "corridor-oasis": 0,
  "corridor-shared-oasis": 0,
  "corridor-visible-oasis": 0,
  "corridor-unique-oasis": 0,
  "numpad-route": 0,
  "corridor-unique-oasis-wide-sight": 0,
  "corridor-wide-sight-stone": 0,
  "corridor-wide-sight-drop": 0,
  "corridor-wide-sight-mixed-carry": 0,
  "corridor-wide-sight-contact-gated": 0,
  "corridor-wide-sight-tight-economy": 0,
  "corridor-wide-sight-logistics-corrected": 0,
};

/** Probability that a central-belt cell becomes farmland, per variant. */
export const CENTRE_BELT_DENSITY: Record<MapVariant, number> = {
  classic: 0,
  gradient: 0.06,
  scarce: 0.06,
  corridor: 0.12,
  "corridor-tight": 0.12,
  "corridor-survive": 0.05,
  "corridor-oasis": 0,
  "corridor-shared-oasis": 0,
  "corridor-visible-oasis": 0,
  "corridor-unique-oasis": 0,
  "numpad-route": 0,
  "corridor-unique-oasis-wide-sight": 0,
  "corridor-wide-sight-stone": 0,
  "corridor-wide-sight-drop": 0,
  "corridor-wide-sight-mixed-carry": 0,
  "corridor-wide-sight-contact-gated": 0,
  "corridor-wide-sight-tight-economy": 0,
  "corridor-wide-sight-logistics-corrected": 0,
};

export function mapVariant(seed: number): MapVariant {
  return SEED_VARIANTS[seed] ?? "classic";
}

/** Fixed home-ring fields (north half; mirrored for south). Kept clear of the
 * 6×6 hall footprint at (45,9) and chosen within ~11 tiles of the spawn. */
export const GRADIENT_HOME_FIELDS: Point[] = [
  { x: 40, z: 5 },
  { x: 52, z: 5 },
  { x: 38, z: 12 },
  { x: 56, z: 12 },
  { x: 44, z: 18 },
  { x: 52, z: 18 },
];

/** Sparse stepping stones between home and the ridge passes. */
export const GRADIENT_STEPPING_FIELDS: Point[] = [
  { x: 40, z: 27 },
  { x: 54, z: 28 },
  { x: 46, z: 31 },
  { x: 20, z: 30 },
  { x: 70, z: 32 },
];

/** The corridor variant deliberately has no east/west decoys near home. */
export const CORRIDOR_HOME_FIELDS: Point[] = [
  { x: 40, z: 5 },
  { x: 56, z: 12 },
  { x: 44, z: 18 },
];

/** Food remains available only by following the same central route as stone. */
export const CORRIDOR_FOOD_MARKERS: Point[] = [
  { x: 47, z: 27 },
  { x: 46, z: 32 },
  { x: 47, z: 37 },
  { x: 48, z: 42 },
];

/**
 * v26 route. The hall already sees the first cell; every later cell is no more than
 * one worker-sight radius from the previous one, including the final compact oasis.
 */
export const VISIBLE_OASIS_FOOD_MARKERS: Point[] = [
  { x: 46, z: 23 },
  { x: 47, z: 28 },
  { x: 47, z: 34 },
  { x: 48, z: 39 },
  { x: 48, z: 44 },
];
export const VISIBLE_OASIS_HOME_FOOD = 40;
export const VISIBLE_OASIS_ROUTE_FOOD = [50, 60, 70, 80, 90] as const;

/**
 * Outward regrowth for `CORRIDOR_FOOD_MARKERS`, nearest home first. Two purposes: it is the
 * only navigation aid either side gets, and the first two links must be rich enough that a
 * settlement which builds one forward store is comfortably fed rather than exactly fed. A
 * 3/4/5/6 chain put "home + own chain" at precisely the population ceiling, and the scan
 * showed that knife edge behaving chaotically — the mover survived at ceiling 10 and died at
 * both 9 and 11. Slack, not balance, is what makes the escape a real strategy.
 */
export const CHAIN_REGEN = [4, 6, 8, 10];

export const OASIS_HOME_FOOD = 90;
export const OASIS_INNER_MARKER_FOOD = 30;
export const OASIS_RENEWABLE_FOOD = 40;
export const OASIS_RENEWABLE_REGEN = 4;

/** North-half cells for v25's single compact oasis; the southern half is the 180° mirror. */
export const SHARED_OASIS_FOOD: Point[] = [
  { x: 45, z: 47 },
  { x: 50, z: 47 },
];
export const SHARED_OASIS_FOOD_AMOUNT = 60;
export const SHARED_OASIS_FOOD_REGEN = 4;
export const SHARED_OASIS_ROUTE_FOOD = 50;

/** v27's one central resource: a rotationally symmetric footprint with one shared pool. */
export const UNIQUE_OASIS_CELLS: Point[] = [
  { x: 47, z: 47 },
  { x: 48, z: 47 },
  { x: 47, z: 48 },
  { x: 48, z: 48 },
];
export const UNIQUE_OASIS_CAP = 16;
export const UNIQUE_OASIS_REGEN = 16;
export const V34_OASIS_CAP = 12;
export const V34_OASIS_REGEN = 12;

/** Protocol 15's north-side half of keypad route 7→4→5; the south side is its 180° mirror. */
export const V28_FOOD_MARKERS: Point[] = [
  { x: 16, z: 20 },
  { x: 16, z: 25 },
  { x: 16, z: 28 },
  { x: 16, z: 32 },
  { x: 16, z: 36 },
  { x: 16, z: 40 },
  { x: 16, z: 44 },
  { x: 20, z: 44 },
  { x: 24, z: 44 },
  { x: 28, z: 44 },
  { x: 32, z: 44 },
  { x: 36, z: 44 },
  { x: 40, z: 44 },
  { x: 44, z: 46 },
];
export const V28_FOOD_AMOUNTS = [4, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 9, 9] as const;
export const V28_OASIS_CAP = 12;
export const V28_OASIS_REGEN = 12;
export const V28_ROUTE_STONE = 12;
export const V28_SHARED_STONE_CAP = 120;
export const V28_SHARED_STONE_CELLS: Point[] = [
  { x: 48, z: 45 },
  { x: 45, z: 47 },
  { x: 50, z: 48 },
  { x: 47, z: 50 },
];

/** Each marker is close enough to reveal the next one from a worker's position. */
export const CORRIDOR_STONE_MARKERS: Point[] = [
  { x: 42, z: 28 },
  { x: 43, z: 33 },
  { x: 44, z: 38 },
];

export const CORRIDOR_MARKER_STONE = 15;

/** Large stone exists only in the shared core, so miners cannot stop on opposite outer edges. */
export const CORRIDOR_CORE_STONE: Point[] = [
  { x: 46, z: 45 },
  { x: 49, z: 45 },
  { x: 47, z: 46 },
  { x: 48, z: 46 },
];

/** North-half rows of the central farmland belt (south mirror lands on 49–61). */
export const GRADIENT_BELT_FROM_Z = 35;

export function idx(x: number, z: number, width = RULES.width) {
  return z * width + x;
}

export function inBounds(x: number, z: number) {
  return x >= 0 && z >= 0 && x < RULES.width && z < RULES.height;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The map is generated for the northern half only and then rotated 180° onto the
 * southern half, so both civilizations receive identical terrain and distances.
 * Any difference in outcome is therefore attributable to the agent, not the map.
 */
export function createMap(seed = 20260802): Tile[] {
  const { width, height } = RULES;
  const variant = mapVariant(seed);
  const random = mulberry32(isWideSightVariant(variant) ? 20260813 : seed);
  const tiles: Tile[] = Array.from({ length: width * height }, () => ({ terrain: "grass" as const }));

  const half = height / 2;
  const set = (x: number, z: number, terrain: Tile["terrain"]) => {
    if (!inBounds(x, z) || z >= half) return;
    tiles[idx(x, z)] = { terrain };
  };

  const spawn = { north: spawnPoint(seed, "north"), south: spawnPoint(seed, "south") };
  const homeQuarry = homeQuarryPoint(seed, "north");
  if (variant === "classic") {
    for (let z = 0; z < half; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const distanceToSpawn = Math.hypot(x - SPAWN.north.x, z - SPAWN.north.z);
        const roll = random();
        if (distanceToSpawn < 18 && roll < 0.16) set(x, z, "field");
        else if (distanceToSpawn < 30 && roll < 0.05) set(x, z, "field");
        else if (distanceToSpawn >= 30 && roll < 0.012) set(x, z, "field");
      }
    }
  } else if (variant === "gradient" || variant === "scarce") {
    for (let z = 0; z < half; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const roll = random();
        if (z >= GRADIENT_BELT_FROM_Z && roll < 0.06) set(x, z, "field");
      }
    }
    for (const p of GRADIENT_HOME_FIELDS) set(p.x, p.z, "field");
    for (const p of GRADIENT_STEPPING_FIELDS) set(p.x, p.z, "field");
  } else if (isCorridorVariant(variant)) {
    for (let z = 39; z < half; z += 1) {
      for (let x = 32; x <= 63; x += 1) {
        if (random() < CENTRE_BELT_DENSITY[variant]) set(x, z, "field");
      }
    }
    if (variant === "numpad-route") {
      for (const p of V28_FOOD_MARKERS) set(p.x, p.z, "field");
    } else {
      for (const p of CORRIDOR_HOME_FIELDS) set(p.x, p.z, "field");
      const routeFood =
        variant === "corridor-visible-oasis" || isUniqueOasisVariant(variant)
          ? VISIBLE_OASIS_FOOD_MARKERS
          : CORRIDOR_FOOD_MARKERS;
      for (const p of routeFood) set(p.x, p.z, "field");
      if (variant === "corridor-shared-oasis" || variant === "corridor-visible-oasis") {
        for (const p of SHARED_OASIS_FOOD) set(p.x, p.z, "field");
      }
    }
    if (isUniqueOasisVariant(variant) || variant === "numpad-route") {
      for (const p of UNIQUE_OASIS_CELLS.filter((point) => point.z < half)) set(p.x, p.z, "oasis");
    }
  } else {
    throw new Error(`Unhandled map variant: ${variant}`);
  }

  if (variant === "numpad-route") {
    blob(set, random, { x: 58, z: 15 }, 6, "water");
    blob(set, random, { x: 78, z: 30 }, 5, "water");
    blob(set, random, { x: 38, z: 24 }, 4, "water");
  } else {
    blob(set, random, { x: 20, z: 16 }, 5, "water");
    blob(set, random, { x: 74, z: 27 }, 4, "water");
    blob(set, random, { x: 12, z: 40 }, 6, "water");
  }

  const ridgePasses: Array<[number, number]> =
    isCorridorVariant(variant)
      ? variant === "numpad-route"
        ? [[13, 21]]
        : [[43, 52]]
      : [
          [16, 22],
          [43, 47],
          [70, 75],
        ];
  ridge(set, 33, ridgePasses);
  ridge(set, 34, ridgePasses);

  if (variant !== "numpad-route") blob(set, random, homeQuarry, 2, "stone");
  if (variant === "numpad-route") {
    set(V28_ROUTE_QUARRY.north.x, V28_ROUTE_QUARRY.north.z, "stone");
    for (const p of V28_SHARED_STONE_CELLS.filter((point) => point.z < half)) set(p.x, p.z, "stone");
  } else if (isCorridorVariant(variant)) {
    for (const p of CORRIDOR_STONE_MARKERS) set(p.x, p.z, "stone");
    for (const p of CORRIDOR_CORE_STONE) set(p.x, p.z, "stone");
  } else {
    blob(set, random, { x: 41, z: 44 }, 3, "stone");
    blob(set, random, { x: 56, z: 45 }, 3, "stone");
  }

  for (let z = 0; z < half; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = tiles[idx(x, z)];
      tiles[idx(width - 1 - x, height - 1 - z)] = { terrain: source.terrain };
    }
  }

  const variantStoneMarkers = variant === "numpad-route" ? [V28_ROUTE_QUARRY.north] : CORRIDOR_STONE_MARKERS;
  const corridorMarkers = new Set(
    variantStoneMarkers.flatMap((p) => [
      `${p.x},${p.z}`,
      `${width - 1 - p.x},${height - 1 - p.z}`,
    ]),
  );
  const isCorridorMarker = (x: number, z: number) =>
    isCorridorVariant(variant) && corridorMarkers.has(`${x},${z}`);
  /**
   * The food chain's regrowth rises with each step outward, so a worker standing on one
   * marker can read a strictly better reason to take the next. Index 0 is the marker nearest
   * home; the mirrored southern copy of a marker keeps its index, so both sides see the same
   * gradient pointing at the middle.
   */
  const cordonFoodRegen = new Map<string, number>();
  if (variant === "corridor-survive") {
    CORRIDOR_FOOD_MARKERS.forEach((p, index) => {
      const regen = CHAIN_REGEN[index] ?? 3;
      cordonFoodRegen.set(`${p.x},${p.z}`, regen);
      cordonFoodRegen.set(`${width - 1 - p.x},${height - 1 - p.z}`, regen);
    });
  }
  const oasisFood = new Map<string, { amount: number; cap: number; regen: number }>();
  if (variant === "corridor-oasis") {
    for (const p of CORRIDOR_HOME_FIELDS) {
      for (const point of [p, { x: width - 1 - p.x, z: height - 1 - p.z }]) {
        oasisFood.set(`${point.x},${point.z}`, {
          amount: OASIS_HOME_FOOD,
          cap: OASIS_HOME_FOOD,
          regen: 0,
        });
      }
    }
    CORRIDOR_FOOD_MARKERS.forEach((p, index) => {
      const finite = index < 2;
      const node = finite
        ? { amount: OASIS_INNER_MARKER_FOOD, cap: OASIS_INNER_MARKER_FOOD, regen: 0 }
        : { amount: OASIS_RENEWABLE_FOOD, cap: OASIS_RENEWABLE_FOOD, regen: OASIS_RENEWABLE_REGEN };
      oasisFood.set(`${p.x},${p.z}`, node);
      oasisFood.set(`${width - 1 - p.x},${height - 1 - p.z}`, { ...node });
    });
  }
  if (variant === "corridor-shared-oasis") {
    for (const p of CORRIDOR_HOME_FIELDS) {
      for (const point of [p, { x: width - 1 - p.x, z: height - 1 - p.z }]) {
        oasisFood.set(`${point.x},${point.z}`, {
          amount: OASIS_HOME_FOOD,
          cap: OASIS_HOME_FOOD,
          regen: 0,
        });
      }
    }
    for (const p of CORRIDOR_FOOD_MARKERS) {
      const node = { amount: SHARED_OASIS_ROUTE_FOOD, cap: SHARED_OASIS_ROUTE_FOOD, regen: 0 };
      oasisFood.set(`${p.x},${p.z}`, node);
      oasisFood.set(`${width - 1 - p.x},${height - 1 - p.z}`, { ...node });
    }
    for (const p of SHARED_OASIS_FOOD) {
      const node = {
        amount: SHARED_OASIS_FOOD_AMOUNT,
        cap: SHARED_OASIS_FOOD_AMOUNT,
        regen: SHARED_OASIS_FOOD_REGEN,
      };
      oasisFood.set(`${p.x},${p.z}`, node);
      oasisFood.set(`${width - 1 - p.x},${height - 1 - p.z}`, { ...node });
    }
  }
  if (variant === "corridor-visible-oasis" || isUniqueOasisVariant(variant)) {
    for (const p of CORRIDOR_HOME_FIELDS) {
      for (const point of [p, { x: width - 1 - p.x, z: height - 1 - p.z }]) {
        oasisFood.set(`${point.x},${point.z}`, {
          amount: VISIBLE_OASIS_HOME_FOOD,
          cap: VISIBLE_OASIS_HOME_FOOD,
          regen: 0,
        });
      }
    }
    VISIBLE_OASIS_FOOD_MARKERS.forEach((p, index) => {
      const amount = VISIBLE_OASIS_ROUTE_FOOD[index];
      const node = { amount, cap: amount, regen: 0 };
      oasisFood.set(`${p.x},${p.z}`, node);
      oasisFood.set(`${width - 1 - p.x},${height - 1 - p.z}`, { ...node });
    });
    if (variant === "corridor-visible-oasis") {
      for (const p of SHARED_OASIS_FOOD) {
        const node = {
          amount: SHARED_OASIS_FOOD_AMOUNT,
          cap: SHARED_OASIS_FOOD_AMOUNT,
          regen: SHARED_OASIS_FOOD_REGEN,
        };
        oasisFood.set(`${p.x},${p.z}`, node);
        oasisFood.set(`${width - 1 - p.x},${height - 1 - p.z}`, { ...node });
      }
    }
  }
  if (variant === "numpad-route") {
    V28_FOOD_MARKERS.forEach((p, index) => {
      const amount = V28_FOOD_AMOUNTS[index];
      const node = { amount, cap: amount, regen: 0 };
      oasisFood.set(`${p.x},${p.z}`, node);
      oasisFood.set(`${width - 1 - p.x},${height - 1 - p.z}`, { ...node });
    });
  }
  const homeStone = countTerrain(
    tiles,
    "stone",
    (x, z) => !isCorridorMarker(x, z) && Math.hypot(x - spawn.north.x, z - spawn.north.z) < 26,
  );
  const centreStone = countTerrain(
    tiles,
    "stone",
    (x, z) => !isCorridorMarker(x, z) && Math.abs(z - CENTRE.z) <= 14,
  );

  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const tile = tiles[idx(x, z)];
      if (tile.terrain === "field") {
        const oasisNode = oasisFood.get(`${x},${z}`);
        const homeField =
          Math.hypot(x - spawn.north.x, z - spawn.north.z) <= RULES.buildRadius ||
          Math.hypot(x - spawn.south.x, z - spawn.south.z) <= RULES.buildRadius;
        const regen = cordonFoodRegen.get(`${x},${z}`) ?? (homeField ? HOME_FIELD_REGEN[variant] : 3);
        tile.node = oasisNode
          ? { kind: "food", ...oasisNode }
          : { kind: "food", amount: 120, cap: 120, regen };
      }
      if (tile.terrain === "oasis") {
        const tightEconomy = isProtocol20Variant(variant);
        tile.node = {
          kind: "food",
          amount: variant === "numpad-route" ? V28_OASIS_CAP : tightEconomy ? V34_OASIS_CAP : UNIQUE_OASIS_CAP,
          cap: variant === "numpad-route" ? V28_OASIS_CAP : tightEconomy ? V34_OASIS_CAP : UNIQUE_OASIS_CAP,
          regen: variant === "numpad-route" ? V28_OASIS_REGEN : tightEconomy ? V34_OASIS_REGEN : UNIQUE_OASIS_REGEN,
        };
      }
      if (tile.terrain === "stone") {
        const centreBand = !isCorridorMarker(x, z) && Math.abs(z - CENTRE.z) <= 14;
        const amount = isCorridorMarker(x, z)
          ? variant === "numpad-route"
            ? V28_ROUTE_STONE
            : CORRIDOR_MARKER_STONE
          : centreBand
          ? Math.round(CENTRE_STONE_TOTAL[variant] / Math.max(1, centreStone))
          : Math.round(HOME_QUARRY_TOTAL[variant] / Math.max(1, homeStone));
        tile.node = { kind: "stone", amount, cap: amount, regen: 0 };
      }
    }
  }

  if (variant === "numpad-route") {
    for (const cell of V28_SHARED_STONE_CELLS) {
      const node = tiles[idx(cell.x, cell.z)].node;
      if (node?.kind === "stone") node.pool = "shared-stone";
    }
  }

  clearArea(tiles, spawn.north, 4);
  clearArea(tiles, spawn.south, 4);
  return tiles;
}

function countTerrain(tiles: Tile[], terrain: Tile["terrain"], filter: (x: number, z: number) => boolean) {
  let count = 0;
  for (let z = 0; z < RULES.height; z += 1) {
    for (let x = 0; x < RULES.width; x += 1) {
      if (tiles[idx(x, z)].terrain === terrain && filter(x, z)) count += 1;
    }
  }
  return count;
}

function clearArea(tiles: Tile[], centre: Point, radius: number) {
  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = centre.x + dx;
      const z = centre.z + dz;
      if (!inBounds(x, z)) continue;
      const tile = tiles[idx(x, z)];
      if (tile.terrain === "water" || tile.terrain === "ridge") {
        tiles[idx(x, z)] = { terrain: "grass" };
      }
    }
  }
}

type Setter = (x: number, z: number, terrain: Tile["terrain"]) => void;

function blob(set: Setter, random: () => number, centre: Point, radius: number, terrain: Tile["terrain"]) {
  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const distance = Math.hypot(dx, dz);
      if (distance > radius) continue;
      if (distance > radius - 1 && random() < 0.45) continue;
      set(centre.x + dx, centre.z + dz, terrain);
    }
  }
}

function ridge(set: Setter, z: number, passes: Array<[number, number]>) {
  for (let x = 0; x < RULES.width; x += 1) {
    if (passes.some(([from, to]) => x >= from && x <= to)) continue;
    set(x, z, "ridge");
  }
}

export function walkableTerrain(tile: Tile) {
  return tile.terrain !== "water" && tile.terrain !== "ridge";
}
