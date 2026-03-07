# Kaiju

Divide, visualize, and share giant PRs.

## Quick Start

```bash
# Install dependencies
bun install

# Run the web UI
bun run dev:web

# Use the CLI
bun run dev:cli --help
```

## Architecture

```
packages/
  core/   @kaiju/core   — Types, SQLite store, git providers, splitter engine
  cli/    @kaiju/cli    — Commander.js CLI
  web/    @kaiju/web    — TanStack Start web UI
```

## Development

```bash
bun run lint          # Lint with oxlint
bun run fmt           # Format with oxfmt
bun run typecheck     # TypeScript type checking
bun run test:unit     # Unit tests
bun run test:integration  # Integration tests
bun run test:e2e      # E2E tests (Playwright)
```

## License

MIT
