import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { decodeWorld } from "../src/research/codec";
import { parseModelDecision } from "../src/research/report";
import { ResearchStore, type SeasonConfig } from "../src/research/store";
import type { CivId } from "../src/sim/types";

type AdapterKind = "claude-cli" | "codex-cli";

export interface AdapterConfig {
  kind: AdapterKind;
  provider: string;
  model: string;
  reasoning: string;
  executable?: string;
  env?: string[];
  home?: string;
  profile?: string;
  profileConfigPath?: string;
}

export interface CoordinatorConfigFile {
  database?: string;
  runtimeRoot?: string;
  cadenceMs?: number;
  providerTimeoutMs?: number;
  slots: Record<CivId, AdapterConfig>;
}

export interface CoordinatorConfig {
  database: string;
  runtimeRoot: string;
  cadenceMs: number;
  providerTimeoutMs: number;
  slots: Record<CivId, AdapterConfig>;
}

interface Usage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  [key: string]: unknown;
}

interface ProviderResult {
  message: string;
  usage: Usage;
}

const CIVS: CivId[] = ["north", "south"];
const DEFAULT_CADENCE_MS = 5 * 60 * 1000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 10 * 60 * 1000;

function validateAdapter(civ: CivId, adapter: AdapterConfig) {
  if (adapter.kind !== "claude-cli" && adapter.kind !== "codex-cli") {
    throw new Error(`${civ}.kind must be claude-cli or codex-cli`);
  }
  for (const key of ["provider", "model", "reasoning"] as const) {
    if (!adapter[key]?.trim()) throw new Error(`${civ}.${key} is required`);
  }
  if (adapter.profileConfigPath && adapter.kind !== "codex-cli") {
    throw new Error(`${civ}.profileConfigPath is only valid for codex-cli`);
  }
}

export function loadCoordinatorConfig(
  path = process.env.COORDINATOR_CONFIG ?? resolve(process.cwd(), "coordinator.json"),
): CoordinatorConfig {
  const absolutePath = resolve(path);
  const base = dirname(absolutePath);
  const raw = JSON.parse(readFileSync(absolutePath, "utf8")) as CoordinatorConfigFile;
  if (!raw.slots?.north || !raw.slots?.south) throw new Error("Coordinator config needs north and south slots");
  for (const civ of CIVS) validateAdapter(civ, raw.slots[civ]);

  const runtimeRoot = resolve(base, raw.runtimeRoot ?? "data/coordinator-runtime");
  const slots = Object.fromEntries(
    CIVS.map((civ) => {
      const adapter = raw.slots[civ];
      return [
        civ,
        {
          ...adapter,
          home: adapter.home ? resolve(base, adapter.home) : undefined,
          profileConfigPath: adapter.profileConfigPath
            ? resolve(base, adapter.profileConfigPath)
            : undefined,
        },
      ];
    }),
  ) as Record<CivId, AdapterConfig>;

  return {
    database: resolve(base, raw.database ?? "data/research.sqlite"),
    runtimeRoot,
    cadenceMs: raw.cadenceMs ?? DEFAULT_CADENCE_MS,
    providerTimeoutMs: raw.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
    slots,
  };
}

export function expectedModels(config: CoordinatorConfig): SeasonConfig["models"] {
  return Object.fromEntries(
    CIVS.map((civ) => {
      const adapter = config.slots[civ];
      return [civ, { provider: adapter.provider, model: adapter.model, reasoning: adapter.reasoning }];
    }),
  ) as SeasonConfig["models"];
}

export function modelsMatch(season: SeasonConfig, coordinator: CoordinatorConfig) {
  const expected = expectedModels(coordinator);
  return CIVS.every((civ) => {
    const actual = season.models[civ];
    return (
      actual.provider === expected[civ].provider &&
      actual.model === expected[civ].model &&
      actual.reasoning === expected[civ].reasoning
    );
  });
}

export function parseCodexJsonl(output: string): ProviderResult {
  let message = "";
  let usage: Usage = {};
  for (const line of output.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    const event = JSON.parse(line) as {
      type?: string;
      item?: { type?: string; text?: string };
      usage?: Usage;
    };
    if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
      message = event.item.text;
    }
    if (event.type === "turn.completed" && event.usage) usage = event.usage;
  }
  if (!message) throw new Error("Codex returned no agent message");
  return { message: message.trim(), usage };
}

export function parseClaudeJson(output: string): ProviderResult {
  const event = JSON.parse(output) as {
    result?: unknown;
    is_error?: boolean;
    usage?: Usage;
    modelUsage?: Record<string, Usage>;
  };
  if (event.is_error) throw new Error("Claude returned an error result");
  if (typeof event.result !== "string" || !event.result.trim()) throw new Error("Claude returned no result");
  const modelUsage = event.modelUsage ? Object.values(event.modelUsage)[0] : undefined;
  return { message: event.result.trim(), usage: event.usage ?? modelUsage ?? {} };
}

function compactEnvironment(input: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => Boolean(entry[1])));
}

function baseEnvironment(source: NodeJS.ProcessEnv) {
  return {
    PATH: source.PATH,
    USER: source.USER,
    LANG: source.LANG,
    LC_ALL: source.LC_ALL,
    TMPDIR: source.TMPDIR,
  };
}

function configuredEnvironment(adapter: AdapterConfig, source: NodeJS.ProcessEnv) {
  return Object.fromEntries((adapter.env ?? []).map((name) => [name, source[name]]));
}

function workdir(config: CoordinatorConfig, civ: CivId) {
  return resolve(config.runtimeRoot, "workdirs", civ);
}

function adapterHome(config: CoordinatorConfig, civ: CivId) {
  return config.slots[civ].home ?? resolve(config.runtimeRoot, "homes", civ);
}

export function providerEnvironment(
  config: CoordinatorConfig,
  civ: CivId,
  source: NodeJS.ProcessEnv = process.env,
) {
  const adapter = config.slots[civ];
  const extra = configuredEnvironment(adapter, source);
  if (adapter.kind === "claude-cli") {
    return compactEnvironment({
      ...baseEnvironment(source),
      ...extra,
      HOME: adapterHome(config, civ),
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
      CLAUDE_CODE_SAFE_MODE: "1",
    });
  }
  return compactEnvironment({
    ...baseEnvironment(source),
    ...extra,
    HOME: workdir(config, civ),
    CODEX_HOME: adapterHome(config, civ),
  });
}

function prepareRuntime(config: CoordinatorConfig) {
  for (const civ of CIVS) {
    const adapter = config.slots[civ];
    mkdirSync(workdir(config, civ), { recursive: true, mode: 0o700 });
    mkdirSync(adapterHome(config, civ), { recursive: true, mode: 0o700 });
    if (adapter.kind === "codex-cli" && adapter.profileConfigPath) {
      const filename = adapter.profile ? `${adapter.profile}.config.toml` : "config.toml";
      writeFileSync(
        resolve(adapterHome(config, civ), filename),
        readFileSync(adapter.profileConfigPath, "utf8"),
        { mode: 0o600 },
      );
    }
  }
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:sk|key|token)[-_][A-Za-z0-9._-]{12,}/gi, "[redacted]")
    .slice(0, 2000);
}

async function runProcess(
  command: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
) {
  const child = Bun.spawn(command, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).finally(() => clearTimeout(timeout));
  if (timedOut) throw new Error(`Provider exceeded ${timeoutMs} ms timeout`);
  if (exitCode !== 0) throw new Error(`Provider exited ${exitCode}: ${stderr.slice(0, 1200)}`);
  return { stdout, stderr };
}

function decisionInstruction(report: string) {
  return [
    "Make exactly one AI Civilization decision.",
    "Do not use tools, read files, inspect a repository, browse, or use outside information.",
    "Use only the authoritative private report below.",
    "Return exactly one JSON object matching the report's schema, without a Markdown fence or explanation.",
    "",
    report,
  ].join("\n");
}

function repairInstruction(report: string, raw: string, error: string) {
  return [
    "Correct the invalid AI Civilization decision below.",
    "Do not use tools or outside information.",
    `Validation error: ${error}`,
    "Return only the corrected JSON object without a Markdown fence or explanation.",
    "",
    "AUTHORITATIVE PRIVATE REPORT:",
    report,
    "",
    "INVALID RESPONSE:",
    raw,
  ].join("\n");
}

async function callProvider(config: CoordinatorConfig, civ: CivId, prompt: string) {
  const adapter = config.slots[civ];
  const cwd = workdir(config, civ);
  const env = providerEnvironment(config, civ);
  if (adapter.kind === "claude-cli") {
    const result = await runProcess(
      [
        adapter.executable ?? "claude",
        "-p",
        "--model",
        adapter.model,
        "--effort",
        adapter.reasoning,
        "--tools",
        "",
        "--disable-slash-commands",
        "--system-prompt",
        "Use only the supplied simulation report. Return only the requested JSON object. Do not use tools or outside information.",
        "--output-format",
        "json",
        "--no-session-persistence",
        "--safe-mode",
        prompt,
      ],
      cwd,
      env,
      config.providerTimeoutMs,
    );
    return parseClaudeJson(result.stdout);
  }

  const profile = adapter.profile ? ["-p", adapter.profile] : [];
  const result = await runProcess(
    [
      adapter.executable ?? "codex",
      "exec",
      ...profile,
      "--strict-config",
      "--ephemeral",
      "-C",
      cwd,
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--json",
      "-m",
      adapter.model,
      "-c",
      `model_reasoning_effort=\"${adapter.reasoning}\"`,
      prompt,
    ],
    cwd,
    env,
    config.providerTimeoutMs,
  );
  return parseCodexJsonl(result.stdout);
}

export async function probeProviders(config = loadCoordinatorConfig()) {
  prepareRuntime(config);
  const sentinels = { north: "NORTH-COORDINATOR-READY", south: "SOUTH-COORDINATOR-READY" } as const;
  const results = await Promise.all(
    CIVS.map((civ) => callProvider(config, civ, `Return exactly ${sentinels[civ]} and nothing else. Do not use tools.`)),
  );
  for (const [index, civ] of CIVS.entries()) {
    if (results[index].message !== sentinels[civ]) throw new Error(`${civ} readiness sentinel mismatch`);
  }
  return {
    ok: true,
    north: { sentinel: sentinels.north, usage: results[0].usage },
    south: { sentinel: sentinels.south, usage: results[1].usage },
  };
}

export async function runCoordinatorCycle(config = loadCoordinatorConfig()) {
  prepareRuntime(config);
  const store = new ResearchStore(config.database);
  try {
    const season = store.latestSeason();
    if (!season || season.status !== "active") return { ok: false, reason: "no_active_season" };
    const seasonConfig = JSON.parse(season.config_json) as SeasonConfig;
    if (!modelsMatch(seasonConfig, config)) {
      store.pauseSeason(season.id);
      return {
        ok: false,
        reason: "model_mismatch",
        seasonId: season.id,
        expected: expectedModels(config),
        actual: seasonConfig.models,
      };
    }
    const lifecycle = store.reviewLatestSeason();
    if (lifecycle.action !== "continue") {
      store.pauseSeason(season.id);
      return { ok: false, reason: lifecycle.reason, seasonId: season.id };
    }

    const north = store.claimDecision(season.id, "north");
    const south = store.claimDecision(season.id, "south");
    if (!north.ok || !south.ok || north.turn !== south.turn || north.snapshotHash !== south.snapshotHash) {
      store.pauseSeason(season.id);
      return { ok: false, reason: "paired_claim_failed", seasonId: season.id, north, south };
    }

    const turn = store.getTurn(season.id, north.turn!);
    if (!turn) throw new Error("Claimed turn no longer exists");
    const world = decodeWorld(turn.snapshot_json);
    const claims = { north, south };
    const startedAt = Date.now();
    const originals = await Promise.allSettled(
      CIVS.map((civ) => callProvider(config, civ, decisionInstruction(claims[civ].prompt!))),
    );

    if (originals.some((result) => result.status === "rejected")) {
      for (const [index, civ] of CIVS.entries()) {
        const result = originals[index];
        const error = result.status === "rejected"
          ? `Provider failure: ${safeError(result.reason)}`
          : "Counterpart provider failed before paired submission; response discarded";
        store.failDecision({
          seasonId: season.id,
          turn: north.turn!,
          civ,
          leaseToken: claims[civ].leaseToken!,
          error,
          rawResponse: result.status === "fulfilled" ? result.value.message : undefined,
        });
      }
      store.pauseSeason(season.id);
      return { ok: false, reason: "provider_failure", seasonId: season.id, turn: north.turn };
    }

    const originalByCiv = Object.fromEntries(
      CIVS.map((civ, index) => [civ, (originals[index] as PromiseFulfilledResult<ProviderResult>).value]),
    ) as Record<CivId, ProviderResult>;
    const repairs = await Promise.allSettled(
      CIVS.map(async (civ) => {
        const parsed = parseModelDecision(civ, originalByCiv[civ].message, world);
        if (parsed.ok) return undefined;
        return callProvider(
          config,
          civ,
          repairInstruction(claims[civ].prompt!, originalByCiv[civ].message, parsed.error ?? "Invalid response"),
        );
      }),
    );
    if (repairs.some((result) => result.status === "rejected")) {
      for (const [index, civ] of CIVS.entries()) {
        const result = repairs[index];
        const error = result.status === "rejected"
          ? `Repair provider failure: ${safeError(result.reason)}`
          : "Counterpart repair failed before paired submission; response discarded";
        store.failDecision({
          seasonId: season.id,
          turn: north.turn!,
          civ,
          leaseToken: claims[civ].leaseToken!,
          error,
          rawResponse: originalByCiv[civ].message,
        });
      }
      store.pauseSeason(season.id);
      return { ok: false, reason: "repair_provider_failure", seasonId: season.id, turn: north.turn };
    }
    const repairByCiv = Object.fromEntries(
      CIVS.map((civ, index) => [civ, (repairs[index] as PromiseFulfilledResult<ProviderResult | undefined>).value]),
    ) as Record<CivId, ProviderResult | undefined>;

    const submissions = CIVS.map((civ) =>
      store.submitDecision({
        seasonId: season.id,
        turn: north.turn!,
        civ,
        leaseToken: claims[civ].leaseToken!,
        submissionKey: `${season.id}:${north.turn}:${civ}`,
        rawResponse: originalByCiv[civ].message,
        repairedResponse: repairByCiv[civ]?.message,
        startedAt,
        completedAt: Date.now(),
      }),
    );
    if (submissions.some((submission) => !(submission as { ok?: boolean }).ok)) {
      store.pauseSeason(season.id);
      return { ok: false, reason: "submission_failure", seasonId: season.id, turn: north.turn, submissions };
    }
    const replay = store.verifyReplay(season.id);
    if (!replay.ok) {
      store.pauseSeason(season.id);
      return { ok: false, reason: "replay_failure", seasonId: season.id, turn: north.turn, replay };
    }
    const finalSeason = store.getSeason(season.id);
    return {
      ok: true,
      seasonId: season.id,
      turn: north.turn,
      snapshotHash: north.snapshotHash,
      status: finalSeason?.status,
      repaired: { north: Boolean(repairByCiv.north), south: Boolean(repairByCiv.south) },
      usage: {
        north: { original: originalByCiv.north.usage, repair: repairByCiv.north?.usage },
        south: { original: originalByCiv.south.usage, repair: repairByCiv.south?.usage },
      },
      replay,
    };
  } catch (error) {
    const season = store.latestSeason();
    if (season?.status === "active") store.pauseSeason(season.id);
    return { ok: false, reason: "coordinator_error", error: safeError(error), seasonId: season?.id };
  } finally {
    store.close();
  }
}

async function main() {
  const config = loadCoordinatorConfig();
  if (process.argv.includes("--probe")) {
    console.log(JSON.stringify(await probeProviders(config)));
    return;
  }
  const once = process.argv.includes("--once") || process.env.COORDINATOR_RUN_ONCE === "1";
  do {
    const startedAt = Date.now();
    console.log(JSON.stringify({ timestamp: new Date(startedAt).toISOString(), ...(await runCoordinatorCycle(config)) }));
    if (once) break;
    await Bun.sleep(Math.max(0, config.cadenceMs - (Date.now() - startedAt)));
  } while (true);
}

if (import.meta.main) await main();
