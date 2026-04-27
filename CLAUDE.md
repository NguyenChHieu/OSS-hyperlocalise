# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context for AI Agents

A detailed project context file with critical implementation rules is maintained at `_bmad-output/project-context.md`. Read it before implementing any code — it covers unobvious patterns for Hono, Drizzle, Next.js 16, WorkOS auth, encryption, testing, and Go linting that are easy to get wrong.

## What This Project Is

**Hyperlocalise** is an AI-native localization infrastructure CLI written in Go, combined with a Next.js web management UI. It provides local-first translation generation, CI drift detection, and pluggable TMS (Translation Management System) adapters.

## Monorepo Layout

- `apps/cli/` — Main CLI application (Go + Cobra)
- `apps/hyperlocalise-web/` — Web management UI (Next.js + Hono)
- `internal/i18n/` — Shared localization packages: parsers, translators, storage adapters
- `pkg/` — Platform packages: `i18nconfig`, `auth`, `observability`, `transport`
- `api/proto/` — Protobuf contracts
- `docs/` — Mintlify product documentation

## CLI Commands (Go)

```bash
# Bootstrap once after cloning
make bootstrap

# Daily workflow
make fmt          # gofumpt + gci
make lint         # golangci-lint
make test-workspace  # tests with coverage
make check-build  # verify build
make precommit    # fmt → lint → test → build (run before committing)

# Run / install
make run
make install      # installs binary to $GOPATH/bin

# Bazel
make bazel-build
make bazel-test
```

To run a single Go test:
```bash
go test ./apps/cli/internal/i18n/runsvc/... -run TestFunctionName -v
```

## Web App Commands (TypeScript)

This project uses **Vite+** (`vp`), a unified toolchain. Do not use `pnpm`/`npm`/`npx` directly.

```bash
vp install        # install dependencies (run after pulling changes)
vp dev            # dev server at http://localhost:3000
vp build          # production build
vp test           # run tests (Vitest)
vp check          # format + lint + TypeScript checks
vp check --fix    # auto-fix issues
vp lint           # lint only
vp fmt            # format only
```

Database (Drizzle + PostgreSQL):
```bash
npm run db:generate  # generate migrations
npm run db:migrate   # apply migrations
npm run db:studio    # open Drizzle Studio
```

Before committing web changes: `vp check --fix && vp test`

## CLI Architecture

Commands live in `apps/cli/cmd/`. The core services are:

| Package | Responsibility |
|---|---|
| `runsvc` | Translation generation planning and execution |
| `evalsvc` | Quality evaluation and scoring (with TUI) |
| `syncsvc` | Storage adapter orchestration and conflict resolution |
| `localstore` | Local translation file management |
| `lockfile` | Project state tracking |

Storage adapters (Crowdin, Lokalise, Phrase, Lilt, POEditor, Smartling) live in `internal/i18n/storage/{provider}/`.

LLM providers (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama, Gemini, Bedrock, LMStudio) are configured via `pkg/i18nconfig/` and resolved at runtime.

Config is read from `i18n.yml` or `i18n.jsonc` in the project root.

## Web Architecture

- **Next.js 16** with App Router (read `node_modules/next/dist/docs/` before writing Next.js code — this version has breaking API changes)
- **Hono** for API routes; root app exported from `src/api/app.ts`
- **Drizzle ORM** + PostgreSQL
- **WorkOS AuthKit** for authentication
- **shadcn/ui** + Tailwind CSS 4

Key conventions for the web app (see `apps/hyperlocalise-web/AGENTS.md` for full detail):
- Define Hono route handlers inline (route-local), not in separate controller files — this preserves type inference for `c.req.param()`
- Split larger APIs into route modules mounted with `app.route(...)`
- Use `createMiddleware` from `hono/factory` for middleware
- Test routes using Hono's `testClient` against the real app from `src/api/app.ts`
- Import test utilities from `vite-plus/test`, not `vitest` directly

## Release

Push a semver tag to trigger GoReleaser:
```bash
git tag v0.1.0
git push origin v0.1.0
```

GoReleaser builds multi-platform binaries (darwin/linux, amd64/arm64) and publishes to GitHub Releases.

## Commit Style

Conventional commits: `<type>(<scope>): <summary>`  
Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `init`
