import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clampCamera,
  fitScale,
  screenToWorld,
  visibleRange,
  worldToScreenX,
  worldToScreenZ,
  zoomAt,
  type Camera,
} from "../lib/camera";
import { homeCentre } from "../lib/strategy";
import { RULES } from "../sim/config";
import type { CivId, Frame, Point, Tile } from "../sim/types";
import { useLang } from "./lang";
import { DRAIN, drawNode, levelOf } from "./resource";
import { expectedRoute, onwardRoute } from "./route";
import { drawWorkerMark, isStalled } from "./worker";

/**
 * One civilization's world as it believes it — or the truth, when `view` is "truth". The page
 * owns one instance and switches its lens, so position and orientation never change between views.
 *
 * Four rules this component exists to enforce:
 *   1. Never mirrored. Every lens shares one orientation, so every difference on screen is a
 *      decision one of the models made rather than an artefact of the drawing.
 *   2. Fog is age, not a binary. Visible now is full colour, remembered bleaches toward paper in
 *      proportion to how long ago it was seen, never-seen is paper — absence, not darkness.
 *   3. Nothing is drawn that the civilization does not know, unless `outlineTruth` is on, and then
 *      it is drawn as an empty hairline so the reader can always tell knowledge from fact.
 *   4. Workers on one tile are drawn once and counted. Ten people standing together must never
 *      read as one person, and the count is taken after the lens filter so it can never reveal
 *      somebody the observer cannot see.
 *
 * The camera (2026-08-07) is the same maths the first build used — wheel to zoom about the
 * cursor, drag to pan, and a fit that frames the whole world. A 96 × 96 world drawn at 640px puts
 * a person inside a 6px circle; at that size the map can be read as a shape but not as a place.
 */

export type View = CivId | "truth";

export const PAPER = "#f4efe4";
const INK = "#2b2723";
/**
 * Field and stone ground used to sit six points apart on every channel, so the middle of the map —
 * which is entirely stone — read as farmland. They are now separated on hue as well as value: the
 * field is unambiguously green, the stone ground unambiguously cool grey. Grass sits between them
 * as the neutral it is.
 */
export const TERRAIN: Record<string, string> = {
  grass: "#e4e1cd",
  field: "#c9dd9c",
  oasis: "#83cbb3",
  stone: "#c8c8c9",
  water: "#c6d6dd",
  ridge: "#bcb3a4",
};
export const CIV_COLOUR: Record<CivId, string> = { north: "#3d4f77", south: "#9c5a3c" };

/** Age at which a remembered tile has bleached as far as it will go. */
const STALE_AFTER = 40;

/** Tile size in pixels at which a structure can carry its name without the map turning to soup. */
const LABEL_SCALE = 9;

export function bleach(colour: string, amount: number) {
  const from = [parseInt(colour.slice(1, 3), 16), parseInt(colour.slice(3, 5), 16), parseInt(colour.slice(5, 7), 16)];
  const to = [parseInt(PAPER.slice(1, 3), 16), parseInt(PAPER.slice(3, 5), 16), parseInt(PAPER.slice(5, 7), 16)];
  const mix = from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount));
  return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
}

export interface Selection {
  kind: "worker" | "tile";
  id?: string;
  x: number;
  z: number;
}

export function BeliefMap({
  tiles,
  frame,
  view,
  outlineTruth,
  showIntent,
  selection,
  onSelect,
  width,
  height,
}: {
  tiles: Tile[];
  frame: Frame;
  view: View;
  outlineTruth: boolean;
  showIntent: boolean;
  selection?: Selection;
  onSelect: (selection: Selection) => void;
  width: number;
  height: number;
}) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const world = RULES.width;

  const cameraRef = useRef<Camera>({ x: world / 2, z: world / 2, scale: 1 });
  const framedFor = useRef<string>("");
  /**
   * Whether the reader has aimed this camera themselves. Once they have, nothing on the page moves
   * it again except another deliberate act — switching lens, resizing, or pressing a map button.
   */
  const aimed = useRef(false);
  const [, forceDraw] = useState(0);
  const redraw = useCallback(() => forceDraw((tick) => tick + 1), []);

  const [hover, setHover] = useState<{ x: number; z: number; left: number; top: number } | null>(null);
  const coarse = useCoarsePointer();

  /**
   * Frame what this lens actually knows.
   *
   * A whole-world fit is the honest default only if the world is full. It is not: at turn 100 of a
   * 96 × 96 season a civilization has seen a blob perhaps thirty tiles across, so "fit" spends nine
   * tenths of the stage on blank paper and draws a person inside three pixels. On a phone that is
   * the entire first impression of this page. Framing the known area instead opens on the place the
   * season is happening, at a size where a worker is a worker.
   *
   * It is computed from the selected lens's own fog, never from truth — framing derived from the
   * world would silently point the camera at the other civilization, which is a leak by geometry.
   */
  const frameKnown = useCallback(() => {
    let x0: number = world;
    let z0: number = world;
    let x1 = -1;
    let z1 = -1;
    const note = (x: number, z: number) => {
      if (x < x0) x0 = x;
      if (z < z0) z0 = z;
      if (x > x1) x1 = x;
      if (z > z1) z1 = z;
    };
    if (view === "truth") {
      for (const building of frame.buildings) {
        building.cells.forEach((point, index) => {
          // An unbuilt worksite counts toward the frame too — a forward site far from home is
          // exactly the thing a reader-aimed camera must not crop away.
          if (building.blocks[index] || !building.complete) note(point.x, point.z);
        });
      }
      for (const worker of frame.workers) note(worker.x, worker.z);
    } else {
      const fog = frame.fog[view as CivId];
      if (fog) {
        for (let index = 0; index < fog.length; index += 1) {
          if (fog[index] > 0) note(index % world, Math.floor(index / world));
        }
      }
    }
    const whole = { x: world / 2, z: world / 2, scale: fitScale(width, height) };
    if (x1 < 0) return whole;
    const margin = 3;
    const spanX = x1 - x0 + 1 + margin * 2;
    const spanZ = z1 - z0 + 1 + margin * 2;
    // Never closer than the whole-world fit — otherwise a first-turn civilization that knows twelve
    // tiles opens at a scale where the map has no context at all — and never past the point where a
    // tile is a tile.
    const scale = Math.max(fitScale(width, height), Math.min(16, Math.min(width / spanX, height / spanZ)));
    return { x: (x0 + x1 + 1) / 2, z: (z0 + z1 + 1) / 2, scale };
  }, [view, frame, world, width, height]);

  // Frame on the first draw, on a resize, and when the lens changes — but only while the camera is
  // still the page's rather than the reader's. A camera clamped for the old box can sit outside a
  // new one, so a resize has to be handled whatever the reader has done.
  const box = `${Math.round(width)}x${Math.round(height)}`;
  useEffect(() => {
    const key = `${box}:${view}`;
    if (framedFor.current === key) return;
    const resized = !framedFor.current.startsWith(`${box}:`);
    framedFor.current = key;
    if (aimed.current && !resized) return;
    cameraRef.current = clampCamera(aimed.current ? cameraRef.current : frameKnown(), width, height);
    redraw();
  }, [box, view, width, height, frameKnown, redraw]);

  const fit = useCallback(() => {
    aimed.current = true;
    cameraRef.current = clampCamera(
      { x: world / 2, z: world / 2, scale: fitScale(width, height) },
      width,
      height,
    );
    redraw();
  }, [width, height, world, redraw]);

  /**
   * Centre on the settlement, close enough to read it.
   *
   * A 96 × 96 world where both civilizations sit within twelve tiles of their own hall means the
   * whole-world fit is mostly empty paper, and zooming into the middle of it — the natural thing
   * to try — lands on ground nobody has ever seen. This is the shortcut back to where the season
   * is actually happening. On truth it frames the middle, which is where the two sides would meet.
   */
  const goHome = useCallback(() => {
    aimed.current = true;
    const centre = view === "truth" ? { x: world / 2, z: world / 2 } : homeCentre(frame, view as CivId);
    cameraRef.current = clampCamera(
      { x: centre.x, z: centre.z, scale: Math.max(cameraRef.current.scale, fitScale(width, height) * 3) },
      width,
      height,
    );
    redraw();
  }, [view, frame, width, height, world, redraw]);

  // A selection made somewhere else on the page — the Worker Loom, or the roster in the inspector —
  // must not point at a person who is off screen. Panning only when the target is actually outside
  // the viewport keeps a click on the visible map from moving the map under the reader's cursor.
  const selectionKey = selection ? `${selection.x},${selection.z}` : "";
  useEffect(() => {
    if (!selection) return;
    const camera = cameraRef.current;
    const left = screenToWorld(camera, width, height, 0, 0);
    const right = screenToWorld(camera, width, height, width, height);
    const inside =
      selection.x >= left.x + 1 &&
      selection.x <= right.x - 1 &&
      selection.z >= left.z + 1 &&
      selection.z <= right.z - 1;
    if (inside) return;
    cameraRef.current = clampCamera(
      { x: selection.x + 0.5, z: selection.z + 0.5, scale: camera.scale },
      width,
      height,
    );
    redraw();
  }, [selectionKey, width, height, redraw]);

  const zoomBy = useCallback(
    (factor: number) => {
      aimed.current = true;
      cameraRef.current = zoomAt(cameraRef.current, width, height, factor, width / 2, height / 2);
      redraw();
    },
    [width, height, redraw],
  );

  // The route of the selected worker, on the selected lens's terms. Recomputed only when the
  // selection or the turn changes — a breadth-first search over 9,216 cells is cheap once and
  // wasteful sixty times a second while somebody is dragging the map.
  const route = useMemo<Point[]>(() => {
    if (!selection?.id) return [];
    const worker = frame.workers.find((entry) => entry.id === selection.id);
    if (!worker) return [];
    if (view !== "truth" && worker.owner !== view) return [];
    return expectedRoute(tiles, frame, worker, view);
  }, [tiles, frame, selection?.id, view]);

  // The leg after that one — the return half of the round trip, which is where the cost of a
  // distant source actually shows up. Computed from where the first leg ends rather than from the
  // destination tile itself, because a destination is often a solid block and a worker stands
  // beside it.
  const onward = useMemo<Point[]>(() => {
    if (route.length === 0 || !selection?.id) return [];
    const worker = frame.workers.find((entry) => entry.id === selection.id);
    if (!worker) return [];
    if (view !== "truth" && worker.owner !== view) return [];
    return onwardRoute(tiles, frame, worker, view, route[route.length - 1]);
  }, [tiles, frame, selection?.id, view, route]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const camera = cameraRef.current;
    const cell = camera.scale;
    const sx = (worldX: number) => worldToScreenX(camera, width, worldX);
    const sz = (worldZ: number) => worldToScreenZ(camera, height, worldZ);

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = PAPER;
    context.fillRect(0, 0, width, height);

    const omniscient = view === "truth";
    const civ = omniscient ? undefined : (view as CivId);
    const fog = civ ? frame.fog[civ] : undefined;
    const seenAt = civ ? frame.lastSeen[civ] : undefined;
    const known = (index: number) => (omniscient ? 2 : (fog?.[index] ?? 0));
    const range = visibleRange(camera, width, height);

    // What the current lens believes is left on each resource tile, indexed for the terrain pass.
    // `kind` and `cap` come from the static terrain rather than the frame — see the node pass below
    // for why that is not a leak.
    const nodes = omniscient
      ? frame.nodes.map((node) => ({ ...node, turn: frame.turn }))
      : frame.observedNodes[civ!];
    const nodeAt = new Map<number, number>();
    for (const node of nodes) nodeAt.set(node.z * world + node.x, node.amount);

    // Terrain, drained by how much of its resource is left, then bleached by how long ago the tile
    // was last seen.
    //
    // The ground carries the level as well as the glyph on purpose. At "fit" zoom a cell is about
    // six pixels and a reader cannot size a dot at that scale — but a whole farm belt draining from
    // green to bare paper is legible without looking at any single tile, which is the reading that
    // actually matters: how much is left near each home, and therefore how hard the map is pushing.
    context.beginPath();
    for (let z = range.z0; z <= range.z1; z += 1) {
      for (let x = range.x0; x <= range.x1; x += 1) {
        const index = z * world + x;
        const level = known(index);
        if (level === 0) continue;
        const tile = tiles[index];
        let base = TERRAIN[tile?.terrain ?? "grass"] ?? TERRAIN.grass;
        if (tile?.node && nodeAt.has(index)) {
          base = bleach(base, DRAIN[levelOf(nodeAt.get(index)!, tile.node.cap)]);
        }
        const age = level === 2 || !seenAt ? 0 : Math.max(0, frame.turn - (seenAt[index] ?? frame.turn));
        context.fillStyle = level === 2 ? base : bleach(base, 0.35 + 0.5 * Math.min(1, age / STALE_AFTER));
        context.fillRect(sx(x), sz(z), cell + 0.6, cell + 0.6);
        if (level === 1) {
          context.moveTo(sx(x) + cell * 0.15, sz(z + 1) - cell * 0.15);
          context.lineTo(sx(x + 1) - cell * 0.15, sz(z) + cell * 0.15);
        }
      }
    }
    if (civ) {
      context.strokeStyle = "rgba(43,39,35,0.16)";
      context.lineWidth = Math.max(0.45, cell * 0.07);
      context.stroke();

      // The outline makes the civilization's live sight explicit. Without it, a two-tile
      // expansion is visually lost inside the much larger remembered area.
      context.beginPath();
      for (let z = range.z0; z <= range.z1; z += 1) {
        for (let x = range.x0; x <= range.x1; x += 1) {
          const index = z * world + x;
          if (known(index) !== 2) continue;
          const left = x === 0 || known(index - 1) !== 2;
          const right = x === world - 1 || known(index + 1) !== 2;
          const top = z === 0 || known(index - world) !== 2;
          const bottom = z === world - 1 || known(index + world) !== 2;
          if (left) {
            context.moveTo(sx(x), sz(z));
            context.lineTo(sx(x), sz(z + 1));
          }
          if (right) {
            context.moveTo(sx(x + 1), sz(z));
            context.lineTo(sx(x + 1), sz(z + 1));
          }
          if (top) {
            context.moveTo(sx(x), sz(z));
            context.lineTo(sx(x + 1), sz(z));
          }
          if (bottom) {
            context.moveTo(sx(x), sz(z + 1));
            context.lineTo(sx(x + 1), sz(z + 1));
          }
        }
      }
      context.strokeStyle = "rgba(43,39,35,0.62)";
      context.lineWidth = Math.max(0.7, cell * 0.1);
      context.stroke();
    }

    // Resource nodes. Shape is the kind, size is one of four named levels, and an emptied source is
    // drawn as a dashed husk rather than removed — see `resource.ts` for why each of those matters.
    //
    // `kind` and `cap` come from the static terrain, never from the frame. That is not a leak: a
    // node only reaches `observedNodes` once the civilization has actually looked at that tile, and
    // what kind of ground it is and how much it holds when full are permanent properties of it. The
    // one thing that changes — how much is left — still comes from the lens's own reading.
    for (const node of nodes) {
      const index = node.z * world + node.x;
      const level = known(index);
      if (level === 0) continue;
      const source = tiles[index]?.node;
      if (!source) continue;
      context.globalAlpha = level === 1 ? 0.42 : 1;
      drawNode(
        context,
        source.kind,
        levelOf(node.amount, source.cap),
        sx(node.x + 0.5),
        sz(node.z + 0.5),
        cell,
        source.regen > 0,
      );
    }
    context.globalAlpha = 1;

    // Construction sites. Placed blocks alone leave a fresh worksite invisible — yet a site is
    // often the most strategically loaded object on the map (v36's forward depot broke ground
    // beside the Oasis with 0 of 6 blocks standing). Every unbuilt footprint cell draws as a
    // dashed outline in the owner's colour; placed blocks then paint solid on top, so progress
    // reads directly off the map. Truth shows every site; a civilization lens shows only its own,
    // because foreign observation carries placed blocks only — an empty foreign footprint is
    // unknowable by design and drawing it would be a leak.
    for (const building of frame.buildings) {
      if (building.complete) continue;
      if (!omniscient && building.owner !== civ) continue;
      context.strokeStyle = CIV_COLOUR[building.owner];
      context.lineWidth = Math.max(0.8, cell * 0.1);
      context.setLineDash([Math.max(2, cell * 0.28), Math.max(1.5, cell * 0.2)]);
      building.cells.forEach((point, index) => {
        if (building.blocks[index]) return;
        context.strokeRect(sx(point.x) + 1, sz(point.z) + 1, cell - 2, cell - 2);
      });
      context.setLineDash([]);
    }

    // Blocks. In truth view every standing cell; in a belief view only remembered cells.
    if (omniscient) {
      for (const building of frame.buildings) {
        building.cells.forEach((point, index) => {
          if (!building.blocks[index]) return;
          context.fillStyle = CIV_COLOUR[building.owner];
          context.fillRect(sx(point.x), sz(point.z), cell + 0.6, cell + 0.6);
        });
      }
    } else {
      for (const block of frame.observedBlocks[civ!]) {
        context.fillStyle = CIV_COLOUR[block.owner];
        context.fillRect(sx(block.x), sz(block.z), cell + 0.6, cell + 0.6);
      }
    }

    // Truth outlined on top of belief: everything that exists but is not known draws empty.
    if (outlineTruth && civ) {
      context.strokeStyle = "rgba(43,39,35,0.45)";
      context.lineWidth = 0.6;
      for (const building of frame.buildings) {
        building.cells.forEach((point, index) => {
          if (!building.blocks[index]) return;
          if (known(point.z * world + point.x) > 0) return;
          context.strokeRect(sx(point.x) + 0.3, sz(point.z) + 0.3, cell - 0.6, cell - 0.6);
        });
      }
      for (const worker of frame.workers) {
        if (known(worker.z * world + worker.x) === 2) continue;
        context.beginPath();
        context.arc(sx(worker.x + 0.5), sz(worker.z + 0.5), cell * 0.34, 0, Math.PI * 2);
        context.stroke();
      }
    }

    // Intent lines: where each worker's standing job is taking it, as the crow flies.
    if (showIntent) {
      for (const worker of frame.workers) {
        if (!worker.destination) continue;
        if (civ && worker.owner !== civ) continue;
        context.strokeStyle = `${CIV_COLOUR[worker.owner]}66`;
        context.lineWidth = 0.8;
        context.beginPath();
        context.moveTo(sx(worker.x + 0.5), sz(worker.z + 0.5));
        context.lineTo(sx(worker.destination.x + 0.5), sz(worker.destination.z + 0.5));
        context.stroke();
      }
    }

    // The selected worker's round trip, tile by tile, on this lens's terms. Drawn over the intent
    // line it replaces: a straight line says where, the route says how far the walk really is.
    //
    // The two legs are drawn differently on purpose. Solid is the walk this worker is on now;
    // dashed is the return that follows and has not started. One line to one destination showed
    // half of what a carry job is, and it was the cheap half — the load has to come back before it
    // counts, and that is the leg that makes a distant field worthless.
    if (route.length > 1 || onward.length > 1) {
      const owner = frame.workers.find((entry) => entry.id === selection?.id)?.owner;
      const colour = owner ? CIV_COLOUR[owner] : INK;
      const trace = (steps: Point[]) => {
        context.beginPath();
        steps.forEach((step, index) => {
          const px = sx(step.x + 0.5);
          const pz = sz(step.z + 0.5);
          if (index === 0) context.moveTo(px, pz);
          else context.lineTo(px, pz);
        });
        context.stroke();
      };
      context.save();
      context.lineWidth = Math.max(1.4, cell * 0.22);
      context.lineJoin = "round";
      context.lineCap = "round";
      if (onward.length > 1) {
        context.strokeStyle = `${colour}70`;
        context.setLineDash([Math.max(3, cell * 0.5), Math.max(2, cell * 0.4)]);
        trace(onward);
        context.setLineDash([]);
        const end = onward[onward.length - 1];
        context.beginPath();
        context.arc(sx(end.x + 0.5), sz(end.z + 0.5), Math.max(2.4, cell * 0.3), 0, Math.PI * 2);
        context.strokeStyle = colour;
        context.lineWidth = Math.max(1, cell * 0.11);
        context.stroke();
        context.lineWidth = Math.max(1.4, cell * 0.22);
      }
      if (route.length > 1) {
        context.strokeStyle = colour;
        trace(route);
        const last = route[route.length - 1];
        context.beginPath();
        context.arc(sx(last.x + 0.5), sz(last.z + 0.5), Math.max(2.4, cell * 0.3), 0, Math.PI * 2);
        context.fillStyle = colour;
        context.fill();
      }
      context.restore();
    }

    // Workers, grouped by tile. Own people are solid; the other side shows only where it is being
    // watched right now, and then only as an anonymous mark — a belief view never knows who it is
    // looking at. The grouping runs after the lens filter, so `×N` can never count a hidden person.
    const stacks = new Map<number, Frame["workers"]>();
    for (const worker of frame.workers) {
      const index = worker.z * world + worker.x;
      const own = civ === undefined || worker.owner === civ;
      if (!own && known(index) !== 2) continue;
      const stack = stacks.get(index);
      if (stack) stack.push(worker);
      else stacks.set(index, [worker]);
    }
    for (const [index, stack] of stacks) {
      const x = index % world;
      const z = Math.floor(index / world);
      const cx = sx(x + 0.5);
      const cy = sz(z + 0.5);
      const own = civ === undefined || stack[0].owner === civ;
      // Own people carry two more readings than a plain dot: what is in the pack, and whether
      // anything is happening at all. A stranger carries neither — a belief view knows only that
      // somebody is standing there. See `worker.ts` for the mark itself.
      drawWorkerMark(
        context,
        cx,
        cy,
        cell,
        {
          colour: own ? CIV_COLOUR[stack[0].owner] : undefined,
          food: stack.reduce((sum, worker) => sum + worker.carrying.food, 0),
          stone: stack.reduce((sum, worker) => sum + worker.carrying.stone, 0),
          stalled: stack.every(isStalled),
          count: stack.length,
        },
        PAPER,
        INK,
      );
      if (stack.length > 1) {
        const label = `×${stack.length}`;
        const fontSize = Math.max(9, Math.min(14, cell * 0.5));
        context.save();
        context.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        const boxWidth = context.measureText(label).width + 7;
        const boxHeight = fontSize + 4;
        const bx = cx + Math.max(3, cell * 0.24);
        const by = cy - Math.max(7, cell * 0.62) - boxHeight / 2;
        context.fillStyle = "rgba(250,246,238,0.94)";
        context.fillRect(bx, by, boxWidth, boxHeight);
        context.strokeStyle = "rgba(43,39,35,0.45)";
        context.lineWidth = 1;
        context.strokeRect(bx, by, boxWidth, boxHeight);
        context.fillStyle = INK;
        context.fillText(label, bx + boxWidth / 2, by + boxHeight / 2 + 0.5);
        context.restore();
      }
    }

    // Structure names, once the map is zoomed in far enough to carry them. A foreign structure is
    // never named through a civilization lens — the name alone would give away its function.
    if (cell >= LABEL_SCALE) {
      context.save();
      context.font = `600 ${Math.min(13, cell * 0.42)}px -apple-system, BlinkMacSystemFont, 'PingFang TC', 'Noto Sans TC', sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      for (const building of frame.buildings) {
        if (civ && building.owner !== civ) continue;
        const alive = building.cells.filter((_, index) => building.blocks[index] === 1);
        // A construction site has no standing cells to anchor on, so its label anchors on the
        // footprint instead and carries build progress — language-neutral, so no lang plumbing.
        const anchor = alive.length > 0 ? alive : building.complete ? [] : building.cells;
        if (anchor.length === 0) continue;
        if (civ && known(anchor[0].z * world + anchor[0].x) === 0) continue;
        const label = building.complete ? building.name : `${building.name} ${alive.length}/${building.total}`;
        const midX = anchor.reduce((sum, point) => sum + point.x, 0) / anchor.length;
        const minZ = Math.min(...anchor.map((point) => point.z));
        const px = sx(midX + 0.5);
        const pz = sz(minZ) - 9;
        if (px < -60 || px > width + 60 || pz < -20 || pz > height + 20) continue;
        const textWidth = context.measureText(label).width;
        context.fillStyle = "rgba(250,246,238,0.92)";
        context.fillRect(px - textWidth / 2 - 6, pz - 9, textWidth + 12, 18);
        context.strokeStyle = "rgba(43,39,35,0.25)";
        context.lineWidth = 1;
        context.strokeRect(px - textWidth / 2 - 6, pz - 9, textWidth + 12, 18);
        context.fillStyle = INK;
        context.fillText(label, px, pz);
      }
      context.restore();
    }

    // The world is finite. Its edge is drawn so a zoomed-out view reads as a map on paper rather
    // than as a world that keeps going.
    context.strokeStyle = "rgba(43,39,35,0.35)";
    context.lineWidth = 1;
    context.strokeRect(sx(0), sz(0), world * cell, world * cell);

    if (hover && !(selection && hover.x === selection.x && hover.z === selection.z)) {
      context.strokeStyle = "rgba(43,39,35,0.45)";
      context.lineWidth = 1;
      context.strokeRect(sx(hover.x) - 1, sz(hover.z) - 1, cell + 2, cell + 2);
    }

    if (selection) {
      context.strokeStyle = INK;
      context.lineWidth = 1.6;
      context.strokeRect(sx(selection.x) - 1.5, sz(selection.z) - 1.5, cell + 3, cell + 3);
    }
  });

  const drag = useRef<{ x: number; y: number; moved: number; camX: number; camZ: number } | null>(null);

  /**
   * Touch (2026-08-08, Shek's call: the map must enlarge by touch the way the first build's does).
   *
   * A phone has no wheel, so without a pinch the only way to enlarge this map was the +/− buttons —
   * and a reader who cannot enlarge the map cannot read it at all, because at fit scale a person is
   * three pixels. Every live pointer is tracked: one is a pan, two are a pinch about their midpoint,
   * and a stationary press-and-release is a tap that selects. `touchAction: none` on the canvas is
   * what makes the browser hand us the second finger instead of zooming the whole page.
   */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number } | null>(null);
  /** A tap that follows another tap closely enough, in the same place, zooms in on it. */
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);

  const zoomAbout = useCallback(
    (factor: number, screenX: number, screenY: number) => {
      aimed.current = true;
      cameraRef.current = zoomAt(cameraRef.current, width, height, factor, screenX, screenY);
      redraw();
    },
    [width, height, redraw],
  );

  // Wheel has to be bound by hand: React's synthetic wheel listener is passive, so it cannot stop
  // the page from scrolling while the reader is zooming the map.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      aimed.current = true;
      const rect = canvas.getBoundingClientRect();
      cameraRef.current = zoomAt(
        cameraRef.current,
        width,
        height,
        Math.exp(-event.deltaY * 0.0016),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      redraw();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [width, height, redraw]);

  function tileAt(event: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = screenToWorld(
      cameraRef.current,
      width,
      height,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    const x = Math.floor(point.x);
    const z = Math.floor(point.z);
    if (x < 0 || z < 0 || x >= world || z >= world) return null;
    return { x, z, left: event.clientX - rect.left, top: event.clientY - rect.top };
  }

  const hoverTile = hover ? tiles[hover.z * world + hover.x] : undefined;
  const hoverKnown =
    hover && view !== "truth" ? (frame.fog[view as CivId]?.[hover.z * world + hover.x] ?? 0) : 2;

  const scaleRatio = cameraRef.current.scale / fitScale(width, height);

  return (
    <div style={{ position: "relative", width, height }}>
      <canvas
        ref={canvasRef}
        style={{
          width,
          height,
          cursor: drag.current ? "grabbing" : "crosshair",
          display: "block",
          border: "1px solid #ded5c4",
          touchAction: "none",
        }}
        onPointerDown={(event) => {
          // Capture keeps a drag alive when the cursor leaves the canvas. It throws for a pointer
          // id the browser does not consider active, which is every synthetic event, so a failure
          // here must not take the drag with it.
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            /* not a live pointer */
          }
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size >= 2) {
            const [a, b] = [...pointers.current.values()];
            pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) };
            // A second finger ends the pan rather than continuing it, so the map does not lurch
            // sideways at the moment a pinch begins.
            drag.current = null;
            setHover(null);
            return;
          }
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            moved: 0,
            camX: cameraRef.current.x,
            camZ: cameraRef.current.z,
          };
        }}
        onPointerMove={(event) => {
          if (pointers.current.has(event.pointerId)) {
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          }
          if (pointers.current.size >= 2 && pinch.current) {
            const [a, b] = [...pointers.current.values()];
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            const factor = distance / (pinch.current.distance || distance);
            pinch.current.distance = distance;
            const rect = event.currentTarget.getBoundingClientRect();
            zoomAbout(factor, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
            return;
          }
          const held = drag.current;
          if (held && event.buttons > 0) {
            const dx = event.clientX - held.x;
            const dy = event.clientY - held.y;
            held.moved = Math.max(held.moved, Math.hypot(dx, dy));
            if (held.moved > 4) aimed.current = true;
            cameraRef.current = clampCamera(
              {
                x: held.camX - dx / cameraRef.current.scale,
                z: held.camZ - dy / cameraRef.current.scale,
                scale: cameraRef.current.scale,
              },
              width,
              height,
            );
            setHover(null);
            redraw();
            return;
          }
          // A finger has no hover state: on touch the tooltip would be pinned under the fingertip
          // that just tapped and would stay there, which reads as a stuck label rather than a hint.
          if (event.pointerType === "touch") return;
          const tile = tileAt(event);
          setHover((current) =>
            !tile
              ? null
              : current && current.x === tile.x && current.z === tile.z
                ? { ...current, left: tile.left, top: tile.top }
                : tile,
          );
        }}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          drag.current = null;
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          const held = drag.current;
          drag.current = null;
          if (!held || held.moved > 4) {
            redraw();
            return;
          }
          // Two quick taps in the same spot enlarge the map about that spot. It is the one gesture
          // a phone reader tries before the pinch, and without it the first tap selects a tile the
          // reader was only trying to look at more closely.
          const now = event.timeStamp;
          const previous = lastTap.current;
          lastTap.current = { time: now, x: event.clientX, y: event.clientY };
          if (
            event.pointerType !== "mouse" &&
            previous &&
            now - previous.time < 320 &&
            Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 26
          ) {
            lastTap.current = null;
            const rect = event.currentTarget.getBoundingClientRect();
            zoomAbout(1.9, event.clientX - rect.left, event.clientY - rect.top);
            return;
          }
          const tile = tileAt(event);
          if (!tile) return;
          const civ = view === "truth" ? undefined : (view as CivId);
          const worker = frame.workers.find(
            (entry) =>
              entry.x === tile.x &&
              entry.z === tile.z &&
              (civ === undefined ||
                entry.owner === civ ||
                frame.fog[civ]?.[tile.z * world + tile.x] === 2),
          );
          onSelect(
            worker
              ? { kind: "worker", id: worker.id, x: tile.x, z: tile.z }
              : { kind: "tile", x: tile.x, z: tile.z },
          );
        }}
      />

      {/* Zoom sits on the map because that is the thing it acts on, and it is the only thing on
          this page allowed to overlap anything — a control for a canvas has nowhere else to be. */}
      <div style={{ position: "absolute", right: 8, top: 8, display: "flex", gap: 4 }}>
        <MapButton onClick={() => zoomBy(1.4)} title={zh ? "放大" : "zoom in"} big={coarse}>
          +
        </MapButton>
        <MapButton onClick={() => zoomBy(1 / 1.4)} title={zh ? "縮小" : "zoom out"} big={coarse}>
          −
        </MapButton>
        <MapButton onClick={goHome} title={zh ? "回到聚居地" : "go to the settlement"} wide big={coarse}>
          {zh ? "聚居地" : "home"}
        </MapButton>
        <MapButton onClick={fit} title={zh ? "全圖" : "fit"} wide big={coarse}>
          {zh ? "全圖" : "fit"}
        </MapButton>
      </div>

      <div
        style={{
          position: "absolute",
          left: 8,
          bottom: 8,
          fontSize: 10.5,
          color: "#6d675d",
          background: "rgba(250,246,238,0.86)",
          padding: "2px 6px",
          border: "1px solid rgba(43,39,35,0.14)",
          pointerEvents: "none",
        }}
      >
        {scaleRatio > 1.02 ? `${scaleRatio.toFixed(1)}× · ` : ""}
        {coarse
          ? zh
            ? "兩指縮放、拖曳平移、輕點查看"
            : "pinch to zoom, drag to pan, tap to inspect"
          : zh
            ? "滾輪縮放、拖曳平移"
            : "wheel to zoom, drag to pan"}
      </div>

      {hover ? (
        <div
          style={{
            position: "absolute",
            left: Math.min(hover.left + 12, width - 150),
            top: Math.min(hover.top + 12, height - 44),
            pointerEvents: "none",
            background: "rgba(250,246,238,0.96)",
            border: "1px solid rgba(43,39,35,0.2)",
            padding: "3px 7px",
            fontSize: 11,
            lineHeight: 1.5,
            color: INK,
            whiteSpace: "nowrap",
          }}
        >
          ({hover.x}, {hover.z})
          {hoverKnown === 0
            ? ` · ${zh ? "從未見過" : "never seen"}`
            : ` · ${terrainLabel(hoverTile?.terrain, zh)}${hoverKnown === 1 ? (zh ? "（記憶）" : " (memory)") : ""}`}
        </div>
      ) : null}
    </div>
  );
}

/** Whether the primary pointer is a finger, which decides both the hint text and the button size. */
function useCoarsePointer() {
  const [coarse, setCoarse] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(pointer: coarse)");
    if (!query) return;
    const update = () => setCoarse(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return coarse;
}

function terrainLabel(terrain: string | undefined, zh: boolean) {
  const names: Record<string, [string, string]> = {
    grass: ["草地", "grass"],
    field: ["糧田", "field"],
    oasis: ["綠洲", "oasis"],
    stone: ["石地", "stone ground"],
    water: ["水", "water"],
    ridge: ["山脊", "ridge"],
  };
  const entry = names[terrain ?? "grass"] ?? names.grass;
  return zh ? entry[0] : entry[1];
}

function MapButton({
  children,
  onClick,
  title,
  wide,
  big,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  wide?: boolean;
  /** A fingertip is about 9mm across; a 24px control is a control a phone reader misses. */
  big?: boolean;
}) {
  const size = big ? 34 : 24;
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: wide ? "auto" : size,
        height: size,
        padding: wide ? `0 ${big ? 11 : 8}px` : 0,
        border: "1px solid rgba(43,39,35,0.24)",
        background: "rgba(250,246,238,0.92)",
        color: INK,
        fontSize: wide ? (big ? 12 : 11) : big ? 18 : 14,
        lineHeight: 1,
        cursor: "pointer",
        touchAction: "manipulation",
      }}
    >
      {children}
    </button>
  );
}
