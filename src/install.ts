// Write the hook registration. Project-level by default (.claude/settings.json
// in the given directory); --global merges into ~/.claude/settings.json after
// taking a timestamped backup. Existing hooks are kept; ours are added once.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const MATCHER = "Bash|Write|Edit|MultiEdit|NotebookEdit|mcp__.*";
const cli = () => fileURLToPath(new URL("./cli.js", import.meta.url));

export function hookConfig() {
  const cmd = (sub: string) => ({ type: "command", command: `node --no-warnings=ExperimentalWarning "${cli()}" ${sub}`, timeout: 600 });
  return { PreToolUse: [{ matcher: MATCHER, hooks: [cmd("hook")] }], PostToolUse: [{ matcher: MATCHER, hooks: [cmd("post")] }] };
}
export function mcpConfig() { return { mcpServers: { "notyet-demo": { command: "node", args: [cli(), "mcp"] } } }; }

export function install(argv: string[]): void {
  const global = argv.includes("--global");
  const dir = argv.find((a) => !a.startsWith("--")) ?? process.cwd();
  const file = global ? path.join(os.homedir(), ".claude", "settings.json") : path.join(path.resolve(dir), ".claude", "settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(file)) { settings = JSON.parse(fs.readFileSync(file, "utf8")); const bak = `${file}.bak-${Date.now()}`; fs.copyFileSync(file, bak); process.stdout.write(`backup → ${bak}\n`); }
  const hooks = (settings.hooks ??= {}) as Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
  for (const [event, entries] of Object.entries(hookConfig())) {
    const list = (hooks[event] ??= []);
    const already = list.some((e) => e.hooks?.some((h) => /notyet|not-yet\/dist\/cli\.js/.test(h.command)));
    if (!already) list.push(...entries);
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  process.stdout.write(`hooks → ${file}\n`);
  if (argv.includes("--mcp")) {
    const mcpFile = path.join(global ? os.homedir() : path.resolve(dir), global ? ".claude.json" : ".mcp.json");
    let cfg: Record<string, unknown> = {}; if (fs.existsSync(mcpFile)) cfg = JSON.parse(fs.readFileSync(mcpFile, "utf8"));
    cfg.mcpServers = { ...(cfg.mcpServers as object), ...mcpConfig().mcpServers };
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
