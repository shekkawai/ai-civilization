import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expectedModels,
  buildApiRequest,
  loadCoordinatorConfig,
  modelsMatch,
  pairedClaimsAreBusy,
  parseAnthropicApiJson,
  parseClaudeJson,
  parseCodexJsonl,
  parseOpenAICompatibleJson,
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

describe("paired turn coordinator", () => {
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

  test("builds direct API requests and normalizes provider usage", () => {
    const openaiAdapter = {
      kind: "openai-compatible-api" as const,
      provider: "deepseek-api",
      model: "deepseek-chat",
      reasoning: "provider-default",
      endpoint: "https://api.deepseek.example/chat/completions",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      env: ["DEEPSEEK_API_KEY"],
      maxTokens: 4096,
    };
    const openai = buildApiRequest(openaiAdapter, "private report", {
      DEEPSEEK_API_KEY: "secret-key",
      RANDOM_PERSONAL_SETTING: "private",
    });
    const openaiHeaders = new Headers(openai.init.headers);
    const openaiBody = JSON.parse(String(openai.init.body));
    expect(openai.url).toBe(openaiAdapter.endpoint);
    expect(openaiHeaders.get("authorization")).toBe("Bearer secret-key");
    expect(openaiBody).toMatchObject({
      model: "deepseek-chat",
      messages: [{ role: "system" }, { role: "user", content: "private report" }],
      max_tokens: 4096,
      stream: false,
    });
    expect(String(openai.init.body)).not.toContain("secret-key");
    expect(String(openai.init.body)).not.toContain("RANDOM_PERSONAL_SETTING");
    expect(
      parseOpenAICompatibleJson(JSON.stringify({
        choices: [{ message: { content: [{ type: "text", text: " {\"actions\":[]} " }] } }],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 8,
          prompt_tokens_details: { cached_tokens: 5 },
          completion_tokens_details: { reasoning_tokens: 3 },
        },
      })),
    ).toMatchObject({
      message: '{"actions":[]}',
      usage: { input_tokens: 20, cached_input_tokens: 5, output_tokens: 8, reasoning_output_tokens: 3 },
    });

    const anthropicAdapter = {
      kind: "anthropic-api" as const,
      provider: "anthropic-api",
      model: "configured-anthropic-model",
      reasoning: "provider-default",
      endpoint: "https://api.anthropic.example/v1/messages",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      env: ["ANTHROPIC_API_KEY"],
    };
    const anthropic = buildApiRequest(anthropicAdapter, "private report", {
      ANTHROPIC_API_KEY: "anthropic-secret",
    });
    const anthropicHeaders = new Headers(anthropic.init.headers);
    const anthropicBody = JSON.parse(String(anthropic.init.body));
    expect(anthropicHeaders.get("x-api-key")).toBe("anthropic-secret");
    expect(anthropicHeaders.get("anthropic-version")).toBe("2023-06-01");
    expect(anthropicBody).toMatchObject({
      model: "configured-anthropic-model",
      messages: [{ role: "user", content: "private report" }],
      max_tokens: 8192,
    });
    expect(
      parseAnthropicApiJson(JSON.stringify({
        content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: " {\"actions\":[]} " }],
        usage: { input_tokens: 21, cache_read_input_tokens: 6, output_tokens: 9 },
      })),
    ).toMatchObject({
      message: '{"actions":[]}',
      usage: { input_tokens: 21, cached_input_tokens: 6, output_tokens: 9 },
    });
  });

  test("probes OpenAI-compatible and Anthropic APIs without either CLI", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body = await request.json() as {
          messages: Array<{ role: string; content: string }>;
        };
        const prompt = body.messages.find((message) => message.role === "user")?.content ?? "";
        if (new URL(request.url).pathname === "/openai") {
          return Response.json({
            choices: [{ message: { content: prompt.includes("NORTH-COORDINATOR-READY")
              ? "NORTH-COORDINATOR-READY"
              : "wrong" } }],
            usage: { prompt_tokens: 3, completion_tokens: 1 },
          });
        }
        return Response.json({
          content: [{ type: "text", text: prompt.includes("SOUTH-COORDINATOR-READY")
            ? "SOUTH-COORDINATOR-READY"
            : "wrong" }],
          usage: { input_tokens: 4, output_tokens: 1 },
        });
      },
    });
    const northKey = "AI_CIV_TEST_NORTH_KEY";
    const southKey = "AI_CIV_TEST_SOUTH_KEY";
    const previousNorth = process.env[northKey];
    const previousSouth = process.env[southKey];
    process.env[northKey] = "north-secret";
    process.env[southKey] = "south-secret";
    try {
      const directConfig: CoordinatorConfig = {
        ...config,
        providerTimeoutMs: 5_000,
        slots: {
          north: {
            kind: "openai-compatible-api",
            provider: "direct-openai-compatible",
            model: "north-model",
            reasoning: "provider-default",
            endpoint: `${server.url}openai`,
            apiKeyEnv: northKey,
            env: [northKey],
          },
          south: {
            kind: "anthropic-api",
            provider: "direct-anthropic",
            model: "south-model",
            reasoning: "provider-default",
            endpoint: `${server.url}anthropic`,
            apiKeyEnv: southKey,
            env: [southKey],
          },
        },
      };
      const result = await probeProviders(directConfig);
      expect(result).toMatchObject({
        ok: true,
        north: { sentinel: "NORTH-COORDINATOR-READY", usage: { input_tokens: 3, output_tokens: 1 } },
        south: { sentinel: "SOUTH-COORDINATOR-READY", usage: { input_tokens: 4, output_tokens: 1 } },
      });
    } finally {
      if (previousNorth === undefined) delete process.env[northKey];
      else process.env[northKey] = previousNorth;
      if (previousSouth === undefined) delete process.env[southKey];
      else process.env[southKey] = previousSouth;
      server.stop(true);
    }
  });

  test("requires direct API credentials to be explicitly allowlisted", () => {
    const root = mkdtempSync(join(tmpdir(), "ai-civilization-config-"));
    const path = join(root, "coordinator.json");
    try {
      writeFileSync(path, JSON.stringify({
        slots: {
          north: config.slots.north,
          south: {
            kind: "openai-compatible-api",
            provider: "direct-api",
            model: "model",
            reasoning: "provider-default",
            endpoint: "https://provider.example/v1/chat/completions",
            apiKeyEnv: "PROVIDER_API_KEY",
            env: [],
          },
        },
      }));
      expect(() => loadCoordinatorConfig(path)).toThrow("apiKeyEnv must also appear in south.env");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects credentials in endpoints and unencrypted remote APIs", () => {
    const root = mkdtempSync(join(tmpdir(), "ai-civilization-endpoint-"));
    const path = join(root, "coordinator.json");
    const writeEndpoint = (endpoint: string) => writeFileSync(path, JSON.stringify({
      slots: {
        north: config.slots.north,
        south: {
          kind: "openai-compatible-api",
          provider: "direct-api",
          model: "model",
          reasoning: "provider-default",
          endpoint,
        },
      },
    }));
    try {
      writeEndpoint("https://user:password@provider.example/v1/chat/completions");
      expect(() => loadCoordinatorConfig(path)).toThrow("endpoint must not contain credentials");
      writeEndpoint("http://provider.example/v1/chat/completions");
      expect(() => loadCoordinatorConfig(path)).toThrow("endpoint must use HTTPS unless it is a loopback address");
      writeEndpoint("http://127.0.0.1:11434/v1/chat/completions");
      expect(loadCoordinatorConfig(path).slots.south.endpoint).toBe("http://127.0.0.1:11434/v1/chat/completions");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

    const apiConfig: CoordinatorConfig = {
      ...config,
      slots: {
        ...config.slots,
        south: {
          kind: "openai-compatible-api",
          provider: "direct-api",
          model: "model",
          reasoning: "provider-default",
          endpoint: "https://provider.example/v1/chat/completions",
          apiKeyEnv: "ANTHROPIC_API_KEY",
          env: ["ANTHROPIC_API_KEY"],
        },
      },
    };
    const api = providerEnvironment(apiConfig, "south", source);
    expect(api).toEqual({ ANTHROPIC_API_KEY: "metered-key" });
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
