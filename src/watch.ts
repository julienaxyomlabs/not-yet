// `notyet watch` — a terminal that answers for the hooks. Keep it open next
// to the agent. It heartbeats so hooks know someone is there, shows each
// pending action, takes one key, and writes the decision back.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { askOnTerminal, openKeys, closeKeys } from "./approve.js";
import { beat, listPending, writeDecision, watcherAlive } from "./pending.js";
import { home } from "./log.js";

export async function runWatch(): Promise<void> {
  if (watcherAlive() && !process.env.NOTYET_FORCE_WATCH) { process.stderr.write(`another notyet watch is already answering for ${home()}.\n`); process.exit(1); }
  const out = process.stdout;
  const dim = (s: string) => (out.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
  const bold = (s: string) => (out.isTTY ? `\x1b[1m${s}\x1b[0m` : s);
  const heartbeatFile = path.join(home(), "watcher.json");
  const stop = (code: number) => { clearInterval(hb); try { fs.unlinkSync(heartbeatFile); } catch {} closeKeys(); out.write("\n"); process.exit(code); };
  beat(); const hb = setInterval(beat, 2000);
  process.on("SIGINT", () => stop(130)); process.on("SIGTERM", () => stop(143));
  // raw mode from the start: nothing typed at idle is echoed or buffered
  try { openKeys(process.stdin, () => stop(130)); } catch { process.stderr.write("notyet watch needs a terminal.\n"); stop(1); }
  let tty = "?"; try { tty = execFileSync("ps", ["-o", "tty=", "-p", String(process.pid)]).toString().trim(); } catch {}
  out.write(`\n${bold("NOT YET WATCHER — ACTIVE")}  ${dim(`pid ${process.pid} · ${tty} · ${home()}`)}\n${dim("consequential actions from the agent will appear here. a approve · r reject · i inspect · ctrl-c quit")}\n\n`);
  const seen = new Set<string>();
  for (;;) {
    const p = listPending().find((x) => !seen.has(x.id));
    if (!p) { await new Promise((r) => setTimeout(r, 300)); continue; }
    seen.add(p.id);
    out.write(dim(`${new Date(p.created).toLocaleTimeString()}  ${p.tool}${p.cwd ? "  " + p.cwd : ""}`) + "\n");
    const choice = await askOnTerminal(p.raw, p.action, p.policy, p.context, { out });
    writeDecision(p.id, { decision: choice, at: new Date().toISOString(), by: "human (notyet watch)" });
  }
}
