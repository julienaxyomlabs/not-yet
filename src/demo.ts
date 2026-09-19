// `notyet demo` — a scripted agent doing ordinary work fast, then hitting
// three consequential actions. The agent is scripted; the interception,
// policy, context, approval and execution are the real code paths. Everything
// it touches is created in a temp directory and removed afterwards.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gate, type Ask } from "./gate.js";
import { DEMO_TOOLS } from "./tools.js";
import { askOnTerminal, closeKeys, type Choice } from "./approve.js";
import type { ToolCall } from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runDemo(argv: string[]): Promise<void> {
  const auto = (argv.find((a) => a.startsWith("--auto="))?.slice(7) ?? "").split(",").filter(Boolean) as Choice[];
  const fast = argv.includes("--fast");
  const transcriptPath = argv.find((a) => a.startsWith("--transcript="))?.slice(13);
  const out = process.stdout;
  const tty = out.isTTY;
  const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
  const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
  const t0 = Date.now();
  const transcript: { t: number; text: string }[] = [];
  let partial = "";
  const record = (chunk: string) => { partial += chunk.replace(/\x1b\[[0-9;]*m/g, ""); const lines = partial.split("\n"); partial = lines.pop() ?? ""; for (const l of lines) transcript.push({ t: Date.now() - t0, text: l }); };
  const say = (s = "") => { out.write(s + "\n"); record(s + "\n"); };
  // the pause renders through the same recorder, so the transcript holds what a human saw
  const rec = { write: (s: string) => { out.write(s); record(s); return true; }, isTTY: out.isTTY, columns: out.columns } as unknown as NodeJS.WriteStream;
  const wait = (ms: number) => (fast ? sleep(20) : sleep(ms));

  // ── a disposable world ──
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notyet-demo-"));
  const repo = path.join(root, "app"); fs.mkdirSync(repo);
  const origin = path.join(root, "origin.git");
  const g = (args: string[], cwd = repo) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  execFileSync("git", ["init", "-q", "--bare", origin]);
  g(["init", "-q", "-b", "main"]); g(["config", "user.email", "agent@example.com"]); g(["config", "user.name", "agent"]);
  fs.writeFileSync(path.join(repo, "index.js"), "export const ok = true;\n");
  fs.writeFileSync(path.join(repo, "test.mjs"), "import assert from 'node:assert'; assert.ok(true); console.log('1 test passed');\n");
  fs.writeFileSync(path.join(repo, "build.mjs"), "console.log('built 23 files');\n");
  fs.writeFileSync(path.join(repo, "build.log"), "stale\n"); fs.writeFileSync(path.join(repo, "tmp.txt"), "stale\n");
  g(["add", "."]); g(["commit", "-q", "-m", "initial"]); g(["remote", "add", "origin", origin]); g(["push", "-q", "-u", "origin", "main"]);
  g(["checkout", "-q", "-b", "cleanup"]); g(["push", "-q", "-u", "origin", "cleanup"]);
  const db = path.join(root, "app.db");
  { const { DatabaseSync } = await import("node:sqlite"); const c = new DatabaseSync(db); c.exec("create table customers (id integer primary key, email text, inactive integer)"); const ins = c.prepare("insert into customers (email, inactive) values (?, ?)"); for (let i = 0; i < 1000; i++) ins.run(`user${i}@example.com`, i % 1000 < 427 ? 1 : 0); c.close(); }
  process.env.NOTYET_HOME ??= path.join(root, "notyet-home");

  const sh = (cmd: string) => async () => execFileSync("sh", ["-c", cmd], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  let autoIdx = 0;
  const ask: Ask = (raw, action, policy, ctx) => askOnTerminal(raw, action, policy, ctx, { auto: auto.length ? (auto[autoIdx++] ?? "rejected") : undefined, out: rec });
  const step = async (label: string, call: ToolCall, exec: () => Promise<unknown>, note?: string) => {
    await wait(350);
    const started = Date.now();
    const r = await gate(call, exec, { ask, run_id: "run_demo" });
    if (r.decision === "allow") say(`  ${dim("✓")} ${label}${note ? "  " + dim(note) : ""}  ${dim(`${Date.now() - started}ms`)}`);
    else if (r.executed) say(`  ${dim("✓")} ${label}  ${dim("approved · executed once")}`);
    else say(`  ${dim("✕")} ${label}  ${dim(r.decision === "deny" ? "denied by policy" : "rejected · not executed")}`);
    return r;
  };

  say(""); say(dim("ombrise / experiment 003")); say(bold("NOT YET") + dim("  ·  friction for autonomous agents")); say(""); say(dim(`sandbox ${transcriptPath ? "/tmp/notyet-demo" : root}`)); say("");
  say(bold("agent") + "  clean the repository and deploy it"); say("");
  await step("ls", { tool: "Bash", input: { command: "ls" }, cwd: repo }, sh("ls"));
  await step("git status", { tool: "Bash", input: { command: "git status --short" }, cwd: repo }, sh("git status --short"));
  await step("rm build.log tmp.txt", { tool: "Bash", input: { command: "rm build.log tmp.txt" }, cwd: repo }, sh("rm build.log tmp.txt"), "removed unused files");
  await step("node test.mjs", { tool: "Bash", input: { command: "node test.mjs" }, cwd: repo }, sh("node test.mjs"), "1 test passed");
  await step("node build.mjs", { tool: "Bash", input: { command: "node build.mjs" }, cwd: repo }, sh("node build.mjs"), "built 23 files");
  await step("git commit -am 'clean'", { tool: "Bash", input: { command: "git commit -qam clean" }, cwd: repo }, sh("git commit -qam clean"));
  await step("git push", { tool: "Bash", input: { command: "git push" }, cwd: repo }, sh("git push -q"), "→ origin/cleanup");
  say("");
  const changed = Array.from({ length: 23 }, (_, i) => (i < 4 ? `supabase/migrations/000${i + 1}_x.sql` : `src/file${i}.ts`));
  await step("deploy_production()", { tool: "mcp__notyet-demo__deploy_production", input: { changed_files: changed, migrations: 4 }, cwd: repo }, () => DEMO_TOOLS.deploy_production.run({ changed_files: changed, migrations: 4 }));
  say("");
  say(bold("agent") + "  now tell everyone about the release"); say("");
  const r2 = await step("send_email(recipients: 1842)", { tool: "mcp__notyet-demo__send_email", input: { recipient_count: 1842, subject: "we shipped" }, cwd: repo }, () => DEMO_TOOLS.send_email.run({ recipient_count: 1842, subject: "we shipped" }));
  if (!r2.executed) { say(dim("  agent received: ") + dim(JSON.stringify(r2.rejection?.status) + " · " + (r2.rejection?.message ?? "").slice(0, 60) + "…")); say(bold("agent") + "  understood. sending to the 3 people on the launch thread instead"); say("");
    await step("send_email(recipients: 3)", { tool: "mcp__notyet-demo__send_email", input: { recipients: ["a@example.com", "b@example.com", "c@example.com"], subject: "we shipped" }, cwd: repo }, () => DEMO_TOOLS.send_email.run({ recipients: ["a@example.com", "b@example.com", "c@example.com"], subject: "we shipped" }), "queued in demo outbox"); }
  say("");
  say(bold("agent") + "  archive inactive customers"); say("");
  const sql = "DELETE FROM customers WHERE inactive = 1";
  await step("run_sql(DELETE FROM customers …)", { tool: "mcp__notyet-demo__run_sql", input: { db, sql, environment: "production" }, cwd: repo }, () => DEMO_TOOLS.run_sql.run({ db, sql }));
  say("");
  say(dim(`events → ${transcriptPath ? "~/.notyet/events.jsonl" : path.join(process.env.NOTYET_HOME!, "events.jsonl")}`));
  say("");
  closeKeys();
  if (transcriptPath) fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 1));
  if (!argv.includes("--keep")) fs.rmSync(root, { recursive: true, force: true });
}
