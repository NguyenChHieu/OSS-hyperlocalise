# Vercel Services go-svc public rewrite

## Problem

`go-svc` already implements CAT segment validation, but it is not deployed.
The CAT client posts to `/api/go-svc/v1/validate/segment`. A July Services
attempt used the same public rewrite layout; the catch-all `/(.*)` → `web`
rewrite broke WorkOS auth and was reverted (`0fa9e26ac`).

## Decision

Use Vercel’s public frontend + public API pattern:

- `web` is Next.js, reached by the catch-all rewrite.
- `go_svc` is a container, reached by `/api/go-svc/(.*)`.
- The browser posts the WorkOS session cookie straight to
  `/api/go-svc/v1/validate/segment`.
- `go-svc` verifies `wos-session` itself.
- A `request.path` transform strips `/api/go-svc` so Go also sees
  `/v1/validate/segment` and `/health`. The same routes are mounted under
  `/api/go-svc` if the transform does not run.

No Next.js proxy and no service binding.

## Dashboard

A project builds as services only when both are true:

1. Framework is **Services**.
2. Root Directory is the repository root, so root `vercel.json` is read.

Keep `apps/hyperlocalise-web/vercel.json` crons as a fallback until that
switch is done.

## Local

`vercel dev -L` runs both services and the rewrite table. `vp run dev` has
no Services router, so `/api/go-svc` 404s unless you point CAT at a local
`go-svc` on `:8080`.

## Out of scope

Service bindings, a Hono proxy, and Crowdin embed session auth on `go-svc`.
