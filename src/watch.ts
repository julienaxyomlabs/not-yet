// `notyet watch` — a terminal that answers for the hooks. Keep it open next
// to the agent. It heartbeats so hooks know someone is there, shows each
// pending action, takes one key, and writes the decision back.
import { askOnTerminal } from "./approve.js";
import { beat, listPending, writeDecision, watcherAlive } from "./pending.js";
import { home } from "./log.js";

export async function runWatch(): Promise<void> {
  if (watcherAlive() && !process.env.NOTYET_FORCE_WATCH) { process.stderr.write("another notyet watch is already running.\n"); process.exit(1); }
  const out = process.stdout;
  const dim = (s: string) => (out.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
  beat(); const hb = setInterval(beat, 2000);
  out.write(`\n${dim("NOT YET · watching.")}  ${dim(home())}\n${dim("consequential actions from the agent will appear here. a approve · r reject · i inspect")}\n\n`);
  const seen = new Set<string>();
  process.on("SIGINT", () => { clearInterval(hb); out.write("\n"); process.exit(0); });
  for (;;) {
    const p = listPending().find((x) => !seen.has(x.id));
    if (!p) { await new Promise((r) => setTimeout(r, 300)); continue; }
    seen.add(p.id);
    out.write(dim(`${new Date(p.created).toLocaleTimeString()}  ${p.tool}${p.cwd ? "  " + p.cwd : ""}`) + "\n");
    const choice = await askOnTerminal(p.raw, p.action, p.policy, p.context, { out });
    writeDecision(p.id, { decision: choice, at: new Date().toISOString(), by: "human (notyet watch)" });
  }
}
