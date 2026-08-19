# AI Civilization

Two language models run separate civilizations in one deterministic world. They see only what their own people have observed, decide from the same frozen turn snapshot, and receive no instruction to compete, cooperate, explore, or make contact.

[View the reference spectator](https://ai-civilization-live-omp.zocomputer.io)

## The experiment

The central question is simple: what do autonomous decision-makers do when scarcity, logistics, another population, and the possibility of interference emerge from the world rather than from the prompt?

The player interface deliberately has no aggression verb. The neutral `remove` action means “take blocks apart and recover material.” It works on any reachable exposed block, but the system never frames another civilization as an enemy or gives the models a victory condition.

Every model receives:

- its own workers, structures, resources, and action results;
- currently visible ground plus stale memory of previously observed ground;
- explicit physics, costs, capacities, timing, and command semantics;
- its own standing orders, notebook, chronicle, and latest journal;
- another civilization only after genuine first sight.

It never receives unseen locations, hidden quantities, map bounds, spectator analysis, or operator commentary.

## What is included

- A deterministic TypeScript simulation engine with fog of war, physical carrying, storage, construction, population pressure, resource scarcity, correspondence, and neutral block removal.
- A SQLite research ledger containing immutable prompts, responses, validation results, world hashes, action outcomes, and replay frames.
- A paired coordinator that launches both native subscription CLIs concurrently from one frozen snapshot, validates locally, repairs at most once, submits both decisions, and verifies replay.
- A bilingual React spectator that separates world truth, each civilization's belief, engine facts, and model-authored claims.
- Regression tests for replay integrity, information leaks, routing, logistics, lifecycle safety, and spectator calculations.

No live databases, provider credentials, model responses, private operations, or deployment history are included in this repository.

## Architecture

```text
scripts/turn-coordinator.ts  Paired native-CLI orchestration and lifecycle safety
src/sim/                    Deterministic world engine
src/research/report.ts      Private player report and strict decision schema
src/research/store.ts       SQLite turn controller, ledger, and replay verifier
src/v3/                     Current spectator interface
server.ts                   Hono API plus Vite/production serving
test/                       Engine, research, coordinator, and UI regressions
```

The coordinator is not involved in world resolution. It only obtains two decisions. The engine validates and resolves the turn locally, so no third model call is needed.

## Requirements

- Bun 1.3 or newer
- One supported CLI per seat:
  - Claude Code CLI, or
  - Codex CLI, including compatible Codex profiles such as Z.AI
- Credentials or subscription authentication for those CLIs

Native-plan runs measure a model together with its CLI harness. They are not identical to minimal-API model comparisons. Record the adapter, model, reasoning level, and CLI version with every season.

## Install and verify

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
```

Start the local spectator and API:

```bash
bun run dev
```

The default address is `http://localhost:3000`.

## Configure the coordinator

Copy the examples:

```bash
cp .env.example .env
cp coordinator.example.json coordinator.json
```

`coordinator.json` defines both seats. Each seat records the exact `provider`, `model`, and `reasoning` labels that must also appear in the season. A mismatch pauses the season before any model call.

Supported adapter kinds:

| Kind | Execution | Isolation |
| --- | --- | --- |
| `claude-cli` | `claude -p` with tools disabled, safe mode, no session persistence | Empty working directory, dedicated home, Claude memory disabled |
| `codex-cli` | `codex exec` with an optional profile | Empty working directory, dedicated `CODEX_HOME`, read-only sandbox |

Only the environment variable names listed in a seat's `env` array are passed through. Values stay in the process environment; do not put credentials in JSON or TOML files.

The included example runs Claude on the north seat and GLM through a Codex `zai` profile on the south seat. `config/codex-zai.toml` contains provider metadata only and reads the key from `Z_AI_API_KEY`.

Use separate authentication/configuration directories for the game. This prevents personal `CLAUDE.md`, `AGENTS.md`, Codex settings, and unrelated environment variables from entering a decision.

Probe both adapters before creating a season:

```bash
bun run coordinator:probe
```

## Create a season

Write routes use bearer authentication when `AI_CIVILIZATION_SECRET` is set. In production, writes are disabled when the secret is absent.

The season's model labels must match `coordinator.json` exactly:

```bash
curl -X POST http://localhost:3000/api/research/season \
  -H "Authorization: Bearer $AI_CIVILIZATION_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "seed": 20260821,
    "id": "my-first-season",
    "maxTurns": 250,
    "models": {
      "north": {"provider":"claude-cli","model":"sonnet","reasoning":"xhigh"},
      "south": {"provider":"codex-cli-zai","model":"glm-5.3","reasoning":"high"}
    }
  }'
```

Run one paired turn:

```bash
bun run coordinator:once
```

Or run continuously at the configured cadence:

```bash
bun run coordinator
```

The coordinator pauses the season on a binding mismatch, provider failure, timeout, failed submission, or replay mismatch. A partial pair never resolves the world.

## Data and reproducibility

Runtime data defaults to `data/research.sqlite` and is ignored by Git. Each resolved turn stores:

- the shared before-turn snapshot and hash;
- both private prompts and model bindings;
- original and repaired responses;
- validation and action results;
- the resolved world and hash;
- compact spectator statistics.

The replay verifier regenerates the world from the season seed and checks every stored hash. Existing seeds and protocol behavior are immutable. Physics or terrain changes require a new protocol branch or seed variant.

One season is one stochastic sample, not a general model ranking. Changes to a model, seat, world, player interface, reasoning level, or harness are separate experimental factors and should be labelled as such.

## HTTP API

Read routes are public by design:

- `GET /api/research/status`
- `GET /api/research/seasons`
- `GET /api/research/spectator`
- `GET /api/research/replay`
- `GET /api/research/verify`
- `GET /api/research/archive`

Bearer-protected write routes:

- `POST /api/research/season`
- `POST /api/research/claim`
- `POST /api/research/submit`
- `POST /api/research/control`

## Contributing

Read `AGENTS.md` before changing the engine or player interface. Research-sensitive changes need a regression test and a clear statement of which experimental factor changes. See `CONTRIBUTING.md` and `SECURITY.md`.

## License

Apache License 2.0. See `LICENSE`.
