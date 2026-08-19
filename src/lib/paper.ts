/**
 * The paper palette. One source of truth for every colour in the redesign.
 *
 * The site is printed, not lit: a warm off-white ground with ink on top, the map
 * drawn like a cartographic plan rather than a glowing game world. Two rules the
 * rest of the app depends on:
 *
 *  1. Every colour used for text clears WCAG AA (4.5:1) on `PAPER`. `INK_3` at
 *     4.6:1 is the lightest text tone that exists; there is nothing below it.
 *  2. Civilization identity is warm-vs-cold, not red-vs-green, so it survives
 *     every common colour-vision deficiency — and identity is never carried by
 *     colour alone anywhere in the UI.
 */

export const PAPER = "#faf8f3";
export const PAPER_SUNK = "#f2efe6";
export const SURFACE = "#ffffff";

export const LINE = "#e6e1d5";
export const LINE_STRONG = "#cfc8b6";

export const INK = "#1c1a15";
export const INK_2 = "#55524a";
export const INK_3 = "#6f6b5d";

/** North reads warm/earth, south reads cold/water. 5.0:1 and 6.5:1 on PAPER. */
export const NORTH_INK = "#a8541a";
export const SOUTH_INK = "#10627a";

/** Lighter fills for blocks and bars, where ink-strength would go muddy. */
export const NORTH_FILL = "#c9762e";
export const SOUTH_FILL = "#2b8199";
export const NORTH_EDGE = "#8a4413";
export const SOUTH_EDGE = "#0c556a";
export const NORTH_WASH = "rgba(168, 84, 26, 0.10)";
export const SOUTH_WASH = "rgba(16, 98, 122, 0.10)";

/** Map ground. Deliberately low-chroma so the two civ colours stay the loudest thing. */
export const MAP = {
  void: "#efece2",
  grid: "rgba(28, 26, 21, 0.05)",
  frame: "#cfc8b6",

  grass: "#e4e2d2",
  grassShade: "#dbd8c5",
  field: "#cbd493",
  fieldShade: "#bcc57e",
  fieldSpent: "#dedfc9",
  oasis: "#8fc9b3",
  oasisShade: "#75b59f",
  oasisSpent: "#cde0d8",
  stone: "#c3bfb2",
  stoneShade: "#b3ae9e",
  stoneSpent: "#d6d3c9",
  water: "#b7d3de",
  waterShade: "#a5c7d5",
  ridge: "#a89e8b",
  ridgeShade: "#99907c",

  /** Never-seen ground under a civ lens: paper with a faint dot screen. */
  unknown: "#f4f2ea",
  unknownDot: "rgba(28, 26, 21, 0.07)",
  /** Seen once, not visible now — the world greys back toward paper. */
  stale: "rgba(250, 248, 243, 0.58)",
  staleLine: "rgba(28, 26, 21, 0.16)",
  sightLine: "rgba(28, 26, 21, 0.62)",

  pile: "#d9a441",
  pileEdge: "#9a7420",
  select: "#1c1a15",
  selectHalo: "rgba(255, 255, 255, 0.85)",
  label: "#1c1a15",
  labelBg: "rgba(255, 255, 255, 0.92)",
  labelLine: "#cfc8b6",
} as const;

/** Resource identity, used by meters and charts alike. */
export const FOOD_INK = "#5f7d1f";
export const STONE_INK = "#5d6b7a";

/** States that are not a civilization: warnings, gains, losses. */
export const WARN_INK = "#9a5b06";
export const WARN_WASH = "rgba(154, 91, 6, 0.10)";
export const LIVE_INK = "#1f7a4d";
export const LIVE_WASH = "rgba(31, 122, 77, 0.10)";
