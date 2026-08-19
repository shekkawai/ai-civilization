import { idx } from "@/sim/map";
import {
  FOOD_INK,
  MAP,
  NORTH_EDGE,
  NORTH_FILL,
  NORTH_INK,
  NORTH_WASH,
  SOUTH_EDGE,
  SOUTH_FILL,
  SOUTH_INK,
  SOUTH_WASH,
  STONE_INK,
} from "@/lib/paper";
import type { CivId, Frame, Terrain } from "@/sim/types";

export type ViewLens = "truth" | CivId;

export function isTileKnown(frame: Frame, lens: ViewLens, x: number, z: number) {
  return lens === "truth" || frame.fog[lens][idx(x, z)] !== 0;
}

export function isWorkerVisible(frame: Frame, lens: ViewLens, worker: Frame["workers"][number]) {
  return lens === "truth" || worker.owner === lens || frame.fog[lens][idx(worker.x, worker.z)] === 2;
}

export function visibleWorkersAt(frame: Frame, lens: ViewLens, x: number, z: number) {
  return frame.workers.filter(
    (worker) => worker.x === x && worker.z === z && isWorkerVisible(frame, lens, worker),
  );
}

/**
 * Civilization identity on paper. North is warm/earth, south is cold/water — a
 * temperature split rather than a hue split, so it survives every common colour
 * vision deficiency. Both clear AA against the paper ground as text.
 *
 * Colour is never the only carrier of identity: every place these appear, the UI
 * also prints the civilization's name, an initial, or a labelled column.
 */
export const CIV_COLOR: Record<CivId, string> = {
  north: NORTH_INK,
  south: SOUTH_INK,
};

/** Block bodies. Lighter than the ink so the edge stroke still reads on top. */
export const CIV_SHADE: Record<CivId, string> = {
  north: NORTH_FILL,
  south: SOUTH_FILL,
};

/** Edge stroke for blocks and worker outlines. */
export const CIV_EDGE: Record<CivId, string> = {
  north: NORTH_EDGE,
  south: SOUTH_EDGE,
};

export const CIV_SOFT: Record<CivId, string> = {
  north: NORTH_WASH,
  south: SOUTH_WASH,
};

export const TERRAIN_COLOR: Record<Terrain, string> = {
  grass: MAP.grass,
  field: MAP.field,
  oasis: MAP.oasis,
  stone: MAP.stone,
  water: MAP.water,
  ridge: MAP.ridge,
};

/** Deeper tone of the same ground, blended in by the per-tile noise for texture. */
export const TERRAIN_SHADE: Record<Terrain, string> = {
  grass: MAP.grassShade,
  field: MAP.fieldShade,
  oasis: MAP.oasisShade,
  stone: MAP.stoneShade,
  water: MAP.waterShade,
  ridge: MAP.ridgeShade,
};

export const RESOURCE_COLOR = {
  food: FOOD_INK,
  stone: STONE_INK,
};

export const PILE_COLOR = MAP.pile;
export const VOID_COLOR = MAP.void;

export const TERRAIN_KEY: Record<Terrain, string> = {
  grass: "terrain.grass",
  field: "terrain.field",
  oasis: "terrain.oasis",
  stone: "terrain.stone",
  water: "terrain.water",
  ridge: "terrain.ridge",
};

export const TERRAIN_NOTE_KEY: Record<Terrain, string> = {
  grass: "terrain.grass.note",
  field: "terrain.field.note",
  oasis: "terrain.oasis.note",
  stone: "terrain.stone.note",
  water: "terrain.water.note",
  ridge: "terrain.ridge.note",
};

export const JOB_KEY: Record<string, string> = {
  idle: "job.idle",
  move: "job.move",
  deposit: "job.deposit",
  gather: "job.gather",
  build: "job.build",
  repair: "job.repair",
  remove: "job.remove",
};

export const CIV_KEY: Record<CivId, string> = {
  north: "civ.north",
  south: "civ.south",
};

export function hoursToDays(turn: number, hoursPerTurn: number, lang: "zh" | "en") {
  const hours = turn * hoursPerTurn;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  if (lang === "en") {
    if (days === 0) return `${hours}h`;
    return rest === 0 ? `day ${days}` : `day ${days}, ${rest}h`;
  }
  if (days === 0) return `${hours} 小時`;
  return rest === 0 ? `第 ${days} 天` : `第 ${days} 天 ${rest} 小時`;
}
