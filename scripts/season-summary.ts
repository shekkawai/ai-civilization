import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ResearchStore } from "../src/research/store";

/**
 * Observer wrapper. An Automation running an observer model calls `pending`, then `brief`, writes
 * a Markdown write-up, then calls `save`.
 *
 * Two rules this script exists to enforce:
 *   1. A season is only ever summarized after it has stopped. Nothing written here can reach a
 *      turn that has not happened yet.
 *   2. The summary is stored in `season_summaries`, which no model-facing prompt ever reads.
 */
const [, , command, ...args] = process.argv;
const COMMANDS = new Set(["review", "pending", "brief", "save"]);
if (!command || !COMMANDS.has(command)) {
  console.error("Usage: bun scripts/season-summary.ts review|pending|brief|save [--season id] [--file path] [--model name]");
  process.exit(2);
}

const runtimeDirectory = resolve("data/automation-runtime");
mkdirSync(runtimeDirectory, { recursive: true });
const briefPath = resolve(runtimeDirectory, "summary-brief.json");
const defaultSummaryPath = resolve(runtimeDirectory, "summary.md");
const store = new ResearchStore(process.env.AI_CIVILIZATION_DB ?? resolve("data/research.sqlite"));

try {
  if (command === "review") {
    console.log(JSON.stringify(store.reviewLatestSeason()));
    process.exit(0);
  }

  const requested = readArg("--season");
  const target = requested ?? store.seasonsAwaitingSummary()[0]?.id;

  if (command === "pending") {
    console.log(JSON.stringify(target ? { ok: true, seasonId: target } : { ok: false, reason: "nothing_to_summarize" }));
    process.exit(0);
  }

  if (!target) {
    console.log(JSON.stringify({ ok: false, reason: "nothing_to_summarize" }));
    process.exit(0);
  }

  if (command === "brief") {
    const built = store.summaryBrief(target);
    if (!built) {
      console.log(JSON.stringify({ ok: false, reason: "season_missing" }));
      process.exit(0);
    }
    writeFileSync(briefPath, JSON.stringify({ seasonId: target, hash: built.hash, brief: built.brief }, null, 2));
    console.log(
      JSON.stringify({ ok: true, seasonId: target, briefPath, hash: built.hash, contextBudget: built.brief.contextBudget }),
    );
    process.exit(0);
  }

  const summaryPath = resolve(readArg("--file") ?? defaultSummaryPath);
  if (!existsSync(summaryPath)) {
    console.error(`Summary file does not exist: ${summaryPath}`);
    process.exit(2);
  }
  if (!existsSync(briefPath)) {
    console.error("No brief file. Run brief first.");
    process.exit(2);
  }
  const briefFile = JSON.parse(readFileSync(briefPath, "utf8")) as { seasonId: string; hash: string };
  if (briefFile.seasonId !== target) {
    console.error(`Brief is for ${briefFile.seasonId}, not ${target}.`);
    process.exit(2);
  }
  const result = store.saveSummary({
    seasonId: target,
    authorModel: readArg("--model") ?? "unspecified-observer",
    markdown: readFileSync(summaryPath, "utf8"),
    briefHash: briefFile.hash,
  });
  console.log(JSON.stringify(result));
  if (result.ok) {
    unlinkIfPresent(briefPath);
    unlinkIfPresent(summaryPath);
  } else {
    process.exit(2);
  }
} finally {
  store.close();
}

function readArg(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function unlinkIfPresent(path: string) {
  if (existsSync(path)) unlinkSync(path);
}
