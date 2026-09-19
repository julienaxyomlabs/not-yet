// The human decision, taken on a real terminal. Keys: a approve, r reject,
// i inspect (prints the normalized action and context as JSON).
//
// The terminal is put in raw mode once, for the life of the process, and
// stays there: keys pressed while nothing is pending are dropped, never
// echoed, never buffered — so a stray `a` typed at idle can never approve
// the next pause unseen. Only a single-byte key counts; escape sequences the
// terminal sends on its own (focus, resize reports) are ignored.
import type { Context, NormalizedAction, PolicyResult } from "./types.js";
import { renderPause } from "./render.js";

export type Choice = "approved" | "rejected";
export type KeyInput = { isTTY?: boolean; setRawMode?: (b: boolean) => unknown; resume: () => unknown; pause: () => unknown; setEncoding: (e: BufferEncoding) => unknown; on: (ev: "data", f: (k: string) => void) => unknown };

type Session = { inp: KeyInput; handler: ((k: string) => void) | null; onInterrupt: () => void };
let session: Session | null = null;

export function openKeys(inp: KeyInput = process.stdin, onInterrupt: () => void = () => process.exit(130)): Session {
  if (session && session.inp === inp) return session;
  if (!inp.isTTY || !inp.setRawMode) throw new Error("no terminal to ask on");
  inp.setRawMode(true); inp.resume(); inp.setEncoding("utf8");
  const s: Session = { inp, handler: null, onInterrupt };
  inp.on("data", (k: string) => {
    if (k === "\x03") { closeKeys(); s.onInterrupt(); return; }   // raw mode swallows SIGINT; honour Ctrl-C ourselves
    if (k.length !== 1) return;                                     // escape sequences, pasted text: never a decision
    s.handler?.(k);                                                 // idle → dropped
  });
  session = s;
  return s;
}

export function closeKeys() {
  if (!session) return;
  try { session.inp.setRawMode?.(false); session.inp.pause(); } catch { /* terminal already gone */ }
  session = null;
}

export async function askOnTerminal(raw: string, action: NormalizedAction, policy: PolicyResult, ctx: Context, opts: { auto?: Choice; out?: NodeJS.WriteStream; inp?: KeyInput } = {}): Promise<Choice> {
  const out = opts.out ?? process.stdout;
  const inp = opts.inp ?? process.stdin;
  out.write(renderPause(raw, policy, ctx, { ansi: out.isTTY, width: Math.min((out.columns || 80) - 4, 72) }));
  const dim = (s: string) => (out.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
  if (opts.auto) { out.write(dim(`${opts.auto === "approved" ? "approve" : "reject"} (auto)`) + "\n\n"); return opts.auto; }
  const s = openKeys(inp);
  out.write(dim("a / r · i to inspect") + " ");
  return new Promise<Choice>((resolve) => {
    const finish = (c: Choice) => { s.handler = null; out.write(`${c === "approved" ? "approve" : "reject"}\n\n`); resolve(c); };
    s.handler = (k) => {
      if (k === "a" || k === "y") finish("approved");
      else if (k === "r" || k === "n" || k === "q") finish("rejected");
      else if (k === "i") out.write("\n\n" + JSON.stringify({ action, policy, context: ctx }, null, 2) + "\n\n" + dim("a / r") + " ");
    };
  });
}
