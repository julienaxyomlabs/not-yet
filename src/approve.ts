// The human decision, taken on a real terminal. Keys: a approve, r reject,
// i inspect (prints the normalized action and context as JSON), q reject.
import type { Context, NormalizedAction, PolicyResult } from "./types.js";
import { renderPause } from "./render.js";

export type Choice = "approved" | "rejected";

export async function askOnTerminal(raw: string, action: NormalizedAction, policy: PolicyResult, ctx: Context, opts: { auto?: Choice; out?: NodeJS.WriteStream; inp?: NodeJS.ReadStream } = {}): Promise<Choice> {
  const out = opts.out ?? process.stdout;
  const inp = opts.inp ?? process.stdin;
  out.write(renderPause(raw, policy, ctx, { ansi: out.isTTY, width: Math.min((out.columns || 80) - 4, 72) }));
  const dim = (s: string) => (out.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
  if (opts.auto) { out.write(dim(`${opts.auto === "approved" ? "approve" : "reject"} (auto)`) + "\n\n"); return opts.auto; }
  if (!inp.isTTY) throw new Error("no terminal to ask on");
  out.write(dim("a / r · i to inspect") + " ");
  return new Promise<Choice>((resolve) => {
    inp.setRawMode(true); inp.resume(); inp.setEncoding("utf8");
    const done = (c: Choice) => { inp.setRawMode(false); inp.pause(); inp.off("data", onData); out.write(`${c === "approved" ? "approve" : "reject"}\n\n`); resolve(c); };
    const onData = (k: string) => {
      if (k === "a" || k === "y") done("approved");
      else if (k === "r" || k === "n" || k === "q" || k === "\x03" || k === "\x1b") done("rejected");
      else if (k === "i") { out.write("\n\n" + JSON.stringify({ action, policy, context: ctx }, null, 2) + "\n\n\x1b[2ma / r\x1b[0m "); }
    };
    inp.on("data", onData);
  });
}
