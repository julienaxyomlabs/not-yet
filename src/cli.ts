#!/usr/bin/env node
// notyet — friction for autonomous agents.
process.removeAllListeners("warning");
process.on("warning", (w) => { if (w.name !== "ExperimentalWarning") process.stderr.write(`${w.name}: ${w.message}\n`); });
import { readStdin, runHook, runPost } from "./hook.js";
import { runWatch } from "./watch.js";
import { runDemo } from "./demo.js";
import { runMcp } from "./mcp.js";
import { install, uninstall, hookConfig, mcpConfig } from "./install.js";
import { normalize } from "./normalize.js";
import { evaluate } from "./policy.js";
import { enrich } from "./context.js";
import { renderPause } from "./render.js";
import { readAll, logPath } from "./log.js";

const [, , cmd = "help", ...rest] = process.argv;

const HELP = `notyet — friction for autonomous agents.

  notyet watch                 keep this open next to the agent; it answers the pauses
  notyet demo [--auto=approved,rejected,approved] [--fast] [--transcript=file]
  notyet check "<command>"     what would happen to this shell command
  notyet log [-n 20]           the last decisions
  notyet install [dir] [--global] [--mcp]   register the Claude Code hooks (and the demo MCP server)
  notyet uninstall [dir] [--global]
  notyet config                print the hook + mcp json without writing anything
  notyet hook | post | mcp     used by Claude Code
`;

(async () => {
  switch (cmd) {
    case "hook": { const raw = await readStdin(); let input; try { input = JSON.parse(raw); } catch { return; } await runHook(input); return; }
    case "post": { const raw = await readStdin(); try { runPost(JSON.parse(raw)); } catch {} return; }
    case "watch": return runWatch();
    case "demo": return runDemo(rest);
    case "mcp": return runMcp();
    case "install": return install(rest);
    case "uninstall": return uninstall(rest);
    case "config": process.stdout.write(JSON.stringify({ hooks: hookConfig(), ...mcpConfig() }, null, 2) + "\n"); return;
    case "check": {
      const command = rest.join(" "); if (!command) { process.stderr.write("usage: notyet check \"<command>\"\n"); process.exit(2); }
      const action = normalize({ tool: "Bash", input: { command }, cwd: process.cwd() });
      const policy = evaluate(action);
      if (policy.decision === "allow") { process.stdout.write(`allow  ${command}\n`); return; }
      process.stdout.write(renderPause(action.raw, policy, await enrich(action, process.cwd()), { ansi: process.stdout.isTTY }));
      process.stdout.write(JSON.stringify({ decision: policy.decision, reasons: policy.reasons }) + "\n");
      return;
    }
    case "log": {
      const n = Number(rest[rest.indexOf("-n") + 1] || 20);
      const all = readAll().filter((e) => e.event_id).slice(-n);
      if (!all.length) { process.stdout.write(`no events yet (${logPath()})\n`); return; }
      for (const e of all) process.stdout.write(`${String(e.timestamp).slice(0, 19)}  ${String(e.policy_decision).padEnd(18)} ${String(e.human_decision ?? "—").padEnd(26)} ${e.tool}  ${String(e.raw_action).slice(0, 60)}\n`);
      return;
    }
    default: process.stdout.write(HELP);
  }
})().catch((e) => { process.stderr.write(String(e?.stack ?? e) + "\n"); process.exit(1); });
