import { RULES } from "../sim/config";
import type { Frame } from "../sim/types";
import { RESOURCE_COLOUR } from "./resource";

/**
 * How a person is drawn, in one place — shared by the map and the legend so a reader who learns
 * the mark in one never meets a different mark in the other.
 *
 * Three readings are carried by one glyph, and each of them answers a question the map could not
 * answer before:
 *
 * 1. **A halo.** A worker used to be a flat civ-coloured disc drawn straight onto the ground, so at
 *    "fit" zoom a north person and a stone diamond were two small cool-grey marks a few pixels
 *    apart. The paper ring separates a person from whatever they are standing on, whatever the
 *    palette does.
 * 2. **The pack.** The carry loop is the whole economy of this world — nothing counts until it is
 *    physically inside a store — and it was invisible. The arc is the fraction of `RULES.carry` in
 *    hand, coloured by what is in the pack, so a column of workers walking home full reads as a
 *    column walking home full.
 * 3. **A hollow centre means nothing is happening.** Not "resting": either no standing order at
 *    all, or an order the engine can find no destination for. Both cost the same — a turn.
 */

export type MarkWorker = Frame["workers"][number];

/**
 * Whether this person will produce nothing this turn, judged only from the frame.
 *
 * Two states qualify and they are deliberately not distinguished on the map, because on the turn
 * itself they are the same fact. An `idle` worker holds no order. A worker who holds an order with
 * no destination is one the engine could route nowhere: every store full, the building gone, no
 * open path. The inspector separates them, and says how many turns it has been true.
 */
export function isStalled(worker: MarkWorker) {
  return worker.job.kind === "idle" || !worker.destination;
}

export interface WorkerMark {
  /** Fill colour for an own worker; `undefined` draws the anonymous outline used for a stranger. */
  colour?: string;
  food: number;
  stone: number;
  stalled: boolean;
  /** How many people share the tile. Only used to scale the pack ring's denominator. */
  count?: number;
}

const TAU = Math.PI * 2;
const START = -Math.PI / 2;

export function drawWorkerMark(
  context: CanvasRenderingContext2D,
  centreX: number,
  centreY: number,
  cell: number,
  mark: WorkerMark,
  paper: string,
  ink: string,
) {
  const radius = Math.max(2, cell * 0.34);
  const ringWidth = Math.max(1.2, cell * 0.12);
  const ringRadius = radius + ringWidth * 0.9;

  // Translucent rather than solid: a hard paper disc punches a hole in the ground and reads as
  // missing terrain, where a wash reads as a person standing on it.
  context.save();
  context.globalAlpha = 0.82;
  context.beginPath();
  context.arc(centreX, centreY, ringRadius + ringWidth / 2 + 0.6, 0, TAU);
  context.fillStyle = paper;
  context.fill();
  context.restore();

  if (mark.colour) {
    context.beginPath();
    context.arc(centreX, centreY, radius, 0, TAU);
    context.fillStyle = mark.colour;
    context.fill();
    if (mark.stalled) {
      context.beginPath();
      context.arc(centreX, centreY, radius * 0.46, 0, TAU);
      context.fillStyle = paper;
      context.fill();
    }
  } else {
    context.beginPath();
    context.arc(centreX, centreY, radius, 0, TAU);
    context.strokeStyle = ink;
    context.lineWidth = 1;
    context.stroke();
    // A stranger's pack is not knowledge a civilization lens has, so nothing more is drawn.
    return;
  }

  const capacity = Math.max(1, (mark.count ?? 1) * RULES.carry);
  const load = mark.food + mark.stone;
  if (load <= 0) return;

  context.save();
  context.lineWidth = ringWidth;
  context.lineCap = "butt";
  context.beginPath();
  context.arc(centreX, centreY, ringRadius, 0, TAU);
  context.strokeStyle = "rgba(43,39,35,0.16)";
  context.stroke();

  let from = START;
  for (const part of [
    { amount: mark.food, colour: RESOURCE_COLOUR.food },
    { amount: mark.stone, colour: RESOURCE_COLOUR.stone },
  ]) {
    if (part.amount <= 0) continue;
    const to = from + TAU * Math.min(1, part.amount / capacity);
    context.beginPath();
    context.arc(centreX, centreY, ringRadius, from, to);
    context.strokeStyle = part.colour;
    context.stroke();
    from = to;
  }
  context.restore();
}
