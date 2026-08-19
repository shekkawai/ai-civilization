# Repository guidance

Read `README.md` before changing the engine, coordinator, research store, or spectator.

## Research boundary

- Never add an aggression verb to the player action list, prompt, or failure text. The neutral verb is `remove`: take blocks apart and recover material.
- Player reports may explain physics, costs, timing, and command semantics. They must not disclose unseen locations, quantities, map bounds, another civilization before first sight, human analysis, or observer commentary.
- Model-authored notes are evidence about the model, not verified world facts.
- Both players decide from one immutable snapshot. The second valid submission resolves the turn exactly once.

## Replay integrity

- Never change the terrain produced by an existing seed. Add a new seed variant.
- Gate replay-affecting behavior by protocol version and update the rules hash.
- Preserve deterministic ordering. Do not rely on JavaScript object insertion order.
- A physics or interface correction discovered during a season requires a new season; do not rewrite stored history.

## Runtime safety

- Keep databases, credentials, CLI homes, generated profiles, and provider output under ignored paths.
- The coordinator must use empty working directories and explicit environment allowlists.
- Never log prompts, credentials, bearer headers, or full provider environments.
- A provider, binding, submission, or replay failure pauses the season. Do not resolve a partial pair.

## Verification

Run before every pull request:

```bash
bun run typecheck
bun run test
bun run build
```
