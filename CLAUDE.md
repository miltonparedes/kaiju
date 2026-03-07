# Kaiju

Tool to divide, visualize, and share giant PRs.

## Architecture

Bun workspaces monorepo with three packages:

| Package         | Name        | Purpose                                                       |
| --------------- | ----------- | ------------------------------------------------------------- |
| `packages/core` | @kaiju/core | Types, SQLite store (Drizzle), git providers, splitter engine |
| `packages/cli`  | @kaiju/cli  | Commander.js CLI                                              |
| `packages/web`  | @kaiju/web  | TanStack Start web UI                                         |

## Commands

| Command                    | Description                 |
| -------------------------- | --------------------------- |
| `bun run lint`             | Lint with oxlint            |
| `bun run fmt`              | Format with oxfmt           |
| `bun run fmt:check`        | Check formatting            |
| `bun run typecheck`        | TypeScript type checking    |
| `bun run test`             | Run all tests               |
| `bun run test:unit`        | Run unit tests only         |
| `bun run test:integration` | Run integration tests only  |
| `bun run test:e2e`         | Run Playwright e2e tests    |
| `bun run dev:web`          | Start web dev server        |
| `bun run dev:cli`          | Run CLI                     |
| `bun run db:generate`      | Generate Drizzle migrations |
| `bun run db:migrate`       | Run Drizzle migrations      |
| `bun run db:studio`        | Open Drizzle Studio         |

## Code Conventions

### Formatting

- oxfmt: single quotes, semicolons, trailing commas, 100 char width
- Sort imports with @kaiju/ as internal

### Linting

- oxlint with typescript, react, import, unicorn plugins
- Correctness errors are hard failures; suspicious/perf/style are warnings

### Testing

- Unit tests: `*.test.ts` — fast, no I/O
- Integration tests: `*.integration.test.ts` — may use DB, filesystem
- E2E tests: `packages/web/e2e/*.spec.ts` — Playwright, browser-based
- Vitest projects config at root: "unit" and "integration"

### Database

- Drizzle ORM with bun:sqlite
- Schema in `packages/core/src/store/schema.ts`
- Migrations via `drizzle-kit` in `packages/core/drizzle/`

### CSS

- Tailwind CSS v4 with CSS-first config
- Import via `@import 'tailwindcss'` in app.css
- Use `@tailwindcss/vite` plugin

### Components

- shadcn/ui with New York style, neutral base color
- Add components: `cd packages/web && bunx shadcn@latest add <component>`
- Utility: `cn()` from `@/lib/utils`

## File Naming

- Source files: `camelCase.ts` / `camelCase.tsx`
- Test files: `<name>.test.ts` or `<name>.integration.test.ts`
- Route files: follow TanStack Router conventions (`__root.tsx`, `index.tsx`)
- Generated files: `*.gen.ts` (excluded from linting)

## Import Conventions

- Use `.js` extensions in relative imports (ESM requirement)
- Use `@kaiju/core` for cross-package imports
- Use `@/*` path alias in web package for internal imports
