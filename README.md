# Kaiju

Tool to divide, visualize, and share giant PRs.

Kaiju fetches pull request data from GitHub (or local git diffs), splits the
changeset into reviewable chunks, and serves a web UI for navigating diffs,
leaving findings, and tracking review progress.

## Prerequisites

- [Bun](https://bun.sh/) (runtime and package manager)
- [gh](https://cli.github.com/) CLI (for fetching GitHub PRs)

## Quick Start

```bash
# Install dependencies
bun install

# Review a GitHub PR (fetches, splits, and opens the web UI)
bun run dev:cli review https://github.com/owner/repo/pull/123

# Or review a local diff between branches
bun run dev:cli fetch --diff main..feature
bun run dev:cli split
bun run dev:cli show
```

## CLI Commands

| Command                                   | Description                              |
| ----------------------------------------- | ---------------------------------------- |
| `kaiju fetch <url>`                       | Fetch PR data from a GitHub URL          |
| `kaiju fetch --diff [range]`              | Fetch a local git diff between branches  |
| `kaiju split [--strategy] [--max-tokens]` | Split PR into reviewable chunks          |
| `kaiju review <url>`                      | Fetch + split + open web UI (all-in-one) |
| `kaiju show`                              | Open web dashboard (context-aware)       |
| `kaiju show --all`                        | Open web dashboard for all reviews       |
| `kaiju files`                             | List files in a review                   |
| `kaiju cat <chunk>`                       | Show chunk contents                      |
| `kaiju status`                            | Show review status with progress         |
| `kaiju ls`                                | List all reviews                         |

All commands support `--json` for machine-readable output.

Split strategies: `directory` (default), `plan`, `single-file`. Use
`--max-tokens` to control chunk size.

## Web UI

The web interface is built with TanStack Start and provides:

- Dashboard with repository-context filtering
- Three-panel resizable layout: chunk list, syntax-highlighted diff, review summary
- Split and unified diff views (powered by @pierre/diffs)
- Inline findings and comments with code suggestions
- Keyboard shortcuts: `j`/`k` navigate chunks, `n`/`p` navigate files,
  `m` mark complete, `1`/`2`/`3` focus panels, `?` show help
- Dark theme
- Review progress persistence

## Architecture

Bun workspaces monorepo with three packages:

| Package         | Name        | Purpose                                                       |
| --------------- | ----------- | ------------------------------------------------------------- |
| `packages/core` | @kaiju/core | Types, SQLite store (Drizzle), git providers, splitter engine |
| `packages/cli`  | @kaiju/cli  | Commander.js CLI                                              |
| `packages/web`  | @kaiju/web  | TanStack Start web UI                                         |

### Store

Kaiju uses a dual-layer store. Every write updates both JSON files on disk
(`~/.kaiju/reviews/`) and a SQLite database (`~/.kaiju/kaiju.db`) with FTS5
full-text search. The schema covers 7 tables: reviews, files, imports, chunks,
chunk_deps, comments, and findings. Recovery commands (`rebuild-index`,
`regenerate-files`) can reconstruct either layer from the other.

### Providers

- **GitHub**: fetches PRs via the `gh` CLI with pagination, comments, and
  review threads.
- **Local**: generates diffs from `git diff` between branches.

### Splitter

Three strategies for dividing a changeset into chunks:

- `directory` -- groups files by directory
- `plan` -- groups files by logical plan
- `single-file` -- one file per chunk

Token estimation and `--max-tokens` control chunk size.

## Development

```bash
bun run lint             # Lint with oxlint
bun run fmt              # Format with oxfmt
bun run fmt:check        # Check formatting
bun run typecheck        # TypeScript type checking
bun run test             # Run all tests
bun run test:unit        # Unit tests only
bun run test:integration # Integration tests only
bun run test:e2e         # Playwright e2e tests
bun run dev:web          # Start web dev server
bun run dev:cli          # Run CLI
bun run db:generate      # Generate Drizzle migrations
bun run db:migrate       # Run Drizzle migrations
bun run db:studio        # Open Drizzle Studio
```

## License

MIT
