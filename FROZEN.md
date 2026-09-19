# FROZEN — NOT YET V1

Frozen 2026-09-19. A working prototype and demo, not a security product.

Real: the Claude Code PreToolUse/PostToolUse hook and its contract, the normalizer, the policy engine, the context enricher (git, file counts, read-only SQLite counts), the watch terminal, the hand-off between hook and watcher, the event log, the MCP demo server, the in-process gate the demo uses, 128 tests.

Simulated: the demo *agent* is a script; `deploy_production` deploys nothing; `send_email` writes to a local outbox. The live-in-Claude-Code run was not executed from the build session (the nested CLI could not authenticate there); `test/live.sh` prepares it for a human.

Not built on purpose: auth, teams, billing, cloud sync, replay, rollback, dashboards, RBAC, model-based risk scoring, multi-agent support, process tracing, analytics.
