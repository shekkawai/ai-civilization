import { RULES, minimumBlocks } from "./config";
import type { Design, Point } from "./types";

export interface DesignCheck {
  ok: boolean;
  errors: string[];
  blocks: number;
  width: number;
  depth: number;
  cost: number;
}

export function designCells(design: Design, origin: Point = { x: 0, z: 0 }): Point[] {
  const cells: Point[] = [];
  design.rows.forEach((row, z) => {
    [...row].forEach((char, x) => {
      if (char === "#") cells.push({ x: origin.x + x, z: origin.z + z });
    });
  });
  return cells;
}

export function checkDesign(design: Design, protocolVersion = 15): DesignCheck {
  const errors: string[] = [];
  const rows = design.rows ?? [];
  const depth = rows.length;
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  const cells = designCells(design);
  const blocks = cells.length;

  if (depth === 0 || width === 0) errors.push("設計是空的。");
  if (rows.some((row) => [...row].some((char) => char !== "#" && char !== "."))) {
    errors.push("只可以使用 # 和 . 兩種符號。");
  }
  if (width > RULES.maxFootprint || depth > RULES.maxFootprint) {
    errors.push(`佔地不可超過 ${RULES.maxFootprint} × ${RULES.maxFootprint} 格。`);
  }
  if (blocks > RULES.maxBlocks) errors.push(`方塊不可超過 ${RULES.maxBlocks} 個。`);

  const minimum = minimumBlocks(design.fn, protocolVersion);
  if (minimum !== undefined && blocks < minimum) {
    errors.push(`${design.fn} 至少需要 ${minimum} 個方塊，現時只有 ${blocks} 個。`);
  }
  if (blocks > 0 && !connected(cells)) errors.push("所有方塊必須連成一體。");

  return { ok: errors.length === 0, errors, blocks, width, depth, cost: blocks * RULES.blockCost };
}

function connected(cells: Point[]) {
  const keys = new Set(cells.map((cell) => `${cell.x},${cell.z}`));
  const queue = [cells[0]];
  const seen = new Set([`${cells[0].x},${cells[0].z}`]);
  while (queue.length > 0) {
    const cell = queue.pop()!;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const key = `${cell.x + dx},${cell.z + dz}`;
      if (!keys.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push({ x: cell.x + dx, z: cell.z + dz });
    }
  }
  return seen.size === keys.size;
}

/** A block is removable only when at least one of its four sides is open. */
export function exposedIndexes(cells: Point[], removed: Set<number>) {
  const present = new Map<string, number>();
  cells.forEach((cell, index) => {
    if (!removed.has(index)) present.set(`${cell.x},${cell.z}`, index);
  });
  const exposed: number[] = [];
  for (const [key, index] of present) {
    const [x, z] = key.split(",").map(Number);
    const open = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dz]) => !present.has(`${x + dx},${z + dz}`));
    if (open) exposed.push(index);
  }
  return exposed;
}

export const STARTER_HALL: Design = {
  id: "starter-hall",
  name: "起始聚居地",
  fn: "hall",
  author: "system",
  rows: ["######", "#....#", "#....#", "#....#", "#....#", "######"],
};
