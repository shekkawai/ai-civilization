import { createHash } from "node:crypto";
import { MIN_BLOCKS, PROTOCOL16_WORKER_SIGHT, RULES, SIGHT, WORKER_SIGHT } from "../sim/config";
import type { CivId, World } from "../sim/types";
import { PROTOCOL_VERSION } from "./protocol";

function plain(value: unknown): unknown {
  if (value instanceof Uint8Array || value instanceof Int32Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) result[key] = plain(item);
    }
    return result;
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(plain(value));
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function encodeWorld(world: World) {
  return canonicalJson(world);
}

export function decodeWorld(json: string): World {
  const world = JSON.parse(json) as World;
  for (const civId of ["north", "south"] as CivId[]) {
    world.civs[civId].knowledge = Uint8Array.from(world.civs[civId].knowledge as unknown as number[]);
    world.civs[civId].lastSeen = Int32Array.from(world.civs[civId].lastSeen as unknown as number[]);
    world.civs[civId].foreignSeen ??= { workers: {}, buildings: {}, nextWorker: 1, nextBuilding: 1 };
  }
  return world;
}

export function worldHash(world: World) {
  return sha256(encodeWorld(world));
}

export const RULES_HASH = sha256(
  canonicalJson({
    protocol: PROTOCOL_VERSION,
    rules: RULES,
    minimums: MIN_BLOCKS,
    sight: SIGHT,
    workerSight: { throughProtocol15: WORKER_SIGHT, protocol16: PROTOCOL16_WORKER_SIGHT },
  }),
);
