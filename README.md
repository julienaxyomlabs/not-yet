# NOT YET

**ombrise / experiment 003 — friction for autonomous agents.**

Griotta adds friction before consequential *human* actions. NOT YET adds friction before consequential *agent* actions. Before an autonomous or coding agent deploys, deletes, sends, charges or publishes, NOT YET stops it, shows what is about to happen, and a person decides. Ordinary work is never interrupted.

```
agent → intercept → normalize → policy (allow · approval_required · deny) → context → human → execute once → event log
```

No model sits in this loop. The rules are plain, ordered code in [`src/policy.ts`](src/policy.ts); the parsing is in [`src/normalize.ts`](src/normalize.ts). Every decision is one JSON line in `~/.notyet/events.jsonl`.

**Griotta slows humans. NOT YET slows agents.** · [not-yet-swart.vercel.app](https://not-yet-swart.vercel.app)

---

## Install

```
git clone https://github.com/julienaxyomlabs/not-yet && cd not-yet
npm install
npm run build
```

Node ≥ 22.13 (uses the built-in `node:sqlite`). No other runtime dependencies.

Try the pipeline immediately, with a scripted agent in a throwaway sandbox — you answer the pauses (`a` / `r` / `i`):

```
npm run demo
```

## Use it with Claude Code

The interception point is a real Claude Code **`PreToolUse` hook** on `Bash|Write|Edit|MultiEdit|NotebookEdit|mcp__.*`. Register it, and keep one **watch terminal** open next to the agent:

```
node dist/cli.js install .          # writes .claude/settings.json here (a backup is taken if one exists)
node dist/cli.js install . --mcp    # also register the demo MCP server (deploy_production, send_email, run_sql)
node dist/cli.js install --global   # ~/.claude/settings.json instead
node dist/cli.js watch              # keep this open beside the agent — it answers the pauses
node dist/cli.js log                # the decisions so far
```

Harmless calls get **no output** from the hook, so Claude Code's own permission flow is untouched. Consequential calls are held until a human answers:

- with `notyet watch` open → the pause renders there, one key (`a`/`r`) decides, and the hook returns `allow` or a structured `deny` the agent reads and replans from;
- with no watch terminal → the hook returns `ask` and Claude Code's own permission prompt carries the NOT YET block.

### What the pause looks like

The agent proposes `git push --force origin main`. It does **not** run. The watch terminal shows:

```
NOT YET

agent wants to:

  git push --force origin main

branch                 main → origin/main
commits ahead          1
commits overwritten    0
force                  yes
protected              yes
reversible             no

because force_push — rewrites history on the remote, protected_branch — targets a protected branch

[ approve ]  [ reject ]
```

Press `r` and the agent receives a structured rejection (it can replan); press `a` and the exact original command runs once.

## What pauses, what passes

Deterministic categories, high level (full table in [`src/policy.ts`](src/policy.ts)):

- **Pass** — reads, `git status/diff/log`, tests, builds, commits, pushes to unprotected branches, ordinary file writes, `rm` of a few named files, single-recipient sends, staging deploys.
- **Pause (a human decides)** — force push · push/merge to `main|master|production|release|live` · `git reset --hard` / `clean -f` / `checkout -- .` · recursive or glob deletes · `DELETE` / `DROP` / `TRUNCATE` / `ALTER … DROP` / `UPDATE` without `WHERE` · migrations · production deploys and deploys with an unknown environment · `kubectl apply` / `terraform apply|destroy` · `npm publish` / releases / `docker push` · sends to ≥ 10 or an unknown number of people · payments · credential changes or reads · permission changes · `sudo` · anything naming production.
- **Deny (never from an agent)** — `rm -rf /` · `~` · `$HOME` · `mkfs` · sending a secret file over the network.

**Fail closed.** A risky-looking command the shell tokenizer can't parse (`$(…)`, backticks, unbalanced quotes) pauses rather than passing. An `approval_required` pause that nobody answers is **denied** when the watcher is absent or the hook's window elapses — never silently executed. The blast-radius facts shown at a pause are only what can be derived cheaply and read-only (branch/ahead/force, file counts, a `COUNT(*)` through a **read-only** SQLite connection, recipient counts, changed files and migrations); anything else says `unknown`.

## Event log

Append-only JSONL at `~/.notyet/events.jsonl` (override with `NOTYET_HOME`). One line per intercepted action: the raw and normalized action, the policy decision and its reasons, the derived context, the human decision, and a reconciliation line when an approved action actually executed.

## Live validation

One command runs the whole thing against the **real Claude Code hook**, in disposable local sandboxes, and asserts repo state plus the event log after every decision:

```
npm run live:test
```

It creates fresh throwaway git repos under the OS temp dir — each with a **local bare `origin`** (`../origin.git`), never a network remote — installs the real hooks, runs `claude -p` agents, and pauses at each consequential action for your single key. Hard guards abort before any force push unless `cwd` is inside the temp root, the origin URL is a local filesystem path (no `://`, no `@`, no github/gitlab/bitbucket), and the bare repo also lives inside the temp root. **It uses only disposable local resources — no real remote, database, email provider, or deployment target is ever touched.** The last saved run is in [`docs/live-validation.txt`](docs/live-validation.txt).

### Validated result

```
V1 CORE LIVE PROOF: PASS

safe path        PASS      ls / git status / git log run, no pause, repo unchanged
reject path      PASS      force push paused → r → never executed, origin unchanged, agent gets a structured rejection
approve path     PASS      force push paused → a → executed exactly once, origin advances, one reconciliation line
mcp path         PASS      send_email(1842) paused → r → fake tool never runs
exact-once       PASS      one push, one execution, no duplicate
event log        PASS      one action, one policy decision, one human decision, scoped to the run
```

Deterministic suite: **137/137** (`npm test`) — the allow/pause/deny matrix, MCP tool names, file tools, the gate (executes exactly once, never before approval, never on reject/deny, fails closed on unparseable input), the hook as a process, the watcher's raw-input path, and the heartbeat under concurrent rewrites.

## Not in V1, on purpose

No auth, teams, billing, cloud sync, replay, rollback, dashboards, RBAC, model-based risk scoring, generic multi-agent support, or analytics. A prototype that proves one idea, not a security product.

MIT.
