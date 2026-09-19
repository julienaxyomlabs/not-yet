# FROZEN — NOT YET V1

Frozen 2026-09-19. A working prototype and demo, not a security product.

Real: the Claude Code PreToolUse/PostToolUse hook and its contract, the normalizer, the policy engine, the context enricher (git, file counts, read-only SQLite counts), the watch terminal, the hand-off between hook and watcher, the event log, the MCP demo server, the in-process gate the demo uses, 128 tests.

Simulated: the demo *agent* is a script; `deploy_production` deploys nothing; `send_email` writes to a local outbox. The live-in-Claude-Code run was not executed from the build session (the nested CLI could not authenticate there); `test/live.sh` prepares it for a human.

Not built on purpose: auth, teams, billing, cloud sync, replay, rollback, dashboards, RBAC, model-based risk scoring, multi-agent support, process tracing, analytics.

## V1 live-proven — 2026-09-19

`npm run live:test` against the real Claude Code PreToolUse hook, disposable sandboxes only: safe / reject / approve / mcp / exact-once / event-log all PASS → `V1 CORE LIVE PROOF: PASS` (saved in docs/live-validation.txt). Deterministic suite 137/137.

Two real bugs found and fixed during validation, both minimal, neither weakening fail-closed:
- watcher input: raw mode is held for the watcher's whole lifetime; idle keys are dropped, escape sequences never decide, the terminal is restored on exit (src/approve.ts, src/watch.ts; test/keys.test.mjs).
- heartbeat liveness: read by atomic mtime instead of a torn JSON read, so a hook polling it can't mistake a live watcher for a dead one and fail closed against a present human (src/pending.ts; test/heartbeat.test.mjs).

Shipped: github.com/julienaxyomlabs/not-yet, tag v1-live-proof-2026-09-19; landing page on Vercel.
