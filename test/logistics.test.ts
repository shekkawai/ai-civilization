import { describe, expect, test } from "bun:test";
import { ResearchStore } from "../src/research/store";

describe("logistics activity", () => {
  test("end-of-turn idle is not mistaken for a whole worker-turn wasted", () => {
    const store = new ResearchStore(":memory:");
    const seasonId = "logistics-activity";
    const worker = store.db.query(
      `INSERT INTO worker_turns
       (season_id, turn, worker_id, civ, job, x, z, carry_food, carry_stone)
       VALUES (?, ?, ?, 'north', ?, ?, ?, ?, 0)`,
    );
    const stat = store.db.query(
      `INSERT INTO turn_stats
       (season_id, turn, civ, workers, food, stone, buildings, carried,
        blocks_placed, blocks_taken, quarry_left, contact, designs, journal,
        storage_used, storage_capacity)
       VALUES (?, ?, 'north', ?, 0, 0, 0, ?, 0, 0, 0, 0, 0, '', 20, 200)`,
    );
    const result = store.db.query(
      `INSERT INTO action_results
       (season_id, turn, result_id, civ, action_index, action_type, status, code, text, payload_json)
       VALUES (?, ?, ?, 'north', -1, 'job', ?, ?, '', ?)`,
    );

    worker.run(seasonId, 1, "north-w1", "idle", 0, 0, 0);
    stat.run(seasonId, 1, 1, 0);

    // The delivery completed and then the worker returned to idle. This is useful work.
    worker.run(seasonId, 2, "north-w1", "idle", 0, 0, 0);
    result.run(
      seasonId,
      2,
      1,
      "completed",
      "deposited",
      JSON.stringify({ workerIds: ["north-w1"], amount: 5 }),
    );
    stat.run(seasonId, 2, 1, 0);

    // Moving, holding a job, and a physically blocked attempt are all active logistics time.
    worker.run(seasonId, 3, "north-w1", "idle", 1, 0, 30);
    stat.run(seasonId, 3, 1, 30);
    worker.run(seasonId, 4, "north-w1", "gather", 1, 0, 30);
    stat.run(seasonId, 4, 1, 30);
    worker.run(seasonId, 5, "north-w1", "idle", 1, 0, 30);
    result.run(
      seasonId,
      5,
      2,
      "failed",
      "blocked_by_person",
      JSON.stringify({ workerIds: ["north-w1"], amount: 0 }),
    );
    stat.run(seasonId, 5, 1, 30);

    // A worker born after the work phase is neither useful output nor idle waste that turn.
    worker.run(seasonId, 6, "north-w1", "gather", 1, 0, 30);
    worker.run(seasonId, 6, "north-w2", "idle", 2, 0, 0);
    stat.run(seasonId, 6, 2, 30);
    // The terminal zero-worker point must reset backpack pressure instead of carrying T6 forward.
    stat.run(seasonId, 7, 0, 0);

    const payload = store.logistics(seasonId);
    const points = payload.points.filter((point) => point.civ === "north");
    expect(points.find((point) => point.turn === 1)?.idle).toBe(1);
    expect(points.find((point) => point.turn === 2)?.productive).toBe(1);
    expect(points.find((point) => point.turn === 3)?.transit).toBe(1);
    expect(points.find((point) => point.turn === 4)?.transit).toBe(1);
    expect(points.find((point) => point.turn === 5)?.transit).toBe(1);
    expect(points.find((point) => point.turn === 6)?.newWorkers).toBe(1);
    expect(points.find((point) => point.turn === 3)?.fullPacks).toBe(1);
    expect(points.find((point) => point.turn === 7)).toMatchObject({ workers: 0, carried: 0 });

    const efficiency = store.efficiency(seasonId, 6).find((row) => row.civ === "north");
    expect(efficiency?.idle_turns).toBe(1);
    store.close();
  });
});
