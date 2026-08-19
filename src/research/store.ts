import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { RULES } from "../sim/config";
import { createWorld, livingWorkers, prepareTurn, resolvePreparedTurn, workerSlots } from "../sim/engine";
import { captureFrame } from "../sim/frames";
import { STARTER_HALL } from "../sim/designs";
import { CENTRE, createMap, hallOrigin, mapVariant } from "../sim/map";
import type { ActionResult, CivFrame, CivId, Decision, Frame, Point, SimEvent, World } from "../sim/types";
import { canonicalJson, decodeWorld, encodeWorld, RULES_HASH, sha256, worldHash } from "./codec";
import { buildPrivateReport, parseModelDecision } from "./report";

export interface SeasonConfig {
  maxTurns: number | null;
  maxModelRuns: number | null;
  decisionTimeoutMs: number;
  leaseMs: number;
  models: Record<CivId, { provider: string; model: string; reasoning: string }>;
}

/** The crisis fields `efficiency` returns for a civilization with no recorded trouble. */
const EMPTY_CRISIS = {
  deaths: 0,
  spilled_food: 0,
  spilled_stone: 0,
  warn_episodes: 0,
  rescued_episodes: 0,
  ongoing_episode: 0,
};

export interface PressurePoint {
  turn: number;
  civ: CivId;
  /** Furthest any living person stood from the hall's centre this turn. */
  reach: number;
  meanReach: number;
  /** People standing further from home than a new worksite could be anchored. */
  beyondHome: number;
  workers: number;
  standingBlocks?: number;
  upkeepDue?: number;
  upkeepPaid?: number;
  blocksLost?: number;
}

/**
 * The hall's centre, not `SPAWN`. `SPAWN` is origin + 3 on a six-cell footprint, so the two spawns
 * sit a diagonal tile apart and a rotationally symmetric map would then measure differently for the
 * two sides — which reads as the map favouring somebody. Duplicated from the client's
 * `lib/strategy.ts` rather than imported: nothing under `src/research/` may depend on the
 * spectator's interpretation layer.
 */
function hallCentre(seed: number, civ: CivId) {
  const width = STARTER_HALL.rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  const origin = hallOrigin(seed, civ);
  return {
    x: origin.x + (width - 1) / 2,
    z: origin.z + (STARTER_HALL.rows.length - 1) / 2,
  };
}

/** A trend note needs new material: at least this many new turns since the previous note. */
export const TREND_MIN_TURN_GAP = 6;

/** Keep the observer below its practical context ceiling while the SQLite archive stays lossless. */
export const OBSERVER_BRIEF_TOKEN_LIMIT = 500_000;
const PLAYER_AUTOMATION_CADENCE_MS = 5 * 60 * 1000;
const SCHEDULE_ANOMALY_GRACE_MS = 60 * 1000;

export const DEFAULT_SEASON_CONFIG: SeasonConfig = {
  maxTurns: 250,
  maxModelRuns: 1000,
  decisionTimeoutMs: 12 * 60 * 1000,
  leaseMs: 15 * 60 * 1000,
  models: {
    north: { provider: "unconfigured", model: "unconfigured", reasoning: "unconfigured" },
    south: { provider: "unconfigured", model: "unconfigured", reasoning: "unconfigured" },
  },
};

function limitReached(value: number, limit: number | null) {
  return limit !== null && value >= limit;
}

interface SeasonRow {
  id: string;
  status: "active" | "paused" | "complete" | "aborted";
  map_seed: number;
  rules_hash: string;
  code_commit: string;
  config_json: string;
  current_turn: number;
  model_runs: number;
  world_json: string;
  world_hash: string;
  created_at: number;
  updated_at: number;
  resumed_at: number | null;
  abort_reason: string | null;
}

interface TurnRow {
  season_id: string;
  turn: number;
  status: "waiting" | "resolved" | "aborted";
  snapshot_json: string;
  snapshot_hash: string;
  before_world_json: string;
  after_world_json: string | null;
  after_world_hash: string | null;
  prepared_at: number;
  resolved_at: number | null;
}

interface SlotRow {
  season_id: string;
  turn: number;
  civ: CivId;
  status: "open" | "claimed" | "invalid" | "submitted" | "submitted_noop" | "timed_out";
  lease_token: string | null;
  lease_expires_at: number | null;
  submission_key: string | null;
  prompt: string;
  prompt_hash: string;
  provider: string;
  model: string;
  reasoning: string;
  raw_response: string | null;
  repaired_response: string | null;
  validated_json: string | null;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
  latency_ms: number | null;
}

interface DecisionAttemptRow {
  season_id: string;
  turn: number;
  civ: CivId;
  attempt: number;
  status: "claimed" | "repair_required" | "submitted" | "submitted_noop" | "timed_out";
  lease_token: string;
  lease_expires_at: number;
  started_at: number;
  completed_at: number | null;
  raw_response: string | null;
  repaired_response: string | null;
  error: string | null;
}

interface TurnStatRow {
  season_id: string;
  turn: number;
  civ: CivId;
  workers: number;
  food: number;
  stone: number;
  buildings: number;
  carried: number;
  blocks_placed: number;
  blocks_taken: number;
  quarry_left: number;
  contact: number;
  designs: number;
  journal: string;
  storage_used: number | null;
  storage_capacity: number | null;
  next_migration_turn: number | null;
  migration_food_required: number | null;
  seen_tiles: number | null;
  nearest_gap: number | null;
}

export interface LogisticsPoint {
  turn: number;
  civ: CivId;
  workers: number;
  productive: number;
  transit: number;
  idle: number;
  newWorkers: number;
  carried: number;
  fullPacks: number;
  storageUsed: number;
  storageCapacity: number;
}

export interface StoreMilestone {
  id: string;
  civ: CivId;
  turn: number;
  x: number;
  z: number;
  capacity: number;
  oasisDistance: number | null;
}

export interface ClaimResult {
  ok: boolean;
  reason?: "season_inactive" | "season_limit" | "busy" | "already_submitted";
  seasonId: string;
  turn?: number;
  civ: CivId;
  leaseToken?: string;
  prompt?: string;
  snapshotHash?: string;
  model?: SeasonConfig["models"][CivId];
}

export interface SubmissionInput {
  seasonId: string;
  turn: number;
  civ: CivId;
  leaseToken: string;
  submissionKey: string;
  rawResponse: string;
  repairedResponse?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface DecisionFailureInput {
  seasonId: string;
  turn: number;
  civ: CivId;
  leaseToken: string;
  error: string;
  rawResponse?: string;
  completedAt?: number;
}

/**
 * One civilization's self-authored text, every version of it, with the turn it was written.
 *
 * Four separate surfaces because the engine treats them as four: standing orders are replaced
 * wholesale whenever the model sends them, the notebook is replaced wholesale by a `note` action,
 * the chronicle only ever appends and only on chronicle turns, and the journal is one entry per
 * turn that is never carried forward beyond the latest one.
 */
export interface CivMemory {
  standingOrders: Array<{ turn: number; text: string }>;
  notebook: Array<{ turn: number; text: string }>;
  chronicle: Array<{ turn: number; text: string }>;
  journal: Array<{ turn: number; text: string }>;
}

/** One delivered letter, exactly as the sending model wrote it. */
export interface SeasonMessage {
  id: number;
  sentTurn: number;
  deliverTurn: number;
  from: CivId;
  to: CivId;
  text: string;
}

export class ResearchStore {
  readonly db: Database;

  /** Season id → parsed letters, invalidated by the season row's `updated_at`. */
  private readonly messageCache = new Map<string, { updatedAt: number; messages: SeasonMessage[] }>();

  constructor(path = `${process.cwd()}/data/research.sqlite`) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate();
  }

  close() {
    this.db.close();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS seasons (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        map_seed INTEGER NOT NULL,
        rules_hash TEXT NOT NULL,
        code_commit TEXT NOT NULL,
        config_json TEXT NOT NULL,
        current_turn INTEGER NOT NULL,
        model_runs INTEGER NOT NULL DEFAULT 0,
        world_json TEXT NOT NULL,
        world_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        resumed_at INTEGER,
        abort_reason TEXT
      );
      CREATE TABLE IF NOT EXISTS turns (
        season_id TEXT NOT NULL REFERENCES seasons(id),
        turn INTEGER NOT NULL,
        status TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL,
        before_world_json TEXT NOT NULL,
        after_world_json TEXT,
        after_world_hash TEXT,
        prepared_at INTEGER NOT NULL,
        resolved_at INTEGER,
        PRIMARY KEY (season_id, turn)
      );
      CREATE TABLE IF NOT EXISTS decision_slots (
        season_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        civ TEXT NOT NULL,
        status TEXT NOT NULL,
        lease_token TEXT,
        lease_expires_at INTEGER,
        submission_key TEXT,
        prompt TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        raw_response TEXT,
        repaired_response TEXT,
        validated_json TEXT,
        error TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        latency_ms INTEGER,
        PRIMARY KEY (season_id, turn, civ),
        UNIQUE (season_id, turn, submission_key),
        FOREIGN KEY (season_id, turn) REFERENCES turns(season_id, turn)
      );
      CREATE TABLE IF NOT EXISTS decision_attempts (
        season_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        civ TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        status TEXT NOT NULL,
        lease_token TEXT NOT NULL UNIQUE,
        lease_expires_at INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        raw_response TEXT,
        repaired_response TEXT,
        error TEXT,
        PRIMARY KEY (season_id, turn, civ, attempt),
        FOREIGN KEY (season_id, turn) REFERENCES turns(season_id, turn)
      );
      CREATE TABLE IF NOT EXISTS action_results (
        season_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        result_id INTEGER NOT NULL,
        civ TEXT NOT NULL,
        action_index INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        status TEXT NOT NULL,
        code TEXT NOT NULL,
        text TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (season_id, turn, result_id)
      );
      CREATE TABLE IF NOT EXISTS world_events (
        season_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        civ TEXT,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (season_id, turn, event_id)
      );
      CREATE TABLE IF NOT EXISTS turn_stats (
        season_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        civ TEXT NOT NULL,
        workers INTEGER NOT NULL,
        food INTEGER NOT NULL,
        stone INTEGER NOT NULL,
        buildings INTEGER NOT NULL,
        carried INTEGER NOT NULL,
        blocks_placed INTEGER NOT NULL,
        blocks_taken INTEGER NOT NULL,
        quarry_left INTEGER NOT NULL,
        contact INTEGER NOT NULL,
        designs INTEGER NOT NULL,
        journal TEXT NOT NULL,
        PRIMARY KEY (season_id, turn, civ)
      );
      CREATE INDEX IF NOT EXISTS slots_by_status ON decision_slots(season_id, status, turn);
      CREATE INDEX IF NOT EXISTS attempts_by_status ON decision_attempts(season_id, status, turn);
      CREATE INDEX IF NOT EXISTS events_by_turn ON world_events(season_id, turn);
      -- One row per worker per resolved turn: the standing job it held and where it stood. This is
      -- what the Worker Loom draws, and it cannot be recovered from action_results alone — a worker
      -- walking to a distant tile produces no result at all, and "walking" must not read as "idle".
      CREATE TABLE IF NOT EXISTS worker_turns (
        season_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        worker_id TEXT NOT NULL,
        civ TEXT NOT NULL,
        job TEXT NOT NULL,
        x INTEGER NOT NULL,
        z INTEGER NOT NULL,
        carry_food INTEGER NOT NULL,
        carry_stone INTEGER NOT NULL,
        PRIMARY KEY (season_id, turn, worker_id)
      );
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      -- Written by an observer model after a season ends, for human readers only.
      -- NOTHING in src/research/report.ts may ever read this table: a summary that reached a
      -- player would be commentary on its own behaviour, which is exactly what the experiment
      -- must not contain. A regression test asserts a saved summary never appears in a prompt.
      CREATE TABLE IF NOT EXISTS season_summaries (
        season_id TEXT PRIMARY KEY REFERENCES seasons(id),
        author_model TEXT NOT NULL,
        written_at INTEGER NOT NULL,
        season_status TEXT NOT NULL,
        season_turn INTEGER NOT NULL,
        brief_hash TEXT NOT NULL,
        markdown TEXT NOT NULL
      );
      -- Mid-season trend commentary by the observer model, for human readers only.
      -- Same seal as season_summaries: NOTHING in src/research/report.ts may ever read this
      -- table, and a regression test asserts a saved trend never appears in a player prompt.
      -- Unlike summaries, a trend note may be written while the season is still running — it is
      -- labelled commentary in the UI and carries the turn it was written at.
      CREATE TABLE IF NOT EXISTS season_trends (
        season_id TEXT NOT NULL REFERENCES seasons(id),
        through_turn INTEGER NOT NULL,
        author_model TEXT NOT NULL,
        written_at INTEGER NOT NULL,
        brief_hash TEXT NOT NULL,
        markdown TEXT NOT NULL,
        PRIMARY KEY (season_id, through_turn)
      );
    `);
    this.ensureColumn("turn_stats", "storage_used", "INTEGER");
    this.ensureColumn("turn_stats", "storage_capacity", "INTEGER");
    this.ensureColumn("turn_stats", "next_migration_turn", "INTEGER");
    this.ensureColumn("turn_stats", "migration_food_required", "INTEGER");
    this.ensureColumn("turn_stats", "seen_tiles", "INTEGER");
    this.ensureColumn("turn_stats", "nearest_gap", "INTEGER");
    this.ensureColumn("seasons", "resumed_at", "INTEGER");
    this.backfillTurnStats();
    this.backfillKnowledgeSeries();
    this.backfillWorkerTurns();
    this.backfillPrepareEvents();
  }

  private ensureColumn(table: string, column: string, type: string) {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  private once(key: string, work: () => void) {
    const done = this.db.query("SELECT value FROM schema_meta WHERE key=?").get(key) as { value: string } | null;
    if (done) return;
    const transaction = this.db.transaction(() => {
      work();
      this.db.query("INSERT INTO schema_meta (key,value) VALUES (?,?)").run(key, String(Date.now()));
    });
    transaction.immediate();
  }

  /**
   * Turns recorded before the prepare-phase logging fix kept their upkeep events only inside the
   * stored snapshot. The evidence was never lost, just never indexed — copy it across once so
   * starvation deaths appear in the ledger of those seasons too.
   */
  private backfillPrepareEvents() {
    this.once("prepare-events-backfilled", () => {
      const turns = this.db
        .query("SELECT season_id, turn, before_world_json, snapshot_json FROM turns ORDER BY season_id, turn")
        .all() as Array<{ season_id: string; turn: number; before_world_json: string; snapshot_json: string }>;
      for (const row of turns) {
        const before = (JSON.parse(row.before_world_json) as World).events;
        const snapshot = (JSON.parse(row.snapshot_json) as World).events;
        if (snapshot.length <= before.length) continue;
        for (const event of snapshot.slice(before.length)) {
          const exists = this.db
            .query("SELECT 1 FROM world_events WHERE season_id=? AND turn=? AND event_id=?")
            .get(row.season_id, event.turn, event.id);
          if (!exists) this.insertEvent(row.season_id, event);
        }
      }
    });
  }

  /**
   * `turn_stats` is a compact per-turn summary so the history, charts and report never have to
   * decode every stored world. Seasons recorded before the table existed are filled in once.
   */
  private backfillTurnStats() {
    const seasons = this.db
      .query(
        `SELECT s.id, s.map_seed FROM seasons s
         WHERE NOT EXISTS (SELECT 1 FROM turn_stats t WHERE t.season_id = s.id)`,
      )
      .all() as Array<{ id: string; map_seed: number }>;
    for (const season of seasons) {
      const transaction = this.db.transaction(() => {
        this.writeTurnStats(season.id, createWorld(season.map_seed));
        const turns = this.db
          .query("SELECT after_world_json FROM turns WHERE season_id=? AND status='resolved' ORDER BY turn")
          .all(season.id) as Array<{ after_world_json: string | null }>;
        for (const turn of turns) {
          if (turn.after_world_json) this.writeTurnStats(season.id, decodeWorld(turn.after_world_json));
        }
      });
      transaction.immediate();
    }
  }

  /**
   * `seen_tiles` and `nearest_gap` arrived with the v3 spectator charts. Every earlier row has them
   * as NULL, and the evidence to fill them is already in the stored worlds — replay each resolved
   * turn once and rewrite its summary. Guarded by `once`, because decoding every world of every
   * season is expensive and only ever needs to happen a single time.
   */
  private backfillKnowledgeSeries() {
    const pending = this.db
      .query("SELECT COUNT(*) AS n FROM turn_stats WHERE seen_tiles IS NULL")
      .get() as { n: number };
    if (pending.n === 0) return;
    this.once("turn-stats-knowledge-series", () => {
      const seasons = this.db.query("SELECT id, map_seed FROM seasons").all() as Array<{
        id: string;
        map_seed: number;
      }>;
      for (const season of seasons) {
        this.writeTurnStats(season.id, createWorld(season.map_seed));
        const turns = this.db
          .query("SELECT after_world_json FROM turns WHERE season_id=? AND status='resolved' ORDER BY turn")
          .all(season.id) as Array<{ after_world_json: string | null }>;
        for (const turn of turns) {
          if (turn.after_world_json) this.writeTurnStats(season.id, decodeWorld(turn.after_world_json));
        }
      }
    });
  }

  /** Replays every stored world once so finished seasons have a Loom too. */
  private backfillWorkerTurns() {
    const existing = this.db.query("SELECT COUNT(*) AS n FROM worker_turns").get() as { n: number };
    if (existing.n > 0) return;
    this.once("worker-turns-backfilled", () => {
      const seasons = this.db.query("SELECT id, map_seed FROM seasons").all() as Array<{
        id: string;
        map_seed: number;
      }>;
      for (const season of seasons) {
        this.writeWorkerTurns(season.id, createWorld(season.map_seed));
        const turns = this.db
          .query("SELECT after_world_json FROM turns WHERE season_id=? AND status='resolved' ORDER BY turn")
          .all(season.id) as Array<{ after_world_json: string | null }>;
        for (const turn of turns) {
          if (turn.after_world_json) this.writeWorkerTurns(season.id, decodeWorld(turn.after_world_json));
        }
      }
    });
  }

  private writeWorkerTurns(seasonId: string, world: World) {
    const insert = this.db.query(
      `INSERT OR REPLACE INTO worker_turns
       (season_id,turn,worker_id,civ,job,x,z,carry_food,carry_stone) VALUES (?,?,?,?,?,?,?,?,?)`,
    );
    for (const worker of Object.values(world.workers)) {
      if (!worker.alive) continue;
      insert.run(
        seasonId,
        world.turn,
        worker.id,
        worker.owner,
        worker.job.kind,
        worker.at.x,
        worker.at.z,
        Math.round(worker.carrying.food),
        Math.round(worker.carrying.stone),
      );
    }
  }

  /**
   * The Loom: one lane per worker across the whole season. `job` is the standing order it held at
   * the end of that turn; `did` is what the engine actually recorded for it, so a lane can show
   * both the intent and the outcome.
   */
  loom(seasonId: string) {
    const lanes = this.db
      .query(
        `SELECT w.turn, w.worker_id, w.civ, w.job, w.carry_food + w.carry_stone AS load,
                (SELECT r.code FROM action_results r
                  WHERE r.season_id = w.season_id AND r.turn = w.turn
                    AND r.payload_json LIKE '%"' || w.worker_id || '"%'
                    AND r.action_type = 'job'
                  ORDER BY r.result_id LIMIT 1) AS did
           FROM worker_turns w WHERE w.season_id = ? ORDER BY w.worker_id, w.turn`,
      )
      .all(seasonId) as Array<{
      turn: number;
      worker_id: string;
      civ: CivId;
      job: string;
      load: number;
      did: string | null;
    }>;
    return lanes;
  }

  /**
   * Classify what physically happened to every living worker during a turn.
   *
   * `worker_turns.job` is the standing job at the *end* of the turn. A worker that delivered a
   * backpack or finished a building often ends that same turn as `idle`, so counting that column
   * directly calls useful work waste. A genuinely idle worker has all four properties below:
   * no completed job result, no attempted/blocked job result, no movement, and no standing job.
   * Newly joined workers are kept separate because the engine adds them after that turn's work.
   */
  private labourActivity(seasonId: string, throughTurn = Number.MAX_SAFE_INTEGER) {
    type WorkerTurn = {
      turn: number;
      worker_id: string;
      civ: CivId;
      job: string;
      x: number;
      z: number;
      carry_food: number;
      carry_stone: number;
    };
    type Activity = {
      productive: number;
      transit: number;
      idle: number;
      newWorkers: number;
      fullPacks: number;
      idleGap: number;
      idleRefused: number;
      idleNeglect: number;
    };

    const workerTurns = this.db
      .query(
        `SELECT turn, worker_id, civ, job, x, z, carry_food, carry_stone
           FROM worker_turns WHERE season_id = ? AND turn <= ?
          ORDER BY turn, worker_id`,
      )
      .all(seasonId, throughTurn) as WorkerTurn[];
    const resultRows = this.db
      .query(
        `SELECT turn, status, payload_json FROM action_results
          WHERE season_id = ? AND turn <= ? AND action_type = 'job'`,
      )
      .all(seasonId, throughTurn) as Array<{ turn: number; status: string; payload_json: string }>;

    const outcomes = new Map<string, { any: boolean; completed: boolean }>();
    for (const row of resultRows) {
      const payload = JSON.parse(row.payload_json) as { workerIds?: string[] };
      for (const workerId of payload.workerIds ?? []) {
        const key = `${row.turn}:${workerId}`;
        const current = outcomes.get(key) ?? { any: false, completed: false };
        current.any = true;
        current.completed ||= row.status === "completed";
        outcomes.set(key, current);
      }
    }

    // Every model-issued order (action_index >= 0) that names a worker, so an idle turn can be
    // attributed: did the model address this worker and the rules refuse, or say nothing at all?
    const orderRows = this.db
      .query(
        `SELECT turn, status, payload_json FROM action_results
          WHERE season_id = ? AND turn <= ? AND action_index >= 0`,
      )
      .all(seasonId, throughTurn) as Array<{ turn: number; status: string; payload_json: string }>;
    const ordered = new Map<string, { refused: boolean }>();
    for (const row of orderRows) {
      const payload = JSON.parse(row.payload_json) as { workerIds?: string[] };
      for (const workerId of payload.workerIds ?? []) {
        const key = `${row.turn}:${workerId}`;
        const current = ordered.get(key) ?? { refused: false };
        current.refused ||= row.status === "rejected" || row.status === "failed";
        ordered.set(key, current);
      }
    }

    const byTurn = new Map<string, Activity>();
    const previous = new Map<string, WorkerTurn>();
    // Genuinely-idle workers of the turn currently being read, and of the turn before it. A
    // second consecutive unaddressed idle turn is neglect; the first is a between-jobs gap.
    let readingTurn = -1;
    let idleBefore = new Set<string>();
    let idleNow = new Set<string>();
    for (const row of workerTurns) {
      if (row.turn !== readingTurn) {
        idleBefore = idleNow;
        idleNow = new Set();
        readingTurn = row.turn;
      }
      const key = `${row.turn}:${row.civ}`;
      const activity = byTurn.get(key) ?? {
        productive: 0,
        transit: 0,
        idle: 0,
        newWorkers: 0,
        fullPacks: 0,
        idleGap: 0,
        idleRefused: 0,
        idleNeglect: 0,
      };
      const before = previous.get(row.worker_id);
      const outcome = outcomes.get(`${row.turn}:${row.worker_id}`);
      const moved = Boolean(before && (before.x !== row.x || before.z !== row.z));

      if (outcome?.completed) activity.productive += 1;
      else if (outcome?.any || moved || row.job !== "idle") activity.transit += 1;
      else if (!before && row.turn > 1) activity.newWorkers += 1;
      else {
        activity.idle += 1;
        const order = ordered.get(`${row.turn}:${row.worker_id}`);
        if (order?.refused) activity.idleRefused += 1;
        else if (order) activity.idleGap += 1;
        else if (idleBefore.has(row.worker_id)) activity.idleNeglect += 1;
        else activity.idleGap += 1;
        idleNow.add(row.worker_id);
      }

      if (row.carry_food + row.carry_stone >= RULES.carry) activity.fullPacks += 1;
      byTurn.set(key, activity);
      previous.set(row.worker_id, row);
    }
    return byTurn;
  }

  /** Observer-only labour, backpack and local-storage facts for the logistics panel. */
  logistics(seasonId: string) {
    const activity = this.labourActivity(seasonId);
    const stats = this.db
      .query(
        `SELECT turn, civ, workers, carried,
                COALESCE(storage_used, 0) AS storage_used,
                COALESCE(storage_capacity, 0) AS storage_capacity
           FROM turn_stats WHERE season_id = ? ORDER BY turn, civ`,
      )
      .all(seasonId) as Array<{
      turn: number;
      civ: CivId;
      workers: number;
      carried: number;
      storage_used: number;
      storage_capacity: number;
    }>;
    const points: LogisticsPoint[] = stats.map((row) => {
      const turn = activity.get(`${row.turn}:${row.civ}`);
      return {
        turn: row.turn,
        civ: row.civ,
        workers: row.workers,
        productive: turn?.productive ?? 0,
        transit: turn?.transit ?? 0,
        idle: turn?.idle ?? 0,
        newWorkers: turn?.newWorkers ?? 0,
        carried: row.carried,
        fullPacks: turn?.fullPacks ?? 0,
        storageUsed: row.storage_used,
        storageCapacity: row.storage_capacity,
      };
    });

    const completionRows = this.db
      .query(
        `SELECT e.turn, e.civ, e.payload_json, t.after_world_json
           FROM world_events e
           JOIN turns t ON t.season_id = e.season_id AND t.turn = e.turn
          WHERE e.season_id = ? AND e.kind = 'complete' AND t.after_world_json IS NOT NULL
          ORDER BY e.turn, e.event_id`,
      )
      .all(seasonId) as Array<{
      turn: number;
      civ: CivId;
      payload_json: string;
      after_world_json: string;
    }>;
    const stores: StoreMilestone[] = [];
    for (const row of completionRows) {
      const event = JSON.parse(row.payload_json) as SimEvent;
      if (!event.at) continue;
      const world = decodeWorld(row.after_world_json);
      const building = Object.values(world.buildings).find(
        (entry) =>
          entry.owner === row.civ &&
          entry.fn === "store" &&
          entry.origin.x === event.at!.x &&
          entry.origin.z === event.at!.z,
      );
      if (!building) continue;
      const oasisDistance = world.oasis
        ? Math.min(
            ...building.access.flatMap((access) =>
              world.oasis!.cells.map((cell) => Math.abs(access.x - cell.x) + Math.abs(access.z - cell.z)),
            ),
          )
        : null;
      stores.push({
        id: building.id,
        civ: row.civ,
        turn: row.turn,
        x: building.origin.x,
        z: building.origin.z,
        capacity: building.total * 10,
        oasisDistance,
      });
    }

    return { points, stores };
  }

  /**
   * How well each side turned worker-turns into goods, up to and including `throughTurn`.
   *
   * These are the readings the stored ledgers actually support, chosen after measuring every
   * recorded season rather than guessed at:
   *
   * - **Delivered per worker-turn** is the headline, because it integrates every other reading at
   *   once — walking, idling, load size and refused orders all reduce it. It counts goods that
   *   physically reached storage, never goods gathered, because goods in a backpack cannot be eaten.
   * - **Load per trip against turns per trip** is the pair that answers "was the pack full". Either
   *   alone is misleading: a five-unit delivery from a field beside the store is optimal, and the
   *   same delivery after a four-turn walk is waste. v11 is the case that proves the pair is needed
   *   — both sides ran a ~3.5-turn cycle and one brought back 4.3 while the other brought 9.6.
   * - **Genuine idle share** and **refusal rate** are the two ways a turn is spent on nothing: no
   *   movement, outcome or standing job at all, or an order the rules would not carry out. The
   *   end-of-turn `job` column alone is not an idle measurement.
   * - **Tiles per worker-turn** is exploration measured as return on labour rather than as a total.
   *   v19's two sides observed 1,500 against 770 tiles on nearly identical worker-turn budgets.
   * - **Still carried** is context, not a score: it is the gap between gathered and delivered, and
   *   a large one means the supply chain, not the gathering, is the constraint.
   * - **Idle attribution** splits the genuine-idle total three ways: a first unaddressed idle
   *   turn (the ordinary gap between jobs), an idle turn whose order the rules refused, or
   *   neglect — a second consecutive idle turn the model said nothing about. Measured across
   *   every recorded season with this exact classifier, neglect never exceeded 2.4% of a side's
   *   worker-turns (v10 north); models almost always answer an idle worker at the next decision.
   * - **The crisis record** exists because raw death counts mislead: the engine (protocol 10+)
   *   kills exactly one worker per hungry turn and picks the victim itself, so a death is never a
   *   choice the model made. What *is* the model's is the response to warning: in every recorded
   *   death the civilization had spent at least 3 consecutive turns with stored-food cover below
   *   3 turns of upkeep first, and 8 civ-seasons entered that band and saved everyone. Spilled
   *   goods at death separate the two failure species — food that existed but sat in backpacks
   *   (a rules misunderstanding; backpacks cannot pay upkeep) against food that never existed.
   *
   * Deliberately **not** returned: any composite, ranking or score. The rules define no victory
   * condition, and none of this may ever reach a player — it is a human-viewer surface only.
   */
  efficiency(seasonId: string, throughTurn: number) {
    const rows = this.db
      .query(
        `WITH labour AS (
           SELECT civ, COUNT(*) AS worker_turns
             FROM worker_turns WHERE season_id = ?1 AND turn <= ?2 GROUP BY civ),
         drops AS (
           SELECT civ, turn, json_extract(payload_json, '$.workerIds[0]') AS worker_id,
                  CAST(json_extract(payload_json, '$.amount') AS INTEGER) AS amount
             FROM action_results WHERE season_id = ?1 AND turn <= ?2 AND code = 'deposited'),
         cycles AS (
           SELECT civ, amount,
                  turn - LAG(turn) OVER (PARTITION BY worker_id ORDER BY turn) AS cycle
             FROM drops),
         delivered AS (
           SELECT civ, COUNT(*) AS trips, SUM(amount) AS delivered, AVG(amount) AS load_per_trip
             FROM drops GROUP BY civ),
         paced AS (
           SELECT civ, AVG(cycle) AS turns_per_trip FROM cycles
            WHERE cycle IS NOT NULL AND cycle <= 40 GROUP BY civ),
         orders AS (
           SELECT civ, COUNT(*) AS issued,
                  SUM(CASE WHEN status IN ('rejected','failed') THEN 1 ELSE 0 END) AS refused
             FROM action_results WHERE season_id = ?1 AND turn <= ?2 AND action_index >= 0 GROUP BY civ),
         latest AS (
           SELECT civ, seen_tiles, carried, workers FROM turn_stats
            WHERE season_id = ?1 AND turn = (SELECT MAX(turn) FROM turn_stats WHERE season_id = ?1 AND turn <= ?2))
         SELECT labour.civ, labour.worker_turns,
                COALESCE(delivered.delivered, 0) AS delivered,
                COALESCE(delivered.trips, 0) AS trips,
                delivered.load_per_trip, paced.turns_per_trip,
                COALESCE(orders.issued, 0) AS issued, COALESCE(orders.refused, 0) AS refused,
                latest.seen_tiles, latest.carried, latest.workers
           FROM labour
           LEFT JOIN delivered ON delivered.civ = labour.civ
           LEFT JOIN paced ON paced.civ = labour.civ
           LEFT JOIN orders ON orders.civ = labour.civ
           LEFT JOIN latest ON latest.civ = labour.civ`,
      )
      .all(seasonId, throughTurn) as Array<{
      civ: CivId;
      worker_turns: number;
      idle_turns?: number;
      delivered: number;
      trips: number;
      load_per_trip: number | null;
      turns_per_trip: number | null;
      issued: number;
      refused: number;
      seen_tiles: number | null;
      carried: number | null;
      workers: number | null;
    }>;
    const activity = this.labourActivity(seasonId, throughTurn);
    const crisis = this.crisisRecord(seasonId, throughTurn);
    return rows.map((row) => {
      const sums = { idle: 0, gap: 0, refused: 0, neglect: 0 };
      for (const [key, value] of activity.entries()) {
        if (!key.endsWith(`:${row.civ}`)) continue;
        sums.idle += value.idle;
        sums.gap += value.idleGap;
        sums.refused += value.idleRefused;
        sums.neglect += value.idleNeglect;
      }
      return {
        ...row,
        idle_turns: sums.idle,
        idle_gap: sums.gap,
        idle_refused: sums.refused,
        idle_neglect: sums.neglect,
        ...(crisis.get(row.civ) ?? EMPTY_CRISIS),
      };
    });
  }

  /**
   * The food-crisis record behind the efficiency panel: warning episodes, rescues, deaths and
   * what the dead were carrying, cumulative to `throughTurn`.
   *
   * A warning turn is stored-food cover below 3 turns of upkeep (`food < 3 × workers × upkeep`)
   * with anyone still alive; consecutive warning turns form one episode. An episode containing a
   * starvation event died; one that ended below the playhead without a death was a rescue; one
   * still open at the playhead is ongoing and counted as neither. The starve and spill figures
   * are parsed from the engine's fixed log text, the same way `harvestSeries` reads gathers —
   * engine-generated, never user input.
   */
  private crisisRecord(seasonId: string, throughTurn: number) {
    const events = this.db
      .query(
        `SELECT turn, civ, kind, text FROM world_events
          WHERE season_id = ?1 AND turn <= ?2 AND kind IN ('starve', 'spill')`,
      )
      .all(seasonId, throughTurn) as Array<{ turn: number; civ: CivId | null; kind: string; text: string }>;
    const deathTurns = new Map<CivId, Set<number>>();
    const record = new Map<CivId, { deaths: number; spilled_food: number; spilled_stone: number }>();
    for (const event of events) {
      if (!event.civ) continue;
      const row = record.get(event.civ) ?? { deaths: 0, spilled_food: 0, spilled_stone: 0 };
      if (event.kind === "starve") {
        // Two text eras: `糧倉見底，N 名工人餓死。` through protocol 16, `The granary ran dry —
        // N workers starved.` from 17. The +1 fallback would also be correct alone for every
        // English-era season (protocol ≥ 10 kills at most one worker a turn), but parsing both
        // keeps the count honest if an old backup is ever re-read.
        const toll = /(\d+) 名工人餓死/.exec(event.text) ?? /(\d+) workers starved/.exec(event.text);
        row.deaths += toll ? Number(toll[1]) : 1;
        const turns = deathTurns.get(event.civ) ?? new Set();
        turns.add(event.turn);
        deathTurns.set(event.civ, turns);
      } else {
        // Anchored to the starved-worker sentence in both eras on purpose: a building falling to
        // unpaid upkeep also logs kind `spill` and its text carries the same `N 糧食與 M 石材`
        // phrase, and an unanchored match counted those blocks' scattered stock as goods the dead
        // were carrying. Building-fall losses are already surfaced by Pressure's blocks-lost
        // reading; this metric is only about what starved workers took down with them.
        const spill =
          /^一名餓死工人攜帶的 (\d+) 糧食與 (\d+) 石材掉在地上。$/.exec(event.text) ??
          /^(\d+) food and (\d+) stone carried by a starved worker fell to the ground\.$/.exec(event.text);
        if (spill) {
          row.spilled_food += Number(spill[1]);
          row.spilled_stone += Number(spill[2]);
        }
      }
      record.set(event.civ, row);
    }

    const cover = this.db
      .query(
        `SELECT turn, civ, workers, food FROM turn_stats
          WHERE season_id = ?1 AND turn <= ?2 ORDER BY civ, turn`,
      )
      .all(seasonId, throughTurn) as Array<{ turn: number; civ: CivId; workers: number; food: number }>;
    const result = new Map<CivId, typeof EMPTY_CRISIS>();
    for (const civ of ["north", "south"] as CivId[]) {
      const turns = cover.filter((row) => row.civ === civ);
      const lastTurn = turns.length > 0 ? turns[turns.length - 1].turn : 0;
      const episodes: Array<{ start: number; end: number }> = [];
      for (const row of turns) {
        const low = row.workers > 0 && row.food < 3 * row.workers * RULES.upkeep;
        if (!low) continue;
        const open = episodes[episodes.length - 1];
        if (open && row.turn === open.end + 1) open.end = row.turn;
        else episodes.push({ start: row.turn, end: row.turn });
      }
      const died = deathTurns.get(civ) ?? new Set<number>();
      // The turn a civilization is wiped out has no living workers, so the low-cover run ends
      // one turn before the starve event it caused; the episode owns that adjacent death.
      const fatal = episodes.filter((episode) =>
        Array.from(died).some((turn) => turn >= episode.start && turn <= episode.end + 1),
      );
      const ongoing = episodes.filter(
        (episode) => episode.end >= lastTurn && !fatal.includes(episode),
      );
      const base = record.get(civ) ?? { deaths: 0, spilled_food: 0, spilled_stone: 0 };
      result.set(civ, {
        deaths: base.deaths,
        spilled_food: base.spilled_food,
        spilled_stone: base.spilled_stone,
        warn_episodes: episodes.length,
        rescued_episodes: episodes.length - fatal.length - ongoing.length,
        ongoing_episode: ongoing.length > 0 ? 1 : 0,
      });
    }
    return result;
  }

  /**
   * Food and stone taken off the map each turn, read straight from the results ledger. The engine
   * writes the resource into the result text rather than a column, so the split keys off that text;
   * it is engine-generated and fixed, never user input.
   *
   * The text has two eras and the match must cover both: through protocol 16 a gather reads
   * `X 採集了 5 糧食。`, from protocol 17 the same sentence is stored in English —
   * `X gathered 5 food.`. Matching only the Chinese word classified every English-era gather as
   * stone, which showed both v36 civilizations at "100% stone" while they were living off the
   * Oasis. Rows are pre-filtered to `code = 'gathered'`, so these are the only two shapes.
   */
  harvestSeries(seasonId: string) {
    return this.db
      .query(
        `SELECT turn, civ,
                SUM(CASE WHEN text LIKE '%糧食%' OR text LIKE '% food.' THEN amount ELSE 0 END) AS food,
                SUM(CASE WHEN text LIKE '%糧食%' OR text LIKE '% food.' THEN 0 ELSE amount END) AS stone
           FROM (SELECT turn, civ, text, CAST(json_extract(payload_json,'$.amount') AS INTEGER) AS amount
                   FROM action_results WHERE season_id = ? AND code = 'gathered')
          GROUP BY turn, civ ORDER BY turn`,
      )
      .all(seasonId) as Array<{ turn: number; civ: CivId; food: number; stone: number }>;
  }

  /**
   * Everything the engine recorded for one turn, refusals included. Refusals get equal billing with
   * successes on the page, so they are returned whole rather than filtered.
   */
  turnDetail(seasonId: string, turn: number) {
    const results = this.db
      .query("SELECT payload_json FROM action_results WHERE season_id=? AND turn=? ORDER BY result_id")
      .all(seasonId, turn) as Array<{ payload_json: string }>;
    const events = this.db
      .query("SELECT payload_json FROM world_events WHERE season_id=? AND turn=? ORDER BY event_id")
      .all(seasonId, turn) as Array<{ payload_json: string }>;
    const journals = this.db
      .query("SELECT civ, journal FROM turn_stats WHERE season_id=? AND turn=?")
      .all(seasonId, turn) as Array<{ civ: CivId; journal: string }>;
    return {
      turn,
      results: results.map((row) => JSON.parse(row.payload_json)),
      events: events.map((row) => JSON.parse(row.payload_json)),
      journals,
    };
  }

  private writeTurnStats(seasonId: string, world: World) {
    const frame = captureFrame(world, []);
    for (const civ of ["north", "south"] as CivId[]) {
      const stats = frame.civs[civ];
      const entries = world.civs[civ].journal;
      this.db
        .query(
          `INSERT OR REPLACE INTO turn_stats
           (season_id,turn,civ,workers,food,stone,buildings,carried,blocks_placed,blocks_taken,quarry_left,contact,designs,journal,storage_used,storage_capacity,next_migration_turn,migration_food_required,seen_tiles,nearest_gap)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          seasonId,
          world.turn,
          civ,
          stats.workers,
          stats.food,
          stats.stone,
          stats.buildings,
          stats.carried,
          stats.blocksPlaced,
          stats.blocksTaken,
          stats.quarryLeft,
          stats.contact ? 1 : 0,
          Object.keys(world.civs[civ].designs).length,
          entries.length > 0 ? entries[entries.length - 1].text : "",
          stats.storageUsed ?? null,
          stats.storageCapacity ?? null,
          stats.nextMigrationTurn ?? null,
          stats.migrationFoodRequired ?? null,
          stats.seenTiles ?? null,
          stats.nearestGap ?? null,
        );
    }
  }

  createSeason(
    seed = 20260802,
    config: SeasonConfig = DEFAULT_SEASON_CONFIG,
    id = `season-${randomUUID()}`,
    codeCommit = process.env.GIT_COMMIT ?? "working-tree",
  ) {
    const world = createWorld(seed);
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO seasons
         (id,status,map_seed,rules_hash,code_commit,config_json,current_turn,model_runs,world_json,world_hash,created_at,updated_at)
         VALUES ($id,'active',$seed,$rules,$commit,$config,0,0,$world,$hash,$now,$now)`,
      )
      .run({
        id,
        seed,
        rules: RULES_HASH,
        commit: codeCommit,
        config: JSON.stringify(config),
        world: encodeWorld(world),
        hash: worldHash(world),
        now,
      });
    this.writeTurnStats(id, world);
    return id;
  }

  getSeason(id: string) {
    return this.db.query("SELECT * FROM seasons WHERE id = ?").get(id) as SeasonRow | null;
  }

  latestSeason() {
    return this.db.query("SELECT * FROM seasons ORDER BY created_at DESC LIMIT 1").get() as SeasonRow | null;
  }

  reviewLatestSeason(now = Date.now(), stallMs = 30 * 60 * 1000) {
    const season = this.latestSeason();
    const summaryPending = this.seasonsAwaitingSummary().map((entry) => entry.id);
    if (!season) {
      return { ok: true as const, action: "pause_players" as const, reason: "no_season" as const, summaryPending };
    }
    const config = JSON.parse(season.config_json) as SeasonConfig;
    const base = {
      ok: true as const,
      seasonId: season.id,
      status: season.status,
      currentTurn: season.current_turn,
      modelRuns: season.model_runs,
      expectedModels: config.models,
      summaryPending,
    };
    if (season.status !== "active") {
      return { ...base, action: "pause_players" as const, reason: `season_${season.status}` as const };
    }
    if (limitReached(season.current_turn, config.maxTurns) || limitReached(season.model_runs, config.maxModelRuns)) {
      return { ...base, action: "pause_players" as const, reason: "season_limit" as const };
    }
    const replay = this.verifyReplay(season.id);
    if (!replay.ok) {
      return { ...base, action: "pause_players" as const, reason: "replay_failed" as const, replay };
    }
    const waiting = this.db
      .query("SELECT * FROM turns WHERE season_id=? AND status='waiting' ORDER BY turn DESC LIMIT 1")
      .get(season.id) as TurnRow | null;
    const slots = waiting
      ? (this.db
          .query("SELECT civ,status,error,started_at FROM decision_slots WHERE season_id=? AND turn=? ORDER BY civ")
          .all(season.id, waiting.turn) as Array<{
          civ: CivId;
          status: string;
          error: string | null;
          started_at: number | null;
        }>)
      : [];
    const decisionInFlight = slots.some(
      (slot) =>
        (slot.status === "claimed" || slot.status === "invalid") &&
        slot.started_at !== null &&
        now - slot.started_at < stallMs,
    );
    const stallWindowStartedAt = waiting ? Math.max(waiting.prepared_at, season.resumed_at ?? 0) : now;
    if (waiting && now - stallWindowStartedAt >= stallMs && !decisionInFlight) {
      this.expireLeases(now);
      const stalledSlots = this.db
        .query("SELECT civ,status,error FROM decision_slots WHERE season_id=? AND turn=? ORDER BY civ")
        .all(season.id, waiting.turn) as Array<{ civ: CivId; status: string; error: string | null }>;
      return {
        ...base,
        action: "pause_players" as const,
        reason: "turn_stalled" as const,
        stalledTurn: waiting.turn,
        stalledForMs: now - stallWindowStartedAt,
        slots: stalledSlots,
        replay,
      };
    }
    return {
      ...base,
      action: "continue" as const,
      reason: "active_season_healthy" as const,
      waitingTurn: waiting?.turn ?? null,
      waitingForMs: waiting ? now - waiting.prepared_at : 0,
      replay,
    };
  }

  getTurn(seasonId: string, turn: number) {
    return this.db.query("SELECT * FROM turns WHERE season_id = ? AND turn = ?").get(seasonId, turn) as TurnRow | null;
  }

  prepareNextTurn(seasonId: string) {
    const transaction = this.db.transaction(() => {
      const season = this.getSeason(seasonId);
      if (!season || season.status !== "active") return null;
      const config = JSON.parse(season.config_json) as SeasonConfig;
      if (limitReached(season.current_turn, config.maxTurns) || limitReached(season.model_runs, config.maxModelRuns)) {
        this.db.query("UPDATE seasons SET status='paused', updated_at=? WHERE id=?").run(Date.now(), seasonId);
        return null;
      }
      const pending = this.db
        .query("SELECT * FROM turns WHERE season_id=? AND status='waiting' ORDER BY turn LIMIT 1")
        .get(seasonId) as TurnRow | null;
      if (pending) return pending;

      const world = decodeWorld(season.world_json);
      const before = encodeWorld(world);
      const prepareEventStart = world.events.length;
      prepareTurn(world);
      const snapshot = encodeWorld(world);
      const snapshotHash = worldHash(world);
      const now = Date.now();
      this.db
        .query(
          `INSERT INTO turns
           (season_id,turn,status,snapshot_json,snapshot_hash,before_world_json,prepared_at)
           VALUES (?,?,'waiting',?,?,?,?)`,
        )
        .run(seasonId, world.turn, snapshot, snapshotHash, before, now);
      // Upkeep and regeneration run here, before either model decides. Their events land in
      // the snapshot, so resolveReadyTurn's slice would skip them and starvation deaths would
      // never reach the ledger. Record them at the moment they are produced.
      for (const event of world.events.slice(prepareEventStart)) this.insertEvent(seasonId, event);
      for (const civ of ["north", "south"] as CivId[]) {
        const report = buildPrivateReport(world, civ);
        const model = config.models[civ];
        this.db
          .query(
            `INSERT INTO decision_slots
             (season_id,turn,civ,status,prompt,prompt_hash,provider,model,reasoning)
             VALUES (?,? ,?,'open',?,?,?,?,?)`,
          )
          .run(seasonId, world.turn, civ, report.text, sha256(report.text), model.provider, model.model, model.reasoning);
      }
      return this.getTurn(seasonId, world.turn);
    });
    return transaction.immediate() as TurnRow | null;
  }

  claimDecision(seasonId: string, civ: CivId): ClaimResult {
    this.expireLeases();
    const prepared = this.prepareNextTurn(seasonId);
    if (!prepared) return { ok: false, reason: "season_inactive", seasonId, civ };
    const transaction = this.db.transaction(() => {
      const season = this.getSeason(seasonId)!;
      const config = JSON.parse(season.config_json) as SeasonConfig;
      const slot = this.getSlot(seasonId, prepared.turn, civ);
      if (!slot) return { ok: false, reason: "season_inactive", seasonId, civ } satisfies ClaimResult;
      if (slot.status === "submitted" || slot.status === "submitted_noop") {
        return { ok: false, reason: "already_submitted", seasonId, turn: prepared.turn, civ } satisfies ClaimResult;
      }
      const now = Date.now();
      if ((slot.status === "claimed" || slot.status === "invalid") && (slot.lease_expires_at ?? 0) > now) {
        return { ok: false, reason: "busy", seasonId, turn: prepared.turn, civ } satisfies ClaimResult;
      }
      const token = randomUUID();
      const leaseExpiresAt = now + Math.min(config.leaseMs, config.decisionTimeoutMs);
      this.db
        .query(
          `UPDATE decision_slots
           SET status='claimed',lease_token=?,lease_expires_at=?,started_at=?,error=NULL
           WHERE season_id=? AND turn=? AND civ=?`,
        )
        .run(token, leaseExpiresAt, now, seasonId, prepared.turn, civ);
      const attempt = (
        this.db
          .query("SELECT COALESCE(MAX(attempt), 0) + 1 AS next FROM decision_attempts WHERE season_id=? AND turn=? AND civ=?")
          .get(seasonId, prepared.turn, civ) as { next: number }
      ).next;
      this.db
        .query(
          `INSERT INTO decision_attempts
           (season_id,turn,civ,attempt,status,lease_token,lease_expires_at,started_at)
           VALUES (?,?,?,?,'claimed',?,?,?)`,
        )
        .run(seasonId, prepared.turn, civ, attempt, token, leaseExpiresAt, now);
      this.db.query("UPDATE seasons SET model_runs=model_runs+1,updated_at=? WHERE id=?").run(now, seasonId);
      return {
        ok: true,
        seasonId,
        turn: prepared.turn,
        civ,
        leaseToken: token,
        prompt: slot.prompt,
        snapshotHash: prepared.snapshot_hash,
        model: config.models[civ],
      } satisfies ClaimResult;
    });
    return transaction.immediate() as ClaimResult;
  }

  submitDecision(input: SubmissionInput) {
    const transaction = this.db.transaction(() => {
      const slot = this.getSlot(input.seasonId, input.turn, input.civ);
      if (!slot) return { ok: false, reason: "slot_missing" as const };
      if (
        (slot.status === "submitted" || slot.status === "submitted_noop") &&
        slot.submission_key === input.submissionKey
      ) {
        return { ok: true, duplicate: true, resolved: this.getTurn(input.seasonId, input.turn)?.status === "resolved" };
      }
      if (slot.status === "submitted" || slot.status === "submitted_noop") {
        return { ok: false, reason: "already_submitted" as const };
      }
      const turn = this.getTurn(input.seasonId, input.turn);
      if (!turn || turn.status !== "waiting") {
        return { ok: false, reason: "turn_inactive" as const };
      }
      if (slot.lease_token !== input.leaseToken) return { ok: false, reason: "lease_mismatch" as const };
      const selected = input.repairedResponse ?? input.rawResponse;
      const parsed = parseModelDecision(input.civ, selected, decodeWorld(turn.snapshot_json));
      const now = input.completedAt ?? Date.now();
      const started = input.startedAt ?? slot.started_at ?? now;
      if (!parsed.ok && input.repairedResponse === undefined) {
        this.db
          .query(
            `UPDATE decision_slots SET status='invalid',submission_key=?,raw_response=?,error=?,completed_at=NULL,latency_ms=NULL
             WHERE season_id=? AND turn=? AND civ=?`,
          )
          .run(input.submissionKey, input.rawResponse, parsed.error ?? "Invalid response", input.seasonId, input.turn, input.civ);
        this.db
          .query(
            `UPDATE decision_attempts SET status='repair_required',raw_response=?,error=?
             WHERE lease_token=?`,
          )
          .run(input.rawResponse, parsed.error ?? "Invalid response", input.leaseToken);
        return { ok: false, reason: "repair_required" as const, error: parsed.error };
      }

      const decision: Decision = parsed.ok
        ? parsed.decision!
        : { civ: input.civ, journal: "", actions: [] };
      const status = parsed.ok ? "submitted" : "submitted_noop";
      this.db
        .query(
          `UPDATE decision_slots
           SET status=?,submission_key=?,raw_response=?,repaired_response=?,validated_json=?,error=?,completed_at=?,latency_ms=?,lease_token=NULL,lease_expires_at=NULL
           WHERE season_id=? AND turn=? AND civ=?`,
        )
        .run(
          status,
          input.submissionKey,
          input.rawResponse,
          input.repairedResponse ?? null,
          JSON.stringify(decision),
          parsed.error ?? null,
          now,
          now - started,
          input.seasonId,
          input.turn,
          input.civ,
        );
      this.db
        .query(
          `UPDATE decision_attempts
           SET status=?,raw_response=?,repaired_response=?,error=?,completed_at=?
           WHERE lease_token=?`,
        )
        .run(status, input.rawResponse, input.repairedResponse ?? null, parsed.error ?? null, now, input.leaseToken);
      const resolved = this.resolveReadyTurn(input.seasonId, input.turn);
      return { ok: true, duplicate: false, noOp: !parsed.ok, resolved };
    });
    return transaction.immediate();
  }

  failDecision(input: DecisionFailureInput) {
    const transaction = this.db.transaction(() => {
      const slot = this.getSlot(input.seasonId, input.turn, input.civ);
      if (!slot) return { ok: false, reason: "slot_missing" as const };
      if (slot.lease_token !== input.leaseToken) return { ok: false, reason: "lease_mismatch" as const };
      if (slot.status !== "claimed" && slot.status !== "invalid") {
        return { ok: false, reason: "slot_inactive" as const };
      }
      const completedAt = input.completedAt ?? Date.now();
      const error = input.error.slice(0, 2000);
      this.db
        .query(
          `UPDATE decision_slots
           SET status='timed_out',raw_response=?,error=?,completed_at=?,latency_ms=?,lease_token=NULL,lease_expires_at=NULL
           WHERE season_id=? AND turn=? AND civ=?`,
        )
        .run(
          input.rawResponse ?? null,
          error,
          completedAt,
          completedAt - (slot.started_at ?? completedAt),
          input.seasonId,
          input.turn,
          input.civ,
        );
      this.db
        .query(
          `UPDATE decision_attempts
           SET status='timed_out',raw_response=?,error=?,completed_at=?
           WHERE lease_token=?`,
        )
        .run(input.rawResponse ?? null, error, completedAt, input.leaseToken);
      return { ok: true };
    });
    return transaction.immediate() as
      | { ok: true }
      | { ok: false; reason: "slot_missing" | "lease_mismatch" | "slot_inactive" };
  }

  private resolveReadyTurn(seasonId: string, turnNumber: number) {
    const turn = this.getTurn(seasonId, turnNumber);
    if (!turn || turn.status === "resolved") return turn?.status === "resolved";
    const slots = this.db
      .query(
        `SELECT * FROM decision_slots WHERE season_id=? AND turn=? AND status IN ('submitted','submitted_noop') ORDER BY civ`,
      )
      .all(seasonId, turnNumber) as SlotRow[];
    if (slots.length !== 2) return false;
    const world = decodeWorld(turn.snapshot_json);
    const eventStart = world.events.length;
    const resultStart = world.actionResults.length;
    const decisions = slots.map((slot) => JSON.parse(slot.validated_json!) as Decision);
    resolvePreparedTurn(world, decisions);
    const afterJson = encodeWorld(world);
    const afterHash = worldHash(world);
    const now = Date.now();
    for (const event of world.events.slice(eventStart)) this.insertEvent(seasonId, event);
    for (const actionResult of world.actionResults.slice(resultStart)) this.insertResult(seasonId, actionResult);
    this.writeTurnStats(seasonId, world);
    this.writeWorkerTurns(seasonId, world);
    this.db
      .query(
        `UPDATE turns SET status='resolved',after_world_json=?,after_world_hash=?,resolved_at=?
         WHERE season_id=? AND turn=? AND status='waiting'`,
      )
      .run(afterJson, afterHash, now, seasonId, turnNumber);
      const config = JSON.parse(this.getSeason(seasonId)!.config_json) as SeasonConfig;
      const finished =
        limitReached(turnNumber, config.maxTurns) ||
        livingWorkers(world, "north").length === 0 ||
        livingWorkers(world, "south").length === 0;
      this.db
      .query(
        `UPDATE seasons SET current_turn=?,world_json=?,world_hash=?,updated_at=?,status=?
         WHERE id=?`,
      )
      .run(turnNumber, afterJson, afterHash, now, finished ? "complete" : "active", seasonId);
    return true;
  }

  expireLeases(now = Date.now()) {
    const transaction = this.db.transaction(() => {
      const expired = this.db
        .query(
          `SELECT * FROM decision_slots
           WHERE status IN ('claimed','invalid') AND lease_expires_at < ?`,
        )
        .all(now) as SlotRow[];
      for (const slot of expired) {
        if (slot.lease_token) {
          this.db
            .query(
              `UPDATE decision_attempts
               SET status='timed_out',error='Decision lease expired',completed_at=?
               WHERE lease_token=?`,
            )
            .run(now, slot.lease_token);
        }
      }
      this.db
        .query(
          `UPDATE decision_slots SET status='timed_out',error='Decision lease expired',lease_token=NULL,lease_expires_at=NULL
           WHERE status IN ('claimed','invalid') AND lease_expires_at < ?`,
        )
        .run(now);
      return expired.length;
    });
    return transaction.immediate() as number;
  }

  pauseSeason(seasonId: string) {
    return this.db.query("UPDATE seasons SET status='paused',updated_at=? WHERE id=? AND status='active'").run(Date.now(), seasonId).changes > 0;
  }

  resumeSeason(seasonId: string, newMaxModelRuns?: number) {
    const season = this.getSeason(seasonId);
    if (!season || season.status !== "paused") return false;
    const config = JSON.parse(season.config_json) as SeasonConfig;
    if (limitReached(season.current_turn, config.maxTurns)) return false;
    if (limitReached(season.model_runs, config.maxModelRuns)) {
      if (!newMaxModelRuns || newMaxModelRuns <= season.model_runs) return false;
      config.maxModelRuns = newMaxModelRuns;
    }
    return (
      this.db
        .query("UPDATE seasons SET status='active',config_json=?,updated_at=?,resumed_at=? WHERE id=? AND status='paused'")
        .run(JSON.stringify(config), Date.now(), Date.now(), seasonId).changes > 0
    );
  }

  abortSeason(seasonId: string, reason: string) {
    const transaction = this.db.transaction(() => {
      const changed = this.db
        .query("UPDATE seasons SET status='aborted',abort_reason=?,updated_at=? WHERE id=? AND status IN ('active','paused')")
        .run(reason.slice(0, 2000), Date.now(), seasonId).changes;
      this.db.query("UPDATE turns SET status='aborted' WHERE season_id=? AND status='waiting'").run(seasonId);
      return changed > 0;
    });
    return transaction.immediate() as boolean;
  }

  status(seasonId: string) {
    const season = this.getSeason(seasonId);
    if (!season) return null;
    const turn = this.db
      .query("SELECT * FROM turns WHERE season_id=? ORDER BY turn DESC LIMIT 1")
      .get(seasonId) as TurnRow | null;
    const slots = turn
      ? (this.db.query("SELECT * FROM decision_slots WHERE season_id=? AND turn=? ORDER BY civ").all(seasonId, turn.turn) as SlotRow[])
      : [];
    const counts = this.db
      .query(
        `SELECT
           (SELECT COUNT(*) FROM world_events WHERE season_id=$id) AS events,
           (SELECT COUNT(*) FROM action_results WHERE season_id=$id) AS results,
           (SELECT COUNT(*) FROM turns WHERE season_id=$id AND status='resolved') AS resolved_turns,
           (SELECT COUNT(*) FROM decision_attempts WHERE season_id=$id) AS decision_attempts,
           (SELECT COUNT(*) FROM decision_attempts WHERE season_id=$id AND status='timed_out') AS timed_out_attempts`,
      )
      .get({ id: seasonId }) as {
        events: number;
        results: number;
        resolved_turns: number;
        decision_attempts: number;
        timed_out_attempts: number;
      };
    return {
      id: season.id,
      status: season.status,
      currentTurn: season.current_turn,
      modelRuns: season.model_runs,
      worldHash: season.world_hash,
      rulesHash: season.rules_hash,
      codeCommit: season.code_commit,
      latestTurn: turn ? { turn: turn.turn, status: turn.status, snapshotHash: turn.snapshot_hash } : null,
      slots: slots.map((slot) => ({ civ: slot.civ, status: slot.status, model: slot.model, latencyMs: slot.latency_ms, error: slot.error })),
      counts,
    };
  }

  spectator(seasonId: string) {
    const season = this.getSeason(seasonId);
    if (!season) return null;
    const world = decodeWorld(season.world_json);
    const frame = captureFrame(world, world.events.filter((event) => event.turn === world.turn));
    const history = this.turnSeries(seasonId);
    return {
      season: this.status(seasonId),
      tiles: world.tiles,
      /**
       * Which protocol produced this world. The spectator page needs it to describe rules that
       * changed between seasons rather than describing the current code's rules over an archived
       * world — protocol 10 stopped stores granting worker places, and a page that keeps saying
       * "one place per five blocks" is quoting a rule the season it is showing does not have.
       */
      protocolVersion: world.protocolVersion ?? 3,
      frame: JSON.parse(canonicalJson(frame)),
      history: JSON.parse(canonicalJson(history)),
      designs: {
        north: world.civs.north.designs,
        south: world.civs.south.designs,
      },
      slots: { north: workerSlots(world, "north"), south: workerSlots(world, "south") },
      recentEvents: world.events.slice(-200),
      nextTurnDue: season.status === "active" ? new Date(season.updated_at + 5 * 60 * 1000).toISOString() : null,
    };
  }

  /** Compact per-turn economy series, read from `turn_stats` rather than re-decoding worlds. */
  turnSeries(seasonId: string) {
    const rows = this.db
      .query("SELECT * FROM turn_stats WHERE season_id=? ORDER BY turn, civ")
      .all(seasonId) as TurnStatRow[];
    const byTurn = new Map<number, { turn: number; civs: Record<CivId, CivFrame> }>();
    for (const row of rows) {
      let entry = byTurn.get(row.turn);
      if (!entry) {
        entry = { turn: row.turn, civs: {} as Record<CivId, CivFrame> };
        byTurn.set(row.turn, entry);
      }
      entry.civs[row.civ] = {
        food: row.food,
        stone: row.stone,
        workers: row.workers,
        buildings: row.buildings,
        carried: row.carried,
        blocksPlaced: row.blocks_placed,
        blocksTaken: row.blocks_taken,
        quarryLeft: row.quarry_left,
        contact: row.contact === 1,
        storageUsed: row.storage_used ?? undefined,
        storageCapacity: row.storage_capacity ?? undefined,
        nextMigrationTurn: row.next_migration_turn ?? undefined,
        migrationFoodRequired: row.migration_food_required ?? undefined,
        seenTiles: row.seen_tiles ?? undefined,
        nearestGap: row.nearest_gap ?? undefined,
      };
    }
    return [...byTurn.values()].filter((entry) => entry.civs.north && entry.civs.south);
  }

  /**
   * Finished seasons that nobody has written up yet. A season is only ever summarized after it
   * stops, so the observer can never influence a turn that has not happened.
   */
  seasonsAwaitingSummary() {
    return this.db
      .query(
        `SELECT s.id FROM seasons s
         WHERE s.status IN ('complete','aborted')
           AND NOT EXISTS (SELECT 1 FROM season_summaries m WHERE m.season_id = s.id)
         ORDER BY s.created_at`,
      )
      .all() as Array<{ id: string }>;
  }

  getSummary(seasonId: string) {
    const row = this.db.query("SELECT * FROM season_summaries WHERE season_id=?").get(seasonId) as {
      season_id: string;
      author_model: string;
      written_at: number;
      season_status: string;
      season_turn: number;
      brief_hash: string;
      markdown: string;
    } | null;
    if (!row) return null;
    return {
      seasonId: row.season_id,
      authorModel: row.author_model,
      writtenAt: row.written_at,
      seasonStatus: row.season_status,
      seasonTurn: row.season_turn,
      briefHash: row.brief_hash,
      markdown: row.markdown,
    };
  }

  saveSummary(input: { seasonId: string; authorModel: string; markdown: string; briefHash: string }) {
    const season = this.getSeason(input.seasonId);
    if (!season) return { ok: false, reason: "season_missing" as const };
    if (season.status !== "complete" && season.status !== "aborted") {
      return { ok: false, reason: "season_still_running" as const };
    }
    const text = input.markdown.trim();
    if (text.length < 40) return { ok: false, reason: "summary_too_short" as const };
    if (text.length > 20_000) return { ok: false, reason: "summary_too_long" as const };
    this.db
      .query(
        `INSERT OR REPLACE INTO season_summaries
         (season_id,author_model,written_at,season_status,season_turn,brief_hash,markdown)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(input.seasonId, input.authorModel, Date.now(), season.status, season.current_turn, input.briefHash, text);
    return { ok: true as const };
  }

  /** All trend notes for a season, newest first. Human commentary only — never a prompt source. */
  getTrends(seasonId: string) {
    const rows = this.db
      .query("SELECT * FROM season_trends WHERE season_id=? ORDER BY through_turn DESC")
      .all(seasonId) as Array<{
      season_id: string;
      through_turn: number;
      author_model: string;
      written_at: number;
      brief_hash: string;
      markdown: string;
    }>;
    return rows.map((row) => ({
      seasonId: row.season_id,
      throughTurn: row.through_turn,
      authorModel: row.author_model,
      writtenAt: row.written_at,
      markdown: row.markdown,
    }));
  }

  /**
   * A trend note is commentary on a season in progress. It is allowed while the season runs —
   * that is its whole point — but it lives in `season_trends`, which no model-facing prompt
   * ever reads, and a note only saves when there are genuinely new turns to talk about.
   */
  saveTrend(input: { seasonId: string; authorModel: string; markdown: string; briefHash: string; throughTurn: number }) {
    const season = this.getSeason(input.seasonId);
    if (!season) return { ok: false, reason: "season_missing" as const };
    if (input.throughTurn !== season.current_turn) {
      return { ok: false, reason: "stale_brief" as const, currentTurn: season.current_turn };
    }
    const last = this.db
      .query("SELECT MAX(through_turn) AS turn FROM season_trends WHERE season_id=?")
      .get(input.seasonId) as { turn: number | null };
    if (last.turn !== null && input.throughTurn - last.turn < TREND_MIN_TURN_GAP) {
      return { ok: false, reason: "too_soon" as const, lastTurn: last.turn };
    }
    const text = input.markdown.trim();
    if (text.length < 40) return { ok: false, reason: "trend_too_short" as const };
    if (text.length > 6_000) return { ok: false, reason: "trend_too_long" as const };
    this.db
      .query(
        `INSERT OR REPLACE INTO season_trends
         (season_id,through_turn,author_model,written_at,brief_hash,markdown)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(input.seasonId, input.throughTurn, input.authorModel, Date.now(), input.briefHash, text);
    return { ok: true as const };
  }

  /**
   * The facts a trend note may draw on: the measured series, recent events, recent failures and
   * the models' own recent journals. Like `summaryBrief`, numbers come from the record — the
   * observer supplies only the reading.
   */
  trendBrief(seasonId: string) {
    const report = this.report(seasonId);
    if (!report) return null;
    const fromTurn = Math.max(1, report.turns - 30);
    const decisions = this.observerDecisions(seasonId).filter((entry) => entry.turn >= fromTurn);
    const failures = this.db
      .query(
        `SELECT civ, code, COUNT(*) AS times, MIN(turn) AS first_turn, MAX(turn) AS last_turn
         FROM action_results WHERE season_id=? AND turn>=? AND status IN ('rejected','failed')
         GROUP BY civ, code ORDER BY times DESC LIMIT 12`,
      )
      .all(seasonId, fromTurn) as Array<{ civ: CivId; code: string; times: number; first_turn: number; last_turn: number }>;
    const previous = this.getTrends(seasonId).map((entry) => ({
      throughTurn: entry.throughTurn,
      markdown: entry.markdown,
    }));
    const brief = {
      season: {
        id: report.id,
        status: report.status,
        turns: report.turns,
        maxTurns: report.maxTurns,
        seed: report.seed,
      },
      mapBackground: observerMapBackground(report.seed),
      sides: report.models,
      final: report.final,
      milestones: report.milestones,
      economyByTurn: report.series,
      scheduleHealth: this.observerScheduleHealth(seasonId),
      contactHistory: this.observerContactHistory(seasonId, decisions),
      longTermMemory: this.observerMemoryEvidence(seasonId, decisions),
      recentFailures: failures,
      recentJournals: decisions.map(({ turn, civ, decision }) => ({ turn, civ, journal: decision.journal })),
      previousTrendNotes: previous.slice(0, 3),
    };
    const budgeted = withObserverBudget(brief, false);
    return { brief: budgeted, hash: sha256(canonicalJson(budgeted)), throughTurn: report.turns };
  }

  /**
   * Everything an observer needs to write up a season, and nothing it would have to guess at.
   * Facts only — the observer supplies the reading, not the numbers.
   */
  summaryBrief(seasonId: string, tokenLimit = OBSERVER_BRIEF_TOKEN_LIMIT) {
    const report = this.report(seasonId);
    if (!report) return null;
    const decisions = this.observerDecisions(seasonId);
    const failures = this.db
      .query(
        `SELECT civ, code, COUNT(*) AS times, MIN(turn) AS first_turn, MAX(turn) AS last_turn
         FROM action_results WHERE season_id=? AND status IN ('rejected','failed')
         GROUP BY civ, code ORDER BY times DESC LIMIT 12`,
      )
      .all(seasonId) as Array<{ civ: CivId; code: string; times: number; first_turn: number; last_turn: number }>;
    const brief = {
      season: {
        id: report.id,
        status: report.status,
        turns: report.turns,
        maxTurns: report.maxTurns,
        seed: report.seed,
        abortReason: report.abortReason,
        outcome: report.outcome,
        rulesCurrent: report.rulesCurrent,
      },
      mapBackground: observerMapBackground(report.seed),
      sides: report.models,
      final: report.final,
      peak: report.peak,
      designs: report.designs,
      reliability: report.reliability,
      milestones: report.milestones,
      economyByTurn: report.series,
      scheduleHealth: this.observerScheduleHealth(seasonId),
      contactHistory: this.observerContactHistory(seasonId, decisions),
      longTermMemory: this.observerMemoryEvidence(seasonId, decisions),
      repeatedFailures: failures,
      journals: decisions.map(({ turn, civ, decision }) => ({ turn, civ, journal: decision.journal })),
    };
    const budgeted = withObserverBudget(brief, true, tokenLimit);
    return { brief: budgeted, hash: sha256(canonicalJson(budgeted)) };
  }

  private observerDecisions(seasonId: string) {
    const rows = this.db
      .query(
        `SELECT turn, civ, validated_json
         FROM decision_slots WHERE season_id=? AND validated_json IS NOT NULL ORDER BY turn, civ`,
      )
      .all(seasonId) as Array<{ turn: number; civ: CivId; validated_json: string }>;
    return rows.map((row) => ({ turn: row.turn, civ: row.civ, decision: JSON.parse(row.validated_json) as Decision }));
  }

  private observerScheduleHealth(seasonId: string) {
    const turns = this.db
      .query(
        `SELECT turn, prepared_at, resolved_at
         FROM turns WHERE season_id=? ORDER BY turn`,
      )
      .all(seasonId) as Array<{ turn: number; prepared_at: number; resolved_at: number | null }>;
    const slots = this.db
      .query(
        `SELECT turn, civ, status, started_at, completed_at, latency_ms
         FROM decision_slots WHERE season_id=? ORDER BY turn, civ`,
      )
      .all(seasonId) as Array<{
      turn: number;
      civ: CivId;
      status: string;
      started_at: number | null;
      completed_at: number | null;
      latency_ms: number | null;
    }>;
    const anomalies: Array<Record<string, unknown>> = [];
    const timeline = turns.map((turn, index) => {
      const previous = turns[index - 1];
      const cadenceGapMs = previous ? turn.prepared_at - previous.prepared_at : null;
      if (cadenceGapMs !== null && cadenceGapMs > PLAYER_AUTOMATION_CADENCE_MS + SCHEDULE_ANOMALY_GRACE_MS) {
        anomalies.push({ kind: "turn_cadence_gap", turn: turn.turn, gapMs: cadenceGapMs, expectedMs: PLAYER_AUTOMATION_CADENCE_MS });
      }
      const slotTimings = slots
        .filter((slot) => slot.turn === turn.turn)
        .map((slot) => {
          const claimDelayMs = slot.started_at === null ? null : Math.max(0, slot.started_at - turn.prepared_at);
          if (claimDelayMs !== null && claimDelayMs > PLAYER_AUTOMATION_CADENCE_MS) {
            anomalies.push({ kind: "slot_claim_delay", turn: turn.turn, civ: slot.civ, delayMs: claimDelayMs });
          }
          return {
            civ: slot.civ,
            status: slot.status,
            claimDelayMs,
            latencyMs: slot.latency_ms,
            startedAt: slot.started_at,
            completedAt: slot.completed_at,
          };
        });
      const resolutionDurationMs = turn.resolved_at === null ? null : turn.resolved_at - turn.prepared_at;
      if (resolutionDurationMs !== null && resolutionDurationMs > PLAYER_AUTOMATION_CADENCE_MS) {
        anomalies.push({ kind: "slow_turn_resolution", turn: turn.turn, durationMs: resolutionDurationMs });
      }
      return {
        turn: turn.turn,
        preparedAt: turn.prepared_at,
        resolvedAt: turn.resolved_at,
        cadenceGapMs,
        resolutionDurationMs,
        slots: slotTimings,
      };
    });
    return {
      expectedPlayerCadenceMs: PLAYER_AUTOMATION_CADENCE_MS,
      anomalyRule: "cadence gap > expected + 60s, or one slot waits > one full cadence after the shared turn was prepared",
      anomalyCount: anomalies.length,
      anomalies,
      turns: timeline,
    };
  }

  private observerContactHistory(
    seasonId: string,
    decisions: Array<{ turn: number; civ: CivId; decision: Decision }>,
  ) {
    const events = this.db
      .query(
        `SELECT turn, civ, kind, text, payload_json
         FROM world_events WHERE season_id=? AND kind IN ('contact','message') ORDER BY turn, event_id`,
      )
      .all(seasonId) as Array<{ turn: number; civ: CivId | null; kind: string; text: string; payload_json: string }>;
    const outcomes = this.db
      .query(
        `SELECT turn, civ, action_index, action_type, status, code, text
         FROM action_results WHERE season_id=? AND action_type IN ('name','message') ORDER BY turn, result_id`,
      )
      .all(seasonId) as Array<{
      turn: number;
      civ: CivId;
      action_index: number;
      action_type: "name" | "message";
      status: string;
      code: string;
      text: string;
    }>;
    const dialogue: Array<
      | { turn: number; civ: CivId; type: "name"; name: string }
      | { turn: number; civ: CivId; type: "message"; text: string }
    > = [];
    for (const { turn, civ, decision } of decisions) {
      for (const action of decision.actions) {
        if (action.type === "name") dialogue.push({ turn, civ, type: action.type, name: action.name });
        if (action.type === "message") dialogue.push({ turn, civ, type: action.type, text: action.text });
      }
    }
    return {
      contactMade: events.some((entry) => entry.kind === "contact"),
      firstContactTurn: events.find((entry) => entry.kind === "contact")?.turn ?? null,
      events: events.map((entry) => ({
        turn: entry.turn,
        civ: entry.civ,
        kind: entry.kind,
        text: entry.text,
        payload: JSON.parse(entry.payload_json),
      })),
      namesAndMessagesAttempted: dialogue,
      namesAndMessagesOutcomes: outcomes.map((entry) => ({
        turn: entry.turn,
        civ: entry.civ,
        actionIndex: entry.action_index,
        type: entry.action_type,
        status: entry.status,
        code: entry.code,
        result: entry.text,
      })),
    };
  }

  private observerMemoryEvidence(
    seasonId: string,
    decisions: Array<{ turn: number; civ: CivId; decision: Decision }>,
  ) {
    const season = this.getSeason(seasonId);
    const world = season ? decodeWorld(season.world_json) : null;
    const standingOrders: Array<{ turn: number; civ: CivId; text: string }> = [];
    const notebook: Array<{ turn: number; civ: CivId; text: string }> = [];
    const chronicle: Array<{ turn: number; civ: CivId; text: string }> = [];
    const lastStanding: Partial<Record<CivId, string>> = {};
    for (const { turn, civ, decision } of decisions) {
      if (decision.standingOrders !== undefined && decision.standingOrders !== lastStanding[civ]) {
        standingOrders.push({ turn, civ, text: decision.standingOrders });
        lastStanding[civ] = decision.standingOrders;
      }
      if (turn % RULES.chronicleInterval === 0 && decision.chronicleLine) {
        chronicle.push({ turn, civ, text: decision.chronicleLine });
      }
      for (const action of decision.actions) {
        if (action.type === "note") notebook.push({ turn, civ, text: action.text });
      }
    }
    return {
      final: world
        ? Object.fromEntries(
            (["north", "south"] as CivId[]).map((civ) => [
              civ,
              {
                standingOrders: world.civs[civ].standingOrders,
                notebook: world.civs[civ].notes,
                chronicle: world.civs[civ].chronicle,
              },
            ]),
          )
        : null,
      changes: { standingOrders, notebook, chronicle },
    };
  }

  /**
   * One worker's whole life, from `worker_turns`. The inspector needs three things that cannot be
   * read from a single frame: how many consecutive turns this worker has held its current job, how
   * long it has been idle, and how far it has ever walked from home. All three are the difference
   * between "this civilization has a plan" and "four people have been standing still since turn 9",
   * and a frame shows neither. One indexed query over a small table per selection.
   */
  workerHistory(seasonId: string, workerId: string) {
    return this.db
      .query(
        `SELECT turn, job, x, z, carry_food AS carryFood, carry_stone AS carryStone
         FROM worker_turns WHERE season_id=? AND worker_id=? ORDER BY turn`,
      )
      .all(seasonId, workerId) as Array<{
      turn: number;
      job: string;
      x: number;
      z: number;
      carryFood: number;
      carryStone: number;
    }>;
  }

  /**
   * The two pressures a season is actually testing, per turn per civilization.
   *
   * `reach` comes from `worker_turns`: how far the furthest person stood from the hall's centre,
   * and how many people were beyond the build radius. A flat reach line is the whole v13 finding —
   * both sides never left — and no existing chart shows it, because population, food and stone all
   * look healthy while it happens.
   *
   * `upkeep` is parsed from the engine's own `upkeep` event text. It is deliberately not
   * recomputed from `blocks_placed`: that column counts every standing block including unfinished
   * worksites, while the engine bills completed structures only. Seasons resolved before structure
   * upkeep existed emit no such event and so report nothing here, rather than being scored by a
   * rule they never played under.
   */
  pressure(seasonId: string) {
    const season = this.getSeason(seasonId);
    if (!season) return { structureUpkeep: false, rows: [] as PressurePoint[] };
    const homeCentres: Record<CivId, Point> = {
      north: hallCentre(season.map_seed, "north"),
      south: hallCentre(season.map_seed, "south"),
    };
    const positions = this.db
      .query(
        `SELECT turn, civ, x, z FROM worker_turns WHERE season_id=? ORDER BY turn`,
      )
      .all(seasonId) as Array<{ turn: number; civ: CivId; x: number; z: number }>;

    const rows = new Map<string, PressurePoint>();
    const at = (turn: number, civ: CivId) => {
      const key = `${turn}:${civ}`;
      let row = rows.get(key);
      if (!row) {
        row = { turn, civ, reach: 0, meanReach: 0, beyondHome: 0, workers: 0 };
        rows.set(key, row);
      }
      return row;
    };

    const totals = new Map<string, number>();
    for (const entry of positions) {
      const home = homeCentres[entry.civ];
      if (!home) continue;
      const distance = Math.round(Math.hypot(entry.x - home.x, entry.z - home.z));
      const row = at(entry.turn, entry.civ);
      row.workers += 1;
      row.reach = Math.max(row.reach, distance);
      if (distance > RULES.buildRadius) row.beyondHome += 1;
      totals.set(`${entry.turn}:${entry.civ}`, (totals.get(`${entry.turn}:${entry.civ}`) ?? 0) + distance);
    }
    for (const [key, row] of rows) {
      row.meanReach = row.workers > 0 ? Math.round((totals.get(key) ?? 0) / row.workers) : 0;
    }

    const upkeep = this.db
      .query(`SELECT turn, civ, text FROM world_events WHERE season_id=? AND kind='upkeep'`)
      .all(seasonId) as Array<{ turn: number; civ: CivId | null; text: string }>;
    for (const event of upkeep) {
      if (!event.civ) continue;
      const numbers = event.text.match(/(\d+)/g);
      if (!numbers || numbers.length < 4) continue;
      const row = at(event.turn, event.civ);
      row.standingBlocks = Number(numbers[0]);
      row.upkeepDue = Number(numbers[1]);
      row.upkeepPaid = Number(numbers[2]);
      row.blocksLost = Number(numbers[3]);
    }

    /**
     * Whether this season was played under the current rule set, and so under structure upkeep.
     * The engine only logs an upkeep line once a civilization is actually billable, so the absence
     * of events cannot distinguish "the rule does not apply" from "nobody has built enough yet" —
     * and those read very differently to someone watching a season open. The stored `rules_hash` is
     * exact, and it costs one row to ask.
     */
    const seasonRule = this.db
      .query("SELECT rules_hash FROM seasons WHERE id=?")
      .get(seasonId) as { rules_hash: string } | null;

    return {
      structureUpkeep: seasonRule?.rules_hash === RULES_HASH,
      rows: [...rows.values()].sort(
        (left, right) => left.turn - right.turn || left.civ.localeCompare(right.civ),
      ),
    };
  }

  /** The season's event log up to a given turn, newest first, so replay never shows the future. */
  events(seasonId: string, throughTurn: number, limit = 400) {
    return (
      this.db
        .query(
          `SELECT payload_json FROM world_events
           WHERE season_id=? AND turn<=? ORDER BY turn DESC, event_id DESC LIMIT ?`,
        )
        .all(seasonId, throughTurn, limit) as Array<{ payload_json: string }>
    ).map((row) => JSON.parse(row.payload_json) as SimEvent);
  }

  /**
   * The handful of turns worth scrubbing to: the first time each notable thing happened, per civ.
   * A timeline with no landmarks is a slider; a timeline with eight is a story. Kept as its own
   * query because `events` is newest-first and capped, so a long season would lose its opening.
   */
  landmarks(seasonId: string) {
    const kinds = ["complete", "migration", "contact", "starve", "removal", "message"];
    return this.db
      .query(
        `SELECT kind, civ, MIN(turn) AS turn FROM world_events
         WHERE season_id=? AND kind IN (${kinds.map(() => "?").join(",")})
         GROUP BY kind, civ ORDER BY turn`,
      )
      .all(seasonId, ...kinds) as Array<{ kind: string; civ: CivId | null; turn: number }>;
  }

  /**
   * Every letter one civilization sent the other, in full.
   *
   * The event log only keeps the first 80 characters of a message, which is enough for a landmark
   * and useless as a record: v30's two sides exchanged 82 letters and spent forty turns negotiating
   * a barter that no action in this engine can execute. That is a finding, and it was invisible.
   * The complete text only survives in `world.messages`, which is never pruned, so the stored world
   * is the source. Parsing a 800 KB world per request would be wasteful for a value that only
   * changes when a turn resolves, so the parse is memoised on the season's `updated_at`.
   */
  messages(seasonId: string): SeasonMessage[] {
    const row = this.db
      .query("SELECT world_json, updated_at FROM seasons WHERE id=?")
      .get(seasonId) as { world_json: string; updated_at: number } | null;
    if (!row) return [];
    const cached = this.messageCache.get(seasonId);
    if (cached && cached.updatedAt === row.updated_at) return cached.messages;
    const world = JSON.parse(row.world_json) as { messages?: SeasonMessage[] };
    const messages = (world.messages ?? []).slice().sort((left, right) => left.id - right.id);
    this.messageCache.set(seasonId, { updatedAt: row.updated_at, messages });
    return messages;
  }

  /**
   * Everything a civilization ever wrote **for itself**, in full, turn by turn.
   *
   * A model's prompt carries four self-authored surfaces forward: standing orders, the chronicle,
   * the notebook and the last journal entry. Three of those four were invisible to a spectator —
   * the page showed the journal of whatever turn the playhead sat on and nothing else — so the only
   * text that actually steers a decision fifty turns later could not be read at all. v39 south
   * rewrote its notebook every single turn while north never opened one, and that difference was
   * unreadable from the site.
   *
   * Reconstructed from the accepted decisions rather than the stored world, because the world only
   * keeps the *current* value of each surface: a revision history is the point. The engine's own
   * apply order is mirrored exactly — the same character caps, the same chronicle interval, the
   * same action limit, and last-`note`-wins within one turn — so a turn shown here is the text the
   * next prompt actually carried.
   *
   * Only resolved turns count, and `throughTurn` clips the record to the playhead, so scrubbing back
   * never shows a page of a notebook that had not been written yet.
   */
  memory(seasonId: string, throughTurn?: number) {
    const season = this.getSeason(seasonId);
    if (!season) return null;
    const ceiling = Number.isFinite(throughTurn) ? Number(throughTurn) : Number.MAX_SAFE_INTEGER;
    const rows = this.db
      .query(
        `SELECT s.turn AS turn, s.civ AS civ, s.validated_json AS validated_json
         FROM decision_slots s
         JOIN turns t ON t.season_id = s.season_id AND t.turn = s.turn
         WHERE s.season_id=? AND s.turn<=? AND s.validated_json IS NOT NULL AND t.status='resolved'
         ORDER BY s.turn, s.civ`,
      )
      .all(seasonId, ceiling) as Array<{ turn: number; civ: CivId; validated_json: string }>;

    const civs = Object.fromEntries(
      (["north", "south"] as CivId[]).map((civ) => [
        civ,
        { standingOrders: [], notebook: [], chronicle: [], journal: [] } as CivMemory,
      ]),
    ) as Record<CivId, CivMemory>;

    for (const row of rows) {
      const civ = civs[row.civ];
      if (!civ) continue;
      let decision: Decision;
      try {
        decision = JSON.parse(row.validated_json) as Decision;
      } catch {
        continue;
      }
      if (decision.journal) {
        civ.journal.push({ turn: row.turn, text: decision.journal.slice(0, RULES.maxJournalChars) });
      }
      if (decision.standingOrders !== undefined) {
        const text = decision.standingOrders.slice(0, RULES.maxStandingOrdersChars);
        // A model that resends identical orders every turn has not revised anything; only the
        // turns where the text actually changed are revisions worth reading.
        if (text !== civ.standingOrders.at(-1)?.text) civ.standingOrders.push({ turn: row.turn, text });
      }
      if (row.turn % RULES.chronicleInterval === 0 && decision.chronicleLine) {
        civ.chronicle.push({ turn: row.turn, text: decision.chronicleLine.slice(0, 500) });
      }
      const actions = Array.isArray(decision.actions) ? decision.actions : [];
      let note: string | undefined;
      actions.forEach((action, index) => {
        if (index >= RULES.maxActionsPerTurn) return;
        if (action.type === "note") note = action.text.slice(0, RULES.maxNotebookChars);
      });
      if (note !== undefined && note !== civ.notebook.at(-1)?.text) {
        civ.notebook.push({ turn: row.turn, text: note });
      }
    }

    return {
      seasonId,
      throughTurn: rows.at(-1)?.turn ?? 0,
      limits: {
        standingOrders: RULES.maxStandingOrdersChars,
        notebook: RULES.maxNotebookChars,
        journal: RULES.maxJournalChars,
        chronicleInterval: RULES.chronicleInterval,
      },
      civs,
    };
  }

  /** Every season, newest first, with just enough for a history list. */
  seasons() {
    const rows = this.db.query("SELECT * FROM seasons ORDER BY created_at DESC").all() as SeasonRow[];
    return rows.map((season) => {
      const config = JSON.parse(season.config_json) as SeasonConfig;
      const finalRows = this.db
        .query(
          `SELECT civ, workers, food, stone, buildings FROM turn_stats
           WHERE season_id=$id AND turn=(SELECT MAX(turn) FROM turn_stats WHERE season_id=$id)`,
        )
        .all({ id: season.id }) as Array<{ civ: CivId; workers: number; food: number; stone: number; buildings: number }>;
      const counts = this.db
        .query(
          `SELECT
             (SELECT COUNT(*) FROM turns WHERE season_id=$id AND status='resolved') AS resolved_turns,
             (SELECT COUNT(*) FROM decision_attempts WHERE season_id=$id) AS attempts,
             (SELECT COUNT(*) FROM decision_attempts WHERE season_id=$id AND status='timed_out') AS timed_out,
             (SELECT COUNT(*) FROM decision_slots WHERE season_id=$id AND status='submitted_noop') AS no_ops,
             (SELECT COUNT(*) FROM season_summaries WHERE season_id=$id) AS summaries`,
        )
        .get({ id: season.id }) as {
          resolved_turns: number;
          attempts: number;
          timed_out: number;
          no_ops: number;
          summaries: number;
        };
      return {
        id: season.id,
        status: season.status,
        hasSummary: counts.summaries > 0,
        turns: counts.resolved_turns,
        maxTurns: config.maxTurns,
        seed: season.map_seed,
        models: config.models,
        createdAt: season.created_at,
        updatedAt: season.updated_at,
        abortReason: season.abort_reason ?? null,
        decisions: counts.attempts,
        timedOut: counts.timed_out,
        noOps: counts.no_ops,
        final: Object.fromEntries(
          finalRows.map((row) => [
            row.civ,
            { workers: row.workers, food: row.food, stone: row.stone, buildings: row.buildings },
          ]),
        ) as Partial<Record<CivId, { workers: number; food: number; stone: number; buildings: number }>>,
      };
    });
  }

  /**
   * A whole season condensed into the things a reader actually wants: who played, how it ended,
   * how the two sides diverged, and which turns are worth replaying. Everything here is derived
   * from stored evidence — no interpretation is baked into the database.
   */
  report(seasonId: string) {
    const season = this.getSeason(seasonId);
    if (!season) return null;
    const config = JSON.parse(season.config_json) as SeasonConfig;
    const series = this.turnSeries(seasonId);
    const last = series.length > 0 ? series[series.length - 1] : null;
    const resolvedTurns = last ? last.turn : 0;

    const reliability = {} as Record<CivId, {
      decisions: number;
      valid: number;
      repaired: number;
      noOps: number;
      timedOut: number;
      avgLatencyMs: number | null;
      maxLatencyMs: number | null;
    }>;
    for (const civ of ["north", "south"] as CivId[]) {
      const row = this.db
        .query(
          `SELECT
             (SELECT COUNT(*) FROM decision_slots WHERE season_id=$id AND civ=$civ AND status IN ('submitted','submitted_noop')) AS decisions,
             (SELECT COUNT(*) FROM decision_slots WHERE season_id=$id AND civ=$civ AND status='submitted') AS valid,
             (SELECT COUNT(*) FROM decision_slots WHERE season_id=$id AND civ=$civ AND status='submitted_noop') AS no_ops,
             (SELECT COUNT(*) FROM decision_slots WHERE season_id=$id AND civ=$civ AND repaired_response IS NOT NULL) AS repaired,
             (SELECT COUNT(*) FROM decision_attempts WHERE season_id=$id AND civ=$civ AND status='timed_out') AS timed_out,
             (SELECT AVG(latency_ms) FROM decision_slots WHERE season_id=$id AND civ=$civ AND latency_ms IS NOT NULL) AS avg_latency,
             (SELECT MAX(latency_ms) FROM decision_slots WHERE season_id=$id AND civ=$civ) AS max_latency`,
        )
        .get({ id: seasonId, civ }) as {
          decisions: number;
          valid: number;
          no_ops: number;
          repaired: number;
          timed_out: number;
          avg_latency: number | null;
          max_latency: number | null;
        };
      reliability[civ] = {
        decisions: row.decisions,
        valid: row.valid,
        repaired: row.repaired,
        noOps: row.no_ops,
        timedOut: row.timed_out,
        avgLatencyMs: row.avg_latency === null ? null : Math.round(row.avg_latency),
        maxLatencyMs: row.max_latency,
      };
    }

    const peak = {} as Record<CivId, { workers: number; stone: number; food: number; buildings: number }>;
    for (const civ of ["north", "south"] as CivId[]) {
      peak[civ] = series.reduce(
        (best, entry) => ({
          workers: Math.max(best.workers, entry.civs[civ].workers),
          stone: Math.max(best.stone, entry.civs[civ].stone),
          food: Math.max(best.food, entry.civs[civ].food),
          buildings: Math.max(best.buildings, entry.civs[civ].buildings),
        }),
        { workers: 0, stone: 0, food: 0, buildings: 0 },
      );
    }

    const designCounts = this.db
      .query("SELECT civ, MAX(designs) AS designs FROM turn_stats WHERE season_id=? GROUP BY civ")
      .all(seasonId) as Array<{ civ: CivId; designs: number }>;

    return {
      id: season.id,
      status: season.status,
      seed: season.map_seed,
      rulesHash: season.rules_hash,
      codeCommit: season.code_commit,
      createdAt: season.created_at,
      updatedAt: season.updated_at,
      abortReason: season.abort_reason ?? null,
      // A season recorded under an earlier protocol is still valid evidence of what those models
      // did, but it can no longer be re-simulated by today's engine. Say which kind this is.
      rulesCurrent: season.rules_hash === RULES_HASH,
      turns: resolvedTurns,
      maxTurns: config.maxTurns,
      models: config.models,
      reliability,
      final: last ? last.civs : null,
      peak,
      designs: Object.fromEntries(designCounts.map((row) => [row.civ, row.designs])) as Record<CivId, number>,
      outcome: this.outcome(season, config, last),
      milestones: this.milestones(seasonId),
      series,
    };
  }

  /** Why the season stopped, stated from the record rather than from a narrative. */
  private outcome(season: SeasonRow, config: SeasonConfig, last: { turn: number; civs: Record<CivId, CivFrame> } | null) {
    if (season.status === "aborted") {
      return { kind: "aborted" as const, civ: null, detail: season.abort_reason ?? "由操作者中止。" };
    }
    if (season.status === "complete") {
      const dead = (["north", "south"] as CivId[]).filter((civ) => (last?.civs[civ].workers ?? 0) === 0);
      if (dead.length > 0) {
        return { kind: "collapse" as const, civ: dead[0], detail: `該文明在第 ${last?.turn} 回合失去全部工人，世界隨即結束。` };
      }
      return { kind: "turn_limit" as const, civ: null, detail: `到達 ${config.maxTurns ?? "已設定"} 回合上限。` };
    }
    if (season.status === "paused") return { kind: "paused" as const, civ: null, detail: "季度已暫停，未結束。" };
    return { kind: "running" as const, civ: null, detail: "季度進行中。" };
  }

  /** First occurrences worth jumping to in the replay. Derived only from recorded events. */
  private milestones(seasonId: string) {
    const events = this.db
      .query(
        `SELECT turn, civ, kind, text FROM world_events
         WHERE season_id=? AND kind IN ('design','build','complete','contact','removal','spill','message','starve','migration')
         ORDER BY turn, event_id`,
      )
      .all(seasonId) as Array<{ turn: number; civ: CivId | null; kind: string; text: string }>;
    const found: Array<{ turn: number; civ: CivId | null; kind: string; label: string; text: string }> = [];
    const seen = new Set<string>();
    const take = (key: string, label: string, entry: { turn: number; civ: CivId | null; kind: string; text: string }) => {
      if (seen.has(key)) return;
      seen.add(key);
      found.push({ turn: entry.turn, civ: entry.civ, kind: entry.kind, label, text: entry.text });
    };
    const civLabel = (civ: CivId | null) => (civ === "north" ? "北岸" : civ === "south" ? "南原" : "世界");
    for (const entry of events) {
      if (entry.kind === "design") take(`design-${entry.civ}`, `${civLabel(entry.civ)}畫出第一張設計圖`, entry);
      if (entry.kind === "complete") take(`complete-${entry.civ}`, `${civLabel(entry.civ)}第一座建築落成`, entry);
      if (entry.kind === "migration") take(`migration-${entry.civ}`, `${civLabel(entry.civ)}第一次自然增加人口`, entry);
      if (entry.kind === "contact") take(`contact-${entry.civ}`, `${civLabel(entry.civ)}首次看見對方`, entry);
      if (entry.kind === "message") take(`message-${entry.civ}`, `${civLabel(entry.civ)}第一次向對方傳話`, entry);
      if (entry.kind === "removal") take(`removal-${entry.civ}`, `${civLabel(entry.civ)}第一次有建築被完全拆走`, entry);
      if (entry.kind === "spill") take(`spill-${entry.civ}`, `${civLabel(entry.civ)}物資散落地面`, entry);
      if (entry.kind === "starve") take(`starve-${entry.civ}`, `${civLabel(entry.civ)}第一次餓死工人`, entry);
    }
    const foreignRemoval = this.db
      .query(
        `SELECT turn, civ, text, payload_json FROM action_results
         WHERE season_id=? AND action_type='remove' AND status IN ('accepted','completed')
         ORDER BY turn, result_id`,
      )
      .all(seasonId) as Array<{ turn: number; civ: CivId; text: string; payload_json: string }>;
    for (const entry of foreignRemoval) {
      const payload = JSON.parse(entry.payload_json) as { targetId?: string };
      if (!payload.targetId || payload.targetId.startsWith(entry.civ)) continue;
      take(`foreign-remove-${entry.civ}`, `${civLabel(entry.civ)}第一次動手拆對方的建築`, {
        turn: entry.turn,
        civ: entry.civ,
        kind: "removal",
        text: entry.text,
      });
      break;
    }
    return found.sort((a, b) => a.turn - b.turn);
  }

  /**
   * One turn of a season, rebuilt from its stored world so any past season can be replayed
   * without holding every world in memory at once.
   */
  replayFrame(seasonId: string, turn: number) {
    const season = this.getSeason(seasonId);
    if (!season) return null;
    if (turn <= 0) {
      const first = this.db
        .query("SELECT before_world_json FROM turns WHERE season_id=? ORDER BY turn LIMIT 1")
        .get(seasonId) as { before_world_json: string } | null;
      const world = first?.before_world_json ? decodeWorld(first.before_world_json) : createWorld(season.map_seed);
      return this.frameFor(seasonId, world);
    }
    const row = this.db
      .query("SELECT after_world_json FROM turns WHERE season_id=? AND turn=? AND status='resolved'")
      .get(seasonId, turn) as { after_world_json: string | null } | null;
    if (!row?.after_world_json) return null;
    return this.frameFor(seasonId, decodeWorld(row.after_world_json));
  }

  private frameFor(seasonId: string, world: World) {
    const frame = captureFrame(world, world.events.filter((event) => event.turn === world.turn));
    return {
      seasonId,
      turn: world.turn,
      frame: JSON.parse(canonicalJson(frame)) as Frame,
      designs: { north: world.civs.north.designs, south: world.civs.south.designs },
      slots: { north: workerSlots(world, "north"), south: workerSlots(world, "south") },
    };
  }

  verifyReplay(seasonId: string) {
    const season = this.getSeason(seasonId);
    if (!season) return { ok: false, error: "season_missing" as const };
    if (season.rules_hash !== RULES_HASH) {
      return { ok: false, error: "rules_hash_mismatch" as const };
    }
    const world = createWorld(season.map_seed);
    const turns = this.db
      .query("SELECT * FROM turns WHERE season_id=? AND status='resolved' ORDER BY turn")
      .all(seasonId) as TurnRow[];
    for (const turn of turns) {
      prepareTurn(world);
      const snapshotHash = worldHash(world);
      if (snapshotHash !== turn.snapshot_hash) {
        return { ok: false, error: "snapshot_hash_mismatch" as const, turn: turn.turn, expected: turn.snapshot_hash, actual: snapshotHash };
      }
      const slots = this.db
        .query("SELECT * FROM decision_slots WHERE season_id=? AND turn=? ORDER BY civ")
        .all(seasonId, turn.turn) as SlotRow[];
      if (slots.length !== 2 || slots.some((slot) => !slot.validated_json)) {
        return { ok: false, error: "decision_missing" as const, turn: turn.turn };
      }
      resolvePreparedTurn(
        world,
        slots.map((slot) => JSON.parse(slot.validated_json!) as Decision),
      );
      const afterHash = worldHash(world);
      if (afterHash !== turn.after_world_hash) {
        return { ok: false, error: "after_hash_mismatch" as const, turn: turn.turn, expected: turn.after_world_hash, actual: afterHash };
      }
    }
    const finalHash = worldHash(world);
    if (finalHash !== season.world_hash) {
      return { ok: false, error: "season_world_hash_mismatch" as const, expected: season.world_hash, actual: finalHash };
    }
    return { ok: true, turns: turns.length, finalHash };
  }

  archive(seasonId: string, requestedTurn?: number) {
    const turn = requestedTurn
      ? this.getTurn(seasonId, requestedTurn)
      : (this.db
          .query("SELECT * FROM turns WHERE season_id=? AND status='resolved' ORDER BY turn DESC LIMIT 1")
          .get(seasonId) as TurnRow | null);
    if (!turn || turn.status !== "resolved") return null;
    const slots = this.db
      .query("SELECT * FROM decision_slots WHERE season_id=? AND turn=? ORDER BY civ")
      .all(seasonId, turn.turn) as SlotRow[];
    const results = this.db
      .query("SELECT payload_json FROM action_results WHERE season_id=? AND turn=? ORDER BY result_id")
      .all(seasonId, turn.turn) as Array<{ payload_json: string }>;
    const events = this.db
      .query("SELECT payload_json FROM world_events WHERE season_id=? AND turn=? ORDER BY event_id")
      .all(seasonId, turn.turn) as Array<{ payload_json: string }>;
    const attempts = this.db
      .query("SELECT * FROM decision_attempts WHERE season_id=? AND turn=? ORDER BY civ,attempt")
      .all(seasonId, turn.turn) as DecisionAttemptRow[];
    return {
      turn: turn.turn,
      snapshotHash: turn.snapshot_hash,
      afterWorldHash: turn.after_world_hash,
      preparedAt: turn.prepared_at,
      resolvedAt: turn.resolved_at,
      decisions: slots.map((slot) => ({
        civ: slot.civ,
        provider: slot.provider,
        model: slot.model,
        reasoning: slot.reasoning,
        status: slot.status,
        prompt: slot.prompt,
        promptHash: slot.prompt_hash,
        rawResponse: slot.raw_response,
        repairedResponse: slot.repaired_response,
        acceptedDecision: slot.validated_json ? JSON.parse(slot.validated_json) : null,
        error: slot.error,
        startedAt: slot.started_at,
        completedAt: slot.completed_at,
        latencyMs: slot.latency_ms,
        attempts: attempts
          .filter((attempt) => attempt.civ === slot.civ)
          .map((attempt) => ({
            attempt: attempt.attempt,
            status: attempt.status,
            startedAt: attempt.started_at,
            completedAt: attempt.completed_at,
            rawResponse: attempt.raw_response,
            repairedResponse: attempt.repaired_response,
            error: attempt.error,
          })),
      })),
      actionResults: results.map((row) => JSON.parse(row.payload_json)),
      events: events.map((row) => JSON.parse(row.payload_json)),
    };
  }

  private getSlot(seasonId: string, turn: number, civ: CivId) {
    return this.db
      .query("SELECT * FROM decision_slots WHERE season_id=? AND turn=? AND civ=?")
      .get(seasonId, turn, civ) as SlotRow | null;
  }

  private insertResult(seasonId: string, entry: ActionResult) {
    this.db
      .query(
        `INSERT INTO action_results
         (season_id,turn,result_id,civ,action_index,action_type,status,code,text,payload_json)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        seasonId,
        entry.turn,
        entry.id,
        entry.civ,
        entry.actionIndex,
        entry.actionType,
        entry.status,
        entry.code,
        entry.text,
        JSON.stringify(entry),
      );
  }

  private insertEvent(seasonId: string, event: SimEvent) {
    this.db
      .query(
        `INSERT INTO world_events (season_id,turn,event_id,civ,kind,text,payload_json) VALUES (?,?,?,?,?,?,?)`,
      )
      .run(seasonId, event.turn, event.id, event.civ ?? null, event.kind, event.text, JSON.stringify(event));
  }
}

function observerMapBackground(seed: number) {
  const variant = mapVariant(seed);
  const tiles = createMap(seed);
  const homes: Record<CivId, Point> = {
    north: hallCentre(seed, "north"),
    south: hallCentre(seed, "south"),
  };
  const distribution = {
    fieldTiles: 0,
    oasisTiles: 0,
    centralFieldTiles: 0,
    homeFieldTiles: { north: 0, south: 0 } as Record<CivId, number>,
    stoneTiles: 0,
    centralStoneTiles: 0,
  };
  for (let z = 0; z < RULES.height; z += 1) {
    for (let x = 0; x < RULES.width; x += 1) {
      const tile = tiles[z * RULES.width + x];
      if (tile.terrain === "field") {
        distribution.fieldTiles += 1;
        if (Math.abs(z - CENTRE.z) <= 14) distribution.centralFieldTiles += 1;
        if (Math.hypot(x - homes.north.x, z - homes.north.z) <= RULES.buildRadius) distribution.homeFieldTiles.north += 1;
        if (Math.hypot(x - homes.south.x, z - homes.south.z) <= RULES.buildRadius) distribution.homeFieldTiles.south += 1;
      }
      if (tile.terrain === "oasis") distribution.oasisTiles += 1;
      if (tile.terrain === "stone") {
        distribution.stoneTiles += 1;
        if (Math.abs(z - CENTRE.z) <= 14) distribution.centralStoneTiles += 1;
      }
    }
  }
  return {
    seed,
    variant,
    dimensions: { width: RULES.width, height: RULES.height },
    distribution,
    designIntent:
      variant === "corridor-wide-sight-logistics-corrected"
        ? "Protocol 21 keeps v34's terrain, finite food route, 12-food shared Oasis, 200 central stone, structure upkeep and all other economy rules unchanged. It repairs three logistics-interface mismatches: drop is accepted by the model schema, route previews use the engine's whole-load-first storage selection, and builders avoid an insufficient stone pickup or a pickup already covered by stone in transit. The south model changes from DeepSeek v4 Pro to GPT Terra, so this is not a clean isolated interface comparison. This is observer-only design context and never enters a player's objective."
        : variant === "corridor-wide-sight-tight-economy"
        ? "Protocol 20 retains v33's symmetric corridor, finite food route, 90-stone home quarry, physical storage, mixed backpacks and contact-gated interface. The compact shared Oasis now renews 12 food per turn, central stone totals 200, and completed structures use a 20-free-block ceil upkeep curve. The combined change is a contact-pacing shakedown, not a clean causal comparison with v33, because the south model also changes from DeepSeek v4 Flash to Pro. This is observer-only design context and never enters a player's objective."
        : variant === "corridor-wide-sight-contact-gated"
        ? "Protocol 19 keeps v32's terrain, resources, physical storage, mixed-resource backpacks, drop and body occupation unchanged. Before first sight, the player interface omits every heading, rule and action schema that presupposes people or structures not its own; those facts and name/message actions appear only after actual contact. This is observer-only protocol context and never enters a player's objective."
        : variant === "corridor-wide-sight-mixed-carry"
        ? "Protocol 18 keeps v31's terrain and physical per-building storage unchanged while making the disclosed 30-unit backpack genuinely mixed-resource. A partially filled carrier may gather either food or stone until full or explicitly sent to deposit. This is observer-only interface context and never enters a player's objective."
        : variant === "corridor-wide-sight-drop"
        ? "Protocol 17 keeps v30's terrain and resources unchanged while switching engine-authored report text to English and adding neutral ground drop plus physical occupation by a person not one's own. These contact-only interface facts do not appear before first sight. This is observer-only protocol context and never enters a player's objective."
        : variant === "corridor-wide-sight-stone"
        ? "Protocol 16 terrain, food, Oasis and sight are byte-identical to v29; exactly one number changes, the shared home quarry holding 90 stone instead of 40. v29 ended with south's home quarry at zero while its own hall lost an exposed block per turn to structure upkeep it could not fund, so the previous reserve made a settlement's first structures self-punishing before either side could weigh travelling for more. Central stone is unchanged, so long-run scarcity still points outward. This is observer-only design context and never enters a player's objective."
        : variant === "corridor-unique-oasis-wide-sight"
        ? "Protocol 16 restores v27's exact corridor, finite 40/40/40 home food, visible 50→60→70→80→90 route, 16-food-per-turn shared Oasis and stone distribution. Worker sight widens from 6 to 8 cells only around each person's physical position, reducing blind exploration turns without revealing any unseen destination, direction or boundary. Building-derived capacity remains, but a new person now needs stored food to cover the joining cost and reserve; the 30-block free allowance and floor-based structure upkeep are restored. This is observer-only design context and never enters a player's objective."
        : variant === "numpad-route"
        ? "The two halls sit in keypad zones 7 and 3. A symmetric bent route runs 7→4→5→6→3, with fourteen observation-linked finite food cells holding 95 food per side; together with 105 stored food, each side has 200 one-off food. The centre exposes one shared 12-food-per-turn Oasis and one shared finite 120-stone pool. Starting stone is 30 per side plus one 12-stone route cell. Capacity is floor(completed standing blocks / 3); completed blocks above 20 cost ceil((blocks−20)/10) stored stone per turn. These labels and totals are observer-only map context and never enter a player's prompt."
        : variant === "corridor-unique-oasis"
        ? "Every ordinary Foodland cell is finite and has zero regrowth. The central 2×2 Oasis is distinct, unbuildable terrain whose four accessible cells share one 16-food pool and one +16/turn renewal. A forward worksite needs current observation and a physical worker route, not a chain of building anchors; a one-block Post remains permanent observation only. This is map and interface context, not evidence that either model understood it."
        : variant === "corridor-visible-oasis"
        ? "Finite food is a complete visible gradient: three 40-food home cells, then five route cells per side holding 50/60/70/80/90. The first route cell is visible from the hall and each later cell is within one worker's sight of the previous one. Total finite food per side is unchanged from v25; the same compact four-cell oasis supplies 16 renewable food/turn. A one-block post is now a cheap permanent observation point, cannot anchor construction, and may be expanded in place into a store. This is map and interface context, not evidence that either model understood it."
        : variant === "corridor-shared-oasis"
        ? "Every home and route food source is finite. All renewable food is concentrated in one compact, rotationally symmetric shared oasis: four cells supply 16 food/turn in total, enough for one full ten-person settlement but below two settlements' combined upkeep. The cells fit within one worker's sight, making nearby structures physically observable. Smaller store and post minimums lower the material barrier to forward logistics. This is map and interface context, not evidence that either model understood it."
        : variant === "corridor-oasis"
        ? "Every food source inside either mountain ridge is finite: three 90-food home fields and two 30-food corridor markers per side. Renewable food begins beyond the ridge and supplies 16 food/turn across four rotationally symmetric oasis cells, below the two civilizations' combined full-population upkeep. Births pause after famine until five fully fed turns pass. This is map and population context, not evidence that either model understood it."
        : variant === "corridor-tight"
        ? "The home ring keeps the single central corridor and visible marker chain, but home fields regenerate more slowly (about 6 food/turn) and completed structures above a free block allowance continuously spend stored stone. Local equilibrium is no longer free; this is map and economy context, not evidence that either model understood it."
        : variant === "corridor"
        ? "The home ring was reduced to three fields and a small quarry, while visible food and stone markers form a central corridor. Each stone marker can reveal the next from worker sight. The terrain is intended to replace arbitrary lateral search with survival pressure toward shared ground around turns 20–30; this is map context, not evidence that either model understood it."
        : variant !== "classic"
        ? "Home farmland was deliberately reduced and most farmland was moved into the central quarry band after v13 stayed at home for 152 turns. Food pressure is intended to pull both settlements outward; this is map context, not evidence that either model understood it."
        : "The classic layout has abundant home farmland. Earlier seasons showed that this can support a stable home economy, so lack of outward movement may reflect the map incentive as well as model choice.",
  };
}

function estimateObserverTokens(value: unknown) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 3);
}

function withObserverBudget<T extends Record<string, unknown>>(
  rawBrief: T,
  allowCompression: boolean,
  tokenLimit = OBSERVER_BRIEF_TOKEN_LIMIT,
) {
  const estimatedTokensBeforeCompression = estimateObserverTokens(rawBrief);
  const compressionApplied = allowCompression && estimatedTokensBeforeCompression > tokenLimit;
  const body = compressionApplied ? compressObserverSummary(rawBrief) : rawBrief;
  const budget = {
    tokenLimit,
    estimateMethod: "UTF-8 bytes divided by 3, rounded up (conservative heuristic, not provider billing tokens)",
    estimatedTokensBeforeCompression,
    estimatedTokens: 0,
    compressionApplied,
    withinBudget: false,
    rawDataPreservedAt: [
      "decision_slots.validated_json",
      "decision_slots.raw_response",
      "world_events",
      "action_results",
      "turns",
      "turn_stats",
    ],
  };
  const budgeted = { ...body, contextBudget: budget };
  budget.estimatedTokens = estimateObserverTokens(budgeted);
  budget.withinBudget = budget.estimatedTokens <= tokenLimit;
  return budgeted;
}

function compressObserverSummary<T extends Record<string, unknown>>(brief: T) {
  const journals = Array.isArray(brief.journals)
    ? groupObserverTextRanges(
        brief.journals as Array<{ turn: number; civ: CivId; journal: string }>,
        "journal",
        650,
        1,
      )
    : brief.journals;
  const memory = brief.longTermMemory as
    | {
        final: unknown;
        changes: Record<string, Array<{ turn: number; civ: CivId; text: string }>>;
      }
    | undefined;
  const compressedMemory = memory
    ? {
        final: memory.final,
        changes: {
          standingOrders: groupObserverTextRanges(memory.changes.standingOrders ?? [], "text", 650, 10),
          notebook: groupObserverTextRanges(memory.changes.notebook ?? [], "text", 900, 10),
          chronicle: groupObserverTextRanges(memory.changes.chronicle ?? [], "text", 500, 10),
        },
      }
    : memory;
  return {
    ...brief,
    journals: {
      format: "similar consecutive entries merged into turn ranges; representative text may be clipped",
      ranges: journals,
    },
    longTermMemory: compressedMemory,
  };
}

function groupObserverTextRanges<T extends { turn: number; civ: CivId }>(
  entries: T[],
  textKey: keyof T,
  maxRepresentativeChars: number,
  maxTurnGap: number,
) {
  const ranges: Array<{
    civ: CivId;
    fromTurn: number;
    toTurn: number;
    entryCount: number;
    representativeTurn: number;
    representativeText: string;
  }> = [];
  for (const civ of ["north", "south"] as CivId[]) {
    for (const entry of entries.filter((candidate) => candidate.civ === civ).sort((a, b) => a.turn - b.turn)) {
      const text = String(entry[textKey] ?? "");
      const previous = ranges[ranges.length - 1];
      const merge =
        previous?.civ === civ &&
        entry.turn - previous.toTurn <= maxTurnGap &&
        observerTextSimilarity(previous.representativeText, text) >= 0.68;
      if (merge) {
        previous.toTurn = entry.turn;
        previous.entryCount += 1;
        previous.representativeTurn = entry.turn;
        previous.representativeText = clipObserverText(text, maxRepresentativeChars);
      } else {
        ranges.push({
          civ,
          fromTurn: entry.turn,
          toTurn: entry.turn,
          entryCount: 1,
          representativeTurn: entry.turn,
          representativeText: clipObserverText(text, maxRepresentativeChars),
        });
      }
    }
  }
  return ranges.sort((a, b) => a.fromTurn - b.fromTurn || a.civ.localeCompare(b.civ));
}

function clipObserverText(text: string, limit: number) {
  return text.length <= limit ? text : `${text.slice(0, limit)}… [${text.length - limit} chars retained only in SQLite archive]`;
}

function observerTextSimilarity(left: string, right: string) {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/\d+(?:\.\d+)?/g, "#")
      .replace(/\s+/g, " ")
      .trim();
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return 1;
  if (a.length < 8 || b.length < 8) return 0;
  const shingles = (value: string) => {
    const chars = Array.from(value);
    const set = new Set<string>();
    for (let index = 0; index <= chars.length - 3; index += 1) set.add(chars.slice(index, index + 3).join(""));
    return set;
  };
  const aSet = shingles(a);
  const bSet = shingles(b);
  let intersection = 0;
  for (const value of aSet) if (bSet.has(value)) intersection += 1;
  return intersection / Math.max(1, aSet.size + bSet.size - intersection);
}
