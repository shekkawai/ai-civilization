import { describe, expect, test } from "bun:test";
import { ResearchStore } from "../src/research/store";
import type { CivId } from "../src/sim/types";

/**
 * `store.efficiency` is the one query on the page that compares the two models directly, so the
 * three ways it could quietly mislead a viewer are pinned here.
 *
 * Rows are seeded straight into the ledgers rather than played through the controller: the SQL is
 * the thing under test, and a scripted season cannot be made to produce a chosen delivery pattern.
 */

function seed(store: ResearchStore, seasonId: string) {
  const worker = store.db.query(
    `INSERT INTO worker_turns (season_id, turn, worker_id, civ, job, x, z, carry_food, carry_stone)
     VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0)`,
  );
  const result = store.db.query(
    `INSERT INTO action_results (season_id, turn, result_id, civ, action_index, action_type, status, code, text, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?)`,
  );
  const stat = store.db.query(
    `INSERT INTO turn_stats (season_id, turn, civ, workers, food, stone, buildings, carried,
       blocks_placed, blocks_taken, quarry_left, contact, designs, journal, seen_tiles)
     VALUES (?, ?, ?, 1, 0, 0, 0, ?, 0, 0, 0, 0, 0, '', ?)`,
  );

  let resultId = 0;
  return {
    /** One worker-turn holding `job`. */
    workerTurn(turn: number, civ: CivId, id: string, job: string) {
      worker.run(seasonId, turn, id, civ, job);
    },
    /** One completed delivery of `amount` by `id`, exactly as the engine writes it. */
    delivery(turn: number, civ: CivId, id: string, amount: number) {
      resultId += 1;
      result.run(
        seasonId, turn, resultId, civ, -1, "job", "completed", "deposited",
        JSON.stringify({ turn, civ, workerIds: [id], amount }),
      );
    },
    /** One issued order with the given status. */
    order(turn: number, civ: CivId, status: string) {
      resultId += 1;
      result.run(seasonId, turn, resultId, civ, 0, "gather", status, "x", JSON.stringify({ turn, civ }));
    },
    /** One issued order naming specific workers, as idle attribution reads it. */
    orderFor(turn: number, civ: CivId, status: string, workerIds: string[]) {
      resultId += 1;
      result.run(
        seasonId, turn, resultId, civ, 0, "gather", status, "x",
        JSON.stringify({ turn, civ, workerIds }),
      );
    },
    stats(turn: number, civ: CivId, carried: number, seenTiles: number) {
      stat.run(seasonId, turn, civ, carried, seenTiles);
    },
    /** One turn's population and larder, as the crisis record reads cover from them. */
    vitals(turn: number, civ: CivId, workers: number, food: number) {
      store.db
        .query(
          `INSERT INTO turn_stats (season_id, turn, civ, workers, food, stone, buildings, carried,
             blocks_placed, blocks_taken, quarry_left, contact, designs, journal)
           VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')`,
        )
        .run(seasonId, turn, civ, workers, food);
    },
    /** One engine log line, exactly as `upkeep` writes starvation and spills. */
    event(turn: number, civ: CivId, kind: string, text: string) {
      resultId += 1;
      store.db
        .query(
          `INSERT INTO world_events (season_id, turn, event_id, civ, kind, text, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, '{}')`,
        )
        .run(seasonId, turn, resultId, civ, kind, text);
    },
  };
}

describe("efficiency", () => {
  test("delivered per worker-turn counts stored goods, never goods still being carried", () => {
    // The distinction is the whole point of the headline reading: a civilization can gather all day
    // and starve, because a backpack is not a granary. v13's north ended with 374 goods in packs.
    const store = new ResearchStore(":memory:");
    const seasonId = "efficiency-delivery";
    const rows = seed(store, seasonId);

    for (let turn = 1; turn <= 10; turn += 1) {
      rows.workerTurn(turn, "north", "north-w1", "gather");
      rows.workerTurn(turn, "south", "south-w1", "gather");
    }
    rows.delivery(10, "north", "north-w1", 30);
    rows.stats(10, "north", 0, 100);
    // South gathered just as long and delivered nothing; all of it is still on its back.
    rows.stats(10, "south", 30, 100);

    const [north, south] = ["north", "south"].map(
      (civ) => store.efficiency(seasonId, 10).find((row) => row.civ === civ)!,
    );
    expect(north.delivered / north.worker_turns).toBeCloseTo(3);
    expect(south.delivered).toBe(0);
    expect(south.carried).toBe(30);
    store.close();
  });

  test("turns per trip is measured between one worker's own deliveries", () => {
    // Averaging across workers would make a civilization with many carriers look faster than one
    // with few, which is a headcount difference rather than a pace difference.
    const store = new ResearchStore(":memory:");
    const seasonId = "efficiency-cycle";
    const rows = seed(store, seasonId);
    for (let turn = 1; turn <= 12; turn += 1) rows.workerTurn(turn, "north", "north-w1", "gather");
    for (let turn = 1; turn <= 12; turn += 1) rows.workerTurn(turn, "south", "south-w1", "gather");

    // north-w1 delivers every 4 turns; south-w1 every 2. Two carriers on north would not change it.
    [1, 5, 9].forEach((turn) => rows.delivery(turn, "north", "north-w1", 20));
    rows.delivery(3, "north", "north-w2", 20);
    [1, 3, 5].forEach((turn) => rows.delivery(turn, "south", "south-w1", 10));
    rows.stats(12, "north", 0, 0);
    rows.stats(12, "south", 0, 0);

    const result = store.efficiency(seasonId, 12);
    expect(result.find((row) => row.civ === "north")!.turns_per_trip).toBeCloseTo(4);
    expect(result.find((row) => row.civ === "south")!.turns_per_trip).toBeCloseTo(2);
    store.close();
  });

  test("only issued orders count toward the refusal rate, never engine job outcomes", () => {
    // `action_index` is -1 on rows the engine writes about a standing job. Counting those would mix
    // "the model asked for something impossible" with "a job finished", and the rate would stop
    // meaning anything about planning.
    const store = new ResearchStore(":memory:");
    const seasonId = "efficiency-refusals";
    const rows = seed(store, seasonId);
    rows.workerTurn(1, "north", "north-w1", "idle");
    rows.workerTurn(2, "north", "north-w1", "gather");
    rows.order(1, "north", "rejected");
    rows.order(1, "north", "accepted");
    rows.order(2, "north", "failed");
    rows.order(2, "north", "accepted");
    rows.delivery(2, "north", "north-w1", 5); // action_index -1: must not enter the denominator
    rows.stats(2, "north", 0, 0);

    const north = store.efficiency(seasonId, 2).find((row) => row.civ === "north")!;
    expect(north.issued).toBe(4);
    expect(north.refused).toBe(2);
    expect(north.idle_turns).toBe(1);
    store.close();
  });

  test("idle turns split into gap, refused order, and neglect — and only neglect needs two silent turns", () => {
    // The split answers "was the idle the model's choice". A worker's first unaddressed idle turn
    // is the ordinary gap between jobs; an idle turn the model addressed but the rules refused is
    // a misunderstanding; only a *second* consecutive turn with no order at all is neglect.
    const store = new ResearchStore(":memory:");
    const seasonId = "efficiency-attribution";
    const rows = seed(store, seasonId);

    // w1 sits idle for three turns and is never mentioned: gap, then neglect twice.
    [1, 2, 3].forEach((turn) => rows.workerTurn(turn, "north", "north-w1", "idle"));
    // w2 is idle while its order is refused on turn 1 (misunderstanding, not neglect). Its idle
    // turn 2 with no order at all IS neglect: the model decided again knowing the worker sat
    // idle, and the refused attempt the turn before does not excuse this turn's silence.
    rows.workerTurn(1, "north", "north-w2", "idle");
    rows.orderFor(1, "north", "rejected", ["north-w2"]);
    rows.workerTurn(2, "north", "north-w2", "idle");
    rows.workerTurn(3, "north", "north-w2", "gather");
    rows.stats(3, "north", 0, 0);

    const north = store.efficiency(seasonId, 3).find((row) => row.civ === "north")!;
    expect(north.idle_turns).toBe(5);
    expect(north.idle_gap).toBe(1); // w1 turn 1
    expect(north.idle_refused).toBe(1); // w2 turn 1
    expect(north.idle_neglect).toBe(3); // w1 turns 2 and 3, w2 turn 2
    store.close();
  });

  test("crisis record separates rescued warnings from fatal ones and reads spilled goods", () => {
    // A death is never the model's direct choice (the engine picks the victim), so the record
    // scores the response instead: cover under 3 turns of upkeep is a warning episode, and an
    // episode either recovers, kills, or is still open at the playhead. A wipe ends the low-cover
    // run one turn before its starve event, so the episode owns the adjacent death.
    const store = new ResearchStore(":memory:");
    const seasonId = "efficiency-crisis";
    const rows = seed(store, seasonId);
    for (let turn = 1; turn <= 7; turn += 1) {
      rows.workerTurn(turn, "north", "north-w1", "gather");
      rows.workerTurn(turn, "south", "south-w1", "gather");
    }

    // North: a rescued episode (turns 2–3), then a wipe — low cover at turn 5, everyone dead by 6.
    rows.vitals(1, "north", 2, 10);
    rows.vitals(2, "north", 2, 5);
    rows.vitals(3, "north", 2, 4);
    rows.vitals(4, "north", 2, 20);
    rows.vitals(5, "north", 2, 1);
    rows.vitals(6, "north", 0, 0);
    rows.vitals(7, "north", 0, 0);
    rows.event(6, "north", "starve", "糧倉見底，2 名工人餓死。");
    rows.event(6, "north", "spill", "一名餓死工人攜帶的 7 糧食與 2 石材掉在地上。");

    // South: in the danger band at the playhead with nobody dead — ongoing, not a rescue.
    rows.vitals(5, "south", 2, 30);
    rows.vitals(6, "south", 2, 2);
    rows.vitals(7, "south", 2, 1);

    const [north, south] = ["north", "south"].map(
      (civ) => store.efficiency(seasonId, 7).find((row) => row.civ === civ)!,
    );
    expect(north.warn_episodes).toBe(2);
    expect(north.rescued_episodes).toBe(1);
    expect(north.deaths).toBe(2);
    expect(north.spilled_food).toBe(7);
    expect(north.spilled_stone).toBe(2);
    expect(north.ongoing_episode).toBe(0);
    expect(south.warn_episodes).toBe(1);
    expect(south.rescued_episodes).toBe(0);
    expect(south.ongoing_episode).toBe(1);
    expect(south.deaths).toBe(0);
    store.close();
  });

  test("crisis and harvest readings parse both engine text eras, and building falls never count as death spills", () => {
    // The engine's log language switched at protocol 17: the same sentence is stored in Chinese
    // through v30 and in English from v31. Every text-parsed reading must match both — matching
    // only 糧食 once showed both v36 civilizations at "100% stone" while they lived off the Oasis,
    // and reported zero died-carrying goods for every English-era season. The spill match is also
    // anchored to the starved-worker sentence, because a building falling to unpaid upkeep logs
    // the same `spill` kind and its scattered stock is not something a dead worker was carrying.
    const store = new ResearchStore(":memory:");
    const seasonId = "efficiency-text-eras";
    const rows = seed(store, seasonId);
    for (let turn = 1; turn <= 3; turn += 1) {
      rows.workerTurn(turn, "north", "north-w1", "gather");
      rows.workerTurn(turn, "south", "south-w1", "gather");
    }

    rows.vitals(1, "north", 2, 1);
    rows.vitals(2, "north", 1, 20);
    rows.vitals(3, "north", 1, 20);
    rows.event(2, "north", "starve", "The granary ran dry — 1 workers starved.");
    rows.event(2, "north", "spill", "5 food and 12 stone carried by a starved worker fell to the ground.");
    // Building falls in both language eras: same `spill` kind, must not count as death spills.
    rows.event(3, "north", "spill", "「糧倉」倒下，6 糧食與 3 石材散落一地，任何人都可以拾走。");
    rows.event(
      3, "north", "spill",
      "「Store」 came down. 6 food and 3 stone spilled across the ground, free for anyone to pick up.",
    );

    const north = store.efficiency(seasonId, 3).find((row) => row.civ === "north")!;
    expect(north.deaths).toBe(1);
    expect(north.spilled_food).toBe(5);
    expect(north.spilled_stone).toBe(12);

    // The harvest split reads the same two eras off the gathered ledger.
    const gather = store.db.query(
      `INSERT INTO action_results (season_id, turn, result_id, civ, action_index, action_type, status, code, text, payload_json)
       VALUES (?, ?, ?, ?, -1, 'job', 'completed', 'gathered', ?, ?)`,
    );
    gather.run(seasonId, 1, 900, "north", "north-w1 gathered 5 food.", JSON.stringify({ amount: 5 }));
    gather.run(seasonId, 1, 901, "north", "north-w1 gathered 3 stone.", JSON.stringify({ amount: 3 }));
    gather.run(seasonId, 1, 902, "south", "south-w1 採集了 5 糧食。", JSON.stringify({ amount: 5 }));
    gather.run(seasonId, 1, 903, "south", "south-w1 採集了 3 石材。", JSON.stringify({ amount: 3 }));
    const harvest = store.harvestSeries(seasonId);
    expect(harvest.find((row) => row.civ === "north")).toMatchObject({ food: 5, stone: 3 });
    expect(harvest.find((row) => row.civ === "south")).toMatchObject({ food: 5, stone: 3 });
    store.close();
  });

  test("the reading is cumulative to the requested turn and never reads past it", () => {
    // The panel moves with the playhead. If it summed the whole season, scrubbing back would show a
    // reader figures from turns that have not happened yet on screen.
    const store = new ResearchStore(":memory:");
    const seasonId = "efficiency-playhead";
    const rows = seed(store, seasonId);
    for (let turn = 1; turn <= 6; turn += 1) rows.workerTurn(turn, "north", "north-w1", "gather");
    rows.delivery(2, "north", "north-w1", 10);
    rows.delivery(6, "north", "north-w1", 90);
    rows.stats(3, "north", 0, 50);
    rows.stats(6, "north", 0, 400);

    const early = store.efficiency(seasonId, 3).find((row) => row.civ === "north")!;
    expect(early.worker_turns).toBe(3);
    expect(early.delivered).toBe(10);
    expect(early.seen_tiles).toBe(50);

    const late = store.efficiency(seasonId, 6).find((row) => row.civ === "north")!;
    expect(late.delivered).toBe(100);
    expect(late.seen_tiles).toBe(400);
    store.close();
  });
});
