import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scriptedDecisions } from "../src/sim/agents";
import { RULES } from "../src/sim/config";
import { decodeWorld, encodeWorld } from "../src/research/codec";
import { DEFAULT_SEASON_CONFIG, ResearchStore } from "../src/research/store";
import { buildPrivateReport } from "../src/research/report";
import { renderModelMarkdown } from "../src/lib/markdown";
import type { Decision } from "../src/sim/types";

const cleanup: string[] = [];

afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function tempDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "ai-civ-research-"));
  cleanup.push(directory);
  return join(directory, "research.sqlite");
}

function modelJson(decision: Decision) {
  return JSON.stringify({
    journal: decision.journal,
    standingOrders: decision.standingOrders,
    chronicleLine: decision.chronicleLine,
    actions: decision.actions.map((action) => {
      if (action.type !== "design") return action;
      const { author: _author, ...design } = action.design;
      return { type: "design", design };
    }),
  });
}

function playOneTurn(store: ResearchStore, seasonId: string) {
  const north = store.claimDecision(seasonId, "north");
  const south = store.claimDecision(seasonId, "south");
  expect(north.ok).toBe(true);
  expect(south.ok).toBe(true);
  expect(north.turn).toBeDefined();
  expect(south.turn).toBe(north.turn!);
  expect(north.snapshotHash).toBeDefined();
  expect(south.snapshotHash).toBe(north.snapshotHash!);
  const turnNumber = north.turn!;
  const turn = store.getTurn(seasonId, turnNumber)!;
  const decisions = scriptedDecisions(decodeWorld(turn.snapshot_json));
  const northResult = store.submitDecision({
    seasonId,
    turn: turnNumber,
    civ: "north",
    leaseToken: north.leaseToken!,
    submissionKey: `north-${turnNumber}`,
    rawResponse: modelJson(decisions.find((decision) => decision.civ === "north")!),
  }) as { ok: boolean; resolved: boolean };
  const southResult = store.submitDecision({
    seasonId,
    turn: turnNumber,
    civ: "south",
    leaseToken: south.leaseToken!,
    submissionKey: `south-${turnNumber}`,
    rawResponse: modelJson(decisions.find((decision) => decision.civ === "south")!),
  }) as { ok: boolean; resolved: boolean };
  return { north, south, northResult, southResult };
}

describe("research turn controller", () => {
  test("both sides receive the same frozen turn and the second submission resolves it once", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260802, { ...DEFAULT_SEASON_CONFIG, maxTurns: 3 }, "frozen-turn");
    const run = playOneTurn(store, season);

    expect(run.northResult.resolved).toBe(false);
    expect(run.southResult.resolved).toBe(true);
    expect(store.status(season)?.currentTurn).toBe(1);

    const duplicate = store.submitDecision({
      seasonId: season,
      turn: run.north.turn!,
      civ: "north",
      leaseToken: run.north.leaseToken!,
      submissionKey: `north-${run.north.turn}`,
      rawResponse: "{}",
    }) as { ok: boolean; duplicate: boolean };
    expect(duplicate).toMatchObject({ ok: true, duplicate: true });
    expect(store.status(season)?.currentTurn).toBe(1);
    store.close();
  });

  test("a season with null limits keeps running until an operator stops it", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(
      20260814,
      { ...DEFAULT_SEASON_CONFIG, maxTurns: null, maxModelRuns: null },
      "manual-stop-season",
    );

    playOneTurn(store, season);
    playOneTurn(store, season);
    playOneTurn(store, season);

    expect(store.status(season)).toMatchObject({ status: "active", currentTurn: 3, modelRuns: 6 });
    store.abortSeason(season, "operator stop test");
    expect(store.status(season)?.status).toBe("aborted");
    store.close();
  });

  test("a late claimed decision cannot revive an aborted season", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260814, DEFAULT_SEASON_CONFIG, "late-aborted-submit");
    const claim = store.claimDecision(season, "north");
    expect(claim.ok).toBe(true);

    expect(store.abortSeason(season, "operator stop test")).toBe(true);
    const result = store.submitDecision({
      seasonId: season,
      turn: claim.turn!,
      civ: "north",
      leaseToken: claim.leaseToken!,
      submissionKey: "late-north",
      rawResponse: JSON.stringify({ journal: "Wait.", actions: [] }),
    });

    expect(result).toEqual({ ok: false, reason: "turn_inactive" });
    expect(store.status(season)).toMatchObject({ status: "aborted", currentTurn: 0 });
    store.close();
  });

  test("a coordinator provider failure is recorded without resolving a partial turn", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260814, DEFAULT_SEASON_CONFIG, "provider-failure");
    const north = store.claimDecision(season, "north");
    const south = store.claimDecision(season, "south");
    expect(north.ok).toBe(true);
    expect(south.ok).toBe(true);
    expect(
      store.failDecision({
        seasonId: season,
        turn: north.turn!,
        civ: "north",
        leaseToken: north.leaseToken!,
        error: "provider authentication failed",
      }),
    ).toEqual({ ok: true });
    expect(
      store.failDecision({
        seasonId: season,
        turn: south.turn!,
        civ: "south",
        leaseToken: south.leaseToken!,
        error: "counterpart provider failed; response discarded",
      }),
    ).toEqual({ ok: true });
    expect(store.pauseSeason(season)).toBe(true);
    expect(store.getTurn(season, north.turn!)?.status).toBe("waiting");
    expect(store.getSeason(season)?.current_turn).toBe(0);
    expect(
      store.submitDecision({
        seasonId: season,
        turn: south.turn!,
        civ: "south",
        leaseToken: south.leaseToken!,
        submissionKey: `${season}:${south.turn}:south`,
        rawResponse: JSON.stringify({ journal: "late", actions: [] }),
      }),
    ).toMatchObject({ ok: false, reason: "lease_mismatch" });
    store.close();
  });

  test("model-facing worker aliases are translated before the turn is stored", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260802, { ...DEFAULT_SEASON_CONFIG, maxTurns: 1 }, "alias-submit");
    const first = store.claimDecision(season, "north");
    const second = store.claimDecision(season, "south");
    const northResult = store.submitDecision({
      seasonId: season,
      turn: first.turn!,
      civ: "north",
      leaseToken: first.leaseToken!,
      submissionKey: "alias-north",
      rawResponse: JSON.stringify({
        journal: "Walk nearby.",
        actions: [{ type: "move", workers: ["worker-1"], to: { x: 45, z: 7 } }],
      }),
    }) as { ok: boolean };
    expect(northResult.ok).toBe(true);
    store.submitDecision({
      seasonId: season,
      turn: second.turn!,
      civ: "south",
      leaseToken: second.leaseToken!,
      submissionKey: "alias-south",
      rawResponse: JSON.stringify({ journal: "Wait.", actions: [] }),
    });
    const archive = store.archive(season, 1)!;
    const northDecision = archive.decisions.find((decision) => decision.civ === "north")!.acceptedDecision as Decision;
    expect(northDecision.actions[0]).toMatchObject({ workers: ["north-w1"] });
    store.close();
  });

  test("model prompts contain no directional identity words and design aliases map back", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260802, { ...DEFAULT_SEASON_CONFIG, maxTurns: 2 }, "neutral-prompt");
    const first = store.claimDecision(season, "north");
    const counterpart = store.claimDecision(season, "south");
    const directions = /\b(?:north|south|northern|southern)\b|[南北]/i;
    expect(first.prompt).not.toMatch(directions);
    expect(first.prompt).toContain("A worker may receive at most one new worker action in a turn.");
    expect(first.prompt).toContain("Its assigned job continues on later turns");
    expect(first.prompt).toContain("Deposit is a separate worker order.");
    expect(first.prompt).toContain("The action does not accept a structure ID");
    expect(first.prompt).toContain("As workers travel, nearby cells enter the observed map.");
    expect(first.prompt).toContain("A completed post continuously observes within 12 spaces of its centre");
    expect(first.prompt).toContain("At least one planned # cell must be within 12 straight-line spaces");
    expect(first.prompt).toContain("backpack 0/30; 30 free spaces");
    expect(first.prompt).toContain("Use deposit only to send a partial backpack home earlier.");
    expect(first.prompt).toContain("Anything that does not fit remains in that worker's backpack.");
    expect(first.prompt).toContain("at is the coordinate of the first character in the plan's first row");

    store.submitDecision({
      seasonId: season,
      turn: first.turn!,
      civ: "north",
      leaseToken: first.leaseToken!,
      submissionKey: "neutral-first",
      rawResponse: JSON.stringify({
        journal: "Explore south while remembering the 北 ridge.",
        standingOrders: "Keep the northern store ready.",
        actions: [
          {
            type: "design",
            design: { id: "south-store", name: "Southern 南倉", fn: "store", rows: ["#####", "#####"] },
          },
          { type: "note", text: "The north path is familiar." },
        ],
      }),
    });
    store.submitDecision({
      seasonId: season,
      turn: counterpart.turn!,
      civ: "south",
      leaseToken: counterpart.leaseToken!,
      submissionKey: "neutral-counterpart-first",
      rawResponse: JSON.stringify({ journal: "Wait.", actions: [] }),
    });

    const second = store.claimDecision(season, "north");
    const secondCounterpart = store.claimDecision(season, "south");
    expect(second.prompt).not.toMatch(directions);
    expect(second.prompt).toContain("plan-1");
    expect(second.prompt).toContain("cells 10; stone cost 30");
    expect(second.prompt).not.toContain("south-store");
    store.submitDecision({
      seasonId: season,
      turn: second.turn!,
      civ: "north",
      leaseToken: second.leaseToken!,
      submissionKey: "neutral-second",
      rawResponse: JSON.stringify({
        journal: "Use the saved plan.",
        actions: [{ type: "build", designId: "plan-1", at: { x: 40, z: 16 }, workers: ["worker-1"] }],
      }),
    });
    store.submitDecision({
      seasonId: season,
      turn: secondCounterpart.turn!,
      civ: "south",
      leaseToken: secondCounterpart.leaseToken!,
      submissionKey: "neutral-counterpart-second",
      rawResponse: JSON.stringify({ journal: "Wait.", actions: [] }),
    });
    const archive = store.archive(season, 2)!;
    const accepted = archive.decisions.find((decision) => decision.civ === "north")!.acceptedDecision as Decision;
    expect(accepted.actions[0]).toMatchObject({ type: "build", designId: "south-store" });
    store.close();
  });

  test("a second run for the same side cannot claim an unexpired slot", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(1, DEFAULT_SEASON_CONFIG, "lease-test");
    const first = store.claimDecision(season, "north");
    const second = store.claimDecision(season, "north");
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, reason: "busy" });
    store.close();
  });

  test("invalid output can be repaired with the same claim and records a distinct no-op", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(2, DEFAULT_SEASON_CONFIG, "invalid-test");
    const claim = store.claimDecision(season, "north");
    const first = store.submitDecision({
      seasonId: season,
      turn: claim.turn!,
      civ: "north",
      leaseToken: claim.leaseToken!,
      submissionKey: "invalid-1",
      rawResponse: "not-json",
    }) as { ok: boolean; reason: string };
    expect(first).toMatchObject({ ok: false, reason: "repair_required" });

    const overlappingClaim = store.claimDecision(season, "north");
    expect(overlappingClaim).toMatchObject({ ok: false, reason: "busy" });
    const second = store.submitDecision({
      seasonId: season,
      turn: claim.turn!,
      civ: "north",
      leaseToken: claim.leaseToken!,
      submissionKey: "invalid-1",
      rawResponse: "not-json",
      repairedResponse: "still-not-json",
    }) as { ok: boolean; noOp: boolean; resolved: boolean };
    expect(second).toMatchObject({ ok: true, noOp: true, resolved: false });
    expect(store.status(season)?.slots.find((slot) => slot.civ === "north")?.status).toBe("submitted_noop");
    store.close();
  });

  test("expired claims remain in the attempt log after the slot is reclaimed", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(
      4,
      { ...DEFAULT_SEASON_CONFIG, leaseMs: 10, decisionTimeoutMs: 10 },
      "timeout-attempt-test",
    );
    const first = store.claimDecision(season, "north");
    expect(first.ok).toBe(true);
    expect(store.expireLeases(Date.now() + 20)).toBe(1);
    expect(store.status(season)?.slots.find((slot) => slot.civ === "north")?.status).toBe("timed_out");
    expect(store.status(season)?.counts).toMatchObject({ decision_attempts: 1, timed_out_attempts: 1 });

    const second = store.claimDecision(season, "north");
    expect(second.ok).toBe(true);
    expect(second.leaseToken).not.toBe(first.leaseToken);
    expect(store.status(season)?.counts).toMatchObject({ decision_attempts: 2, timed_out_attempts: 1 });
    store.close();
  });

  test("a paused season can be resumed with an explicitly higher model-run ceiling", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(
      5,
      { ...DEFAULT_SEASON_CONFIG, maxModelRuns: 1 },
      "raise-run-limit-test",
    );
    expect(store.claimDecision(season, "north").ok).toBe(true);
    expect(store.claimDecision(season, "south")).toMatchObject({ ok: false, reason: "season_inactive" });
    expect(store.status(season)?.status).toBe("paused");
    expect(store.resumeSeason(season)).toBe(false);
    expect(store.resumeSeason(season, 3)).toBe(true);
    expect(store.claimDecision(season, "south").ok).toBe(true);
    store.close();
  });

  test("a prepared turn survives process restart without changing its snapshot", () => {
    const path = tempDatabase();
    const firstStore = new ResearchStore(path);
    const season = firstStore.createSeason(3, DEFAULT_SEASON_CONFIG, "restart-test");
    const claim = firstStore.claimDecision(season, "north");
    const hash = claim.snapshotHash!;
    firstStore.close();

    const secondStore = new ResearchStore(path);
    const pending = secondStore.getTurn(season, claim.turn!);
    expect(pending?.status).toBe("waiting");
    expect(pending?.snapshot_hash).toBe(hash);
    expect(secondStore.status(season)?.currentTurn).toBe(0);
    secondStore.close();
  });

  test("a 50-turn stored season replays to every saved hash", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(
      20260802,
      { ...DEFAULT_SEASON_CONFIG, maxTurns: 50, maxModelRuns: 120 },
      "replay-50",
    );
    for (let turn = 0; turn < 50; turn += 1) playOneTurn(store, season);
    const verification = store.verifyReplay(season);
    expect(verification).toMatchObject({ ok: true, turns: 50 });
    const status = store.status(season)!;
    expect(status.currentTurn).toBe(50);
    expect(status.counts.results).toBeGreaterThan(100);
    expect(status.counts.resolved_turns).toBe(50);
    store.close();
  }, 30_000);

  test("starvation deaths reach the ledger even though upkeep runs before either model decides", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260802, { ...DEFAULT_SEASON_CONFIG, maxTurns: 3 }, "starve-logging");
    // Empty the southern granaries so the very next upkeep kills someone. Upkeep happens inside
    // prepareTurn, whose events used to be written into the snapshot and nowhere else.
    const row = store.db.query("SELECT world_json FROM seasons WHERE id=?").get(season) as { world_json: string };
    const world = decodeWorld(row.world_json);
    for (const building of Object.values(world.buildings)) {
      if (building.owner === "south") building.stock.food = 0;
    }
    store.db.query("UPDATE seasons SET world_json=? WHERE id=?").run(encodeWorld(world), season);

    playOneTurn(store, season);

    const starved = store.db
      .query("SELECT turn, civ, text FROM world_events WHERE season_id=? AND kind='starve'")
      .all(season) as Array<{ turn: number; civ: string; text: string }>;
    expect(starved.length).toBeGreaterThan(0);
    expect(starved[0].civ).toBe("south");
    expect(store.events(season, 1).some((event) => event.kind === "starve")).toBe(true);
    store.close();
  });

  test("an observer summary is only written after a season stops, and never reaches a prompt", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260802, { ...DEFAULT_SEASON_CONFIG, maxTurns: 3 }, "observer-isolation");
    playOneTurn(store, season);
    const token = "OBSERVER-CANARY-9c1f";

    // While the season is live the observer must not be able to record anything at all.
    expect(store.seasonsAwaitingSummary().some((entry) => entry.id === season)).toBe(false);
    expect(store.saveSummary({ seasonId: season, authorModel: "opus", markdown: `${token} ${"x".repeat(60)}`, briefHash: "h" })).toMatchObject({
      ok: false,
      reason: "season_still_running",
    });

    store.abortSeason(season, "test");
    expect(store.seasonsAwaitingSummary().some((entry) => entry.id === season)).toBe(true);
    const built = store.summaryBrief(season)!;
    expect(built.brief.sides.north.model).toBe(DEFAULT_SEASON_CONFIG.models.north.model);
    expect(built.brief.contextBudget.compressionApplied).toBe(false);
    expect(store.saveSummary({ seasonId: season, authorModel: "opus", markdown: `${token} ${"x".repeat(60)}`, briefHash: built.hash })).toMatchObject({ ok: true });
    expect(store.getSummary(season)!.markdown).toContain(token);

    // The prompt builder must not consult the summary table for any civilization.
    const world = decodeWorld(store.getSeason(season)!.world_json);
    for (const civ of ["north", "south"] as const) {
      expect(buildPrivateReport(world, civ).text).not.toContain(token);
    }
    store.close();
  });

  test("the observer brief records map pressure, schedule gaps, contact and actual memory changes", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260805, { ...DEFAULT_SEASON_CONFIG, maxTurns: 3 }, "observer-evidence");
    const north = store.claimDecision(season, "north");
    const south = store.claimDecision(season, "south");
    store.submitDecision({
      seasonId: season,
      turn: north.turn!,
      civ: "north",
      leaseToken: north.leaseToken!,
      submissionKey: "observer-evidence-north",
      rawResponse: JSON.stringify({
        journal: "Keep food moving while the settlement grows.",
        standingOrders: "Keep five turns of food and extend carefully.",
        actions: [{ type: "note", text: "The central route may matter later." }],
      }),
    });
    store.submitDecision({
      seasonId: season,
      turn: south.turn!,
      civ: "south",
      leaseToken: south.leaseToken!,
      submissionKey: "observer-evidence-south",
      rawResponse: JSON.stringify({ journal: "Gather nearby food.", actions: [] }),
    });
    store.db
      .query("UPDATE turns SET prepared_at=prepared_at-? WHERE season_id=? AND turn=1")
      .run(6 * 60 * 1000, season);
    const contact = { id: 999, turn: 1, civ: "north", kind: "contact", text: "First sighting.", at: { x: 48, z: 48 } };
    store.db
      .query("INSERT INTO world_events (season_id,turn,event_id,civ,kind,text,payload_json) VALUES (?,?,?,?,?,?,?)")
      .run(season, 1, contact.id, contact.civ, contact.kind, contact.text, JSON.stringify(contact));
    store.abortSeason(season, "observer evidence test");

    const built = store.summaryBrief(season, 1)!;
    const brief = built.brief;
    expect(brief.mapBackground.variant).toBe("gradient");
    expect(brief.mapBackground.distribution.centralFieldTiles).toBeGreaterThan(
      brief.mapBackground.distribution.homeFieldTiles.north,
    );
    expect(brief.scheduleHealth.anomalies.some((entry) => entry.kind === "slot_claim_delay")).toBe(true);
    expect(brief.contactHistory).toMatchObject({ contactMade: true, firstContactTurn: 1 });
    expect(brief.longTermMemory.final?.north).toMatchObject({
      standingOrders: "Keep five turns of food and extend carefully.",
      notebook: "The central route may matter later.",
    });
    expect(brief.longTermMemory.changes.standingOrders[0]).toMatchObject({ fromTurn: 1, toTurn: 1, civ: "north" });
    expect(brief.contextBudget.compressionApplied).toBe(true);
    expect(brief.journals).toHaveProperty("ranges");
    store.close();
  });

  test("the observer describes scarce as a reduced-home-field map, not the classic layout", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260806, { ...DEFAULT_SEASON_CONFIG, maxTurns: 3 }, "observer-scarce-map");
    store.abortSeason(season, "observer scarce map test");

    const brief = store.summaryBrief(season)!.brief;
    expect(brief.mapBackground.variant).toBe("scarce");
    expect(brief.mapBackground.designIntent).toContain("Home farmland was deliberately reduced");
    expect(brief.mapBackground.designIntent).not.toContain("classic layout");
    store.close();
  });

  test("the observer records the corridor forcing function without attributing understanding", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260807, { ...DEFAULT_SEASON_CONFIG, maxTurns: 3 }, "observer-corridor-map");
    store.abortSeason(season, "observer corridor map test");

    const brief = store.summaryBrief(season)!.brief;
    expect(brief.mapBackground.variant).toBe("corridor");
    expect(brief.mapBackground.designIntent).toContain("three fields and a small quarry");
    expect(brief.mapBackground.designIntent).toContain("turns 20–30");
    expect(brief.mapBackground.designIntent).toContain("not evidence that either model understood it");
    store.close();
  });

  test("the observer records corridor-tight as explore-or-die pressure, not a model conclusion", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260808, { ...DEFAULT_SEASON_CONFIG, maxTurns: 3 }, "observer-corridor-tight-map");
    store.abortSeason(season, "observer corridor-tight map test");

    const brief = store.summaryBrief(season)!.brief;
    expect(brief.mapBackground.variant).toBe("corridor-tight");
    expect(brief.mapBackground.designIntent).toContain("regenerate more slowly");
    expect(brief.mapBackground.designIntent).toContain("continuously spend stored stone");
    expect(brief.mapBackground.designIntent).toContain("not evidence that either model understood it");
    store.close();
  });

  test("the observer records corridor-oasis finite home food and shared scarcity", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260810, { ...DEFAULT_SEASON_CONFIG, maxTurns: 3 }, "observer-corridor-oasis-map");
    store.abortSeason(season, "observer corridor-oasis map test");

    const brief = store.summaryBrief(season)!.brief;
    expect(brief.mapBackground.variant).toBe("corridor-oasis");
    expect(brief.mapBackground.designIntent).toContain("Every food source inside either mountain ridge is finite");
    expect(brief.mapBackground.designIntent).toContain("16 food/turn");
    expect(brief.mapBackground.designIntent).toContain("not evidence that either model understood it");
    store.close();
  });

  test("the observer records the compact shared oasis and cheaper forward logistics", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260811, { ...DEFAULT_SEASON_CONFIG, maxTurns: 3 }, "observer-shared-oasis-map");
    store.abortSeason(season, "observer shared-oasis map test");

    const brief = store.summaryBrief(season)!.brief;
    expect(brief.mapBackground.variant).toBe("corridor-shared-oasis");
    expect(brief.mapBackground.designIntent).toContain("one compact, rotationally symmetric shared oasis");
    expect(brief.mapBackground.designIntent).toContain("16 food/turn");
    expect(brief.mapBackground.designIntent).toContain("Smaller store and post minimums");
    expect(brief.mapBackground.designIntent).toContain("not evidence that either model understood it");
    store.close();
  });

  test("the observer records finite Foodland and the single shared Oasis pool", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260813, { ...DEFAULT_SEASON_CONFIG, maxTurns: 3 }, "observer-unique-oasis-map");
    store.abortSeason(season, "observer unique-oasis map test");

    const brief = store.summaryBrief(season)!.brief;
    expect(brief.mapBackground.variant).toBe("corridor-unique-oasis");
    expect(brief.mapBackground.distribution.oasisTiles).toBe(4);
    expect(brief.mapBackground.designIntent).toContain("Every ordinary Foodland cell is finite");
    expect(brief.mapBackground.designIntent).toContain("share one 16-food pool");
    expect(brief.mapBackground.designIntent).toContain("not a chain of building anchors");
    expect(brief.mapBackground.designIntent).toContain("not evidence that either model understood it");
    store.close();
  });

  test("the observer records v28's bent route and pressure totals without entering player reports", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(
      20260814,
      { ...DEFAULT_SEASON_CONFIG, maxTurns: null, maxModelRuns: null },
      "observer-numpad-route-map",
    );
    const world = decodeWorld(store.getSeason(season)!.world_json);
    const playerReports = (["north", "south"] as const).map((civ) => buildPrivateReport(world, civ).text);
    store.abortSeason(season, "observer numpad-route map test");

    const brief = store.summaryBrief(season)!.brief;
    expect(brief.mapBackground.variant).toBe("numpad-route");
    expect(brief.mapBackground.designIntent).toContain("7→4→5→6→3");
    expect(brief.mapBackground.designIntent).toContain("200 one-off food");
    expect(brief.mapBackground.designIntent).toContain("shared finite 120-stone pool");
    expect(brief.mapBackground.designIntent).toContain("observer-only");
    for (const report of playerReports) {
      expect(report).not.toMatch(/keypad|numpad|7→4|3→6|120-stone|200 one-off/i);
    }
    store.close();
  });

  test("the observer records v29's restored route and wider local sight without leaking an objective", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260815, DEFAULT_SEASON_CONFIG, "observer-wide-sight-map");
    const world = decodeWorld(store.getSeason(season)!.world_json);
    const playerReports = (["north", "south"] as const).map((civ) => buildPrivateReport(world, civ).text);
    store.abortSeason(season, "observer v29 map test");

    const brief = store.summaryBrief(season)!.brief;
    expect(brief.mapBackground.variant).toBe("corridor-unique-oasis-wide-sight");
    expect(brief.mapBackground.designIntent).toContain("v27");
    expect(brief.mapBackground.designIntent).toContain("6 to 8 cells");
    for (const report of playerReports) {
      expect(report).toContain("observes cells within 8 spaces");
      expect(report).not.toMatch(/v27|v29|faster contact|route destination|world boundary/i);
    }
    store.close();
  });

  test("the observer records v33's contact-gated interface without entering player reports", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260819, DEFAULT_SEASON_CONFIG, "observer-contact-gated-map");
    const world = decodeWorld(store.getSeason(season)!.world_json);
    const playerReports = (["north", "south"] as const).map((civ) => buildPrivateReport(world, civ).text);
    store.abortSeason(season, "observer v33 map test");

    const brief = store.summaryBrief(season)!.brief;
    expect(brief.mapBackground.variant).toBe("corridor-wide-sight-contact-gated");
    expect(brief.mapBackground.designIntent).toContain("Protocol 19");
    expect(brief.mapBackground.designIntent).toContain("appear only after actual contact");
    for (const report of playerReports) {
      expect(report).not.toMatch(/Protocol 19|contact|people or structures not its own|name\/message/i);
    }
    store.close();
  });

  test("the observer records v34's economy calibration without leaking its purpose to players", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260820, DEFAULT_SEASON_CONFIG, "observer-tight-economy-map");
    const world = decodeWorld(store.getSeason(season)!.world_json);
    const playerReports = (["north", "south"] as const).map((civ) => buildPrivateReport(world, civ).text);
    store.abortSeason(season, "observer v34 map test");

    const brief = store.summaryBrief(season)!.brief;
    expect(brief.mapBackground.variant).toBe("corridor-wide-sight-tight-economy");
    expect(brief.mapBackground.designIntent).toContain("Protocol 20");
    expect(brief.mapBackground.designIntent).toContain("contact-pacing shakedown");
    for (const report of playerReports) {
      expect(report).not.toMatch(/Protocol 20|contact-pacing|v33|DeepSeek|Flash|Pro/i);
      expect(report).toContain("The first 20 standing blocks");
      expect(report).toContain("ceil((completed standing blocks − 20) / 10)");
    }
    store.close();
  });

  test("the observer records v35's logistics correction without leaking its purpose to players", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260821, DEFAULT_SEASON_CONFIG, "observer-logistics-corrected-map");
    const world = decodeWorld(store.getSeason(season)!.world_json);
    const playerReports = (["north", "south"] as const).map((civ) => buildPrivateReport(world, civ).text);
    store.abortSeason(season, "observer v35 map test");

    const brief = store.summaryBrief(season)!.brief;
    expect(brief.mapBackground.variant).toBe("corridor-wide-sight-logistics-corrected");
    expect(brief.mapBackground.designIntent).toContain("Protocol 21");
    expect(brief.mapBackground.designIntent).toContain("drop is accepted");
    for (const report of playerReports) {
      expect(report).not.toMatch(/Protocol 21|v34|logistics-interface|DeepSeek|GPT Terra/i);
      expect(report).toContain("The first 20 standing blocks");
      expect(report).toContain('drop: {"type":"drop"');
    }
    store.close();
  });

  test("a trend note is commentary on a live season and never reaches a prompt", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260802, { ...DEFAULT_SEASON_CONFIG, maxTurns: 30 }, "trend-isolation");
    playOneTurn(store, season);
    const token = "trend-note-isolation-marker";

    // A stale brief (wrong turn) is rejected; a fresh one is accepted while the season runs.
    expect(
      store.saveTrend({ seasonId: season, authorModel: "opus", markdown: `${token} ${"x".repeat(60)}`, briefHash: "h", throughTurn: 99 }),
    ).toMatchObject({ ok: false, reason: "stale_brief" });
    const built = store.trendBrief(season)!;
    expect(built.throughTurn).toBe(1);
    expect(
      store.saveTrend({
        seasonId: season,
        authorModel: "opus",
        markdown: `${token} ${"x".repeat(60)}`,
        briefHash: built.hash,
        throughTurn: built.throughTurn,
      }),
    ).toMatchObject({ ok: true });
    expect(store.getTrends(season)[0].markdown).toContain(token);

    // A second note without enough new turns is refused.
    expect(
      store.saveTrend({
        seasonId: season,
        authorModel: "opus",
        markdown: `${token} ${"x".repeat(60)}`,
        briefHash: built.hash,
        throughTurn: built.throughTurn,
      }),
    ).toMatchObject({ ok: false, reason: "too_soon" });

    // The prompt builder must not consult the trend table for any civilization.
    const world = decodeWorld(store.getSeason(season)!.world_json);
    for (const civ of ["north", "south"] as const) {
      expect(buildPrivateReport(world, civ).text).not.toContain(token);
    }
    store.close();
  });

  test("the lifecycle review continues a healthy season and pauses a finished one", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260802, { ...DEFAULT_SEASON_CONFIG, maxTurns: 1 }, "lifecycle-review");

    expect(store.reviewLatestSeason()).toMatchObject({
      action: "continue",
      reason: "active_season_healthy",
      seasonId: season,
    });

    playOneTurn(store, season);
    expect(store.reviewLatestSeason()).toMatchObject({
      action: "pause_players",
      reason: "season_complete",
      seasonId: season,
      summaryPending: [season],
    });
    store.close();
  });

  test("the lifecycle review does not pause while a recent retry is still running", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(
      20260802,
      { ...DEFAULT_SEASON_CONFIG, leaseMs: 1, decisionTimeoutMs: 1 },
      "retry-in-flight-review",
    );
    const first = store.claimDecision(season, "north");
    expect(first.ok).toBe(true);
    expect(store.expireLeases(Date.now() + 10)).toBe(1);
    const retry = store.claimDecision(season, "north");
    expect(retry.ok).toBe(true);
    const now = Date.now();
    store.db
      .query("UPDATE turns SET prepared_at=? WHERE season_id=? AND turn=?")
      .run(now - 31 * 60 * 1000, season, retry.turn!);
    store.db
      .query("UPDATE decision_slots SET started_at=?,lease_expires_at=? WHERE season_id=? AND turn=? AND civ='north'")
      .run(now - 10 * 60 * 1000, now - 60 * 1000, season, retry.turn!);

    expect(store.reviewLatestSeason(now)).toMatchObject({
      action: "continue",
      reason: "active_season_healthy",
      seasonId: season,
      waitingTurn: retry.turn,
    });
    expect(store.status(season)?.slots.find((slot) => slot.civ === "north")?.status).toBe("claimed");
    store.close();
  });

  test("the lifecycle review pauses an objectively stalled turn with no work in flight", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260802, DEFAULT_SEASON_CONFIG, "stalled-review");
    const waiting = store.prepareNextTurn(season)!;
    const now = Date.now();
    store.db
      .query("UPDATE turns SET prepared_at=? WHERE season_id=? AND turn=?")
      .run(now - 31 * 60 * 1000, season, waiting.turn);

    expect(store.reviewLatestSeason(now)).toMatchObject({
      action: "pause_players",
      reason: "turn_stalled",
      seasonId: season,
      stalledTurn: waiting.turn,
    });
    store.close();
  });

  test("the lifecycle review expires and pauses an attempt older than the stall window", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260802, DEFAULT_SEASON_CONFIG, "stale-attempt-review");
    const claim = store.claimDecision(season, "north");
    expect(claim.ok).toBe(true);
    const now = Date.now();
    store.db
      .query("UPDATE turns SET prepared_at=? WHERE season_id=? AND turn=?")
      .run(now - 32 * 60 * 1000, season, claim.turn!);
    store.db
      .query("UPDATE decision_slots SET started_at=?,lease_expires_at=? WHERE season_id=? AND turn=? AND civ='north'")
      .run(now - 31 * 60 * 1000, now - 19 * 60 * 1000, season, claim.turn!);

    expect(store.reviewLatestSeason(now)).toMatchObject({
      action: "pause_players",
      reason: "turn_stalled",
      seasonId: season,
      stalledTurn: claim.turn,
    });
    expect(store.status(season)?.slots.find((slot) => slot.civ === "north")?.status).toBe("timed_out");
    store.close();
  });

  test("replay verification checks the season's stored final hash", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260802, { ...DEFAULT_SEASON_CONFIG, maxTurns: 1 }, "season-hash-check");
    playOneTurn(store, season);
    store.db.query("UPDATE seasons SET world_hash='tampered' WHERE id=?").run(season);

    expect(store.verifyReplay(season)).toMatchObject({
      ok: false,
      error: "season_world_hash_mismatch",
    });
    store.close();
  });

  test("spawn rotation is recorded per decision, so a season's sides are never assumed", () => {
    const store = new ResearchStore(":memory:");
    const swapped = {
      ...DEFAULT_SEASON_CONFIG,
      maxTurns: 2,
      models: { north: DEFAULT_SEASON_CONFIG.models.south, south: DEFAULT_SEASON_CONFIG.models.north },
    };
    const season = store.createSeason(20260802, swapped, "rotated-sides");
    playOneTurn(store, season);

    const slots = store.db
      .query("SELECT civ, provider, model FROM decision_slots WHERE season_id=? ORDER BY civ")
      .all(season) as Array<{ civ: string; provider: string; model: string }>;
    expect(slots.find((slot) => slot.civ === "north")!.model).toBe(DEFAULT_SEASON_CONFIG.models.south.model);
    expect(slots.find((slot) => slot.civ === "south")!.model).toBe(DEFAULT_SEASON_CONFIG.models.north.model);
    const report = store.report(season)!;
    expect(report.models.north.model).toBe(DEFAULT_SEASON_CONFIG.models.south.model);
    expect(report.models.south.model).toBe(DEFAULT_SEASON_CONFIG.models.north.model);
    store.close();
  });

  test("a finished season reports its models, outcome and replayable milestones", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260802, { ...DEFAULT_SEASON_CONFIG, maxTurns: 6 }, "report-shape");
    for (let turn = 0; turn < 6; turn += 1) playOneTurn(store, season);

    const report = store.report(season)!;
    expect(report.turns).toBe(6);
    expect(report.models.north.model).toBe(DEFAULT_SEASON_CONFIG.models.north.model);
    expect(report.models.south.model).toBe(DEFAULT_SEASON_CONFIG.models.south.model);
    expect(report.reliability.north.decisions).toBe(6);
    expect(report.reliability.north.timedOut).toBe(0);
    expect(report.outcome.kind).toBe("turn_limit");
    expect(report.series.map((entry) => entry.turn)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(report.final).not.toBeNull();
    expect(report.peak.north.workers).toBeGreaterThan(0);
    for (const milestone of report.milestones) {
      expect(milestone.turn).toBeLessThanOrEqual(report.turns);
    }
    expect(store.seasons().some((entry) => entry.id === season)).toBe(true);
    store.close();
  }, 20_000);

  test("any past turn can be replayed from storage without decoding the whole season", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260802, { ...DEFAULT_SEASON_CONFIG, maxTurns: 4 }, "replay-frame");
    for (let turn = 0; turn < 4; turn += 1) playOneTurn(store, season);

    const start = store.replayFrame(season, 0)!;
    expect(start.turn).toBe(0);
    const middle = store.replayFrame(season, 2)!;
    expect(middle.turn).toBe(2);
    expect(middle.frame.civs.north).toEqual(store.turnSeries(season)[2].civs.north);
    // A replayed turn must not leak anything that happened later.
    expect(middle.frame.events.every((event) => event.turn <= 2)).toBe(true);
    expect(store.replayFrame(season, 99)).toBeNull();
    store.close();
  });

  test("spectator history includes the initial economy and every resolved turn", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260802, { ...DEFAULT_SEASON_CONFIG, maxTurns: 3 }, "spectator-history");
    playOneTurn(store, season);
    playOneTurn(store, season);
    const spectator = store.spectator(season)!;
    expect(spectator.history.map((entry: { turn: number }) => entry.turn)).toEqual([0, 1, 2]);
    expect(spectator.history.at(-1)?.civs).toEqual(spectator.frame.civs);
    expect(spectator.frame.civs.north.storageCapacity).toBe(RULES.hallStorageCapacity);
    expect(spectator.frame.workers[0].job).toHaveProperty("kind");
    store.close();
  });
});

describe("rendering model-written summaries on a public page", () => {
  test("markdown structure survives while HTML and unsafe links do not", () => {
    const rendered = renderModelMarkdown(
      [
        "> 第 1 回合：「先採附近的糧食。」",
        "",
        "- **重點**一",
        "",
        '<img src=x onerror="alert(1)">',
        "",
        "[safe](https://example.com) [bad](javascript:alert(1))",
      ].join("\n"),
    );
    // Blockquotes and emphasis must still render — escaping ">" would have silently killed them.
    expect(rendered).toContain("<blockquote>");
    expect(rendered).toContain("<strong>重點</strong>");
    expect(rendered).toContain("<li>");
    // No tag may originate from the document itself. The word "onerror" surviving as escaped text
    // is fine and expected — what must not survive is a real element carrying it.
    expect(rendered).not.toContain("<img");
    expect(rendered).toContain("&lt;img");
    expect(rendered).toContain('href="https://example.com"');
    expect(rendered).not.toContain("javascript:");
  });
});

describe("pressure and worker history", () => {
  /**
   * The two readings that need a worker to actually walk somewhere. Neither can be derived from a
   * single frame: reach is the max over living workers *per resolved turn*, and how long a worker
   * has held its job is a run over the turn table. Both were added because a season can look
   * healthy on every level chart while nobody has left home once — v13's whole finding.
   */
  test("reach and job runs come from the resolved turns, not from one frame", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260808, DEFAULT_SEASON_CONFIG, "pressure-test");
    for (let turn = 0; turn < 6; turn += 1) playOneTurn(store, season);

    const pressure = store.pressure(season);
    expect(pressure.rows.length).toBeGreaterThan(0);
    // The season was created under the current rules, so the panel is entitled to state that
    // structure upkeep applies even before anybody is billable enough to produce an event.
    expect(pressure.structureUpkeep).toBe(true);

    for (const civ of ["north", "south"] as const) {
      const rows = pressure.rows.filter((row) => row.civ === civ);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.workers).toBeGreaterThan(0);
        expect(row.reach).toBeGreaterThanOrEqual(row.meanReach);
        expect(row.beyondHome).toBeLessThanOrEqual(row.workers);
      }
      // Somebody has to have moved off the hall by the sixth turn, or the measurement is not
      // measuring anything.
      expect(Math.max(...rows.map((row) => row.reach))).toBeGreaterThan(0);
    }

    const history = store.workerHistory(season, "north-w1");
    expect(history.length).toBeGreaterThan(0);
    expect(history.map((row) => row.turn)).toEqual([...history.map((row) => row.turn)].sort((a, b) => a - b));
    expect(history.every((row) => typeof row.job === "string" && row.job.length > 0)).toBe(true);
    store.close();
  });

  test("a season that never resolved a turn reports no pressure rather than zeroes", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(20260808, DEFAULT_SEASON_CONFIG, "pressure-empty");
    expect(store.pressure(season).rows).toEqual([]);
    expect(store.workerHistory(season, "north-w1")).toEqual([]);
    store.close();
  });
});

/**
 * The spectator's record of what each model wrote for itself. This is the only place a reader can
 * see the three surfaces that persist between turns, so it has to agree with the engine exactly:
 * if the site shows a chronicle line the engine discarded, the page is inventing memory the model
 * never had.
 */
describe("self-written memory on the public page", () => {
  function submitBoth(
    store: ResearchStore,
    seasonId: string,
    north: Record<string, unknown>,
    south: Record<string, unknown>,
    { resolve = true }: { resolve?: boolean } = {},
  ) {
    const northSlot = store.claimDecision(seasonId, "north");
    const southSlot = store.claimDecision(seasonId, "south");
    const turn = northSlot.turn!;
    store.submitDecision({
      seasonId,
      turn,
      civ: "north",
      leaseToken: northSlot.leaseToken!,
      submissionKey: `north-${turn}`,
      rawResponse: JSON.stringify({ actions: [], ...north }),
    });
    if (!resolve) return turn;
    store.submitDecision({
      seasonId,
      turn,
      civ: "south",
      leaseToken: southSlot.leaseToken!,
      submissionKey: `south-${turn}`,
      rawResponse: JSON.stringify({ actions: [], ...south }),
    });
    return turn;
  }

  test("every version of the standing orders, notebook and chronicle is kept with its turn", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(
      20260808,
      { ...DEFAULT_SEASON_CONFIG, maxTurns: null, maxModelRuns: null },
      "memory-surfaces",
    );

    submitBoth(
      store,
      season,
      { journal: "n1", standingOrders: "hold the hall" },
      { journal: "s1", standingOrders: "walk east", actions: [{ type: "note", text: "page one" }] },
    );
    // Turn 2 resends both surfaces unchanged. Resending is not revising, and a page that counted it
    // as one would report a model rewriting its orders every turn when it never touched them.
    submitBoth(
      store,
      season,
      { journal: "n2", standingOrders: "hold the hall" },
      { journal: "s2", standingOrders: "walk east", actions: [{ type: "note", text: "page one" }] },
    );
    // A chronicle line off the chronicle interval is discarded by the engine, so it must not appear.
    submitBoth(
      store,
      season,
      { journal: "n3", standingOrders: "leave the hall", chronicleLine: "too early" },
      { journal: "s3", actions: [{ type: "note", text: "page two" }] },
    );
    submitBoth(store, season, { journal: "n4" }, { journal: "s4" });
    submitBoth(
      store,
      season,
      { journal: "n5", chronicleLine: "we held" },
      { journal: "s5", chronicleLine: "we walked" },
    );

    const memory = store.memory(season)!;
    expect(memory.throughTurn).toBe(5);

    expect(memory.civs.north.standingOrders).toEqual([
      { turn: 1, text: "hold the hall" },
      { turn: 3, text: "leave the hall" },
    ]);
    expect(memory.civs.south.notebook).toEqual([
      { turn: 1, text: "page one" },
      { turn: 3, text: "page two" },
    ]);
    // North never used a note action all season. That is a behaviour, not a gap in the record.
    expect(memory.civs.north.notebook).toEqual([]);
    expect(memory.civs.north.chronicle).toEqual([{ turn: 5, text: "we held" }]);
    expect(memory.civs.south.chronicle).toEqual([{ turn: 5, text: "we walked" }]);
    expect(memory.civs.north.journal.map((entry) => entry.text)).toEqual(["n1", "n2", "n3", "n4", "n5"]);

    // Scrubbing back must not show a page that had not been written yet.
    const early = store.memory(season, 2)!;
    expect(early.civs.north.standingOrders).toEqual([{ turn: 1, text: "hold the hall" }]);
    expect(early.civs.south.notebook).toEqual([{ turn: 1, text: "page one" }]);
    expect(early.civs.south.chronicle).toEqual([]);
    expect(early.civs.north.journal).toHaveLength(2);

    store.close();
  });

  test("a turn that has not resolved yet is not published, even though one side has submitted", () => {
    const store = new ResearchStore(":memory:");
    const season = store.createSeason(
      20260808,
      { ...DEFAULT_SEASON_CONFIG, maxTurns: null, maxModelRuns: null },
      "memory-unresolved",
    );
    submitBoth(store, season, { journal: "n1", standingOrders: "first" }, { journal: "s1" });
    submitBoth(store, season, { journal: "n2", standingOrders: "second" }, {}, { resolve: false });

    const memory = store.memory(season)!;
    expect(memory.throughTurn).toBe(1);
    expect(memory.civs.north.standingOrders).toEqual([{ turn: 1, text: "first" }]);
    store.close();
  });

  test("an unknown season is null rather than an empty record", () => {
    const store = new ResearchStore(":memory:");
    expect(store.memory("no-such-season")).toBeNull();
    store.close();
  });
});
