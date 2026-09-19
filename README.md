# NOT YET

ombrise / experiment 003 — friction for autonomous agents.

Griotta adds friction before consequential human actions. NOT YET adds friction before consequential agent actions: before an agent deploys, deletes, sends, charges or publishes, it stops, shows what is about to happen, and a person decides.

```
agent → interceptor → normalize → policy (allow | approval_required | deny) → context → human → execute once → event log
```

No model in the loop. The rules are plain code in [`src/policy.ts`](src/policy.ts); the parsing is in [`src/normalize.ts`](src/normalize.ts). Every decision is a JSON line in `~/.notyet/events.jsonl`.

## Run

```
npm install
npm run demo          # a scripted agent in a throwaway sandbox; you answer the pauses (a / r / i)
node dist/cli.js check "git push --force origin main"
```

## In Claude Code (real interception)

The interception point is a Claude Code `PreToolUse` hook on `Bash|Write|Edit|MultiEdit|NotebookEdit|mcp__.*`. Harmless calls get no output from the hook, so Claude Code's own permission flow is untouched. Consequential calls are held until a human answers:

- with `notyet watch` open in another terminal → the pause renders there, `a`/`r` decide, the hook returns `allow` or a structured `deny` the agent can read and replan from;
- with no watch terminal → the hook returns `ask` and Claude Code's own permission prompt carries the NOT YET block.

```
node dist/cli.js install .          # writes .claude/settings.json in this project (backup taken if one exists)
node dist/cli.js install . --mcp    # also registers the demo MCP server (deploy_production, send_email, run_sql)
node dist/cli.js install --global   # ~/.claude/settings.json instead
node dist/cli.js watch              # keep open next to the agent
node dist/cli.js log                # what was paused and what was decided
sh test/live.sh                     # a disposable project ready for a real Claude Code session
```

Hooks have no terminal of their own (Claude Code runs them without a TTY), which is why the watch terminal exists. Hook timeout is 600 s; an unanswered pause fails closed.

## What pauses, what passes

Passes: reads, `git status/diff/log`, tests, builds, commits, pushes to unprotected branches, ordinary file writes, `rm` of a few named files, single-recipient sends, staging deploys.

Pauses: force push, push/merge to `main|master|production|release|live`, `git reset --hard`/`clean -f`/`checkout -- .`, recursive or glob deletes, `DELETE`/`DROP`/`TRUNCATE`/`ALTER … DROP`/`UPDATE` without `WHERE`, migrations (`supabase db push`, `prisma migrate …`), production deploys and deploys whose environment is unknown, `kubectl apply`/`terraform apply|destroy`, `npm publish`/releases/`docker push`, sends to ≥10 or an unknown number of people, payments, credential changes or reads, permission changes, `sudo`, anything naming production, and any risky-looking line the tokenizer cannot parse (`$(…)`, backticks, unbalanced quotes).

Denies: `rm -rf /`, `~`, `$HOME`; `mkfs`; sending a secret file over the network.

Context shown at the pause is only what can be derived cheaply and read-only: branch/ahead/force for pushes, file counts for deletes, a `COUNT(*)` through a read-only connection for local SQLite, recipient counts, changed files and migrations for deploys. Anything else says `unknown`.

## Tests

`npm test` — 128 deterministic cases: the allow/pause/deny matrix, MCP tool names, file tools, the gate (executes exactly once, never before approval, never on reject or deny, fails closed on unparseable input, logs match), and the hook as a process (silent on safe calls, `ask` without a watcher, `allow`/`deny` with one, no hang if the watcher dies, `post` reconciliation, garbage input).

## Demo safety

The demo and tests only touch temp directories, a bare git remote created for the run, a SQLite file inside the sandbox, a fake deploy and a fake outbox. `run_sql` refuses any file outside the NOT YET home or the OS temp dir.
