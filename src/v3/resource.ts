import type { Resource } from "../sim/types";

/**
 * How a resource tile is drawn, in one place.
 *
 * Two things were wrong with the previous scheme and both of them made the middle of the map
 * unreadable:
 *
 * 1. **Every node was the same green dot.** Food and stone were drawn identically, so a quarry read
 *    as farmland. The one distinction the map exists to show — where the food is and where the
 *    stone is — was the one it did not draw.
 * 2. **Amount was a continuous radius against a hard-coded 120.** A radius you cannot measure is not
 *    a reading: two dots a few pixels apart are indistinguishable, and a stone node capped at 40 was
 *    drawn permanently tiny even when it was completely full.
 *
 * So: **shape carries the kind, size carries the level, and the level is one of four named steps**
 * measured against that node's own capacity. Shape survives bleaching, small cells and colour
 * blindness in a way hue does not, which matters because a remembered tile is drawn washed toward
 * paper and the two resource greens would converge.
 *
 * `spent` is deliberately drawn rather than skipped. An emptied field and ground that never held
 * anything are completely different facts — the first is why six of north's twelve people stood
 * still at v13 Turn 100 — and the old renderer drew them identically as bare terrain.
 */

export type Level = "full" | "mid" | "low" | "spent";

/**
 * Stone was slate blue (`#5c6675`) until 2026-08-08, and that put it four degrees of hue from
 * north's own `#3d4f77`. Both are small marks a few pixels across on bleached paper, so a quarry
 * diamond and a north worker read as the same kind of cool grey dot — on the one map where telling
 * *a person* from *the ground they stand on* is the entire reading. Stone is now a warm graphite:
 * still unmistakably stone, on the opposite side of neutral from either civilization's colour, and
 * far enough from food's green that colour blindness is carried by the shape as before.
 */
export const RESOURCE_COLOUR: Record<Resource, string> = {
  food: "#6b8f3c",
  stone: "#6f6a63",
};

/**
 * Fraction of the tile width, by level. `spent` is drawn at nearly full size because it is a husk
 * marking where a source was, not a smaller source — and because a hollow shape can be large
 * without competing for attention with the filled ones.
 */
const RADIUS: Record<Level, number> = { full: 0.4, mid: 0.29, low: 0.19, spent: 0.36 };

/**
 * How far the tile's own ground colour is washed toward paper, by level. This is the reading that
 * works at "fit" zoom, where a cell is a few pixels wide and no glyph can be sized by eye: a farm
 * belt draining from green to bare paper says how much is left near a home without the reader
 * having to look at any single tile.
 */
export const DRAIN: Record<Level, number> = { full: 0, mid: 0.28, low: 0.55, spent: 0.8 };

/**
 * Levels are fractions of *this node's own* capacity, not of a shared constant. A field caps at 120
 * and a quarry at about 40, so an absolute scale would tell a reader that every quarry on the map
 * was nearly empty from the first turn.
 */
export function levelOf(amount: number, cap: number): Level {
  if (amount <= 0) return "spent";
  const share = cap > 0 ? amount / cap : 0;
  if (share >= 2 / 3) return "full";
  if (share >= 1 / 3) return "mid";
  return "low";
}

export function levelLabel(level: Level, zh: boolean) {
  const words: Record<Level, [string, string]> = {
    full: ["充足", "full"],
    mid: ["過半已採", "half worked"],
    low: ["將盡", "nearly gone"],
    spent: ["已採光", "worked out"],
  };
  return zh ? words[level][0] : words[level][1];
}

/**
 * Draws one node glyph in world coordinates. Shared by the map and the legend so a reader who
 * learns the mark in one place is never shown a different mark in the other.
 *
 * **Round means it comes back; angular means it does not.** Colour carries the kind — green food,
 * graphite stone — and the shape carries whether the source has an income. Stone has never regrown,
 * so it is always the diamond. Food used to always regrow, and the circle was written down as
 * "round for something that grows back" — which stopped being true on 2026-08-08, when
 * `corridor-oasis` made every food cell inside either ridge finite (regen 0) and left only four
 * renewable cells beyond them. Ten of that map's fourteen food cells are one-off larders and the
 * map drew them exactly like the four that feed a settlement forever, which is the single reading
 * the season exists to produce. Finite food is therefore a square: angular like the quarry it now
 * behaves like, but still green, and still not a diamond.
 *
 * The distinction is a property of the tile rather than of the turn, so it is read from the
 * season's terrain like `kind` and `cap`. On every map before v24 no food cell is finite and
 * nothing on screen changes.
 *
 * `spent` is an outline of the same shape — the husk of a source, not a source.
 */
export function drawNode(
  context: CanvasRenderingContext2D,
  kind: Resource,
  level: Level,
  centreX: number,
  centreY: number,
  cell: number,
  renews = true,
) {
  const radius = Math.max(1, RADIUS[level] * cell);
  const colour = RESOURCE_COLOUR[kind];

  context.beginPath();
  if (kind === "stone") {
    context.moveTo(centreX, centreY - radius);
    context.lineTo(centreX + radius, centreY);
    context.lineTo(centreX, centreY + radius);
    context.lineTo(centreX - radius, centreY);
    context.closePath();
  } else if (!renews) {
    // A square, not a rotated diamond: at six pixels a 45° rotation is not a reading, and the
    // diamond already means stone. Squared off at 0.88 of the radius so it carries about the same
    // ink as the circle it replaces and the four levels stay comparable across both shapes.
    const half = radius * 0.88;
    context.rect(centreX - half, centreY - half, half * 2, half * 2);
  } else {
    context.arc(centreX, centreY, radius, 0, Math.PI * 2);
  }

  if (level === "spent") {
    context.strokeStyle = colour;
    context.lineWidth = Math.max(0.6, cell * 0.075);
    context.setLineDash([Math.max(1.2, cell * 0.16), Math.max(1.2, cell * 0.14)]);
    context.stroke();
    context.setLineDash([]);
    return;
  }

  context.fillStyle = colour;
  context.fill();

  // A full source carries a paler core, so the top step is distinguishable from `mid` by more than
  // a few pixels of radius — the difference the previous continuous scale could not carry.
  if (level === "full") {
    context.beginPath();
    context.arc(centreX, centreY, radius * 0.34, 0, Math.PI * 2);
    context.fillStyle = "rgba(244,239,228,0.72)";
    context.fill();
  }
}
