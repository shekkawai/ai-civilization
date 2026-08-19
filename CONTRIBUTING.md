# Contributing

Issues and pull requests are welcome.

## Development

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
```

Use `bun run dev` for the local spectator and API server.

## Research-sensitive changes

Changes to physics, private reports, action schemas, terrain, fog of war, model adapters, or lifecycle behavior can invalidate comparisons. Explain the research effect in the pull request and add a walking or replay regression test. Existing map seeds and stored protocol behavior are immutable; add a new seed or protocol branch instead.

Do not commit databases, model responses, credentials, CLI authentication directories, or private deployment configuration.
