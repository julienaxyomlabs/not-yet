// Write the hook registration. Project-level by default (.claude/settings.json
// in the given directory); --global merges into ~/.claude/settings.json after
// taking a timestamped backup. Existing hooks are kept; ours are added once.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const MATCHER = "Bash|Write|Edit|MultiEdit|NotebookEdit|mcp__.*";
const cli = () => fileURLToPath(new URL("./cli.js", import.meta.url));

// opts.home / opts.budget are for test harnesses: they pin the hook to a
// private NOT YET home and a shorter wait, without touching the user's own.
export type InstallOpts = { home?: string; budget?: number };
export function hookConfig(opts: InstallOpts = {}) {
  const env = [opts.home ? `NOTYET_HOME="${opts.home}"` : "", opts.budget ? `NOTYET_HOOK_BUDGET_MS=${opts.budget}` : ""].filter(Boolean).join(" ");
  const cmd = (sub: string) => ({ type: "command", command: `${env ? env + " " : ""}node --no-warnings=ExperimentalWarning "${cli()}" ${sub}`, timeout: opts.budget ? Math.ceil(opts.budget / 1000) + 30 : 600 });
  return { PreToolUse: [{ matcher: MATCHER, hooks: [cmd("hook")] }], PostToolUse: [{ matcher: MATCHER, hooks: [cmd("post")] }] };
}
export function mcpConfig(opts: InstallOpts = {}) { return { mcpServers: { "notyet-demo": { command: "node", args: [cli(), "mcp"], ...(opts.home ? { env: { NOTYET_HOME: opts.home } } : {}) } } }; }

function parse(argv: string[]) {
  const opts: InstallOpts = {}; const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--home") opts.home = argv[++i];
    else if (argv[i] === "--budget") opts.budget = Number(argv[++i]);
    else rest.push(argv[i]);
  }
  return { opts, rest };
}

export function install(argv0: string[]): void {
  const { opts, rest: argv } = parse(argv0);
  const global = argv.includes("--global");
  const dir = argv.find((a) => !a.startsWith("--")) ?? process.cwd();
  const file = global ? path.join(os.homedir(), ".claude", "settings.json") : path.join(path.resolve(dir), ".claude", "settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(file)) { settings = JSON.parse(fs.readFileSync(file, "utf8")); const bak = `${file}.bak-${Date.now()}`; fs.copyFileSync(file, bak); process.stdout.write(`backup → ${bak}\n`); }
  const hooks = (settings.hooks ??= {}) as Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
  for (const [event, entries] of Object.entries(hookConfig(opts))) {
    const list = (hooks[event] ??= []);
    const already = list.some((e) => e.hooks?.some((h) => /notyet|not-yet\/dist\/cli\.js/.test(h.command)));
    if (!already) list.push(...entries);
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  process.stdout.write(`hooks → ${file}\n`);
  if (argv.includes("--mcp")) {
    const mcpFile = path.join(global ? os.homedir() : path.resolve(dir), global ? ".claude.json" : ".mcp.json");
    let cfg: Record<string, unknown> = {}; if (fs.existsSync(mcpFile)) cfg = JSON.parse(fs.readFileSync(mcpFile, "utf8"));
    cfg.mcpServers = { ...(cfg.mcpServers as object), ...mcpConfig(opts).mcpServers };
    fs.writeFileSync(mcpFile, JSON.stringify(cfg, null, 2) + "\n");
    process.stdout.write(`demo mcp server → ${mcpFile}\n`);
  }
}

export function uninstall(argv: string[]): void {
  const global = argv.includes("--global");
  const dir = argv.find((a) => !a.startsWith("--")) ?? process.cwd();
  const file = global ? path.join(os.homedir(), ".claude", "settings.json") : path.join(path.resolve(dir), ".claude", "settings.json");
  if (!fs.existsSync(file)) return;
  const settings = JSON.parse(fs.readFileSync(file, "utf8"));
  const hooks = settings.hooks ?? {};
  for (const ev of Object.keys(hooks)) hooks[ev] = hooks[ev].filter((e: { hooks?: { command: string }[] }) => !e.hooks?.some((h) => /not-yet\/dist\/cli\.js/.test(h.command)));
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  process.stdout.write(`removed notyet hooks from ${file}\n`);
}
