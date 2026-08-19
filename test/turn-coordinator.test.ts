import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expectedModels,
  modelsMatch,
  pairedClaimsAreBusy,
  parseClaudeJson,
  parseCodexJsonl,
  probeProviders,
  providerEnvironment,
  type CoordinatorConfig,
} from "../scripts/turn-coordinator";
import { DEFAULT_SEASON_CONFIG } from "../src/research/store";

const config: CoordinatorConfig = {
  database: "/tmp/research.sqlite",
  runtimeRoot: "/tmp/ai-civilization-runtime",
  cadenceMs: 300_000,
  providerTimeoutMs: 600_000,
  slots: {
    north: {
      kind: "claude-cli",
      provider: "claude-cli",
      model: "sonnet",
      reasoning: "xhigh",
      env: ["CLAUDE_CODE_OAUTH_TOKEN"],
    },
    south: {
      kind: "codex-cli",
      provider: "codex-cli-zai",
      model: "glm-5.3",
      reasoning: "high",
      profile: "zai",
      env: ["Z_AI_API_KEY"],
    },
  },
};

describe("native-plan turn coordinator", () => {
  test("names a missing provider CLI and its config key instead of a spawn stack", async () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), "ai-civilization-probe-"));
    try {
      const missing: CoordinatorConfig = {
        ...config,
        runtimeRoot,
        slots: {
          north: { ...config.slots.north, executable: join(runtimeRoot, "absent-claude") },
          south: { ...config.slots.south, executable: join(runtimeRoot, "absent-codex") },
        },
      };
      const failure = await probeProviders(missing).then(
        () => null,
        (error: unknown) => error as Error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure!.message).toContain("absent-claude");
      expect(failure!.message).toContain("slots.north.executable");
      expect(failure!.message).not.toContain("posix_spawn");
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("requires season metadata to match both configured adapters", () => {
    expect(modelsMatch(DEFAULT_SEASON_CONFIG, config)).toBe(false);
    expect(modelsMatch({ ...DEFAULT_SEASON_CONFIG, models: expectedModels(config) }, config)).toBe(true);
  });

  test("extracts Claude and Codex messages without logging prompts", () => {
    expect(parseClaudeJson(JSON.stringify({ result: "  {\"actions\":[]}  ", usage: { input_tokens: 12 } }))).toEqual({
      message: '{"actions":[]}',
      usage: { input_tokens: 12 },
    });
    const codex = [
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "old" } }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: " final " } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 15, reasoning_output_tokens: 2 } }),
    ].join("\n");
    expect(parseCodexJsonl(codex)).toEqual({
      message: "final",
      usage: { input_tokens: 15, reasoning_output_tokens: 2 },
    });
  });

  test("allowlists provider environments and excludes unrelated personal settings", () => {
    const source = {
      PATH: "/bin",
      USER: "test",
      ANTHROPIC_API_KEY: "metered-key",
      CLAUDE_CODE_OAUTH_TOKEN: "subscription-token",
      Z_AI_API_KEY: "zai-key",
      RANDOM_PERSONAL_SETTING: "private",
    };
    const claude = providerEnvironment(config, "north", source);
    const codex = providerEnvironment(config, "south", source);
    expect(claude.CLAUDE_CODE_OAUTH_TOKEN).toBe("subscription-token");
    expect(claude.ANTHROPIC_API_KEY).toBeUndefined();
    expect(claude.Z_AI_API_KEY).toBeUndefined();
    expect(claude.RANDOM_PERSONAL_SETTING).toBeUndefined();
    expect(claude.CLAUDE_CODE_DISABLE_CLAUDE_MDS).toBe("1");
    expect(codex.Z_AI_API_KEY).toBe("zai-key");
    expect(codex.ANTHROPIC_API_KEY).toBeUndefined();
    expect(codex.RANDOM_PERSONAL_SETTING).toBeUndefined();
  });

  test("waits when a restarted process finds both claims still leased", () => {
    expect(
      pairedClaimsAreBusy(
        { ok: false, reason: "busy", seasonId: "season", turn: 45, civ: "north" },
        { ok: false, reason: "busy", seasonId: "season", turn: 45, civ: "south" },
      ),
    ).toBe(true);
    expect(
      pairedClaimsAreBusy(
        { ok: false, reason: "busy", seasonId: "season", turn: 45, civ: "north" },
        { ok: false, reason: "season_inactive", seasonId: "season", turn: 45, civ: "south" },
      ),
    ).toBe(false);
  });
});
