import type { CivId, Frame, Tile } from "../sim/types";

/**
 * v3 reads the research API directly and keeps its own thin types, so the redesign never inherits
 * a shape from the page it replaces. Terrain is immutable for a season, so it is fetched once;
 * only the frame under the playhead is fetched per turn, because the stored worlds are large.
 */

export interface SeasonStatus {
  id: string;
  status: "active" | "paused" | "complete" | "aborted";
  currentTurn: number;
  modelRuns: number;
  slots: Array<{ civ: CivId; status: string; model: string; latencyMs: number | null; error: string | null }>;
  counts: { resolved_turns: number };
}

export interface ReplayFrame {
  seasonId: string;
  turn: number;
  frame: Frame;
  slots: Record<CivId, number>;
}

export interface Landmark {
  kind: string;
  civ: CivId | null;
  turn: number;
}

export interface SeasonMessage {
  id: number;
  sentTurn: number;
  deliverTurn: number;
  from: CivId;
  to: CivId;
  text: string;
}

/** One version of one self-written text, and the turn the model wrote it. */
export interface MemoryEntry {
  turn: number;
  text: string;
}

export interface CivMemory {
  standingOrders: MemoryEntry[];
  notebook: MemoryEntry[];
  chronicle: MemoryEntry[];
  journal: MemoryEntry[];
}

export interface SeasonMemory {
  seasonId: string;
  throughTurn: number;
  limits: { standingOrders: number; notebook: number; journal: number; chronicleInterval: number };
  civs: Record<CivId, CivMemory>;
}

export interface SeasonEntry {
  id: string;
  status: string;
  /** Resolved turns. The route has always called this `turns`; `currentTurn` was never sent. */
  turns: number;
}

async function get<T>(path: string): Promise<T | null> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

export const api = {
  seasons: () => get<SeasonEntry[]>("/api/research/seasons"),
  status: (seasonId?: string) =>
    get<SeasonStatus>(`/api/research/status${seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : ""}`),
  landmarks: (seasonId: string) =>
    get<Landmark[]>(`/api/research/landmarks?seasonId=${encodeURIComponent(seasonId)}`),
  /** Clipped to the playhead, so scrubbing back hides letters that had not been sent yet. */
  messages: (seasonId: string, throughTurn: number) =>
    get<SeasonMessage[]>(
      `/api/research/messages?seasonId=${encodeURIComponent(seasonId)}&turn=${throughTurn}`,
    ),
  /** Clipped to the playhead, for the same reason the letters are. */
  memory: (seasonId: string, throughTurn: number) =>
    get<SeasonMemory>(
      `/api/research/memory?seasonId=${encodeURIComponent(seasonId)}&turn=${throughTurn}`,
    ),
  replay: (seasonId: string, turn: number) =>
    get<ReplayFrame>(`/api/research/replay?seasonId=${encodeURIComponent(seasonId)}&turn=${turn}`),
  /**
   * Terrain and the protocol that produced it. Both are immutable for a season and the spectator
   * payload carries the whole world, so v3 asks for it exactly once. The protocol travels with the
   * terrain because every reading that needs it is a reading about this map's rules.
   */
  terrain: async (seasonId: string) => {
    const payload = await get<{ tiles: Tile[]; protocolVersion?: number }>(
      `/api/research/spectator?seasonId=${encodeURIComponent(seasonId)}`,
    );
    if (!payload?.tiles) return null;
    return { tiles: payload.tiles, protocolVersion: payload.protocolVersion ?? 3 };
  },
};
